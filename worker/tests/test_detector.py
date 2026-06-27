"""Worker unit tests.

Tests that only detections above the confidence threshold are emitted as events.
Uses a mock YOLO model output to avoid requiring the actual model or GPU.
"""

import asyncio
import unittest
from unittest.mock import MagicMock, patch, AsyncMock
import numpy as np

from src.config import Config
from src.detector import PersonDetector


class FakeBox:
    """Mock YOLO detection box."""

    def __init__(self, confidence: float, x1: float, y1: float, x2: float, y2: float):
        self.conf = [confidence]
        self.xyxy = [MagicMock(tolist=lambda: [x1, y1, x2, y2])]


class FakeResult:
    """Mock YOLO result."""

    def __init__(self, boxes: list[FakeBox]):
        self.boxes = boxes


class TestPersonDetector(unittest.TestCase):
    """Test the PersonDetector with mocked YOLO model."""

    def setUp(self) -> None:
        self.config = Config()
        # Override threshold for testing
        object.__setattr__(self.config, "confidence_threshold", 0.5)
        self.detector = PersonDetector(self.config)

    def test_detections_above_threshold_are_included(self) -> None:
        """Detections with confidence >= threshold should produce events."""
        mock_results = [
            FakeResult([
                FakeBox(0.85, 100, 50, 200, 300),  # Above threshold
                FakeBox(0.72, 300, 100, 380, 350),  # Above threshold
            ])
        ]

        with patch.object(self.detector, "_load_model") as mock_model:
            mock_model.return_value = MagicMock(return_value=mock_results)
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            detections = self.detector._run_inference(frame)

        self.assertEqual(len(detections), 2)
        self.assertAlmostEqual(detections[0]["confidence"], 0.85, places=2)
        self.assertAlmostEqual(detections[1]["confidence"], 0.72, places=2)
        self.assertEqual(detections[0]["type"], "person_detected")

    def test_detections_below_threshold_are_filtered(self) -> None:
        """Detections with confidence < threshold should be excluded."""
        mock_results = [
            FakeResult([
                FakeBox(0.85, 100, 50, 200, 300),  # Above threshold
                FakeBox(0.30, 300, 100, 380, 350),  # Below threshold
                FakeBox(0.45, 400, 150, 480, 400),  # Below threshold
            ])
        ]

        with patch.object(self.detector, "_load_model") as mock_model:
            mock_model.return_value = MagicMock(return_value=mock_results)
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            detections = self.detector._run_inference(frame)

        # Only 1 detection should pass (0.85), the others are below 0.5
        self.assertEqual(len(detections), 1)
        self.assertAlmostEqual(detections[0]["confidence"], 0.85, places=2)

    def test_no_detections_returns_empty_list(self) -> None:
        """When no persons are detected, return empty list."""
        mock_results = [FakeResult([])]

        with patch.object(self.detector, "_load_model") as mock_model:
            mock_model.return_value = MagicMock(return_value=mock_results)
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            detections = self.detector._run_inference(frame)

        self.assertEqual(len(detections), 0)

    def test_bounding_box_format(self) -> None:
        """Bounding box should be in {x, y, width, height} format."""
        mock_results = [
            FakeResult([
                FakeBox(0.90, 100.0, 50.0, 200.0, 300.0),
            ])
        ]

        with patch.object(self.detector, "_load_model") as mock_model:
            mock_model.return_value = MagicMock(return_value=mock_results)
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            detections = self.detector._run_inference(frame)

        self.assertEqual(len(detections), 1)
        bb = detections[0]["boundingBox"]
        self.assertEqual(bb["x"], 100)
        self.assertEqual(bb["y"], 50)
        self.assertEqual(bb["width"], 100)   # 200 - 100
        self.assertEqual(bb["height"], 250)  # 300 - 50

    def test_event_has_required_fields(self) -> None:
        """Each event must have id, type, confidence, boundingBox, detectedAt."""
        mock_results = [
            FakeResult([FakeBox(0.75, 10, 20, 50, 100)])
        ]

        with patch.object(self.detector, "_load_model") as mock_model:
            mock_model.return_value = MagicMock(return_value=mock_results)
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            detections = self.detector._run_inference(frame)

        self.assertEqual(len(detections), 1)
        event = detections[0]
        self.assertIn("id", event)
        self.assertIn("type", event)
        self.assertIn("confidence", event)
        self.assertIn("boundingBox", event)
        self.assertIn("detectedAt", event)
        self.assertEqual(event["type"], "person_detected")

    def test_async_detect_tags_camera_id(self) -> None:
        """The async detect method should tag each detection with the camera ID."""
        mock_results = [
            FakeResult([FakeBox(0.80, 10, 20, 50, 100)])
        ]

        with patch.object(self.detector, "_load_model") as mock_model:
            mock_model.return_value = MagicMock(return_value=mock_results)
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            detections = asyncio.run(self.detector.detect(frame, "cam-123"))

        self.assertEqual(len(detections), 1)
        self.assertEqual(detections[0]["cameraId"], "cam-123")


if __name__ == "__main__":
    unittest.main()
