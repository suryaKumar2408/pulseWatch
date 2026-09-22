import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { useToast } from '../../hooks/useToast';

export default function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((item) => {
        const isSuccess = item.type === 'success';
        const isError = item.type === 'error';

        return (
          <div
            key={item.id}
            className={`toast-item toast-${item.type}`}
            role={isError ? 'alert' : 'status'}
          >
            {/* Status icon */}
            <div style={{ flexShrink: 0, marginTop: 1 }}>
              {isSuccess && <CheckCircle2 size={16} style={{ color: 'var(--color-up)' }} />}
              {isError && <AlertCircle size={16} style={{ color: 'var(--color-down)' }} />}
              {!isSuccess && !isError && <Info size={16} style={{ color: 'var(--color-info)' }} />}
            </div>

            {/* Content */}
            <div className="toast-content">
              {item.title && <div className="toast-title">{item.title}</div>}
              {item.message && <div className="toast-message">{item.message}</div>}
            </div>

            {/* Dismiss button */}
            <button
              type="button"
              className="toast-close-btn"
              onClick={() => removeToast(item.id)}
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
