"""Redis-based alert deduplication and rate limiting.

Uses Redis sorted sets for sliding-window rate limiting and
simple key expiry for deduplication.

Per camera:
- Dedup: Skip if the most recent alert for that camera was < N seconds ago
- Rate limit: Hard cap on alerts per camera per minute
"""

import time
from typing import Optional

import redis.asyncio as redis

from .config import Config
from .logging_config import get_logger

logger = get_logger(__name__)


class AlertRateLimiter:
    """Redis-backed alert deduplication and rate limiting."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self._redis: Optional[redis.Redis] = None  # type: ignore[type-arg]

    async def connect(self) -> None:
        """Connect to Redis."""
        logger.info("Connecting to Redis", url=self.config.redis_url)
        self._redis = redis.from_url(
            self.config.redis_url,
            decode_responses=True,
        )
        # Test connection
        await self._redis.ping()
        logger.info("Redis connected")

    async def should_alert(self, camera_id: str) -> bool:
        """Check if an alert should be emitted for this camera.

        Returns True if the alert should proceed, False if deduplicated/rate-limited.

        Two checks:
        1. Dedup: Was the last alert for this camera < dedup_window seconds ago?
        2. Rate limit: Has this camera exceeded alerts-per-minute?
        """
        if self._redis is None:
            # Redis not connected — allow all alerts (fail-open)
            return True

        now = time.time()

        # --- Dedup check ---
        dedup_key = f"alert:dedup:{camera_id}"
        last_alert_time = await self._redis.get(dedup_key)
        if last_alert_time is not None:
            elapsed = now - float(last_alert_time)
            if elapsed < self.config.dedup_window_seconds:
                logger.debug(
                    "Alert deduplicated",
                    camera_id=camera_id,
                    elapsed=round(elapsed, 2),
                    window=self.config.dedup_window_seconds,
                )
                return False

        # --- Rate limit check (sliding window with sorted set) ---
        rate_key = f"alert:rate:{camera_id}"
        window_start = now - 60.0

        # Remove entries outside the 1-minute window
        await self._redis.zremrangebyscore(rate_key, "-inf", window_start)

        # Count remaining entries in window
        count = await self._redis.zcard(rate_key)
        if count >= self.config.rate_limit_per_minute:
            logger.debug(
                "Alert rate limited",
                camera_id=camera_id,
                count=count,
                limit=self.config.rate_limit_per_minute,
            )
            return False

        return True

    async def record_alert(self, camera_id: str) -> None:
        """Record that an alert was emitted for dedup/rate tracking."""
        if self._redis is None:
            return

        now = time.time()

        # Update dedup timestamp
        dedup_key = f"alert:dedup:{camera_id}"
        await self._redis.set(
            dedup_key, str(now),
            ex=self.config.dedup_window_seconds * 2,  # TTL = 2× window for safety
        )

        # Add to rate limit sorted set
        rate_key = f"alert:rate:{camera_id}"
        await self._redis.zadd(rate_key, {str(now): now})
        await self._redis.expire(rate_key, 120)  # TTL of 2 minutes

    async def close(self) -> None:
        """Close Redis connection."""
        if self._redis is not None:
            await self._redis.close()
            logger.info("Redis connection closed")
