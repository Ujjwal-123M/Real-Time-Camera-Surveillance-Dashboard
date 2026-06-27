"""Configuration loaded from environment variables."""

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Config:
    """Worker configuration from environment variables."""

    # Kafka
    kafka_brokers: list[str] = field(default_factory=lambda: (
        os.getenv("KAFKA_BROKERS", "localhost:9092").split(",")
    ))
    kafka_consumer_group: str = "worker-group"
    kafka_commands_topic: str = "camera.commands"
    kafka_detections_topic: str = "camera.detections"

    # Redis
    redis_url: str = field(default_factory=lambda: os.getenv("REDIS_URL", "redis://localhost:6379"))

    # RTSP
    rtsp_base_url: str = field(default_factory=lambda: os.getenv("RTSP_BASE_URL", "rtsp://localhost:8554"))

    # Internal WebSocket to backend for signaling
    internal_ws_url: str = field(default_factory=lambda: os.getenv(
        "WORKER_INTERNAL_WS_URL", "ws://localhost:3000/internal/signaling"
    ))

    # Detection
    confidence_threshold: float = field(default_factory=lambda: float(
        os.getenv("CONFIDENCE_THRESHOLD", "0.5")
    ))
    yolo_model: str = "yolov8n.pt"

    # Alert deduplication
    dedup_window_seconds: int = field(default_factory=lambda: int(
        os.getenv("ALERT_DEDUP_WINDOW_SECONDS", "5")
    ))
    rate_limit_per_minute: int = field(default_factory=lambda: int(
        os.getenv("ALERT_RATE_LIMIT_PER_MINUTE", "30")
    ))


def load_config() -> Config:
    """Load and return the worker configuration."""
    return Config()
