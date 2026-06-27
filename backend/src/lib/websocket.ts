/**
 * WebSocket manager for the backend.
 *
 * Manages two kinds of WebSocket connections:
 * 1. Browser connections: Authenticated users subscribing to camera alerts/stats/signaling
 * 2. Internal signaling: Worker connects here for WebRTC SDP/ICE relay
 *
 * Browser WebSocket Protocol:
 *   Server → Client: { type: "alert" | "stats" | "signal", payload: {...} }
 *   Client → Server: { type: "subscribe" | "signal", payload: {...} }
 */

import type { ServerWebSocket } from 'bun';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import type { JwtPayload } from '../middleware/auth';
import { logger } from './logger';
import { db } from '../db';
import { cameras } from '../db/schema';

const JWT_SECRET = process.env.JWT_SECRET || 'skylark-dev-secret';

// ────── Browser Connection Management ──────

interface BrowserConnection {
  ws: ServerWebSocket<WebSocketData>;
  userId: string;
  subscribedCameras: Set<string>;
}

interface WebSocketData {
  type: 'browser' | 'worker';
  userId?: string;
  connectionId: string;
}

// Active browser connections indexed by connection ID
const browserConnections = new Map<string, BrowserConnection>();

// Worker signaling connection
let workerWs: ServerWebSocket<WebSocketData> | null = null;

/**
 * Handle a new WebSocket upgrade request.
 * Determines if it's a browser client (needs JWT) or internal worker connection.
 */
export function handleWsUpgrade(
  req: Request,
  server: ReturnType<typeof Bun.serve>,
): boolean {
  const url = new URL(req.url);
  const isInternal = url.pathname === '/internal/signaling';

  if (isInternal) {
    // Worker internal signaling — no auth needed (internal network only)
    const connectionId = crypto.randomUUID();
    return server.upgrade(req, {
      data: { type: 'worker' as const, connectionId },
    });
  }

  // Browser WebSocket — require JWT
  const token = url.searchParams.get('token');
  if (!token) {
    return false;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const connectionId = crypto.randomUUID();
    return server.upgrade(req, {
      data: { type: 'browser' as const, userId: decoded.userId, connectionId },
    });
  } catch {
    logger.warn('WebSocket upgrade failed — invalid token');
    return false;
  }
}

/**
 * Handle WebSocket open event.
 */
export function handleWsOpen(ws: ServerWebSocket<WebSocketData>): void {
  const { type, userId, connectionId } = ws.data;

  if (type === 'worker') {
    workerWs = ws;
    logger.info('Worker signaling WebSocket connected');
  } else if (type === 'browser' && userId) {
    browserConnections.set(connectionId, {
      ws,
      userId,
      subscribedCameras: new Set(),
    });
    logger.info({ userId, connectionId }, 'Browser WebSocket connected');
  }
}

/**
 * Handle WebSocket message.
 */
export function handleWsMessage(
  ws: ServerWebSocket<WebSocketData>,
  message: string | Buffer,
): void {
  const { type, connectionId } = ws.data;

  try {
    const data = JSON.parse(typeof message === 'string' ? message : message.toString());

    if (type === 'browser') {
      handleBrowserMessage(connectionId, data);
    } else if (type === 'worker') {
      handleWorkerMessage(data);
    }
  } catch (error) {
    logger.error({ error }, 'Error parsing WebSocket message');
  }
}

/**
 * Handle WebSocket close event.
 */
export function handleWsClose(ws: ServerWebSocket<WebSocketData>): void {
  const { type, connectionId } = ws.data;

  if (type === 'worker') {
    workerWs = null;
    logger.info('Worker signaling WebSocket disconnected');
  } else if (type === 'browser') {
    browserConnections.delete(connectionId);
    logger.info({ connectionId }, 'Browser WebSocket disconnected');
  }
}

// ────── Browser Message Handling ──────

function handleBrowserMessage(
  connectionId: string,
  data: { type: string; payload?: Record<string, unknown> },
): void {
  const conn = browserConnections.get(connectionId);
  if (!conn) return;

  switch (data.type) {
    case 'subscribe': {
      const cameraId = data.payload?.cameraId as string | undefined;
      if (cameraId) {
        conn.subscribedCameras.add(cameraId);
        logger.info({ connectionId, cameraId }, 'Browser subscribed to camera');
      }
      break;
    }

    case 'unsubscribe': {
      const cameraId = data.payload?.cameraId as string | undefined;
      if (cameraId) {
        conn.subscribedCameras.delete(cameraId);
      }
      break;
    }

    case 'signal': {
      // Relay WebRTC signal from browser to worker
      const payload = data.payload;
      if (payload && workerWs) {
        workerWs.send(JSON.stringify({
          type: 'signal',
          payload,
        }));
        logger.debug({ cameraId: payload.cameraId }, 'Signal relayed: browser → worker');
      }
      break;
    }

    default:
      logger.warn({ type: data.type }, 'Unknown browser WebSocket message type');
  }
}

// ────── Worker Message Handling ──────

function handleWorkerMessage(data: { type: string; payload?: Record<string, unknown> }): void {
  switch (data.type) {
    case 'signal': {
      // Relay WebRTC signal from worker to the relevant browser
      const payload = data.payload;
      const cameraId = payload?.cameraId as string | undefined;
      if (cameraId && payload) {
        broadcastToSubscribers(cameraId, {
          type: 'signal',
          payload,
        });
        logger.debug({ cameraId }, 'Signal relayed: worker → browser');
      }
      break;
    }

    case 'status_update': {
      // Camera status changed — persist to DB and broadcast to all subscribers
      const payload = data.payload;
      const cameraId = payload?.cameraId as string | undefined;
      const newStatus = payload?.status as string | undefined;
      if (cameraId && payload) {
        // Persist to database so API responses reflect the real state
        if (newStatus) {
          db.update(cameras)
            .set({ status: newStatus, updatedAt: new Date() })
            .where(eq(cameras.id, cameraId))
            .then(() => {
              logger.info({ cameraId, status: newStatus }, 'Camera status updated in DB');
            })
            .catch((err: unknown) => {
              logger.error({ error: err, cameraId }, 'Failed to update camera status in DB');
            });
        }

        broadcastToSubscribers(cameraId, {
          type: 'status',
          payload,
        });
      }
      break;
    }

    case 'stats': {
      // Camera stats from worker — forward to subscribers
      const payload = data.payload;
      const cameraId = payload?.cameraId as string | undefined;
      if (cameraId && payload) {
        broadcastToSubscribers(cameraId, {
          type: 'stats',
          payload,
        });
      }
      break;
    }

    case 'frame': {
      // JPEG frames from worker for WebRTC fallback
      const payload = data.payload;
      const cameraId = payload?.cameraId as string | undefined;
      if (cameraId && payload) {
        broadcastToSubscribers(cameraId, {
          type: 'frame',
          payload,
        });
      }
      break;
    }

    case 'worker_register':
      logger.info('Worker registered on signaling channel');
      break;

    default:
      logger.warn({ type: data.type }, 'Unknown worker WebSocket message type');
  }
}

// ────── Broadcasting ──────

/**
 * Send a message to all browser connections subscribed to a specific camera.
 */
function broadcastToSubscribers(
  cameraId: string,
  message: { type: string; payload: unknown },
): void {
  const messageStr = JSON.stringify(message);

  for (const [, conn] of browserConnections) {
    if (conn.subscribedCameras.has(cameraId)) {
      try {
        conn.ws.send(messageStr);
      } catch (error) {
        logger.error({ error }, 'Error sending to browser WebSocket');
      }
    }
  }
}

/**
 * Broadcast an alert to all browser connections subscribed to the camera.
 */
export function broadcastAlert(cameraId: string, alert: Record<string, unknown>): void {
  broadcastToSubscribers(cameraId, {
    type: 'alert',
    payload: alert,
  });
}

/**
 * Broadcast stats to all browser connections subscribed to the camera.
 */
export function broadcastStats(cameraId: string, stats: Record<string, unknown>): void {
  broadcastToSubscribers(cameraId, {
    type: 'stats',
    payload: stats,
  });
}

/**
 * Send a signal to the worker's internal WebSocket.
 */
export function sendToWorker(message: Record<string, unknown>): void {
  if (workerWs) {
    try {
      workerWs.send(JSON.stringify(message));
    } catch (error) {
      logger.error({ error }, 'Error sending to worker WebSocket');
    }
  } else {
    logger.warn('Worker not connected — cannot relay signal');
  }
}
