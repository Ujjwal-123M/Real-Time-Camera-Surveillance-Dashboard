/**
 * Database migration / schema sync.
 *
 * Uses raw SQL to create tables if they don't exist, matching the Drizzle schema.
 * This is simpler than generating migration files for a demo project and
 * works reliably in Docker without needing a pre-generated `drizzle/` folder.
 */

import { sql } from 'drizzle-orm';
import { db } from './index';
import { logger } from '../lib/logger';

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS cameras (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    rtsp_url TEXT NOT NULL,
    location TEXT,
    enabled BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'stopped',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    camera_id UUID NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'person_detected',
    confidence REAL NOT NULL,
    bounding_box JSONB NOT NULL,
    detected_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_camera_time ON alerts (camera_id, detected_at DESC);
`;

export async function runMigrations(): Promise<void> {
  logger.info('Running database migrations...');
  try {
    await db.execute(sql.raw(CREATE_TABLES_SQL));
    logger.info('Migrations completed successfully');
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    throw error;
  }
}
