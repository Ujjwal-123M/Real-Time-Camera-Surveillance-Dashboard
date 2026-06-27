import { useEffect, useRef, useCallback, useState } from 'react';
import type { Alert, CameraStats } from '../types';

/**
 * WebSocket hook that connects to the backend, subscribes to cameras,
 * and receives real-time stats, status updates, alerts, and WebRTC signals.
 *
 * Also exposes sendSignal() so the WebRTC hook can send SDP offers / ICE
 * candidates through the same WebSocket connection.
 */

type StatusUpdate = {
  cameraId: string;
  status: 'connecting' | 'live' | 'stopped' | 'error';
};

type SignalMessage = {
  cameraId: string;
  kind: 'answer' | 'offer' | 'ice';
  data: unknown;
};

type MessageHandler = {
  onStats?: (stats: CameraStats) => void;
  onStatusUpdate?: (update: StatusUpdate) => void;
  onAlert?: (alert: Alert) => void;
  onSignal?: (signal: SignalMessage) => void;
  onFrame?: (frame: { cameraId: string; image: string }) => void;
};

export function useWebSocket(cameraIds: string[], handlers: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          switch (data.type) {
            case 'stats':
              handlersRef.current.onStats?.(data.payload);
              break;
            case 'status':
              handlersRef.current.onStatusUpdate?.(data.payload);
              break;
            case 'alert':
              handlersRef.current.onAlert?.(data.payload);
              break;
            case 'signal':
              handlersRef.current.onSignal?.(data.payload);
              break;
            case 'frame':
              handlersRef.current.onFrame?.(data.payload);
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        reconnectTimerRef.current = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // Will retry on reconnect timer
    }
  }, []); // Remove cameraIds dependency to prevent reconnect loop

  // Subscribe to cameras when connection opens OR cameraIds change
  useEffect(() => {
    if (isConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      for (const cameraId of cameraIds) {
        wsRef.current.send(JSON.stringify({
          type: 'subscribe',
          payload: { cameraId },
        }));
      }
    }
  }, [cameraIds, isConnected]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  /**
   * Send a WebRTC signaling message (SDP offer, ICE candidate) through
   * the existing WebSocket connection.
   */
  const sendSignal = useCallback((cameraId: string, kind: string, data: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'signal',
        payload: { cameraId, kind, data },
      }));
    }
  }, []);

  return { isConnected, sendSignal };
}
