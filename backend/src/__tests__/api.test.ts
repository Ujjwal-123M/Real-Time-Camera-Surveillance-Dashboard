/**
 * Backend unit and integration tests.
 *
 * Uses Bun's built-in test runner.
 * These tests require a running Postgres instance. In CI, they run against
 * the Docker Compose postgres service. For local dev, ensure DATABASE_URL is set.
 *
 * Test coverage:
 * - Signup rejects duplicate username (unit)
 * - Login rejects wrong password (unit)
 * - Camera creation rejects missing RTSP URL (unit)
 * - Integration: signup → login → create camera → fetch alerts (expect empty list)
 */

import { describe, test, expect, beforeAll } from 'bun:test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

// Helper for making requests
async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  token?: string,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: res.status, data: data as Record<string, unknown> };
}

// Unique username to avoid conflicts across test runs
const testUser = `testuser_${Date.now()}`;
const testPassword = 'testpass123';
let authToken = '';

describe('Auth', () => {
  test('POST /auth/signup — creates user and returns JWT', async () => {
    const res = await api('POST', '/auth/signup', {
      username: testUser,
      password: testPassword,
    });

    expect(res.status).toBe(201);
    expect(res.data.token).toBeDefined();
    expect(res.data.user).toBeDefined();
    expect((res.data.user as Record<string, unknown>).username).toBe(testUser);

    authToken = res.data.token as string;
  });

  test('POST /auth/signup — rejects duplicate username', async () => {
    const res = await api('POST', '/auth/signup', {
      username: testUser,
      password: testPassword,
    });

    expect(res.status).toBe(409);
    expect((res.data as Record<string, unknown>).error).toBe('Username already taken');
  });

  test('POST /auth/login — rejects wrong password', async () => {
    const res = await api('POST', '/auth/login', {
      username: testUser,
      password: 'wrongpassword',
    });

    expect(res.status).toBe(401);
    expect((res.data as Record<string, unknown>).error).toBe('Invalid username or password');
  });

  test('POST /auth/login — succeeds with correct credentials', async () => {
    const res = await api('POST', '/auth/login', {
      username: testUser,
      password: testPassword,
    });

    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();

    // Use this token for subsequent tests
    authToken = res.data.token as string;
  });
});

describe('Camera CRUD', () => {
  let cameraId = '';

  test('POST /cameras — rejects missing RTSP URL', async () => {
    const res = await api(
      'POST',
      '/cameras',
      { name: 'Test Camera' },
      authToken,
    );

    expect(res.status).toBe(400);
  });

  test('POST /cameras — creates camera with valid data', async () => {
    const res = await api(
      'POST',
      '/cameras',
      {
        name: 'Lobby Camera',
        rtspUrl: 'rtsp://mediamtx:8554/live/test1',
        location: 'Main Lobby',
      },
      authToken,
    );

    expect(res.status).toBe(201);
    expect(res.data.name).toBe('Lobby Camera');
    expect(res.data.rtspUrl).toBe('rtsp://mediamtx:8554/live/test1');
    expect(res.data.status).toBe('stopped');

    cameraId = res.data.id as string;
  });

  test('GET /cameras — lists cameras', async () => {
    const res = await api('GET', '/cameras', undefined, authToken);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect((res.data as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  test('GET /cameras/:id — returns single camera', async () => {
    const res = await api('GET', `/cameras/${cameraId}`, undefined, authToken);

    expect(res.status).toBe(200);
    expect(res.data.id).toBe(cameraId);
  });

  test('PUT /cameras/:id — updates camera', async () => {
    const res = await api(
      'PUT',
      `/cameras/${cameraId}`,
      { name: 'Updated Lobby Camera' },
      authToken,
    );

    expect(res.status).toBe(200);
    expect(res.data.name).toBe('Updated Lobby Camera');
  });

  test('GET /cameras — returns 401 without token', async () => {
    const res = await api('GET', '/cameras');

    expect(res.status).toBe(401);
  });
});

describe('Integration: Full Flow', () => {
  test('signup → login → create camera → fetch alerts (empty)', async () => {
    // 1. Sign up a new user
    const uniqueUser = `inttest_${Date.now()}`;
    const signupRes = await api('POST', '/auth/signup', {
      username: uniqueUser,
      password: 'integrationtest123',
    });
    expect(signupRes.status).toBe(201);
    const token = signupRes.data.token as string;

    // 2. Login with the new user
    const loginRes = await api('POST', '/auth/login', {
      username: uniqueUser,
      password: 'integrationtest123',
    });
    expect(loginRes.status).toBe(200);

    // 3. Create a camera
    const cameraRes = await api(
      'POST',
      '/cameras',
      {
        name: 'Integration Test Camera',
        rtspUrl: 'rtsp://mediamtx:8554/live/test1',
        location: 'Test Location',
      },
      token,
    );
    expect(cameraRes.status).toBe(201);
    const cameraId = cameraRes.data.id as string;

    // 4. Fetch alerts — should be empty
    const alertsRes = await api(
      'GET',
      `/alerts?cameraId=${cameraId}`,
      undefined,
      token,
    );
    expect(alertsRes.status).toBe(200);
    expect(alertsRes.data.alerts).toEqual([]);
    expect(alertsRes.data.total).toBe(0);
  });
});
