import { useState, useEffect, type FormEvent } from 'react';
import type { Camera } from '../types';
import { apiClient } from '../api/client';
import './CameraForm.css';

interface CameraFormProps {
  camera?: Camera | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function CameraForm({ camera, onClose, onSuccess }: CameraFormProps) {
  const [name, setName] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditing = !!camera;

  useEffect(() => {
    if (camera) {
      setName(camera.name);
      setRtspUrl(camera.rtspUrl);
      setLocation(camera.location || '');
    }
  }, [camera]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Camera name is required');
      return;
    }

    if (!rtspUrl.trim()) {
      setError('RTSP URL is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const data = {
        name: name.trim(),
        rtspUrl: rtspUrl.trim(),
        ...(location.trim() ? { location: location.trim() } : {}),
      };

      if (isEditing && camera) {
        await apiClient.updateCamera(camera.id, data);
      } else {
        await apiClient.createCamera(data);
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-content camera-form-modal">
        <div className="modal-header">
          <h2 className="modal-title">
            {isEditing ? (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit Camera
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                Add Camera
              </>
            )}
          </h2>
          <button className="btn btn-icon btn-ghost" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="camera-form-error animate-fadeIn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="camera-name">Camera Name</label>
            <input
              id="camera-name"
              className="form-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Front Entrance"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="camera-rtsp">RTSP URL</label>
            <input
              id="camera-rtsp"
              className="form-input"
              type="text"
              list="rtsp-suggestions"
              value={rtspUrl}
              onChange={(e) => setRtspUrl(e.target.value)}
              placeholder="e.g. rtsp://192.168.1.100:554/stream"
            />
            <datalist id="rtsp-suggestions">
              <option value="rtsp://mediamtx:8554/live/test1">Stream 1 — Color Bars (live/test1)</option>
              <option value="rtsp://mediamtx:8554/live/test2">Stream 2 — SMPTE Bars (live/test2)</option>
              <option value="rtsp://mediamtx:8554/live/test3">Stream 3 — Test Pattern (live/test3)</option>
              <option value="rtsp://mediamtx:8554/live/test4">Stream 4 — Blue Feed (live/test4)</option>
            </datalist>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="camera-location">
              Location <span style={{ color: 'var(--text-dim)', textTransform: 'none' }}>(optional)</span>
            </label>
            <input
              id="camera-location"
              className="form-input"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Building A, Floor 2"
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  {isEditing ? 'Saving...' : 'Creating...'}
                </>
              ) : (
                isEditing ? 'Save Changes' : 'Add Camera'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
