import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-react';
import api from '../lib/api';
import StatusBadge from '../components/ui/StatusBadge';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';
import ErrorBanner from '../components/ui/ErrorBanner';
import ToggleSwitch from '../components/ui/ToggleSwitch';
import { TableRowSkeleton } from '../components/ui/LoadingSkeleton';

function formatRelativeTime(dateString) {
  if (!dateString) return 'Never';
  const now = new Date();
  const past = new Date(dateString);
  const diffSec = Math.floor((now - past) / 1000);

  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  return past.toLocaleDateString();
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

export default function Dashboard() {
  const navigate = useNavigate();

  // Selected period for analytics
  const [period, setPeriod] = useState('24h');

  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Data states
  const [monitors, setMonitors] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [recentChecks, setRecentChecks] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // Effect for initial load and period changes
  useEffect(() => {
    let active = true;

    async function run() {
      try {
        const [monRes, analyticsRes, incRes] = await Promise.allSettled([
          api.get('/api/v1/monitors', { params: { limit: 100, sort: 'createdAt', order: 'desc' } }),
          api.get('/api/v1/analytics', { params: { period } }),
          api.get('/api/v1/incidents', { params: { limit: 5, order: 'desc' } }),
        ]);

        if (!active) return;

        let fetchedMonitors = [];
        if (monRes.status === 'fulfilled') {
          fetchedMonitors = monRes.value.data?.data || [];
          setMonitors(fetchedMonitors);
        }

        if (analyticsRes.status === 'fulfilled') {
          setAnalytics(analyticsRes.value.data?.data || null);
        }

        if (incRes.status === 'fulfilled') {
          setIncidents(incRes.value.data?.data || []);
        }

        const activeTargets = fetchedMonitors.filter((m) => m.enabled).slice(0, 4);
        if (activeTargets.length > 0) {
          const checkPromises = activeTargets.map((m) =>
            api
              .get(`/api/v1/monitors/${m.id}/checks`, { params: { limit: 3, order: 'desc' } })
              .then((r) =>
                (r.data?.data || []).map((check) => ({
                  ...check,
                  monitorName: m.name,
                  monitorUrl: m.url,
                }))
              )
              .catch(() => [])
          );

          const checkResults = await Promise.all(checkPromises);
          if (!active) return;
          const combined = checkResults
            .flat()
            .sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt))
            .slice(0, 7);

          setRecentChecks(combined);
        } else {
          setRecentChecks([]);
        }
      } catch (err) {
        if (active) {
          setErrorMessage(
            err.response?.data?.error?.message ||
            err.message ||
            'Failed to synchronize dashboard telemetry with PulseWatch backend.'
          );
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    run();
    return () => {
      active = false;
    };
  }, [period]);

  // Background refresh trigger
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setErrorMessage('');

    try {
      const [monRes, analyticsRes, incRes] = await Promise.allSettled([
        api.get('/api/v1/monitors', { params: { limit: 100, sort: 'createdAt', order: 'desc' } }),
        api.get('/api/v1/analytics', { params: { period } }),
        api.get('/api/v1/incidents', { params: { limit: 5, order: 'desc' } }),
      ]);

      let fetchedMonitors = [];
      if (monRes.status === 'fulfilled') {
        fetchedMonitors = monRes.value.data?.data || [];
        setMonitors(fetchedMonitors);
      }

      if (analyticsRes.status === 'fulfilled') {
        setAnalytics(analyticsRes.value.data?.data || null);
      }

      if (incRes.status === 'fulfilled') {
        setIncidents(incRes.value.data?.data || []);
      }

      const activeTargets = fetchedMonitors.filter((m) => m.enabled).slice(0, 4);
      if (activeTargets.length > 0) {
        const checkPromises = activeTargets.map((m) =>
          api
            .get(`/api/v1/monitors/${m.id}/checks`, { params: { limit: 3, order: 'desc' } })
            .then((r) =>
              (r.data?.data || []).map((check) => ({
                ...check,
                monitorName: m.name,
                monitorUrl: m.url,
              }))
            )
            .catch(() => [])
        );

        const checkResults = await Promise.all(checkPromises);
        const combined = checkResults
          .flat()
          .sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt))
          .slice(0, 7);

        setRecentChecks(combined);
      } else {
        setRecentChecks([]);
      }
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to synchronize dashboard telemetry with PulseWatch backend.'
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [period]);

  // Auto-refresh interval (every 15 seconds)
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      handleRefresh();
    }, 15_000);
    return () => clearInterval(timer);
  }, [autoRefresh, handleRefresh]);

  // Health Metrics Computations
  const healthStats = useMemo(() => {
    const total = monitors.length;
    const up = monitors.filter((m) => m.status === 'UP').length;
    const down = monitors.filter((m) => m.status === 'DOWN').length;
    const unknown = monitors.filter((m) => m.status === 'UNKNOWN').length;
    const paused = monitors.filter((m) => !m.enabled).length;

    const upPct = total > 0 ? (up / total) * 100 : 0;
    const downPct = total > 0 ? (down / total) * 100 : 0;
    const unknownPct = total > 0 ? (unknown / total) * 100 : 0;

    return { total, up, down, unknown, paused, upPct, downPct, unknownPct };
  }, [monitors]);

  // Latency & Uptime values from backend analytics
  const uptimeVal = analytics?.summary?.uptimePercentage ?? null;
  const avgLatency = analytics?.summary?.averageResponseTime;
  const p95Latency = analytics?.summary?.p95ResponseTime;
  const p99Latency = analytics?.summary?.p99ResponseTime;
  const totalChecks = analytics?.summary?.totalChecks ?? 0;
  const successfulChecks = analytics?.summary?.successfulChecks ?? 0;
  const failedChecks = analytics?.summary?.failedChecks ?? 0;

  return (
    <div>
      {/* Top Header Section */}
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <h1 className="page-title">Monitoring Dashboard</h1>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-up)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <Radio size={12} className="spin" style={{ animationDuration: '3s' }} />
              <span>LIVE</span>
            </div>
          </div>
          <p className="page-subtitle">
            Real-time fleet availability, incident telemetry, and latency distribution
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          {/* Period selector */}
          <div className="period-btn-group">
            {['24h', '7d', '30d'].map((p) => (
              <button
                key={p}
                type="button"
                className={`period-btn ${period === p ? 'active' : ''}`}
                onClick={() => setPeriod(p)}
                disabled={isLoading}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Auto refresh toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-secondary)',
              background: 'var(--color-bg-elevated)',
              padding: 'var(--space-1) var(--space-3)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
            }}
          >
            <span>Auto (15s)</span>
            <ToggleSwitch
              checked={autoRefresh}
              onChange={setAutoRefresh}
              ariaLabel="Toggle 15-second automatic refresh"
            />
          </div>

          {/* Manual refresh button */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={isLoading || isRefreshing}
            title="Refresh monitoring telemetry"
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            <span>{isRefreshing ? 'Updating…' : 'Refresh'}</span>
          </button>

          {/* Manage / Create Monitor */}
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => navigate('/monitors')}
          >
            <Plus size={16} />
            <span>New Monitor</span>
          </button>
        </div>
      </div>

      {/* Error alert banner */}
      {errorMessage && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <ErrorBanner
            title="Telemetry Synchronization Error"
            message={errorMessage}
            onRetry={handleRefresh}
            retrying={isRefreshing}
          />
        </div>
      )}

      {/* Active Outages Banner */}
      {!isLoading && incidents.some((i) => i.status === 'OPEN') && (
        <div className="ongoing-alert-banner" style={{ marginBottom: 'var(--space-6)' }}>
          <div className="ongoing-alert-title">
            <AlertTriangle size={18} />
            <span>
              {incidents.filter((i) => i.status === 'OPEN').length} Active Outage
              {incidents.filter((i) => i.status === 'OPEN').length > 1 ? 's' : ''} Detected
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <span className="ongoing-alert-desc" style={{ fontSize: 'var(--text-xs)' }}>
              Affected: {incidents.filter((i) => i.status === 'OPEN').map((i) => i.monitor?.name || 'Endpoint').join(', ')}
            </span>
            <Link
              to="/incidents"
              className="btn btn-secondary"
              style={{
                padding: '4px 12px',
                fontSize: 'var(--text-xs)',
                borderColor: 'rgba(239, 68, 68, 0.4)',
                color: 'var(--color-down)',
                textDecoration: 'none',
              }}
            >
              Investigate Outages &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* Primary KPI Grid */}
      <div className="stats-grid" style={{ marginBottom: 'var(--space-6)' }}>
        {/* Total Monitors */}
        <StatCard
          label="Total Monitors"
          value={isLoading ? null : healthStats.total}
          icon={Server}
          variant="default"
          subtext={
            isLoading
              ? 'Loading fleet…'
              : healthStats.total > 0
              ? `${healthStats.total - healthStats.paused} active • ${healthStats.paused} paused`
              : 'No monitors configured'
          }
          loading={isLoading}
        />

        {/* Healthy Monitors (UP) */}
        <StatCard
          label="Healthy (UP)"
          value={isLoading ? null : healthStats.up}
          icon={CheckCircle2}
          variant="up"
          subtext={
            healthStats.total > 0
              ? `${Math.round(healthStats.upPct)}% of configured endpoints`
              : 'Awaiting endpoints'
          }
          loading={isLoading}
        />

        {/* Unhealthy Monitors (DOWN) */}
        <StatCard
          label="Unhealthy (DOWN)"
          value={isLoading ? null : healthStats.down}
          icon={XCircle}
          variant={healthStats.down > 0 ? 'down' : 'default'}
          subtext={
            healthStats.down > 0
              ? `${healthStats.down} active outage${healthStats.down > 1 ? 's' : ''}`
              : 'No active outages'
          }
          loading={isLoading}
        />

        {/* Overall Uptime */}
        <StatCard
          label={`Uptime (${period})`}
          value={isLoading ? null : totalChecks > 0 && uptimeVal != null ? `${Number(uptimeVal).toFixed(2)}%` : '—'}
          icon={ShieldCheck}
          variant={totalChecks > 0 && uptimeVal != null ? (uptimeVal >= 99 ? 'up' : uptimeVal >= 95 ? 'warning' : 'down') : 'default'}
          subtext={
            totalChecks > 0
              ? `${successfulChecks.toLocaleString()} passed • ${failedChecks.toLocaleString()} failed`
              : 'No checks in window'
          }
          loading={isLoading}
        />

        {/* Response Time */}
        <StatCard
          label={`Avg Response (${period})`}
          value={isLoading ? null : avgLatency != null ? `${Math.round(avgLatency)} ms` : '—'}
          icon={Clock}
          variant="default"
          subtext={
            p95Latency != null
              ? `P95: ${Math.round(p95Latency)}ms • P99: ${p99Latency != null ? Math.round(p99Latency) : '—'}ms`
              : 'No latency samples'
          }
          loading={isLoading}
        />
      </div>

      {/* Health Distribution Segmented Bar */}
      {healthStats.total > 0 && (
        <div className="health-distribution-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-primary)' }}>
              Fleet Status Distribution
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              {healthStats.up} / {healthStats.total} Operational
            </span>
          </div>

          <div className="health-distribution-bar">
            {healthStats.upPct > 0 && (
              <div
                className="health-segment health-segment-up"
                style={{ width: `${healthStats.upPct}%` }}
                title={`UP: ${healthStats.up} (${Math.round(healthStats.upPct)}%)`}
              />
            )}
            {healthStats.downPct > 0 && (
              <div
                className="health-segment health-segment-down"
                style={{ width: `${healthStats.downPct}%` }}
                title={`DOWN: ${healthStats.down} (${Math.round(healthStats.downPct)}%)`}
              />
            )}
            {healthStats.unknownPct > 0 && (
              <div
                className="health-segment health-segment-unknown"
                style={{ width: `${healthStats.unknownPct}%` }}
                title={`UNKNOWN: ${healthStats.unknown} (${Math.round(healthStats.unknownPct)}%)`}
              />
            )}
          </div>

          <div className="health-legend">
            <div className="health-legend-item">
              <span className="health-legend-dot" style={{ background: 'var(--color-up)' }} />
              <span>UP ({healthStats.up})</span>
            </div>
            <div className="health-legend-item">
              <span className="health-legend-dot" style={{ background: 'var(--color-down)' }} />
              <span>DOWN ({healthStats.down})</span>
            </div>
            <div className="health-legend-item">
              <span className="health-legend-dot" style={{ background: '#f59e0b' }} />
              <span>UNKNOWN ({healthStats.unknown})</span>
            </div>
            {healthStats.paused > 0 && (
              <div className="health-legend-item" style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }}>
                <span>{healthStats.paused} Paused</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Two-Column Split */}
      <div className="dashboard-grid-cols">
        {/* Left Column: Monitored Endpoints & Recent Incidents */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Monitored Endpoints Overview Card */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              className="card-header"
              style={{
                padding: 'var(--space-4) var(--space-6)',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <h2 className="card-title" style={{ fontSize: 'var(--text-base)' }}>
                  Monitored Endpoints
                </h2>
                <p className="card-subtitle">Real-time status and telemetry per target</p>
              </div>

              <Link
                to="/monitors"
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-brand-hover)',
                  fontWeight: 'var(--weight-medium)',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span>View all ({healthStats.total})</span>
                <ArrowRight size={13} />
              </Link>
            </div>

            <div className="monitors-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
              <table className="monitors-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Target Endpoint</th>
                    <th>Method</th>
                    <th>Latency</th>
                    <th>Last Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRowSkeleton key={i} cols={5} />
                    ))
                  ) : monitors.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 'var(--space-6)' }}>
                        <EmptyState
                          icon={Server}
                          title="No monitors configured yet"
                          description="Add your first target to start tracking real-time status and outage alerts."
                          actionText="Configure Monitor"
                          onAction={() => navigate('/monitors')}
                        />
                      </td>
                    </tr>
                  ) : (
                    monitors.slice(0, 6).map((m) => {
                      const methodLower = (m.method || 'get').toLowerCase();
                      return (
                        <tr key={m.id}>
                          <td style={{ width: 130 }}>
                            <StatusBadge status={m.status} showDot size="sm" />
                          </td>
                          <td>
                            <div className="monitor-target-cell">
                              <Link to={`/monitors/${m.id}`} className="monitor-name-link">
                                {m.name}
                              </Link>
                              <a
                                href={m.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="monitor-url-text"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <span>{m.url}</span>
                                <ExternalLink size={11} style={{ opacity: 0.6 }} />
                              </a>
                            </div>
                          </td>
                          <td>
                            <span className={`badge-method badge-method-${methodLower}`}>
                              {m.method || 'GET'}
                            </span>
                          </td>
                          <td>
                            {m.lastResponseTimeMs != null ? (
                              <span
                                style={{
                                  fontSize: 'var(--text-xs)',
                                  fontFamily: 'var(--font-mono)',
                                  color:
                                    m.lastResponseTimeMs < 300
                                      ? 'var(--color-up)'
                                      : m.lastResponseTimeMs < 1000
                                      ? '#f59e0b'
                                      : 'var(--color-down)',
                                }}
                              >
                                {m.lastResponseTimeMs} ms
                              </span>
                            ) : (
                              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                —
                              </span>
                            )}
                          </td>
                          <td>
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                              {formatRelativeTime(m.lastCheckedAt)}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Incidents Card */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div
              className="card-header"
              style={{
                padding: 'var(--space-4) var(--space-6)',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <h2 className="card-title" style={{ fontSize: 'var(--text-base)' }}>
                  Recent Incidents
                </h2>
                <p className="card-subtitle">Automated outage tracking and resolution history</p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                {incidents.length > 0 && (
                  <span className="tag" style={{ color: incidents.some((i) => i.status === 'OPEN') ? 'var(--color-down)' : 'inherit' }}>
                    {incidents.filter((i) => i.status === 'OPEN').length} Active
                  </span>
                )}
                <Link
                  to="/incidents"
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-brand-hover)',
                    fontWeight: 'var(--weight-medium)',
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span>View all</span>
                  <ArrowRight size={13} />
                </Link>
              </div>
            </div>

            <div style={{ padding: 'var(--space-4) var(--space-6)' }}>
              {isLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div style={{ height: 48, background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-md)' }} />
                  <div style={{ height: 48, background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-md)' }} />
                </div>
              ) : incidents.length === 0 ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-4)',
                    background: 'rgba(16, 185, 129, 0.05)',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    borderRadius: 'var(--radius-lg)',
                  }}
                >
                  <CheckCircle2 size={20} style={{ color: 'var(--color-up)', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                      All Systems Operational
                    </div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                      No recent outages or degraded services detected on your monitors.
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {incidents.map((inc) => {
                    const isOpen = inc.status === 'OPEN';
                    return (
                      <div
                        key={inc.id}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          padding: 'var(--space-3) var(--space-4)',
                          background: isOpen ? 'rgba(239, 68, 68, 0.06)' : 'var(--color-bg-primary)',
                          border: `1px solid ${isOpen ? 'rgba(239, 68, 68, 0.3)' : 'var(--color-border-subtle)'}`,
                          borderRadius: 'var(--radius-lg)',
                          gap: 'var(--space-3)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                          <div style={{ marginTop: 2 }}>
                            {isOpen ? (
                              <AlertTriangle size={16} style={{ color: 'var(--color-down)' }} />
                            ) : (
                              <CheckCircle2 size={16} style={{ color: 'var(--color-up)' }} />
                            )}
                          </div>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                              <span style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-xs)', color: 'var(--color-text-primary)' }}>
                                {inc.monitor?.name || 'Target Endpoint'}
                              </span>
                              <span className={isOpen ? 'incident-badge-open' : 'incident-badge-resolved'}>
                                {isOpen ? 'OUTAGE' : 'RESOLVED'}
                              </span>
                              {inc.statusCode && (
                                <span className="tag" style={{ fontSize: '0.625rem', padding: '1px 5px', color: 'var(--color-down)' }}>
                                  HTTP {inc.statusCode}
                                </span>
                              )}
                              {inc.errorCode && !inc.statusCode && (
                                <span className="tag" style={{ fontSize: '0.625rem', padding: '1px 5px', color: 'var(--color-down)' }}>
                                  {inc.errorCode}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                              {inc.cause || inc.failureReason || 'Health probe timed out or returned unexpected code.'}
                            </div>
                          </div>
                        </div>

                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                            {isOpen ? 'Ongoing' : formatDuration(inc.durationSeconds)}
                          </div>
                          <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                            {formatRelativeTime(inc.startedAt)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Latency Distribution & Live Activity Feed */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Latency Percentiles Card */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <div>
                <h3 className="card-title" style={{ fontSize: 'var(--text-sm)' }}>
                  Response Time Telemetry
                </h3>
                <p className="card-subtitle" style={{ fontSize: 'var(--text-xs)' }}>
                  Latency benchmarks for {period} window
                </p>
              </div>
              <Zap size={16} style={{ color: 'var(--color-brand-hover)' }} />
            </div>

            <div className="percentile-group">
              <div className="percentile-card">
                <div className="percentile-label">Average</div>
                <div className="percentile-value">
                  {avgLatency != null ? `${Math.round(avgLatency)}ms` : '—'}
                </div>
              </div>

              <div className="percentile-card">
                <div className="percentile-label">P95 (95th)</div>
                <div className="percentile-value" style={{ color: '#60a5fa' }}>
                  {p95Latency != null ? `${Math.round(p95Latency)}ms` : '—'}
                </div>
              </div>

              <div className="percentile-card">
                <div className="percentile-label">P99 (99th)</div>
                <div className="percentile-value" style={{ color: '#c084fc' }}>
                  {p99Latency != null ? `${Math.round(p99Latency)}ms` : '—'}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 'var(--space-4)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border-subtle)',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>Total Probes Recorded:</span>
              <strong style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                {totalChecks.toLocaleString()}
              </strong>
            </div>
          </div>

          {/* Recent Activity Stream Feed */}
          <div className="card">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 'var(--space-4)',
              }}
            >
              <div>
                <h3 className="card-title" style={{ fontSize: 'var(--text-sm)' }}>
                  Recent Activity Stream
                </h3>
                <p className="card-subtitle" style={{ fontSize: 'var(--text-xs)' }}>
                  Live probe outcomes across active targets
                </p>
              </div>
              <Activity size={16} style={{ color: 'var(--color-brand)' }} />
            </div>

            {isLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ height: 36, background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-md)' }} />
                <div style={{ height: 36, background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-md)' }} />
                <div style={{ height: 36, background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-md)' }} />
              </div>
            ) : recentChecks.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: 'var(--space-6) var(--space-4)',
                  color: 'var(--color-text-muted)',
                  fontSize: 'var(--text-xs)',
                }}
              >
                <Clock size={24} style={{ margin: '0 auto var(--space-2) auto', opacity: 0.5 }} />
                <span>No automated checks recorded yet.</span>
                <div style={{ marginTop: 'var(--space-1)', color: 'var(--color-text-secondary)' }}>
                  Checks are queued by the background scheduler based on your configured intervals.
                </div>
              </div>
            ) : (
              <div className="activity-stream">
                {recentChecks.map((check) => {
                  const isSuccess = check.success;
                  return (
                    <div key={check.id} className="activity-item">
                      <div className="activity-left">
                        <span
                          className={`activity-status-dot ${isSuccess ? 'success' : 'failure'}`}
                          title={isSuccess ? 'Check Passed' : 'Check Failed'}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div className="activity-monitor-name" title={check.monitorName}>
                            {check.monitorName}
                          </div>
                          <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                            {formatRelativeTime(check.checkedAt)}
                          </div>
                        </div>
                      </div>

                      <div className="activity-right">
                        {check.statusCode != null && (
                          <span
                            className="tag"
                            style={{
                              color: isSuccess ? 'var(--color-up)' : 'var(--color-down)',
                              borderColor: isSuccess ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                            }}
                          >
                            HTTP {check.statusCode}
                          </span>
                        )}
                        {check.responseTimeMs != null && (
                          <span
                            style={{
                              fontSize: 'var(--text-xs)',
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--color-text-secondary)',
                            }}
                          >
                            {check.responseTimeMs}ms
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
