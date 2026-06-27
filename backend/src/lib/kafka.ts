/**
 * Kafka client for the backend service.
 *
 * Produces: camera.commands (start/stop camera processing)
 * Consumes: camera.detections (person detection events from worker)
 */

import { Kafka, type Producer, type Consumer, type EachMessagePayload } from 'kafkajs';
import { logger } from './logger';

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
const COMMANDS_TOPIC = 'camera.commands';
const DETECTIONS_TOPIC = 'camera.detections';

const kafka = new Kafka({
  clientId: 'skylark-backend',
  brokers: KAFKA_BROKERS,
  retry: {
    initialRetryTime: 1000,
    retries: 10,
  },
});

let producer: Producer | null = null;
let consumer: Consumer | null = null;

export async function initKafkaProducer(): Promise<void> {
  producer = kafka.producer();
  await producer.connect();
  logger.info({ brokers: KAFKA_BROKERS }, 'Kafka producer connected');
}

export async function initKafkaConsumer(
  onDetection: (detection: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  consumer = kafka.consumer({ groupId: 'backend-group' });
  await consumer.connect();
  await consumer.subscribe({ topic: DETECTIONS_TOPIC, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      if (!message.value) return;

      try {
        const detection = JSON.parse(message.value.toString()) as Record<string, unknown>;
        logger.debug(
          { topic, partition, offset: message.offset, cameraId: detection.cameraId },
          'Detection event received',
        );
        await onDetection(detection);
      } catch (error) {
        logger.error({ error, topic, partition }, 'Error processing detection message');
      }
    },
  });

  logger.info({ topic: DETECTIONS_TOPIC }, 'Kafka consumer started');
}

export async function publishCameraCommand(
  cameraId: string,
  action: 'start' | 'stop',
  rtspUrl?: string,
): Promise<void> {
  if (!producer) {
    logger.warn('Kafka producer not initialized — command not sent');
    return;
  }

  const command = {
    cameraId,
    action,
    ...(rtspUrl ? { rtspUrl } : {}),
  };

  await producer.send({
    topic: COMMANDS_TOPIC,
    messages: [
      {
        key: cameraId,
        value: JSON.stringify(command),
      },
    ],
  });

  logger.info({ cameraId, action }, 'Camera command published to Kafka');
}

export async function disconnectKafka(): Promise<void> {
  if (producer) await producer.disconnect();
  if (consumer) await consumer.disconnect();
  logger.info('Kafka disconnected');
}
