import type { Camera } from '../types';

interface StatusBadgeProps {
  status: Camera['status'];
}

const statusLabels: Record<Camera['status'], string> = {
  connecting: 'Connecting',
  live: 'Live',
  stopped: 'Stopped',
  error: 'Error',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-${status}`}>
      <span className="status-dot" />
      {statusLabels[status]}
    </span>
  );
}
