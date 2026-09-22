import { useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

export default function ConfirmModal({
  isOpen = false,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed? This action cannot be undone.',
  confirmText = 'Delete',
  confirmVariant = 'danger',
  isLoading = false,
}) {
  const cancelBtnRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      cancelBtnRef.current?.focus();
      const handleEscape = (e) => {
        if (e.key === 'Escape' && !isLoading) {
          onClose();
        }
      };
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!isLoading) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div
        className="modal-container modal-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id="confirm-modal-title">
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-md)',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-down)',
              }}
            >
              <AlertTriangle size={18} />
            </div>
            <span>{title}</span>
          </div>

          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
            {message}
          </p>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            ref={cancelBtnRef}
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </button>

          <button
            type="button"
            className={`btn btn-${confirmVariant}`}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="spin" />
                Deleting...
              </>
            ) : (
              confirmText
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
