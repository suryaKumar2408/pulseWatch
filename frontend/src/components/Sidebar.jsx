import { Activity, LayoutDashboard, Monitor, AlertCircle, BarChart3, Settings, LogOut, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/monitors',  icon: Monitor,         label: 'Monitors' },
  { to: '/incidents', icon: AlertCircle,     label: 'Incidents' },
  { to: '/analytics', icon: BarChart3,       label: 'Analytics' },
];

export default function Sidebar({ isOpen = false, onClose }) {
  const { logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Local session is cleared even if network fails
    }
  };

  return (
    <aside className={`app-sidebar ${isOpen ? 'open' : ''}`} aria-label="Sidebar navigation">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <Activity size={18} color="white" strokeWidth={2.5} />
        </div>
        <span className="sidebar-logo-text">PulseWatch</span>

        {/* Mobile close drawer button */}
        <button
          type="button"
          className="sidebar-close-btn"
          onClick={onClose}
          aria-label="Close navigation sidebar"
        >
          <X size={18} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav" aria-label="Main navigation">
        <span className="sidebar-section-label">Monitoring</span>

        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/dashboard'}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            onClick={onClose}
          >
            <Icon size={18} className="nav-link-icon" />
            {label}
          </NavLink>
        ))}

        <span className="sidebar-section-label" style={{ marginTop: 'var(--space-4)' }}>
          System
        </span>

        <NavLink
          to="/settings"
          className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          onClick={onClose}
        >
          <Settings size={18} className="nav-link-icon" />
          Settings
        </NavLink>
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            marginBottom: 'var(--space-2)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          <span>PulseWatch Engine</span>
          <span style={{ color: 'var(--color-brand-hover)', fontFamily: 'var(--font-mono)' }}>v1.0.0</span>
        </div>

        <button
          type="button"
          className="nav-link"
          style={{ color: 'var(--color-text-muted)', width: '100%', cursor: 'pointer' }}
          onClick={handleLogout}
        >
          <LogOut size={18} className="nav-link-icon" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
