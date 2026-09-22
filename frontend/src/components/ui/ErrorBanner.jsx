import { AlertCircle, RefreshCw } from 'lucide-react';

export default function ErrorBanner({
  title = 'Backend connection issue',
  message,
  onRetry,
  retrying = false,
}) {
  if (!message) return null;

  return (
    <div
      className="error-banner"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-4)',
        marginBottom: 'var(--space-6)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-down-muted)',
        border: '1px solid rgba(239, 68, 68, 0.3)',
        color: 'var(--color-down)',
        fontSize: 'var(--text-sm)',
      }}
      role="alert"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <AlertCircle size={18} style={{ flexShrink: 0 }} />
        <span>
          <strong>{title}:</strong> {message}
        </span>
      </div>

      {onRetry && (
        <button
          type="button"
          className="btn btn-outline"
          onClick={onRetry}
          disabled={retrying}
          style={{
            borderColor: 'rgba(239, 68, 68, 0.4)',
            color: 'var(--color-down)',
            padding: 'var(--space-1) var(--space-3)',
            fontSize: 'var(--text-xs)',
          }}
        >
          <RefreshCw
            size={12}
            style={{ animation: retrying ? 'spin 1s linear infinite' : undefined }}
          />
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
      )}
    </div>
  );
}
