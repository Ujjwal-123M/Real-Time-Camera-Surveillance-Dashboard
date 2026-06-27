"""Kafka integration — consuming commands, producing detections.

Uses aiokafka for async-native Kafka access that fits the worker's asyncio model.
"""

import asyncio
import json
from typing import Any, Callable, Awaitable

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

from .config import Config
from .logging_config import get_logger

logger = get_logger(__name__)

# Callback types
CommandCallback = Callable[[dict[str, Any]], Awaitable[None]]


class KafkaClient:
    """Async Kafka client for the worker service.

    Consumes: camera.commands (start/stop camera)
    Produces: camera.detections (person detection events)
    """

    def __init__(self, config: Config) -> None:
        self.config = config
        self._producer: AIOKafkaProducer | None = None
        self._consumer: AIOKafkaConsumer | None = None
        self._consumer_task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Initialize Kafka producer and consumer."""
        logger.info("Starting Kafka client", brokers=self.config.kafka_brokers)

        # Producer for detection events
        self._producer = AIOKafkaProducer(
            bootstrap_servers=self.config.kafka_brokers,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            key_serializer=lambda k: k.encode("utf-8") if k else None,
        )
        await self._producer.start()
        logger.info("Kafka producer started")

        # Consumer for camera commands
        self._consumer = AIOKafkaConsumer(
            self.config.kafka_commands_topic,
            bootstrap_servers=self.config.kafka_brokers,
            group_id=self.config.kafka_consumer_group,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
            auto_offset_reset="latest",
        )
        await self._consumer.start()
        logger.info("Kafka consumer started", topic=self.config.kafka_commands_topic)

    async def consume_commands(self, callback: CommandCallback) -> None:
        """Start consuming camera commands in a loop.

        Args:
            callback: Async function called for each command message.
        """
        if self._consumer is None:
            raise RuntimeError("Kafka consumer not started")

        logger.info("Consuming camera commands...")
        try:
            async for msg in self._consumer:
                try:
                    command = msg.value
                    logger.info(
                        "Received camera command",
                        command=command,
                        partition=msg.partition,
                        offset=msg.offset,
                    )
                    await callback(command)
                except Exception as e:
                    logger.error("Error processing command", error=str(e), exc_info=True)
        except asyncio.CancelledError:
            logger.info("Command consumer cancelled")
        except Exception as e:
            logger.error("Command consumer error", error=str(e), exc_info=True)

    async def publish_detection(self, detection: dict[str, Any]) -> None:
        """Publish a detection event to the camera.detections topic.

        The message is keyed by cameraId for per-camera ordering.
        """
        if self._producer is None:
            logger.warning("Kafka producer not started, dropping detection")
            return

        try:
            await self._producer.send(
                self.config.kafka_detections_topic,
                value=detection,
                key=detection.get("cameraId", "unknown"),
            )
            logger.debug(
                "Detection published",
                camera_id=detection.get("cameraId"),
                detection_id=detection.get("id"),
            )
        except Exception as e:
            logger.error("Failed to publish detection", error=str(e))

    async def stop(self) -> None:
        """Shut down producer and consumer gracefully."""
        if self._consumer is not None:
            await self._consumer.stop()
            logger.info("Kafka consumer stopped")

        if self._producer is not None:
            await self._producer.stop()
            logger.info("Kafka producer stopped")
