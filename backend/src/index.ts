import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from './lib/logger';
import { authMiddleware } from './middleware/auth';
import { authRoutes } from './routes/auth';
import { cameraRoutes } from './routes/cameras';
import { alertRoutes } from './routes/alerts';
import { runMigrations } from './db/migrate';
import { initKafkaProducer, initKafkaConsumer, disconnectKafka } from './lib/kafka';
import {
  handleWsUpgrade,
  handleWsOpen,
  handleWsMessage,
  handleWsClose,
  broadcastAlert,
} from './lib/websocket';
import { db } from './db';
import { alerts } from './db/schema';

const app = new Hono();

// Global CORS middleware (allow all origins for dev)
app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes
app.route('/auth', authRoutes);

// Protected routes
app.use('/cameras/*', authMiddleware);
app.use('/alerts/*', authMiddleware);
app.route('/cameras', cameraRoutes);
app.route('/alerts', alertRoutes);

// Start server
const port = parseInt(process.env.BACKEND_PORT || '3000', 10);

async function handleDetection(detection: Record<string, unknown>): Promise<void> {
  try {
    const cameraId = detection.cameraId as string;
    const id = detection.id as string;
    const confidence = detection.confidence as number;
    const boundingBox = detection.boundingBox as Record<string, unknown>;
    const detectedAt = detection.detectedAt as string;
    const type = (detection.type as string) || 'person_detected';

    // Persist to database (onConflictDoNothing for idempotent replay)
    await db.insert(alerts).values({
      id,
      cameraId,
      type,
      confidence,
      boundingBox,
      detectedAt: new Date(detectedAt),
    }).onConflictDoNothing();

    // Broadcast to subscribed browser connections
    broadcastAlert(cameraId, detection);

    logger.info({ cameraId, id, confidence }, 'Detection persisted and broadcast');
  } catch (error) {
    logger.error({ error, detection }, 'Failed to process detection');
  }
}

async function start(): Promise<void> {
  // Run database migrations
  try {
    await runMigrations();
  } catch (error) {
    logger.warn({ error }, 'Migration failed — continuing anyway (tables may already exist)');
  }

  // Start HTTP + WebSocket server FIRST to avoid EADDRINUSE on restart
  const server = Bun.serve({
    port,
    fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade for browser clients and worker signaling
      if (url.pathname === '/ws' || url.pathname === '/internal/signaling') {
        const upgraded = handleWsUpgrade(req, server);
        if (upgraded) {
          return undefined; // Bun handles the upgrade
        }
        return new Response('WebSocket upgrade failed', { status: 401 });
      }

      // Regular HTTP request — delegate to Hono
      return app.fetch(req);
    },
    websocket: {
      open: handleWsOpen,
      message: handleWsMessage,
      close: handleWsClose,
    },
  });

  logger.info({ port }, `Started server: http://localhost:${port}`);

  // Initialize Kafka AFTER server is listening (with retry for startup ordering)
  const connectKafka = async () => {
    try {
      await initKafkaProducer();
      await initKafkaConsumer(handleDetection);
      logger.info('Kafka initialized');
    } catch (error) {
      logger.warn({ error }, 'Kafka initialization failed — will retry in 5s');
      setTimeout(connectKafka, 5000);
    }
  };

  // Start Kafka connection in background (don't block server startup)
  connectKafka();
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await disconnectKafka();
  process.exit(0);
});

start();
