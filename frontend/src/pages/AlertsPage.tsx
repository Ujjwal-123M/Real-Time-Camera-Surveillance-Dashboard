import { useState, useEffect, useCallback } from 'react';
import type { Camera, Alert, PaginatedAlerts } from '../types';
import { apiClient } from '../api/client';
import { AlertList } from '../components/AlertList';

export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedCamera, setSelectedCamera] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const limit = 20;

  const fetchAlerts = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const params: {
        cameraId?: string;
        from?: string;
        to?: string;
        page: number;
        limit: number;
      } = { page, limit };

      if (selectedCamera) params.cameraId = selectedCamera;
      if (dateFrom) params.from = new Date(dateFrom).toISOString();
      if (dateTo) params.to = new Date(dateTo).toISOString();

      const data: PaginatedAlerts = await apiClient.getAlerts(params);
      setAlerts(data.alerts);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    } finally {
      setIsLoading(false);
    }
  }, [page, selectedCamera, dateFrom, dateTo]);

  useEffect(() => {
    apiClient.getCameras().then(setCameras).catch(() => {});
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const totalPages = Math.ceil(total / limit);

  const handleFilterChange = () => {
    setPage(1);
  };

  return (
    <div className="alerts-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Alerts</h1>
          <p className="page-subtitle">
            {total} detection{total !== 1 ? 's' : ''} recorded
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="alerts-filters">
        <div className="filter-group">
          <label className="form-label">Camera</label>
          <select
            className="form-input"
            value={selectedCamera}
            onChange={(e) => {
              setSelectedCamera(e.target.value);
              handleFilterChange();
            }}
          >
            <option value="">All Cameras</option>
            {cameras.map((cam) => (
              <option key={cam.id} value={cam.id}>
                {cam.name}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="form-label">From</label>
          <input
            type="datetime-local"
            className="form-input"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              handleFilterChange();
            }}
          />
        </div>

        <div className="filter-group">
          <label className="form-label">To</label>
          <input
            type="datetime-local"
            className="form-input"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              handleFilterChange();
            }}
          />
        </div>

        <div className="filter-group filter-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSelectedCamera('');
              setDateFrom('');
              setDateTo('');
              setPage(1);
            }}
          >
            Clear Filters
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="page-loading" style={{ minHeight: '300px' }}>
          <div className="spinner spinner-lg" />
        </div>
      ) : (
        <>
          <AlertList
            alerts={alerts}
            cameraNames={Object.fromEntries(cameras.map((c) => [c.id, c.name]))}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="pagination">
              <button
                className="btn btn-ghost btn-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <span className="pagination-info">
                Page {page} of {totalPages}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
