"""Camera pipeline — one per camera, runs as an isolated asyncio Task.

Manages the lifecycle: RTSP ingestion → YOLO detection → WebRTC streaming → Kafka events.
A failure in one camera's pipeline never affects any other camera.
"""

import asyncio
import time
from collections import deque
from typing import Any, Callable, Awaitable

import numpy as np

from .config import Config
from .detector import PersonDetector
from .rtsp_ingester import RTSPIngester
from .webrtc_manager import WebRTCManager
from .logging_config import get_logger

logger = get_logger(__name__)

# Type for the callback that sends detection events to Kafka
DetectionCallback = Callable[[dict[str, Any]], Awaitable[None]]
# Type for the callback that sends status updates
StatusCallback = Callable[[str, str], Awaitable[None]]
# Type for the callback that sends JPEG frames
FrameCallback = Callable[[str, str], Awaitable[None]]


class CameraPipeline:
    """Manages the full processing pipeline for a single camera.

    Each pipeline runs as an independent asyncio task:
    1. Connects to RTSP stream via OpenCV
    2. Reads frames at target FPS
    3. Runs YOLOv8n person detection (in thread pool)
    4. Pushes frames to WebRTC video track
    5. Publishes detection events via callback (→ Kafka)
    """

    def __init__(
        self,
        camera_id: str,
        rtsp_url: str,
        config: Config,
        detector: PersonDetector,
        webrtc_manager: WebRTCManager,
        on_detection: DetectionCallback | None = None,
        on_status_change: StatusCallback | None = None,
        on_frame: FrameCallback | None = None,
    ) -> None:
        self.camera_id = camera_id
        self.rtsp_url = rtsp_url
        self.config = config
        self.detector = detector
        self.webrtc_manager = webrtc_manager
        self._on_detection = on_detection
        self._on_status_change = on_status_change
        self._on_frame = on_frame

        self._task: asyncio.Task[None] | None = None
        self._status: str = "stopped"
        self._ingester: RTSPIngester | None = None

        # Stats tracking
        self._frame_count = 0
        self._detection_count = 0
        self._fps_samples: deque[float] = deque(maxlen=30)
        self._detection_timestamps: deque[float] = deque(maxlen=100)
        self._last_frame_time: float = 0.0

    @property
    def status(self) -> str:
        return self._status

    @property
    def fps(self) -> float:
        """Calculate current FPS from recent frame timestamps."""
        if len(self._fps_samples) < 2:
            return 0.0
        elapsed = self._fps_samples[-1] - self._fps_samples[0]
        if elapsed <= 0:
            return 0.0
        return (len(self._fps_samples) - 1) / elapsed

    @property
    def detections_per_minute(self) -> float:
        """Calculate detections per minute from recent detection timestamps."""
        now = time.time()
        # Only count detections in the last 60 seconds
        cutoff = now - 60.0
        recent = [t for t in self._detection_timestamps if t > cutoff]
        return float(len(recent))

    async def _set_status(self, status: str) -> None:
        """Update status and notify via callback."""
        self._status = status
        logger.info("Camera status changed", camera_id=self.camera_id, status=status)
        if self._on_status_change is not None:
            try:
                await self._on_status_change(self.camera_id, status)
            except Exception as e:
                logger.error("Status callback error", camera_id=self.camera_id, error=str(e))

    async def start(self) -> None:
        """Start the camera pipeline as a background task."""
        if self._task is not None and not self._task.done():
            logger.warning("Pipeline already running", camera_id=self.camera_id)
            return

        self._task = asyncio.create_task(
            self._run(),
            name=f"camera-pipeline-{self.camera_id}",
        )
        logger.info("Camera pipeline started", camera_id=self.camera_id)

    async def stop(self) -> None:
        """Stop the camera pipeline gracefully."""
        logger.info("Stopping camera pipeline", camera_id=self.camera_id)

        if self._ingester is not None:
            self._ingester.stop()

        if self._task is not None and not self._task.done():
            self._task.cancel()
            try:
                await asyncio.wait_for(self._task, timeout=5.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass

        # Clean up WebRTC resources
        self.webrtc_manager.remove_track(self.camera_id)
        await self.webrtc_manager.close_connection(self.camera_id)

        await self._set_status("stopped")
        self._task = None
        self._ingester = None

    async def _run(self) -> None:
        """Main pipeline loop — runs until cancelled or stream ends."""
        try:
            import cv2
            import base64
            
            await self._set_status("connecting")

            # Create RTSP ingester
            self._ingester = RTSPIngester(
                camera_id=self.camera_id,
                rtsp_url=self.rtsp_url,
                target_fps=10.0,
            )

            # Connect to RTSP stream
            if not await self._ingester.connect():
                await self._set_status("error")
                return

            await self._set_status("live")

            # Create WebRTC video track for this camera
            self.webrtc_manager.get_or_create_track(self.camera_id)

            # Process frames
            async for frame in self._ingester.frames():
                now = time.time()
                self._fps_samples.append(now)
                self._frame_count += 1

                # Push every frame to WebRTC for smooth video
                self.webrtc_manager.push_frame(self.camera_id, frame)

                # Send every 2nd frame over WebSocket for MJPEG fallback (~5 FPS)
                if self._on_frame is not None and self._frame_count % 2 == 0:
                    try:
                        # Resize to 480px width for speed+bandwidth balance
                        h, w = frame.shape[:2]
                        if w > 480:
                            scale = 480 / w
                            frame_small = cv2.resize(frame, (480, int(h * scale)))
                        else:
                            frame_small = frame
                        
                        _, buffer = cv2.imencode('.jpg', frame_small, [cv2.IMWRITE_JPEG_QUALITY, 40])
                        b64_image = f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('utf-8')}"
                        asyncio.create_task(self._on_frame(self.camera_id, b64_image))
                    except Exception as e:
                        logger.error("Failed to send frame fallback", error=str(e))

                # Run detection concurrently, only if previous detection is finished
                if getattr(self, "_detection_task", None) is None or self._detection_task.done():
                    self._detection_task = asyncio.create_task(self._process_detection(frame))

        except asyncio.CancelledError:
            logger.info("Pipeline cancelled", camera_id=self.camera_id)
        except Exception as e:
            logger.error("Pipeline error", camera_id=self.camera_id, error=str(e), exc_info=True)
            await self._set_status("error")
        finally:
            if self._ingester is not None:
                self._ingester.stop()

    async def _process_detection(self, frame: np.ndarray) -> None:
        """Run detection on a frame and publish results."""
        try:
            detections = await self.detector.detect(frame, self.camera_id)

            for detection in detections:
                self._detection_count += 1
                self._detection_timestamps.append(time.time())

                if self._on_detection is not None:
                    await self._on_detection(detection)

        except Exception as e:
            logger.error(
                "Detection error",
                camera_id=self.camera_id,
                error=str(e),
            )

    def get_stats(self) -> dict[str, Any]:
        """Get current stats for this camera pipeline."""
        return {
            "cameraId": self.camera_id,
            "fps": round(self.fps, 1),
            "detectionsPerMinute": round(self.detections_per_minute, 1),
        }
