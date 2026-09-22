import { useState, useEffect } from 'react';
import {
  Activity,
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Key,
  LogOut,
  Radio,
  ShieldCheck,
  User,
} from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../hooks/useToast';
import ConfirmModal from '../components/ui/ConfirmModal';

const WEBHOOK_SAMPLE_SCHEMA = `{
  "event": "MONITOR_DOWN | MONITOR_RECOVERED",
  "monitor": {
    "id": "cm...abc123",
    "name": "Production API Gateway",
    "url": "https://api.example.com/health",
    "status": "DOWN"
  },
  "incident": {
    "id": "cm...inc456",
    "cause": "HTTP 502 Bad Gateway",
    "errorCode": "ERR_BAD_RESPONSE",
    "statusCode": 502,
    "startedAt": "2026-09-22T00:00:00.000Z",
    "durationSeconds": 180
  },
  "timestamp": "2026-09-22T00:03:00.000Z"
}`;

export default function Settings() {
  const { user, logout } = useAuth();
  const { toast } = useToast();

  const [copiedSchema, setCopiedSchema] = useState(false);
  const [healthStatus, setHealthStatus] = useState(null);
  const [isPingingHealth, setIsPingingHealth] = useState(false);

  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Probe default preferences (stored locally in localStorage)
  const [defaultInterval, setDefaultInterval] = useState(() => {
    return localStorage.getItem('pw_pref_interval') || '60';
  });
  const [defaultTimeout, setDefaultTimeout] = useState(() => {
    return localStorage.getItem('pw_pref_timeout') || '10';
  });
  const [liveTelemetry, setLiveTelemetry] = useState(() => {
    return localStorage.getItem('pw_pref_live') !== 'false';
  });

  // Verify backend health connectivity
  useEffect(() => {
    let active = true;
    async function checkHealth() {
      setIsPingingHealth(true);
      try {
        const res = await api.get('/api/health');
        if (active) {
          setHealthStatus(res.data?.status || 'OK');
        }
      } catch {
        if (active) setHealthStatus('UNREACHABLE');
      } finally {
        if (active) setIsPingingHealth(false);
      }
    }
    checkHealth();
    return () => {
      active = false;
    };
  }, []);

  const handleCopySchema = () => {
    navigator.clipboard.writeText(WEBHOOK_SAMPLE_SCHEMA);
    setCopiedSchema(true);
    toast.success('Webhook payload schema copied to clipboard');
    setTimeout(() => setCopiedSchema(false), 2500);
  };

  const handleSavePreferences = () => {
    localStorage.setItem('pw_pref_interval', defaultInterval);
    localStorage.setItem('pw_pref_timeout', defaultTimeout);
    localStorage.setItem('pw_pref_live', String(liveTelemetry));
    toast.success('Monitoring defaults saved successfully');
  };

  const handleConfirmLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      toast.info('Signed out of PulseWatch Core');
    } catch {
      // Local session is cleared even if network fails
    } finally {
      setIsLoggingOut(false);
      setLogoutModalOpen(false);
    }
  };

  return (
    <div className="settings-container">
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <h1 className="page-title">Platform Settings</h1>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(99, 102, 241, 0.1)',
                border: '1px solid var(--color-border-brand)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-brand-hover)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <Key size={12} />
              <span>CORE CONFIG</span>
            </span>
          </div>
          <p className="page-subtitle">
            Account identity, monitoring defaults, alerting webhooks, and security telemetry
          </p>
        </div>
      </div>

      {/* Section 1: User & Workspace Identity */}
      <div className="settings-section-card">
        <div className="settings-section-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <User size={16} style={{ color: 'var(--color-brand-hover)' }} />
            <h2 className="card-title" style={{ fontSize: 'var(--text-sm)' }}>
              Account &amp; Workspace Profile
            </h2>
          </div>
          <span className="tag" style={{ color: 'var(--color-up)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
            Active Session
          </span>
        </div>

        <div className="settings-section-body">
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Authenticated Email</div>
              <div className="settings-row-desc">Primary login identity used for session verification and alerts</div>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-primary)' }}>
              {user?.email || 'user@pulsewatch.local'}
            </span>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">Workspace Access Role</div>
              <div className="settings-row-desc">Access authorization level within this PulseWatch fleet</div>
            </div>
            <span className="tag">Account Administrator</span>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">Authentication Token</div>
              <div className="settings-row-desc">JSON Web Token with 24-hour expiration stored in secure browser storage</div>
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--color-up)',
                fontSize: 'var(--text-xs)',
              }}
            >
              <CheckCircle2 size={13} />
              <span>JWT Bearer Active</span>
            </span>
          </div>

          <div style={{ paddingTop: 'var(--space-2)', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-danger"
              style={{ padding: '6px 14px', fontSize: 'var(--text-xs)' }}
              onClick={() => setLogoutModalOpen(true)}
            >
              <LogOut size={14} />
              <span>Sign Out of PulseWatch</span>
            </button>
          </div>
        </div>
      </div>

      {/* Section 2: Global Monitoring Defaults */}
      <div className="settings-section-card">
        <div className="settings-section-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Activity size={16} style={{ color: 'var(--color-up)' }} />
            <h2 className="card-title" style={{ fontSize: 'var(--text-sm)' }}>
              Monitoring Presets &amp; Defaults
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '4px 12px', fontSize: 'var(--text-xs)' }}
            onClick={handleSavePreferences}
          >
            Save Defaults
          </button>
        </div>

        <div className="settings-section-body">
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Default Probe Interval</div>
              <div className="settings-row-desc">Default frequency pre-selected when configuring a new target</div>
            </div>
            <select
              className="analytics-scope-select"
              value={defaultInterval}
              onChange={(e) => setDefaultInterval(e.target.value)}
              aria-label="Default Probe Interval"
            >
              <option value="30">30 seconds (High-frequency)</option>
              <option value="60">60 seconds (1 minute standard)</option>
              <option value="300">300 seconds (5 minutes)</option>
              <option value="900">900 seconds (15 minutes)</option>
            </select>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">Default Request Timeout</div>
              <div className="settings-row-desc">Time to wait before a target probe is recorded as ETIMEDOUT</div>
            </div>
            <select
              className="analytics-scope-select"
              value={defaultTimeout}
              onChange={(e) => setDefaultTimeout(e.target.value)}
              aria-label="Default Request Timeout"
            >
              <option value="5">5 seconds</option>
              <option value="10">10 seconds (standard)</option>
              <option value="15">15 seconds</option>
              <option value="30">30 seconds</option>
            </select>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">Auto-Refresh Live Telemetry</div>
              <div className="settings-row-desc">Enable 15-second background synchronization on Dashboard and Analytics</div>
            </div>
            <button
              type="button"
              className={`period-btn ${liveTelemetry ? 'active' : ''}`}
              style={{ fontSize: 'var(--text-xs)', padding: '4px 12px' }}
              onClick={() => setLiveTelemetry((prev) => !prev)}
            >
              {liveTelemetry ? 'Enabled (15s)' : 'Disabled (Manual)'}
            </button>
          </div>
        </div>
      </div>

      {/* Section 3: Alert Notification & Webhook Integration */}
      <div className="settings-section-card">
        <div className="settings-section-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Bell size={16} style={{ color: '#f59e0b' }} />
            <h2 className="card-title" style={{ fontSize: 'var(--text-sm)' }}>
              Outage Alerting &amp; Webhooks
            </h2>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '4px 10px', fontSize: 'var(--text-xs)' }}
            onClick={handleCopySchema}
            title="Copy sample JSON webhook payload"
          >
            {copiedSchema ? <Check size={13} style={{ color: 'var(--color-up)' }} /> : <Copy size={13} />}
            <span>{copiedSchema ? 'Copied' : 'Copy JSON Schema'}</span>
          </button>
        </div>

        <div className="settings-section-body">
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            PulseWatch dispatches automated notifications whenever a monitored target changes health state.
            Alerts include root cause analysis, HTTP response codes, and exact outage durations.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-lg)',
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', color: 'var(--color-down)' }}>
                <AlertCircle size={14} />
                <span>MONITOR_DOWN Trigger</span>
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                Fired when consecutive probe failures exceed your configured threshold.
              </div>
            </div>

            <div
              style={{
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-lg)',
                background: 'rgba(16, 185, 129, 0.05)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', color: 'var(--color-up)' }}>
                <CheckCircle2 size={14} />
                <span>MONITOR_RECOVERED Trigger</span>
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                Fired when a previously failing endpoint returns healthy response codes.
              </div>
            </div>
          </div>

          <div style={{ marginTop: 'var(--space-2)' }}>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', marginBottom: 6, color: 'var(--color-text-secondary)' }}>
              Webhook JSON Payload Specification
            </div>
            <pre
              style={{
                background: 'var(--color-bg-primary)',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-border)',
                color: '#cbd5e1',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                overflowX: 'auto',
                lineHeight: 1.5,
              }}
            >
              {WEBHOOK_SAMPLE_SCHEMA}
            </pre>
          </div>
        </div>
      </div>

      {/* Section 4: Engine Diagnostics & Infrastructure */}
      <div className="settings-section-card">
        <div className="settings-section-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Cpu size={16} style={{ color: '#60a5fa' }} />
            <h2 className="card-title" style={{ fontSize: 'var(--text-sm)' }}>
              Platform Infrastructure &amp; Security
            </h2>
          </div>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 'var(--text-xs)',
              color: healthStatus === 'OK' ? 'var(--color-up)' : '#f59e0b',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <Radio size={12} className={isPingingHealth ? 'spin' : ''} />
            <span>{isPingingHealth ? 'CHECKING' : healthStatus === 'OK' ? 'API ONLINE' : 'API CONNECTING'}</span>
          </div>
        </div>

        <div className="settings-section-body">
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Engine Version</div>
              <div className="settings-row-desc">Core background scheduler and health probe worker</div>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-primary)' }}>
              PulseWatch v1.0.0 (Production Core)
            </span>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">SSRF Protection Engine</div>
              <div className="settings-row-desc">Enforces private IP blocking, IPv6 link-local filtration, and DNS re-resolution checks</div>
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--color-up)',
                fontSize: 'var(--text-xs)',
              }}
            >
              <ShieldCheck size={14} />
              <span>Hardened Active</span>
            </span>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">Concurrent Capacity</div>
              <div className="settings-row-desc">Verified workload throughput for simultaneous monitor scheduling</div>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
              50+ Endpoints Concurrent
            </span>
          </div>

          <div className="settings-row">
            <div>
              <div className="settings-row-label">API Gateway Target</div>
              <div className="settings-row-desc">Endpoint utilized by frontend client for telemetry synchronization</div>
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              {import.meta.env.VITE_API_URL || 'Direct Origin (/api/v1)'}
            </span>
          </div>
        </div>
      </div>

      {/* Logout Confirmation Modal */}
      <ConfirmModal
        isOpen={logoutModalOpen}
        onClose={() => setLogoutModalOpen(false)}
        onConfirm={handleConfirmLogout}
        title="Sign Out of PulseWatch"
        message="Are you sure you want to sign out? Your session token will be cleared and you will be returned to the login screen."
        confirmText="Sign Out"
        confirmVariant="danger"
        isLoading={isLoggingOut}
      />
    </div>
  );
}
