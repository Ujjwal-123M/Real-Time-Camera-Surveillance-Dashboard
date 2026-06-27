import type { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';
import { logger } from '../lib/logger';

export interface JwtPayload {
  userId: string;
  username: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'skylark-dev-secret';

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Missing or malformed Authorization header');
    return c.json({ error: 'Authentication required' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    c.set('userId', decoded.userId);
    c.set('username', decoded.username);
    await next();
  } catch (error) {
    logger.warn({ error }, 'Invalid or expired token');
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
}
