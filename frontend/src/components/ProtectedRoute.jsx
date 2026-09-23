import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Loader2 } from 'lucide-react';

export default function ProtectedRoute() {
  const { isAuthenticated, isLoading, loading } = useAuth();
  const location = useLocation();
  const authLoading = loading !== undefined ? loading : isLoading;

  if (authLoading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: 'var(--space-4)',
        backgroundColor: 'var(--color-bg-primary)'
      }}>
        <Loader2 className="spin" size={32} style={{ color: 'var(--color-brand)' }} />
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Validating session...
        </span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
