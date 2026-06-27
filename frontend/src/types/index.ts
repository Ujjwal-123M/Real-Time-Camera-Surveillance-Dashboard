export interface User {
  id: string;
  username: string;
}

export interface Camera {
  id: string;
  userId: string;
  name: string;
  rtspUrl: string;
  location: string | null;
  enabled: boolean;
  status: 'connecting' | 'live' | 'stopped' | 'error';
  createdAt: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  cameraId: string;
  type: 'person_detected';
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  detectedAt: string;
}

export interface CameraStats {
  cameraId: string;
  fps: number;
  detectionsPerMinute: number;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface PaginatedAlerts {
  alerts: Alert[];
  total: number;
  page: number;
  limit: number;
}

export type WSServerMessage =
  | { type: 'alert'; payload: Alert }
  | { type: 'stats'; payload: CameraStats }
  | { type: 'status'; payload: { cameraId: string; status: Camera['status'] } }
  | { type: 'signal'; payload: { cameraId: string; kind: 'offer' | 'ice'; data: unknown } };

export type WSClientMessage =
  | { type: 'subscribe'; payload: { cameraId: string } }
  | { type: 'signal'; payload: { cameraId: string; kind: 'answer' | 'ice'; data: unknown } };
