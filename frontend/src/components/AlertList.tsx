import type { Alert } from '../types';
import './AlertList.css';

interface AlertListProps {
  alerts: Alert[];
  cameraNames?: Record<string, string>;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function getConfidenceClass(confidence: number): string {
  if (confidence >= 0.8) return 'confidence-high';
  if (confidence >= 0.5) return 'confidence-medium';
  return 'confidence-low';
}

export function AlertList({ alerts, cameraNames }: AlertListProps) {
  if (alerts.length === 0) {
    return (
      <div className="empty-state">
        <svg className="empty-state-icon" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <h3 className="empty-state-title">No Alerts</h3>
        <p className="empty-state-description">
          No detection events found. Alerts will appear here when persons are detected.
        </p>
      </div>
    );
  }

  return (
    <div className="alert-list">
      {alerts.map((alert, index) => (
        <div
          key={alert.id}
          className="alert-item"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <div className="alert-item-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>

          <div className="alert-item-content">
            <div className="alert-item-header">
              <span className="alert-item-type">Person Detected</span>
              <span className="alert-item-time">{timeAgo(alert.detectedAt)}</span>
            </div>
            <div className="alert-item-details">
              <span className={`alert-item-confidence ${getConfidenceClass(alert.confidence)}`}>
                {(alert.confidence * 100).toFixed(1)}% confidence
              </span>
              {cameraNames?.[alert.cameraId] && (
                <span className="alert-item-camera">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  {cameraNames[alert.cameraId]}
                </span>
              )}
              <span className="alert-item-bbox">
                [{alert.boundingBox.x}, {alert.boundingBox.y}] {alert.boundingBox.width}×{alert.boundingBox.height}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
