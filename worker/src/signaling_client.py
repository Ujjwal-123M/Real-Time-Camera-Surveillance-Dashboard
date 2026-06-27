"""Internal WebSocket client for signaling relay.

The worker connects to the backend's internal signaling endpoint
(ws://backend:3000/internal/signaling) to exchange WebRTC SDP
offers/answers and ICE candidates.

This is separate from Kafka because signaling must be low-latency.
"""

import asyncio
import json
from typing import Any, Callable, Awaitable

import websockets
from websockets.asyncio.client import connect

from .config import Config
from .logging_config import get_logger

logger = get_logger(__name__)

# Callback type for incoming signaling messages
SignalCallback = Callable[[dict[str, Any]], Awaitable[None]]


class SignalingClient:
    """WebSocket client that connects to the backend's internal signaling endpoint."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self._ws: Any = None  # websockets connection — typed as Any due to complex generic types
        self._reconnect_delay = 1.0
        self._max_reconnect_delay = 30.0
        self._running = False

    async def connect_and_listen(self, on_signal: SignalCallback) -> None:
        """Connect to the backend signaling WebSocket and listen for messages.

        Automatically reconnects on disconnect with exponential backoff.

        Args:
            on_signal: Async callback for incoming signaling messages.
        """
        self._running = True

        while self._running:
            try:
                logger.info(
                    "Connecting to signaling endpoint",
                    url=self.config.internal_ws_url,
                )
                async with connect(
                    self.config.internal_ws_url,
                    ping_interval=20,
                    ping_timeout=20,
                ) as ws:
                    self._ws = ws
                    self._reconnect_delay = 1.0  # Reset on successful connect
                    logger.info("Signaling WebSocket connected")

                    # Send a registration message
                    await ws.send(json.dumps({
                        "type": "worker_register",
                        "payload": {"workerId": "worker-1"},
                    }))

                    async for message in ws:
                        try:
                            data = json.loads(message)
                            await on_signal(data)
                        except json.JSONDecodeError:
                            logger.warning("Invalid JSON from signaling WS", message=message)
                        except Exception as e:
                            logger.error("Signal handler error", error=str(e))

            except asyncio.CancelledError:
                logger.info("Signaling client cancelled")
                break
            except Exception as e:
                logger.warning(
                    "Signaling connection lost, reconnecting",
                    error=str(e),
                    delay=self._reconnect_delay,
                )
                await asyncio.sleep(self._reconnect_delay)
                self._reconnect_delay = min(
                    self._reconnect_delay * 2, self._max_reconnect_delay
                )

        self._ws = None

    async def send_signal(self, message: dict[str, Any]) -> None:
        """Send a signaling message to the backend.

        Args:
            message: The signaling message (SDP answer or ICE candidate).
        """
        if self._ws is None:
            logger.warning("Cannot send signal — not connected")
            return

        try:
            await self._ws.send(json.dumps(message))
            logger.debug("Signal sent", type=message.get("type"))
        except Exception as e:
            logger.error("Failed to send signal", error=str(e))

    async def stop(self) -> None:
        """Disconnect from the signaling WebSocket."""
        self._running = False
        if self._ws is not None:
            await self._ws.close()
            self._ws = None
        logger.info("Signaling client stopped")
