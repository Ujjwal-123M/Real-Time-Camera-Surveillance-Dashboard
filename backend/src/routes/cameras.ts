import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db';
import { cameras } from '../db/schema';
import { logger } from '../lib/logger';
import { publishCameraCommand } from '../lib/kafka';

const cameraRoutes = new Hono();

const createCameraSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  rtspUrl: z.string().min(1, 'RTSP URL is required'),
  location: z.string().optional(),
});

const updateCameraSchema = z.object({
  name: z.string().min(1).optional(),
  rtspUrl: z.string().min(1).optional(),
  location: z.string().optional(),
  enabled: z.boolean().optional(),
});

// GET /cameras — list all cameras for authenticated user
cameraRoutes.get('/', async (c) => {
  const userId = c.get('userId') as string;

  const result = await db
    .select()
    .from(cameras)
    .where(eq(cameras.userId, userId));

  logger.info({ userId, count: result.length }, 'Listed cameras');

  return c.json(result);
});

// POST /cameras — create a new camera
cameraRoutes.post('/', zValidator('json', createCameraSchema), async (c) => {
  const userId = c.get('userId') as string;
  const body = c.req.valid('json');

  const [camera] = await db
    .insert(cameras)
    .values({
      userId,
      name: body.name,
      rtspUrl: body.rtspUrl,
      location: body.location,
    })
    .returning();

  logger.info({ userId, cameraId: camera.id, name: camera.name }, 'Camera created');

  return c.json(camera, 201);
});

// GET /cameras/:id — get single camera
cameraRoutes.get('/:id', async (c) => {
  const userId = c.get('userId') as string;
  const cameraId = c.req.param('id');

  const [camera] = await db
    .select()
    .from(cameras)
    .where(and(eq(cameras.id, cameraId), eq(cameras.userId, userId)))
    .limit(1);

  if (!camera) {
    logger.warn({ userId, cameraId }, 'Camera not found');
    return c.json({ error: 'Camera not found' }, 404);
  }

  return c.json(camera);
});

// PUT /cameras/:id — update camera
cameraRoutes.put('/:id', zValidator('json', updateCameraSchema), async (c) => {
  const userId = c.get('userId') as string;
  const cameraId = c.req.param('id');
  const body = c.req.valid('json');

  // Verify ownership
  const [existing] = await db
    .select({ id: cameras.id })
    .from(cameras)
    .where(and(eq(cameras.id, cameraId), eq(cameras.userId, userId)))
    .limit(1);

  if (!existing) {
    logger.warn({ userId, cameraId }, 'Camera not found for update');
    return c.json({ error: 'Camera not found' }, 404);
  }

  const [updated] = await db
    .update(cameras)
    .set({
      ...body,
      updatedAt: sql`now()`,
    })
    .where(and(eq(cameras.id, cameraId), eq(cameras.userId, userId)))
    .returning();

  logger.info({ userId, cameraId }, 'Camera updated');

  return c.json(updated);
});

// DELETE /cameras/:id — delete camera
cameraRoutes.delete('/:id', async (c) => {
  const userId = c.get('userId') as string;
  const cameraId = c.req.param('id');

  const [deleted] = await db
    .delete(cameras)
    .where(and(eq(cameras.id, cameraId), eq(cameras.userId, userId)))
    .returning({ id: cameras.id });

  if (!deleted) {
    logger.warn({ userId, cameraId }, 'Camera not found for deletion');
    return c.json({ error: 'Camera not found' }, 404);
  }

  logger.info({ userId, cameraId }, 'Camera deleted');

  return c.json({ message: 'Camera deleted', id: deleted.id });
});

// POST /cameras/:id/start — set status to 'connecting'
cameraRoutes.post('/:id/start', async (c) => {
  const userId = c.get('userId') as string;
  const cameraId = c.req.param('id');

  const [existing] = await db
    .select({ id: cameras.id })
    .from(cameras)
    .where(and(eq(cameras.id, cameraId), eq(cameras.userId, userId)))
    .limit(1);

  if (!existing) {
    logger.warn({ userId, cameraId }, 'Camera not found for start');
    return c.json({ error: 'Camera not found' }, 404);
  }

  const [updated] = await db
    .update(cameras)
    .set({
      status: 'connecting',
      updatedAt: sql`now()`,
    })
    .where(and(eq(cameras.id, cameraId), eq(cameras.userId, userId)))
    .returning();

  logger.info({ userId, cameraId }, 'Camera start requested');

  // Publish start command to Kafka for the worker
  try {
    await publishCameraCommand(cameraId, 'start', updated.rtspUrl);
  } catch (error) {
    logger.error({ error, cameraId }, 'Failed to publish start command to Kafka');
  }

  return c.json(updated);
});

// POST /cameras/:id/stop — set status to 'stopped'
cameraRoutes.post('/:id/stop', async (c) => {
  const userId = c.get('userId') as string;
  const cameraId = c.req.param('id');

  const [existing] = await db
    .select({ id: cameras.id })
    .from(cameras)
    .where(and(eq(cameras.id, cameraId), eq(cameras.userId, userId)))
    .limit(1);

  if (!existing) {
    logger.warn({ userId, cameraId }, 'Camera not found for stop');
    return c.json({ error: 'Camera not found' }, 404);
  }

  const [updated] = await db
    .update(cameras)
    .set({
      status: 'stopped',
      updatedAt: sql`now()`,
    })
    .where(and(eq(cameras.id, cameraId), eq(cameras.userId, userId)))
    .returning();

  logger.info({ userId, cameraId }, 'Camera stop requested');

  // Publish stop command to Kafka for the worker
  try {
    await publishCameraCommand(cameraId, 'stop');
  } catch (error) {
    logger.error({ error, cameraId }, 'Failed to publish stop command to Kafka');
  }

  return c.json(updated);
});

export { cameraRoutes };
