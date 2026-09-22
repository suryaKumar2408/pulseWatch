import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import ToastContainer from './ui/ToastContainer';
import { useAuth } from '../hooks/useAuth';

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user } = useAuth();

  const userInitial = user?.email ? user.email.charAt(0).toUpperCase() : 'PW';

  return (
    <div className="app-layout">
      {/* Accessible skip to main content for screen readers and keyboard users */}
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      {/* Global Toast Container */}
      <ToastContainer />

      {/* Mobile drawer backdrop */}
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar navigation */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content area */}
      <main className="app-main" id="main-content">
        {/* Sticky top navigation bar */}
        <header className="app-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {/* Mobile menu toggle */}
            <button
              type="button"
              className="menu-toggle-btn"
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label="Toggle navigation menu"
              aria-expanded={sidebarOpen}
            >
              <Menu size={20} />
            </button>

            <span
              className="topbar-subtitle"
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-muted)',
                fontWeight: 'var(--weight-medium)',
              }}
            >
              Enterprise Uptime &amp; Observability
            </span>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {/* Workspace / User Indicator */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-secondary)',
                maxWidth: '220px',
              }}
            >
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--color-brand)',
                  boxShadow: '0 0 6px var(--color-brand)',
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontWeight: 'var(--weight-medium)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user?.email || 'PulseWatch Core'}
              </span>
            </div>

            {/* User Profile Avatar Pill */}
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'var(--color-brand-muted)',
                border: '1px solid var(--color-border-brand)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--color-brand-hover)',
                flexShrink: 0,
              }}
              title={user?.email || 'Administrator Profile'}
            >
              {userInitial}
            </div>
          </div>
        </header>

        {/* Dynamic page content */}
        <div className="app-content">{children || <Outlet />}</div>
      </main>
    </div>
  );
}
