import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../db/schema';
import { signToken } from '../middleware/auth';
import { logger } from '../lib/logger';

const authRoutes = new Hono();

const signupSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

// POST /auth/signup
authRoutes.post('/signup', zValidator('json', signupSchema), async (c) => {
  const { username, password } = c.req.valid('json');

  logger.info({ username }, 'Signup attempt');

  // Check if username already exists
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (existing.length > 0) {
    logger.warn({ username }, 'Signup failed: username already taken');
    return c.json({ error: 'Username already taken' }, 409);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const [user] = await db
    .insert(users)
    .values({ username, passwordHash })
    .returning({ id: users.id, username: users.username, createdAt: users.createdAt });

  const token = signToken({ userId: user.id, username: user.username });

  logger.info({ userId: user.id, username }, 'User signed up successfully');

  return c.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
    },
  }, 201);
});

// POST /auth/login
authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const { username, password } = c.req.valid('json');

  logger.info({ username }, 'Login attempt');

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);

  if (!user) {
    logger.warn({ username }, 'Login failed: user not found');
    return c.json({ error: 'Invalid username or password' }, 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    logger.warn({ username }, 'Login failed: invalid password');
    return c.json({ error: 'Invalid username or password' }, 401);
  }

  const token = signToken({ userId: user.id, username: user.username });

  logger.info({ userId: user.id, username }, 'User logged in successfully');

  return c.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
    },
  });
});

export { authRoutes };
