"""Person detection using YOLOv8n with Ultralytics.

Runs inference in a thread pool to avoid blocking the asyncio event loop.
Filters to COCO class 0 (person) only and applies confidence threshold.
"""

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any

import numpy as np
from ultralytics import YOLO

from .config import Config
from .logging_config import get_logger

logger = get_logger(__name__)

# COCO class index for 'person'
PERSON_CLASS_ID = 0


class PersonDetector:
    """YOLOv8n person detector with async inference support."""

    def __init__(self, config: Config) -> None:
        self.config = config
        self._model: YOLO | None = None
        logger.info(
            "PersonDetector initialized",
            model=config.yolo_model,
            confidence_threshold=config.confidence_threshold,
        )

    def _load_model(self) -> YOLO:
        """Load the YOLO model (lazy, on first inference call)."""
        if self._model is None:
            logger.info("Loading YOLO model", model=self.config.yolo_model)
            self._model = YOLO(self.config.yolo_model)
            logger.info("YOLO model loaded successfully")
        return self._model

    def _run_inference(self, frame: np.ndarray) -> list[dict[str, Any]]:
        """Run synchronous YOLO inference on a single frame.

        Returns a list of detection event dicts (only persons above threshold).
        """
        import cv2

        # Downscale for faster CPU inference — keep original dims for bbox mapping
        orig_h, orig_w = frame.shape[:2]
        infer_size = 320
        if orig_w > infer_size:
            scale = infer_size / orig_w
            small = cv2.resize(frame, (infer_size, int(orig_h * scale)))
        else:
            small = frame
            scale = 1.0

        model = self._load_model()
        results = model(small, classes=[PERSON_CLASS_ID], imgsz=infer_size, verbose=False)

        detections: list[dict[str, Any]] = []
        now = datetime.now(timezone.utc).isoformat()

        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                confidence = float(box.conf[0])
                if confidence < self.config.confidence_threshold:
                    continue

                # Extract bounding box (xyxy format → x, y, width, height)
                # Map coords back to original frame size
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                if scale != 1.0:
                    x1 /= scale; y1 /= scale; x2 /= scale; y2 /= scale
                detection = {
                    "id": str(uuid.uuid4()),
                    "type": "person_detected",
                    "confidence": round(confidence, 4),
                    "boundingBox": {
                        "x": int(x1),
                        "y": int(y1),
                        "width": int(x2 - x1),
                        "height": int(y2 - y1),
                    },
                    "detectedAt": now,
                }
                detections.append(detection)

        return detections

    async def detect(
        self, frame: np.ndarray, camera_id: str
    ) -> list[dict[str, Any]]:
        """Run person detection asynchronously via thread pool.

        Args:
            frame: BGR image as numpy array (from OpenCV).
            camera_id: The camera ID to tag detections with.

        Returns:
            List of detection event dicts matching the unified event format.
        """
        # Run CPU-bound inference in a thread so it doesn't block the event loop
        detections = await asyncio.to_thread(self._run_inference, frame)

        # Tag each detection with the camera ID
        for det in detections:
            det["cameraId"] = camera_id

        if detections:
            logger.debug(
                "Detections found",
                camera_id=camera_id,
                count=len(detections),
            )

        return detections
