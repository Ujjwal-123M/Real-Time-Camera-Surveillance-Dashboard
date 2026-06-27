import { useState, useRef, useEffect } from 'react';
import type { Camera, CameraStats, Alert } from '../types';
import { StatusBadge } from './StatusBadge';
import { apiClient } from '../api/client';
import './CameraCard.css';

interface CameraCardProps {
  camera: Camera;
  stats?: CameraStats;
  recentAlerts?: Alert[];
  videoStream?: MediaStream | null;
  webrtcState?: string;
  fallbackFrame?: string;
  onEdit: (camera: Camera) => void;
  onDelete: (camera: Camera) => void;
  onStatusChange: () => void;
}

export function CameraCard({
  camera,
  stats,
  recentAlerts = [],
  videoStream,
  webrtcState,
  fallbackFrame,
  onEdit,
  onDelete,
  onStatusChange,
}: CameraCardProps) {
  const [isToggling, setIsToggling] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Attach the WebRTC stream to the <video> element
  useEffect(() => {
    if (videoRef.current && videoStream) {
      videoRef.current.srcObject = videoStream;
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [videoStream]);

  const handleToggle = async () => {
    setIsToggling(true);
    try {
      if (camera.status === 'stopped' || camera.status === 'error') {
        await apiClient.startCamera(camera.id);
      } else {
        await apiClient.stopCamera(camera.id);
      }
      onStatusChange();
    } catch (err) {
      console.error('Failed to toggle camera:', err);
    } finally {
      setIsToggling(false);
    }
  };

  const isRunning = camera.status === 'live' || camera.status === 'connecting';
  const hasVideo = camera.status === 'live' && videoStream;

  // Use live stats if available, otherwise show dashes
  const fpsDisplay = stats && camera.status === 'live' ? stats.fps.toFixed(1) : '—';
  const detDisplay = stats && camera.status === 'live' ? stats.detectionsPerMinute.toFixed(0) : '—';

  const formatAlertTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className={`camera-card ${camera.status === 'live' ? 'camera-card-live' : ''}`}>
      {/* Video Preview Area */}
      <div className="camera-card-preview">
        {/* Fallback MJPEG frame image */}
        {fallbackFrame && (
          <img 
            src={fallbackFrame} 
            className="camera-card-video camera-card-video-active" 
            style={{ zIndex: 0 }} 
            alt="Live Fallback Feed" 
          />
        )}
        
        {/* Live WebRTC video element */}
        <video
          ref={videoRef}
          className={`camera-card-video ${hasVideo ? 'camera-card-video-active' : ''}`}
          style={{ zIndex: 1 }}
          autoPlay
          playsInline
          muted
        />

        {/* Fallback placeholder when no video AND no fallback frame */}
        {!hasVideo && !fallbackFrame && (
          <div className="camera-card-preview-inner">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="camera-card-icon"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="camera-card-preview-text">
              {camera.status === 'connecting'
                ? 'Connecting...'
                : camera.status === 'live' && webrtcState === 'connecting'
                  ? 'Buffering...'
                  : 'No Stream'}
            </span>
          </div>
        )}

        {/* Status badge overlay */}
        <div className="camera-card-status-overlay">
          <StatusBadge status={camera.status} />
        </div>

        {/* Live indicator dot for active video */}
        {hasVideo && (
          <div className="camera-card-live-dot">
            <span className="live-dot-pulse" />
            REC
          </div>
        )}

        {/* Action buttons overlay */}
        <div className="camera-card-actions-overlay">
          <button
            className="btn btn-icon btn-ghost btn-sm camera-card-action-btn"
            onClick={() => onEdit(camera)}
            title="Edit camera"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            className="btn btn-icon btn-ghost btn-sm camera-card-action-btn camera-card-action-delete"
            onClick={() => onDelete(camera)}
            title="Delete camera"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Card Body */}
      <div className="camera-card-body">
        <div className="camera-card-info">
          <h3 className="camera-card-name">{camera.name}</h3>
          {camera.location && (
            <p className="camera-card-location">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {camera.location}
            </p>
          )}
        </div>

        {/* Live Stats */}
        <div className="camera-card-stats">
          <div className="camera-card-stat">
            <span className={`camera-card-stat-value ${stats && camera.status === 'live' ? 'camera-card-stat-live' : ''}`}>
              {fpsDisplay}
            </span>
            <span className="camera-card-stat-label">FPS</span>
          </div>
          <div className="camera-card-stat">
            <span className={`camera-card-stat-value ${stats && camera.status === 'live' ? 'camera-card-stat-live' : ''}`}>
              {detDisplay}
            </span>
            <span className="camera-card-stat-label">Det/min</span>
          </div>
        </div>

        {/* Recent Alerts */}
        {recentAlerts && recentAlerts.length > 0 && (
          <div className="camera-card-alerts">
            <span className="camera-card-alerts-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Recent Detections
            </span>
            <ul className="camera-card-alerts-list">
              {recentAlerts.slice(0, 3).map((alert) => (
                <li key={alert.id} className="camera-card-alert-item">
                  <span className="camera-card-alert-time">{formatAlertTime(alert.detectedAt)}</span>
                  <span className="camera-card-alert-conf">{(alert.confidence * 100).toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Toggle Button */}
        <button
          className={`btn btn-sm w-full ${isRunning ? 'btn-danger' : 'btn-success'}`}
          onClick={handleToggle}
          disabled={isToggling}
        >
          {isToggling ? (
            <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
          ) : isRunning ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              Stop
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Start
            </>
          )}
        </button>
      </div>
    </div>
  );
}
