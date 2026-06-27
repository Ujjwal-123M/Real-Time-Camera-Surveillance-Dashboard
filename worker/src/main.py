"""Worker main entry point.

Orchestrates all components:
- Kafka consumer (camera commands) + producer (detections)
- Internal signaling WebSocket to backend
- Camera pipelines (one asyncio task per camera)
- Redis rate limiter
- WebRTC manager
- Stats broadcast loop
"""

import asyncio
import signal
import json
from typing import Any

from .config import load_config, Config
from .logging_config import setup_logging, get_logger
from .kafka_client import KafkaClient
from .signaling_client import SignalingClient
from .camera_pipeline import CameraPipeline
from .detector import PersonDetector
from .webrtc_manager import WebRTCManager
from .rate_limiter import AlertRateLimiter

# Configure logging before anything else
setup_logging()
logger = get_logger("worker.main")


class Worker:
    """Main worker orchestrator.

    Manages the lifecycle of all camera pipelines and infrastructure connections.
    """

    def __init__(self, config: Config) -> None:
        self.config = config
        self.kafka = KafkaClient(config)
        self.signaling = SignalingClient(config)
        self.detector = PersonDetector(config)
        self.webrtc = WebRTCManager()
        self.rate_limiter = AlertRateLimiter(config)

        # Active camera pipelines keyed by camera ID
        self._pipelines: dict[str, CameraPipeline] = {}
        self._shutdown_event = asyncio.Event()

    async def start(self) -> None:
        """Start all worker components and run until shutdown."""
        logger.info("Worker starting up", config={
            "kafka_brokers": self.config.kafka_brokers,
            "confidence_threshold": self.config.confidence_threshold,
            "dedup_window": self.config.dedup_window_seconds,
            "rate_limit": self.config.rate_limit_per_minute,
        })

        # Connect to infrastructure with retries
        await self._connect_with_retry("Kafka", self.kafka.start)
        await self._connect_with_retry("Redis", self.rate_limiter.connect)

        # Start background tasks
        tasks = [
            asyncio.create_task(
                self.kafka.consume_commands(self._handle_command),
                name="kafka-consumer",
            ),
            asyncio.create_task(
                self.signaling.connect_and_listen(self._handle_signal),
                name="signaling-client",
            ),
            asyncio.create_task(
                self._stats_broadcast_loop(),
                name="stats-broadcast",
            ),
        ]

        logger.info("Worker started — waiting for camera commands")

        # Wait for shutdown signal
        await self._shutdown_event.wait()

        # Clean shutdown
        logger.info("Shutting down worker...")
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self._shutdown()

    async def _connect_with_retry(
        self, name: str, connect_fn: Any, max_retries: int = 10
    ) -> None:
        """Connect to a service with retry logic."""
        for attempt in range(1, max_retries + 1):
            try:
                await connect_fn()
                logger.info(f"{name} connected", attempt=attempt)
                return
            except Exception as e:
                delay = min(attempt * 2, 30)
                logger.warning(
                    f"{name} connection failed, retrying",
                    attempt=attempt,
                    max_retries=max_retries,
                    error=str(e),
                    retry_delay=delay,
                )
                if attempt == max_retries:
                    raise
                await asyncio.sleep(delay)

    async def _handle_command(self, command: dict[str, Any]) -> None:
        """Handle a camera command from Kafka.

        Expected format: { "cameraId": "...", "action": "start" | "stop", "rtspUrl": "..." }
        """
        camera_id = command.get("cameraId")
        action = command.get("action")

        if not camera_id or not action:
            logger.warning("Invalid command format", command=command)
            return

        if action == "start":
            rtsp_url = command.get("rtspUrl", "")
            if not rtsp_url:
                logger.error("Start command missing rtspUrl", camera_id=camera_id)
                return
            await self._start_camera(camera_id, rtsp_url)

        elif action == "stop":
            await self._stop_camera(camera_id)

        else:
            logger.warning("Unknown action", camera_id=camera_id, action=action)

    async def _start_camera(self, camera_id: str, rtsp_url: str) -> None:
        """Start a camera pipeline."""
        # Stop existing pipeline if running
        if camera_id in self._pipelines:
            logger.info("Stopping existing pipeline before restart", camera_id=camera_id)
            await self._stop_camera(camera_id)

        logger.info("Starting camera pipeline", camera_id=camera_id, rtsp_url=rtsp_url)

        pipeline = CameraPipeline(
            camera_id=camera_id,
            rtsp_url=rtsp_url,
            config=self.config,
            detector=self.detector,
            webrtc_manager=self.webrtc,
            on_detection=self._on_detection,
            on_status_change=self._on_status_change,
            on_frame=self._on_frame,
        )

        self._pipelines[camera_id] = pipeline
        await pipeline.start()

    async def _stop_camera(self, camera_id: str) -> None:
        """Stop a camera pipeline."""
        pipeline = self._pipelines.pop(camera_id, None)
        if pipeline is not None:
            await pipeline.stop()
            logger.info("Camera pipeline stopped", camera_id=camera_id)
        else:
            logger.warning("No pipeline to stop", camera_id=camera_id)

    async def _on_frame(self, camera_id: str, image_b64: str) -> None:
        """Handle a JPEG frame from a camera pipeline — forward to backend signaling WS."""
        await self.signaling.send_signal({
            "type": "frame",
            "payload": {"cameraId": camera_id, "image": image_b64},
        })

    async def _on_detection(self, detection: dict[str, Any]) -> None:
        """Handle a detection from a camera pipeline — rate limit and publish to Kafka."""
        camera_id = detection.get("cameraId", "unknown")

        # Check rate limiting
        if not await self.rate_limiter.should_alert(camera_id):
            return

        # Record the alert for future dedup/rate checks
        await self.rate_limiter.record_alert(camera_id)

        # Publish to Kafka
        await self.kafka.publish_detection(detection)

    async def _on_status_change(self, camera_id: str, status: str) -> None:
        """Handle a camera status change — notify backend via signaling WS."""
        await self.signaling.send_signal({
            "type": "status_update",
            "payload": {"cameraId": camera_id, "status": status},
        })

    async def _handle_signal(self, message: dict[str, Any]) -> None:
        """Handle a signaling message from the backend (WebRTC offer/ICE)."""
        msg_type = message.get("type")
        payload = message.get("payload", {})
        camera_id = payload.get("cameraId")

        if not camera_id:
            logger.warning("Signal missing cameraId", message=message)
            return

        if msg_type == "signal":
            kind = payload.get("kind")
            data = payload.get("data")

            if kind == "offer":
                # Browser sent an offer → create answer
                logger.info("Handling WebRTC offer", camera_id=camera_id)
                try:
                    answer = await self.webrtc.handle_offer(camera_id, data)
                    # Send answer back via signaling
                    await self.signaling.send_signal({
                        "type": "signal",
                        "payload": {
                            "cameraId": camera_id,
                            "kind": "answer",
                            "data": answer,
                        },
                    })
                except Exception as e:
                    logger.error("WebRTC offer handling failed", camera_id=camera_id, error=str(e))

            elif kind == "ice":
                # ICE candidate from browser
                await self.webrtc.add_ice_candidate(camera_id, data)

            else:
                logger.warning("Unknown signal kind", camera_id=camera_id, kind=kind)

    async def _stats_broadcast_loop(self) -> None:
        """Periodically send camera stats to the backend via signaling WS."""
        while not self._shutdown_event.is_set():
            try:
                for camera_id, pipeline in self._pipelines.items():
                    if pipeline.status == "live":
                        stats = pipeline.get_stats()
                        await self.signaling.send_signal({
                            "type": "stats",
                            "payload": stats,
                        })

                await asyncio.sleep(2.0)  # Broadcast every 2 seconds
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Stats broadcast error", error=str(e))
                await asyncio.sleep(5.0)

    async def _shutdown(self) -> None:
        """Gracefully shut down all components."""
        # Stop all pipelines
        camera_ids = list(self._pipelines.keys())
        for camera_id in camera_ids:
            await self._stop_camera(camera_id)

        # Close infrastructure connections
        await self.webrtc.close_all()
        await self.kafka.stop()
        await self.signaling.stop()
        await self.rate_limiter.close()
        logger.info("Worker shut down complete")

    def request_shutdown(self) -> None:
        """Signal the worker to shut down."""
        self._shutdown_event.set()


async def main() -> None:
    """Entry point for the worker process."""
    config = load_config()
    worker = Worker(config)

    # Handle SIGTERM/SIGINT for graceful shutdown
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, worker.request_shutdown)

    await worker.start()


if __name__ == "__main__":
    asyncio.run(main())
