import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  History,
  Pencil,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import api from '../lib/api';
import StatusBadge from '../components/ui/StatusBadge';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';
import ErrorBanner from '../components/ui/ErrorBanner';
import ToggleSwitch from '../components/ui/ToggleSwitch';
import ConfirmModal from '../components/ui/ConfirmModal';
import MonitorModal from '../components/monitors/MonitorModal';
import { TableRowSkeleton } from '../components/ui/LoadingSkeleton';
import { useToast } from '../hooks/useToast';

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

function formatChartTime(dateString) {
  const d = new Date(dateString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Custom Recharts Tooltip
function CustomLatencyTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="chart-custom-tooltip">
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {new Date(data.time).toLocaleString()}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: data.success ? 'var(--color-up)' : 'var(--color-down)' }}>●</span>
          <span>Response: <strong>{data.latency} ms</strong></span>
        </div>
        {data.statusCode && (
          <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
            Status: HTTP {data.statusCode}
          </div>
        )}
      </div>
    );
  }
  return null;
}

export default function MonitorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Selected time period for telemetry
  const [period, setPeriod] = useState('24h');

  // Sub-navigation tab: 'checks' | 'incidents' | 'notifications'
  const [activeTab, setActiveTab] = useState('checks');

  // Check history filter: 'ALL' | 'SUCCESS' | 'FAILURE'
  const [checkOutcomeFilter, setCheckOutcomeFilter] = useState('ALL');

  // Data states
  const [monitor, setMonitor] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [checks, setChecks] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [notifications, setNotifications] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [notFound, setNotFound] = useState(false);

  // Copy feedback
  const [copied, setCopied] = useState(false);

  // Modals state
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isToggling, setIsToggling] = useState(false);
  const [retryingIds, setRetryingIds] = useState(new Set());

  // Fetch all monitor detail data
  const loadMonitorData = useCallback(async (isBackground = false) => {
    if (isBackground) {
      setIsRefreshing(true);
    }
    setErrorMessage('');

    try {
      const [monRes, analyticsRes, checksRes, incRes, notifRes] = await Promise.allSettled([
        api.get(`/api/v1/monitors/${id}`),
        api.get(`/api/v1/monitors/${id}/analytics`, { params: { period } }),
        api.get(`/api/v1/monitors/${id}/checks`, { params: { limit: 100, order: 'desc' } }),
        api.get(`/api/v1/monitors/${id}/incidents`, { params: { limit: 20, order: 'desc' } }),
        api.get(`/api/v1/monitors/${id}/notifications`, { params: { limit: 50, order: 'desc' } }),
      ]);

      if (monRes.status === 'rejected') {
        if (monRes.reason?.response?.status === 404) {
          setNotFound(true);
          return;
        }
        throw monRes.reason;
      }

      setMonitor(monRes.value.data?.data || null);

      if (analyticsRes.status === 'fulfilled') {
        setAnalytics(analyticsRes.value.data?.data || null);
      }

      if (checksRes.status === 'fulfilled') {
        setChecks(checksRes.value.data?.data || []);
      }

      if (incRes.status === 'fulfilled') {
        setIncidents(incRes.value.data?.data || []);
      }

      if (notifRes.status === 'fulfilled') {
        setNotifications(notifRes.value.data?.data || []);
      }
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to retrieve monitor details from server.';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [id, period]);

  // Initial load effect
  useEffect(() => {
    let active = true;

    async function run() {
      try {
        const [monRes, analyticsRes, checksRes, incRes, notifRes] = await Promise.allSettled([
          api.get(`/api/v1/monitors/${id}`),
          api.get(`/api/v1/monitors/${id}/analytics`, { params: { period } }),
          api.get(`/api/v1/monitors/${id}/checks`, { params: { limit: 100, order: 'desc' } }),
          api.get(`/api/v1/monitors/${id}/incidents`, { params: { limit: 20, order: 'desc' } }),
          api.get(`/api/v1/monitors/${id}/notifications`, { params: { limit: 50, order: 'desc' } }),
        ]);

        if (!active) return;

        if (monRes.status === 'rejected') {
          if (monRes.reason?.response?.status === 404) {
            setNotFound(true);
            return;
          }
          throw monRes.reason;
        }

        setMonitor(monRes.value.data?.data || null);

        if (analyticsRes.status === 'fulfilled') {
          setAnalytics(analyticsRes.value.data?.data || null);
        }

        if (checksRes.status === 'fulfilled') {
          setChecks(checksRes.value.data?.data || []);
        }

        if (incRes.status === 'fulfilled') {
          setIncidents(incRes.value.data?.data || []);
        }

        if (notifRes.status === 'fulfilled') {
          setNotifications(notifRes.value.data?.data || []);
        }
      } catch (err) {
        if (active) {
          setErrorMessage(
            err.response?.data?.error?.message ||
            err.message ||
            'Failed to retrieve monitor details from server.'
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
  }, [id, period]);

  // Handle URL copy
  const handleCopyUrl = () => {
    if (!monitor?.url) return;
    navigator.clipboard.writeText(monitor.url);
    setCopied(true);
    toast.success('Target URL copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  // Handle Enable / Disable Toggle
  const handleToggle = async (newEnabled) => {
    if (!monitor || isToggling) return;
    setIsToggling(true);

    const prevMonitor = { ...monitor };
    setMonitor((prev) => ({ ...prev, enabled: newEnabled }));

    try {
      const response = await api.patch(`/api/v1/monitors/${monitor.id}`, {
        enabled: newEnabled,
      });
      const updated = response.data?.data;
      if (updated) {
        setMonitor(updated);
        toast.success(`Monitor ${newEnabled ? 'enabled' : 'disabled'}`);
      }
    } catch (err) {
      setMonitor(prevMonitor);
      setErrorMessage(
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to update monitor status.'
      );
    } finally {
      setIsToggling(false);
    }
  };

  // Handle Delete
  const handleDelete = async () => {
    if (!monitor) return;
    setIsDeleting(true);

    try {
      await api.delete(`/api/v1/monitors/${monitor.id}`);
      toast.success(`Deleted monitor "${monitor.name}"`);
      navigate('/monitors', { replace: true });
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to delete monitor.'
      );
      setIsDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  // Retry notification handler
  const handleRetryNotification = async (notifId) => {
    if (retryingIds.has(notifId)) return;

    setRetryingIds((prev) => new Set(prev).add(notifId));
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const response = await api.post(`/api/v1/notifications/${notifId}/retry`);
      const updated = response.data?.data;
      if (updated) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notifId ? updated : n))
        );
      }
      toast.success('Notification retry dispatched');
      setSuccessMessage('Notification delivery re-attempt dispatched.');
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to retry notification delivery.'
      );
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(notifId);
        return next;
      });
    }
  };

  // Chart data computation (chronological ascending)
  const chartData = useMemo(() => {
    return [...checks]
      .filter((c) => c.responseTimeMs != null)
      .reverse()
      .map((c) => ({
        time: c.checkedAt,
        formattedTime: formatChartTime(c.checkedAt),
        latency: c.responseTimeMs,
        success: c.success,
        statusCode: c.statusCode,
      }));
  }, [checks]);

  // Filtered checks list
  const filteredChecks = useMemo(() => {
    return checks.filter((c) => {
      if (checkOutcomeFilter === 'SUCCESS') return c.success;
      if (checkOutcomeFilter === 'FAILURE') return !c.success;
      return true;
    });
  }, [checks, checkOutcomeFilter]);

  // Availability strip ticks (last 40 checks)
  const stripTicks = useMemo(() => {
    return [...checks].slice(0, 40).reverse();
  }, [checks]);

  if (notFound) {
    return (
      <div>
        <div className="breadcrumb-nav">
          <Link to="/monitors" className="breadcrumb-link">
            <ArrowLeft size={14} />
            <span>Back to Monitors</span>
          </Link>
        </div>
        <div className="card">
          <EmptyState
            icon={XCircle}
            title="Monitor Not Found"
            description="The requested endpoint monitor does not exist or you do not have permission to view it."
            actionText="View All Monitors"
            onAction={() => navigate('/monitors')}
          />
        </div>
      </div>
    );
  }

  const summary = analytics?.summary;
  const uptimeVal = summary?.uptimePercentage ?? 100;
  const avgLatency = summary?.averageResponseTime;
  const p95Latency = summary?.p95ResponseTime;
  const p99Latency = summary?.p99ResponseTime;
  const totalChecks = summary?.totalChecks ?? 0;
  const successfulChecks = summary?.successfulChecks ?? 0;
  const failedChecks = summary?.failedChecks ?? 0;
  const downtimeSec = summary?.downtimeSeconds ?? 0;
  const incidentCount = summary?.incidentCount ?? 0;

  const methodLower = (monitor?.method || 'get').toLowerCase();

  return (
    <div>
      {/* Breadcrumb Navigation */}
      <div className="breadcrumb-nav">
        <Link to="/monitors" className="breadcrumb-link">
          <ArrowLeft size={14} />
          <span>Monitors</span>
        </Link>
        <span>/</span>
        <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
          {monitor?.name || 'Loading…'}
        </span>
      </div>

      {/* Error alert banner */}
      {errorMessage && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <ErrorBanner
            title="Monitoring Telemetry Error"
            message={errorMessage}
            onRetry={() => loadMonitorData(true)}
            retrying={isRefreshing}
          />
        </div>
      )}

      {/* Success banner */}
      {successMessage && (
        <div
          className="alert alert-success"
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            marginBottom: 'var(--space-6)',
            fontSize: 'var(--text-sm)',
            padding: 'var(--space-3) var(--space-4)',
          }}
        >
          <CheckCircle2 size={16} />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Monitor Hero Header Card */}
      <div className="monitor-hero-card">
        <div className="monitor-hero-header">
          <div>
            <div className="monitor-hero-title-group">
              <span className={`badge-method badge-method-${methodLower}`}>
                {monitor?.method || 'GET'}
              </span>
              <h1 className="monitor-hero-name">{monitor?.name || 'Endpoint Details'}</h1>
              {monitor && <StatusBadge status={monitor.status} showDot size="md" />}
            </div>

            {/* Target URL Pill */}
            {monitor?.url && (
              <div className="monitor-url-pill">
                <a href={monitor.url} target="_blank" rel="noopener noreferrer">
                  {monitor.url}
                </a>
                <a
                  href={monitor.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center' }}
                  title="Open target URL in new window"
                >
                  <ExternalLink size={12} />
                </a>
                <button
                  type="button"
                  onClick={handleCopyUrl}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: copied ? 'var(--color-up)' : 'var(--color-text-muted)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: 0,
                  }}
                  title="Copy URL to clipboard"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            )}

            {/* Meta Configuration Chips */}
            {monitor && (
              <div className="monitor-meta-chips">
                <div className="meta-chip">
                  <Clock size={12} />
                  <span>Polling: Every {monitor.intervalSeconds}s</span>
                </div>

                <div className="meta-chip">
                  <Zap size={12} />
                  <span>Timeout: {monitor.timeoutSeconds}s</span>
                </div>

                <div className="meta-chip">
                  <span>Expected Codes:</span>
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>
                    {Array.isArray(monitor.expectedCodes) ? monitor.expectedCodes.join(', ') : '200'}
                  </strong>
                </div>

                {monitor.consecutiveSuccesses > 0 && (
                  <div className="meta-chip" style={{ color: 'var(--color-up)' }}>
                    <CheckCircle2 size={12} />
                    <span>{monitor.consecutiveSuccesses} consecutive successes</span>
                  </div>
                )}

                {monitor.consecutiveFailures > 0 && (
                  <div className="meta-chip" style={{ color: 'var(--color-down)' }}>
                    <AlertTriangle size={12} />
                    <span>{monitor.consecutiveFailures} consecutive failures</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
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

            {/* Active toggle */}
            {monitor && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  fontSize: 'var(--text-xs)',
                  background: 'var(--color-bg-elevated)',
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <span>{monitor.enabled ? 'Enabled' : 'Paused'}</span>
                <ToggleSwitch
                  checked={monitor.enabled}
                  onChange={handleToggle}
                  disabled={isToggling}
                  ariaLabel="Toggle monitor status"
                />
              </div>
            )}

            {/* Refresh */}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => loadMonitorData(true)}
              disabled={isLoading || isRefreshing}
              title="Refresh telemetry"
            >
              <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            </button>

            {/* Edit */}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEditModalOpen(true)}
              disabled={isLoading}
              title="Edit configuration"
            >
              <Pencil size={14} />
              <span>Edit</span>
            </button>

            {/* Delete */}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ color: 'var(--color-down)' }}
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={isLoading}
              title="Delete monitor"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="stats-grid" style={{ marginBottom: 'var(--space-6)' }}>
        {/* Overall Uptime */}
        <StatCard
          label={`Availability (${period})`}
          value={isLoading ? null : `${Number(uptimeVal).toFixed(2)}%`}
          icon={ShieldCheck}
          variant={uptimeVal >= 99 ? 'up' : uptimeVal >= 95 ? 'warning' : 'down'}
          subtext={
            totalChecks > 0
              ? `${successfulChecks.toLocaleString()} passed • ${failedChecks.toLocaleString()} failed`
              : 'No checks recorded'
          }
          loading={isLoading}
        />

        {/* Avg Response Time */}
        <StatCard
          label={`Avg Latency (${period})`}
          value={isLoading ? null : avgLatency != null ? `${Math.round(avgLatency)} ms` : '—'}
          icon={Zap}
          variant="default"
          subtext={
            p95Latency != null
              ? `P95: ${Math.round(p95Latency)}ms • P99: ${p99Latency != null ? Math.round(p99Latency) : '—'}ms`
              : 'No latency samples'
          }
          loading={isLoading}
        />

        {/* Total Downtime */}
        <StatCard
          label={`Downtime (${period})`}
          value={isLoading ? null : formatDuration(downtimeSec)}
          icon={ShieldAlert}
          variant={downtimeSec > 0 ? 'down' : 'default'}
          subtext={
            incidentCount > 0
              ? `${incidentCount} outage event${incidentCount > 1 ? 's' : ''}`
              : 'Zero recorded outages'
          }
          loading={isLoading}
        />

        {/* Last Probe Latency */}
        <StatCard
          label="Last Probe Latency"
          value={isLoading ? null : monitor?.lastResponseTimeMs != null ? `${monitor.lastResponseTimeMs} ms` : '—'}
          icon={Clock}
          variant="default"
          subtext={monitor?.lastCheckedAt ? `Checked ${formatRelativeTime(monitor.lastCheckedAt)}` : 'Awaiting check'}
          loading={isLoading}
        />
      </div>

      {/* Availability Status Strip Card */}
      <div className="status-bar-strip-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-primary)' }}>
              Recent Check Outcomes
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginLeft: 'var(--space-2)' }}>
              (Last {stripTicks.length} probes)
            </span>
          </div>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {checks.length > 0 && formatRelativeTime(checks[0].checkedAt)}
          </span>
        </div>

        {stripTicks.length === 0 ? (
          <div style={{ padding: 'var(--space-3) 0', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
            No probes executed yet. Once background checks run, real-time availability ticks will appear here.
          </div>
        ) : (
          <div className="status-bar-strip">
            {stripTicks.map((c) => (
              <div
                key={c.id}
                className={`status-bar-tick ${c.success ? 'success' : 'failure'}`}
                title={`${new Date(c.checkedAt).toLocaleTimeString()} - ${c.success ? 'SUCCESS' : 'FAILED'} (HTTP ${c.statusCode || 'N/A'}, ${c.responseTimeMs ?? 0}ms)`}
              />
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
          <span>Chronological →</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-up)' }} /> Success
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-down)' }} /> Failed
            </span>
          </div>
        </div>
      </div>

      {/* Response Time Chart Card (Recharts) */}
      <div className="chart-container-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <div>
            <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-primary)' }}>
              Response Time Latency Trend
            </h3>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Historical probe duration over the selected {period} window
            </p>
          </div>

          {avgLatency != null && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
              Mean: <strong style={{ color: 'var(--color-brand-hover)' }}>{Math.round(avgLatency)} ms</strong>
            </div>
          )}
        </div>

        {chartData.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-8) var(--space-4)', color: 'var(--color-text-muted)' }}>
            <Activity size={28} style={{ margin: '0 auto var(--space-2) auto', opacity: 0.4 }} />
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              No latency points recorded yet in this time window
            </div>
            <div style={{ fontSize: 'var(--text-xs)', marginTop: 4 }}>
              Probes are dispatched automatically by the background worker at your configured interval.
            </div>
          </div>
        ) : (
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                <XAxis
                  dataKey="formattedTime"
                  stroke="var(--color-text-muted)"
                  fontSize={11}
                  tickLine={false}
                />
                <YAxis
                  stroke="var(--color-text-muted)"
                  fontSize={11}
                  tickLine={false}
                  unit="ms"
                />
                <Tooltip content={<CustomLatencyTooltip />} />
                <Area
                  type="monotone"
                  dataKey="latency"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#latencyGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="tab-nav">
        <button
          type="button"
          className={`tab-nav-btn ${activeTab === 'checks' ? 'active' : ''}`}
          onClick={() => setActiveTab('checks')}
        >
          <History size={16} />
          <span>Monitoring History ({checks.length})</span>
        </button>

        <button
          type="button"
          className={`tab-nav-btn ${activeTab === 'incidents' ? 'active' : ''}`}
          onClick={() => setActiveTab('incidents')}
        >
          <ShieldAlert size={16} />
          <span>Incident Log ({incidents.length})</span>
        </button>

        <button
          type="button"
          className={`tab-nav-btn ${activeTab === 'notifications' ? 'active' : ''}`}
          onClick={() => setActiveTab('notifications')}
        >
          <Bell size={16} />
          <span>Alert History ({notifications.length})</span>
        </button>
      </div>

      {/* Tab 1: Monitoring History */}
      {activeTab === 'checks' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: 'var(--space-3) var(--space-6)',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
            }}
          >
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              Showing {filteredChecks.length} of {checks.length} recorded checks
            </span>

            {/* Outcome Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <button
                type="button"
                className={`preset-pill ${checkOutcomeFilter === 'ALL' ? 'active' : ''}`}
                onClick={() => setCheckOutcomeFilter('ALL')}
              >
                All Checks
              </button>
              <button
                type="button"
                className={`preset-pill ${checkOutcomeFilter === 'SUCCESS' ? 'active' : ''}`}
                onClick={() => setCheckOutcomeFilter('SUCCESS')}
              >
                Success
              </button>
              <button
                type="button"
                className={`preset-pill ${checkOutcomeFilter === 'FAILURE' ? 'active' : ''}`}
                onClick={() => setCheckOutcomeFilter('FAILURE')}
              >
                Failed
              </button>
            </div>
          </div>

          <div className="monitors-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table className="monitors-table">
              <thead>
                <tr>
                  <th>Outcome</th>
                  <th>HTTP Status</th>
                  <th>Latency</th>
                  <th>Failure Details</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRowSkeleton key={i} cols={5} />
                  ))
                ) : filteredChecks.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 'var(--space-6)' }}>
                      <EmptyState
                        icon={Clock}
                        title="No checks match filter"
                        description="No check records found for the selected outcome criteria."
                        actionText="Show All Checks"
                        onAction={() => setCheckOutcomeFilter('ALL')}
                      />
                    </td>
                  </tr>
                ) : (
                  filteredChecks.map((check) => (
                    <tr key={check.id}>
                      <td style={{ width: 120 }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 'var(--text-xs)',
                            fontWeight: 600,
                            color: check.success ? 'var(--color-up)' : 'var(--color-down)',
                          }}
                        >
                          {check.success ? (
                            <CheckCircle2 size={16} />
                          ) : (
                            <XCircle size={16} />
                          )}
                          <span>{check.success ? 'SUCCESS' : 'FAILED'}</span>
                        </span>
                      </td>

                      <td>
                        {check.statusCode != null ? (
                          <span
                            className="tag"
                            style={{
                              color: check.success ? 'var(--color-up)' : 'var(--color-down)',
                              borderColor: check.success
                                ? 'rgba(16, 185, 129, 0.3)'
                                : 'rgba(239, 68, 68, 0.3)',
                            }}
                          >
                            HTTP {check.statusCode}
                          </span>
                        ) : (
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                            No response
                          </span>
                        )}
                      </td>

                      <td>
                        {check.responseTimeMs != null ? (
                          <span
                            style={{
                              fontSize: 'var(--text-xs)',
                              fontFamily: 'var(--font-mono)',
                              color:
                                check.responseTimeMs < 300
                                  ? 'var(--color-up)'
                                  : check.responseTimeMs < 1000
                                  ? '#f59e0b'
                                  : 'var(--color-down)',
                            }}
                          >
                            {check.responseTimeMs} ms
                          </span>
                        ) : (
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                            —
                          </span>
                        )}
                      </td>

                      <td>
                        {!check.success && (check.errorCode || check.errorMessage) ? (
                          <span className="error-code-pill" title={check.errorMessage || check.errorCode}>
                            {check.errorCode || 'ERROR'}: {check.errorMessage || 'Unknown error'}
                          </span>
                        ) : (
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                            None
                          </span>
                        )}
                      </td>

                      <td>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                          {new Date(check.checkedAt).toLocaleTimeString()} ({formatRelativeTime(check.checkedAt)})
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Incident History */}
      {activeTab === 'incidents' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="monitors-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table className="monitors-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Outage Started</th>
                  <th>Recovery Time</th>
                  <th>Duration</th>
                  <th>Failure Reason &amp; Code</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRowSkeleton key={i} cols={5} />
                  ))
                ) : incidents.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 'var(--space-6)' }}>
                      <EmptyState
                        icon={CheckCircle2}
                        title="No incidents recorded"
                        description="This monitor has experienced no detected downtime or outage incidents."
                      />
                    </td>
                  </tr>
                ) : (
                  incidents.map((inc) => {
                    const isOpen = inc.status === 'OPEN';
                    return (
                      <tr key={inc.id}>
                        <td style={{ width: 130 }}>
                          <span className={isOpen ? 'incident-badge-open' : 'incident-badge-resolved'}>
                            {isOpen ? 'ONGOING OUTAGE' : 'RESOLVED'}
                          </span>
                        </td>

                        <td>
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                            {new Date(inc.startedAt).toLocaleString()}
                          </span>
                        </td>

                        <td>
                          <span style={{ fontSize: 'var(--text-xs)', color: isOpen ? 'var(--color-down)' : 'var(--color-text-secondary)' }}>
                            {inc.resolvedAt ? new Date(inc.resolvedAt).toLocaleString() : 'Pending Recovery'}
                          </span>
                        </td>

                        <td>
                          <span
                            style={{
                              fontSize: 'var(--text-xs)',
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 600,
                              color: isOpen ? 'var(--color-down)' : 'var(--color-text-primary)',
                            }}
                          >
                            {isOpen ? 'Active' : formatDuration(inc.durationSeconds)}
                          </span>
                        </td>

                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            {inc.statusCode != null && (
                              <span className="tag" style={{ color: 'var(--color-down)' }}>
                                HTTP {inc.statusCode}
                              </span>
                            )}
                            {inc.errorCode && (
                              <span className="error-code-pill">
                                {inc.errorCode}
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: 'var(--text-xs)',
                                color: isOpen ? 'var(--color-down)' : 'var(--color-text-secondary)',
                              }}
                            >
                              {inc.cause || inc.failureReason || 'Failed consecutive health checks'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Alert Notifications */}
      {activeTab === 'notifications' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="monitors-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table className="monitors-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Event</th>
                  <th>Recipient</th>
                  <th>Attempts</th>
                  <th>Sent At</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRowSkeleton key={i} cols={6} />
                  ))
                ) : notifications.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 'var(--space-6)' }}>
                      <EmptyState
                        icon={Bell}
                        title="No notifications dispatched"
                        description="Alert dispatches for outage and recovery events for this monitor will be logged here."
                      />
                    </td>
                  </tr>
                ) : (
                  notifications.map((notif) => {
                    const isDown = notif.event === 'MONITOR_DOWN';
                    const isDelivered = notif.status === 'DELIVERED';
                    const isFailed = notif.status === 'FAILED';
                    const isRetrying = retryingIds.has(notif.id);

                    return (
                      <tr key={notif.id}>
                        <td style={{ width: 120 }}>
                          <span
                            className={
                              isDelivered
                                ? 'notif-badge-delivered'
                                : isFailed
                                ? 'notif-badge-failed'
                                : 'notif-badge-pending'
                            }
                          >
                            {notif.status}
                          </span>
                        </td>

                        <td>
                          <span className={`event-badge ${isDown ? 'event-badge-down' : 'event-badge-recovered'}`}>
                            {isDown ? '▼ OUTAGE' : '▲ RECOVERED'}
                          </span>
                        </td>

                        <td>
                          <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                            {notif.recipient}
                          </span>
                        </td>

                        <td>
                          <span style={{ fontSize: 'var(--text-xs)' }}>
                            {notif.attempts} attempt{notif.attempts !== 1 ? 's' : ''}
                          </span>
                        </td>

                        <td>
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                            {formatRelativeTime(notif.sentAt || notif.createdAt)}
                          </span>
                        </td>

                        <td style={{ textAlign: 'right' }}>
                          {isFailed && (
                            <button
                              type="button"
                              className="retry-btn"
                              onClick={() => handleRetryNotification(notif.id)}
                              disabled={isRetrying}
                              title="Retry alert delivery"
                            >
                              <RotateCw size={12} className={isRetrying ? 'spin' : ''} />
                              <span>{isRetrying ? 'Retrying…' : 'Retry'}</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Monitor Modal */}
      {editModalOpen && monitor && (
        <MonitorModal
          key={monitor.id}
          isOpen={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          initialMonitor={monitor}
          onSuccess={(saved) => {
            setMonitor(saved);
            loadMonitorData(true);
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          if (!isDeleting) setDeleteConfirmOpen(false);
        }}
        onConfirm={handleDelete}
        title="Delete Monitor"
        message={`Are you sure you want to permanently delete "${monitor?.name}"? All associated health check history and incident logs will be wiped permanently.`}
        confirmText="Delete Monitor"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
