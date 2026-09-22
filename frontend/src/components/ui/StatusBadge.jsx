export default function StatusBadge({ status = 'PENDING', label: customLabel }) {
  const normalized = (status || 'PENDING').toUpperCase();

  const statusMap = {
    UP: {
      className: 'badge-up',
      dotClass: 'status-dot-up',
      defaultLabel: 'Up',
    },
    DOWN: {
      className: 'badge-down',
      dotClass: 'status-dot-down',
      defaultLabel: 'Down',
    },
    DEGRADED: {
      className: 'badge-degraded',
      dotClass: 'status-dot-degraded',
      defaultLabel: 'Degraded',
    },
    UNKNOWN: {
      className: 'badge-pending',
      dotClass: 'status-dot-pending',
      defaultLabel: 'Unknown',
    },
    PENDING: {
      className: 'badge-pending',
      dotClass: 'status-dot-pending',
      defaultLabel: 'Pending',
    },
  };

  const config = statusMap[normalized] || statusMap.PENDING;
  const displayText = customLabel || config.defaultLabel;

  return (
    <span className={`badge ${config.className}`}>
      <span className={`status-dot ${config.dotClass}`} aria-hidden="true" />
      <span>{displayText}</span>
    </span>
  );
}
