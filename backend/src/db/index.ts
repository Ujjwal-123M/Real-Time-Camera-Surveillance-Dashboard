import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { logger } from '../lib/logger';

const connectionString = process.env.DATABASE_URL || 'postgresql://skylark:skylark_secret@localhost:5432/skylark_vms';

// Detect if we're connecting to a cloud DB (Neon, Supabase, etc.) that needs SSL
const isSSL = connectionString.includes('neon.tech') || connectionString.includes('sslmode=require');

const client = postgres(connectionString, {
  max: 10,
  onnotice: () => {},
  ssl: isSSL ? 'require' : undefined,
});

export const db = drizzle(client, { schema });

logger.info('Database connection initialized');
