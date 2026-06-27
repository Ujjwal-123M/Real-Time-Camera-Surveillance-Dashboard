import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Camera, CameraStats, Alert } from '../types';
import { apiClient } from '../api/client';
import { CameraCard } from '../components/CameraCard';
import { CameraForm } from '../components/CameraForm';
import { useWebSocket } from '../hooks/useWebSocket';
import { useWebRTC } from '../hooks/useWebRTC';

/**
 * Wrapper component that provides WebRTC connection per camera card.
 */
function CameraCardWithWebRTC({
  camera,
  stats,
  recentAlerts,
  sendSignal,
  isConnected,
  onEdit,
  onDelete,
  onStatusChange,
  registerSignalHandler,
  fallbackFrame,
}: {
  camera: Camera;
  stats?: CameraStats;
  recentAlerts?: Alert[];
  sendSignal: (cameraId: string, kind: string, data: unknown) => void;
  isConnected: boolean;
  onEdit: (camera: Camera) => void;
  onDelete: (camera: Camera) => void;
  onStatusChange: () => void;
  registerSignalHandler: (cameraId: string, handler: ((kind: string, data: unknown) => void) | null) => void;
  fallbackFrame?: string;
}) {
  const isLive = camera.status === 'live';

  const { stream, connectionState, handleSignal } = useWebRTC({
    cameraId: camera.id,
    active: isLive && isConnected,
    sendSignal,
  });

  // Register this camera's signal handler with the parent
  useEffect(() => {
    if (isLive && handleSignal) {
      registerSignalHandler(camera.id, handleSignal);
    }
    return () => {
      registerSignalHandler(camera.id, null);
    };
  }, [camera.id, isLive, handleSignal, registerSignalHandler]);

  return (
    <CameraCard
      camera={camera}
      stats={stats}
      recentAlerts={recentAlerts}
      videoStream={stream}
      webrtcState={connectionState}
      fallbackFrame={fallbackFrame}
      onEdit={onEdit}
      onDelete={onDelete}
      onStatusChange={onStatusChange}
    />
  );
}

export function DashboardPage() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingCamera, setEditingCamera] = useState<Camera | null>(null);
  const [cameraStats, setCameraStats] = useState<Record<string, CameraStats>>({});
  const [recentAlerts, setRecentAlerts] = useState<Record<string, Alert[]>>({});

  // Map of cameraId → signal handler function (set by each CameraCardWithWebRTC)
  const signalHandlersRef = useRef<Record<string, (kind: string, data: unknown) => void>>({});

  const registerSignalHandler = useCallback(
    (cameraId: string, handler: ((kind: string, data: unknown) => void) | null) => {
      if (handler) {
        signalHandlersRef.current[cameraId] = handler;
      } else {
        delete signalHandlersRef.current[cameraId];
      }
    },
    [],
  );

  const fetchCameras = useCallback(async () => {
    try {
      setError(null);
      const data = await apiClient.getCameras();
      setCameras(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cameras');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch recent alerts for all cameras
  const fetchRecentAlerts = useCallback(async (cameraList: Camera[]) => {
    try {
      const alertMap: Record<string, Alert[]> = {};
      // Fetch last 3 alerts for each camera in parallel
      const results = await Promise.allSettled(
        cameraList.map((cam) =>
          apiClient.getAlerts({ cameraId: cam.id, limit: 3 }),
        ),
      );
      cameraList.forEach((cam, i) => {
        const result = results[i];
        if (result.status === 'fulfilled') {
          alertMap[cam.id] = result.value.alerts;
        }
      });
      setRecentAlerts(alertMap);
    } catch {
      // Non-critical — ignore
    }
  }, []);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  // Once cameras are loaded (first time only), fetch their recent alerts
  const alertsFetched = useRef(false);
  useEffect(() => {
    if (cameras.length > 0 && !alertsFetched.current) {
      alertsFetched.current = true;
      fetchRecentAlerts(cameras);
    }
  }, [cameras, fetchRecentAlerts]);

  // Poll cameras every 5 seconds to pick up status changes from DB
  useEffect(() => {
    const interval = setInterval(fetchCameras, 5000);
    return () => clearInterval(interval);
  }, [fetchCameras]);

  // Collect camera IDs for WebSocket subscription
  const cameraIds = useMemo(() => cameras.map((c) => c.id), [cameras]);
  const [cameraFrames, setCameraFrames] = useState<Record<string, string>>({});

  // WebSocket for real-time stats, status, alerts, and signaling
  const { sendSignal, isConnected } = useWebSocket(cameraIds, {
    onStats: (stats) => {
      setCameraStats((prev) => ({ ...prev, [stats.cameraId]: stats }));
    },
    onFrame: (frame) => {
      setCameraFrames((prev) => ({ ...prev, [frame.cameraId]: frame.image }));
    },
    onStatusUpdate: (update) => {
      setCameras((prev) =>
        prev.map((cam) =>
          cam.id === update.cameraId ? { ...cam, status: update.status } : cam,
        ),
      );
    },
    onAlert: (alert) => {
      // Prepend the new alert and keep only the latest 3
      setRecentAlerts((prev) => {
        const current = prev[alert.cameraId] || [];
        return {
          ...prev,
          [alert.cameraId]: [alert, ...current].slice(0, 3),
        };
      });
    },
    onSignal: (signal) => {
      // Route the signaling message to the correct camera's WebRTC handler
      const handler = signalHandlersRef.current[signal.cameraId];
      if (handler) {
        handler(signal.kind, signal.data);
      }
    },
  });

  const handleEdit = (camera: Camera) => {
    setEditingCamera(camera);
    setShowForm(true);
  };

  const handleDelete = async (camera: Camera) => {
    if (!confirm(`Delete camera "${camera.name}"? This cannot be undone.`)) return;
    try {
      await apiClient.deleteCamera(camera.id);
      await fetchCameras();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete camera');
    }
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingCamera(null);
  };

  const handleFormSuccess = () => {
    handleFormClose();
    fetchCameras();
  };

  if (isLoading) {
    return (
      <div className="page-loading">
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {cameras.length} camera{cameras.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <div className="page-header-actions">
          <button
            className="btn btn-ghost"
            onClick={fetchCameras}
            title="Refresh"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            Refresh
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Camera
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '1.5rem' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          {error}
        </div>
      )}

      {cameras.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <h2 className="empty-state-title">No cameras yet</h2>
          <p className="empty-state-description">
            Add your first camera to start monitoring your spaces in real-time.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Your First Camera
          </button>
        </div>
      ) : (
        <div className="camera-grid">
          {cameras.map((camera) => (
            <CameraCardWithWebRTC
              key={camera.id}
              camera={camera}
              stats={cameraStats[camera.id]}
              recentAlerts={recentAlerts[camera.id]}
              sendSignal={sendSignal}
              isConnected={isConnected}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onStatusChange={fetchCameras}
              registerSignalHandler={registerSignalHandler}
              fallbackFrame={cameraFrames[camera.id]}
            />
          ))}
        </div>
      )}

      {showForm && (
        <CameraForm
          camera={editingCamera}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}
    </div>
  );
}
