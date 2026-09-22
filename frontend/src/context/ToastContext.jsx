import { createContext, useState, useCallback, useMemo } from 'react';

const ToastContext = createContext(null);

let nextToastId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((toastItem) => {
    const id = nextToastId++;
    const duration = toastItem.duration ?? 4000;

    const newToast = {
      id,
      type: toastItem.type || 'info', // 'success' | 'error' | 'info'
      title: toastItem.title || '',
      message: toastItem.message || '',
    };

    setToasts((prev) => [...prev, newToast]);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }

    return id;
  }, [removeToast]);

  const toast = useMemo(
    () => ({
      success: (message, title = 'Success') => addToast({ type: 'success', title, message }),
      error: (message, title = 'Error') => addToast({ type: 'error', title, message }),
      info: (message, title = 'Notice') => addToast({ type: 'info', title, message }),
    }),
    [addToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, toast }}>
      {children}
    </ToastContext.Provider>
  );
}

export default ToastContext;
