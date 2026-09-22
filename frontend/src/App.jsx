import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ProtectedRoute from './components/ProtectedRoute';
import PublicOnlyRoute from './components/PublicOnlyRoute';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Monitors from './pages/Monitors';
import MonitorDetail from './pages/MonitorDetail';
import Incidents from './pages/Incidents';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Register from './pages/Register';

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes>
          {/* Public-only authentication routes (redirected to / if authenticated) */}
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Route>

          {/* Protected workspace routes (redirected to /login if unauthenticated) */}
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/monitors" element={<Monitors />} />
              <Route path="/monitors/:id" element={<MonitorDetail />} />
              <Route path="/incidents" element={<Incidents />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
          </Route>

          {/* Fallback unknown routes */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}
