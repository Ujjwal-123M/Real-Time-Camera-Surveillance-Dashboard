import { pgTable, uuid, text, boolean, real, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  username: text('username').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const cameras = pgTable('cameras', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  rtspUrl: text('rtsp_url').notNull(),
  location: text('location'),
  enabled: boolean('enabled').default(true),
  status: text('status').default('stopped'), // connecting | live | stopped | error
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  cameraId: uuid('camera_id').notNull().references(() => cameras.id),
  type: text('type').notNull().default('person_detected'),
  confidence: real('confidence').notNull(),
  boundingBox: jsonb('bounding_box').notNull(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  cameraTimeIdx: index('idx_alerts_camera_time').on(table.cameraId, table.detectedAt),
}));
