import type { AuthResponse, Camera, PaginatedAlerts } from '../types';

const envUrl = import.meta.env.VITE_API_URL;
// In production/Docker: VITE_API_URL is empty → use /api prefix (nginx proxies to backend)
// In local dev: VITE_API_URL=http://localhost:3000 → hit backend directly
const BASE_URL = envUrl ? envUrl : '/api';

class ApiClient {
  private getToken(): string | null {
    return localStorage.getItem('token');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
      throw new Error('Unauthorized');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  // Auth
  async signup(username: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  async login(username: string, password: string): Promise<AuthResponse> {
    return this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  }

  // Cameras
  async getCameras(): Promise<Camera[]> {
    return this.request<Camera[]>('/cameras');
  }

  async createCamera(data: {
    name: string;
    rtspUrl: string;
    location?: string;
  }): Promise<Camera> {
    return this.request<Camera>('/cameras', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getCamera(id: string): Promise<Camera> {
    return this.request<Camera>(`/cameras/${id}`);
  }

  async updateCamera(
    id: string,
    data: { name?: string; rtspUrl?: string; location?: string }
  ): Promise<Camera> {
    return this.request<Camera>(`/cameras/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteCamera(id: string): Promise<void> {
    return this.request<void>(`/cameras/${id}`, {
      method: 'DELETE',
    });
  }

  async startCamera(id: string): Promise<Camera> {
    return this.request<Camera>(`/cameras/${id}/start`, {
      method: 'POST',
    });
  }

  async stopCamera(id: string): Promise<Camera> {
    return this.request<Camera>(`/cameras/${id}/stop`, {
      method: 'POST',
    });
  }

  // Alerts
  async getAlerts(params?: {
    cameraId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedAlerts> {
    const searchParams = new URLSearchParams();
    if (params?.cameraId) searchParams.set('cameraId', params.cameraId);
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.page) searchParams.set('page', params.page.toString());
    if (params?.limit) searchParams.set('limit', params.limit.toString());

    const query = searchParams.toString();
    return this.request<PaginatedAlerts>(`/alerts${query ? `?${query}` : ''}`);
  }
}

export const apiClient = new ApiClient();
