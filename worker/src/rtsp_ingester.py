import asyncio
import threading
import time
from typing import AsyncGenerator

import cv2
import numpy as np

from .logging_config import get_logger

logger = get_logger(__name__)


class RTSPIngester:
    """Reads frames from an RTSP URL using OpenCV VideoCapture.
    Uses a dedicated background thread to drain the buffer and keep the latest frame.
    """

    def __init__(self, camera_id: str, rtsp_url: str, target_fps: float = 10.0) -> None:
        self.camera_id = camera_id
        self.rtsp_url = rtsp_url
        self.target_fps = target_fps
        self._cap: cv2.VideoCapture | None = None
        self._running = False
        
        self._latest_frame: np.ndarray | None = None
        self._grab_thread: threading.Thread | None = None

    async def connect(self) -> bool:
        """Open the RTSP stream. Returns True on success."""
        logger.info("Connecting to RTSP stream", camera_id=self.camera_id, url=self.rtsp_url)
        try:
            cap = await asyncio.to_thread(self._open_capture)
            if cap is not None and cap.isOpened():
                self._cap = cap
                self._running = True
                
                # Start background thread to constantly grab frames
                self._grab_thread = threading.Thread(target=self._grab_loop, daemon=True)
                self._grab_thread.start()
                
                logger.info("RTSP stream connected", camera_id=self.camera_id)
                return True
            else:
                logger.error("Failed to open RTSP stream", camera_id=self.camera_id, url=self.rtsp_url)
                return False
        except Exception as e:
            logger.error("RTSP connection error", camera_id=self.camera_id, error=str(e))
            return False

    def _open_capture(self) -> cv2.VideoCapture | None:
        """Synchronous OpenCV capture open (runs in thread)."""
        # Lower timeout and buffer size for lowest latency
        import os
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay"
        cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if cap.isOpened():
            return cap
        cap.release()
        return None

    def _grab_loop(self) -> None:
        """Continuously reads frames to keep the buffer empty."""
        while self._running and self._cap is not None:
            ret, frame = self._cap.read()
            if ret:
                self._latest_frame = frame
            else:
                # If read fails, wait a bit
                time.sleep(0.1)

    async def frames(self) -> AsyncGenerator[np.ndarray, None]:
        """Async generator that yields the latest frame at target FPS."""
        frame_interval = 1.0 / self.target_fps

        while self._running:
            try:
                frame = self._latest_frame
                
                if frame is None:
                    # Not ready or stream disconnected
                    if self._cap is None or not self._cap.isOpened():
                        logger.warning("Stream dead, retrying...", camera_id=self.camera_id)
                        self.stop()
                        if not await self.connect():
                            logger.error("Reconnection failed", camera_id=self.camera_id)
                            break
                    await asyncio.sleep(0.5)
                    continue

                yield frame
                await asyncio.sleep(frame_interval)

            except asyncio.CancelledError:
                logger.info("Frame generator cancelled", camera_id=self.camera_id)
                break
            except Exception as e:
                logger.error("Frame read error", camera_id=self.camera_id, error=str(e))
                await asyncio.sleep(1.0)

    def stop(self) -> None:
        """Stop the ingestion and release resources."""
        self._running = False
        if self._grab_thread is not None:
            self._grab_thread.join(timeout=1.0)
            self._grab_thread = None
            
        if self._cap is not None:
            self._cap.release()
            self._cap = None
            
        logger.info("RTSP ingester stopped", camera_id=self.camera_id)

    @property
    def is_running(self) -> bool:
        return self._running
