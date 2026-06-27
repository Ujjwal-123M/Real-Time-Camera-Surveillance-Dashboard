import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and, gte, lte, sql, inArray } from 'drizzle-orm';
import { db } from '../db';
import { alerts, cameras } from '../db/schema';
import { logger } from '../lib/logger';

const alertRoutes = new Hono();

const alertQuerySchema = z.object({
  cameraId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// GET /alerts — list alerts with filtering and pagination
alertRoutes.get('/', async (c) => {
  const userId = c.get('userId') as string;

  // Parse and validate query params
  const parseResult = alertQuerySchema.safeParse({
    cameraId: c.req.query('cameraId'),
    from: c.req.query('from'),
    to: c.req.query('to'),
    page: c.req.query('page'),
    limit: c.req.query('limit'),
  });

  if (!parseResult.success) {
    return c.json({ error: 'Invalid query parameters', details: parseResult.error.flatten() }, 400);
  }

  const { cameraId, from, to, page, limit } = parseResult.data;
  const offset = (page - 1) * limit;

  // Get all camera IDs belonging to this user (for scoping)
  const userCameras = await db
    .select({ id: cameras.id })
    .from(cameras)
    .where(eq(cameras.userId, userId));

  const userCameraIds = userCameras.map((cam) => cam.id);

  if (userCameraIds.length === 0) {
    return c.json({ alerts: [], total: 0, page, limit });
  }

  // Build conditions
  const conditions = [];

  // If a specific cameraId is requested, verify it belongs to the user
  if (cameraId) {
    if (!userCameraIds.includes(cameraId)) {
      return c.json({ alerts: [], total: 0, page, limit });
    }
    conditions.push(eq(alerts.cameraId, cameraId));
  } else {
    conditions.push(inArray(alerts.cameraId, userCameraIds));
  }

  if (from) {
    conditions.push(gte(alerts.detectedAt, new Date(from)));
  }

  if (to) {
    conditions.push(lte(alerts.detectedAt, new Date(to)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(alerts)
    .where(whereClause);

  const total = countResult?.count ?? 0;

  // Get paginated alerts
  const alertResults = await db
    .select()
    .from(alerts)
    .where(whereClause)
    .orderBy(sql`${alerts.detectedAt} desc`)
    .limit(limit)
    .offset(offset);

  logger.info({ userId, cameraId, from, to, page, limit, total }, 'Listed alerts');

  return c.json({
    alerts: alertResults,
    total,
    page,
    limit,
  });
});

export { alertRoutes };
