import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock,
  ExternalLink,
  Layers,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import api from '../lib/api';
import StatusBadge from '../components/ui/StatusBadge';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';
import ErrorBanner from '../components/ui/ErrorBanner';
import ToggleSwitch from '../components/ui/ToggleSwitch';
import { TableRowSkeleton } from '../components/ui/LoadingSkeleton';

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m < 60) return `${m}m ${s > 0 ? `${s}s` : ''}`.trim();
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return `${h}h ${remM > 0 ? `${remM}m` : ''}`.trim();
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return `${d}d ${remH > 0 ? `${remH}h` : ''}`.trim();
}

function CustomLatencyTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-custom-tooltip">
      <div style={{ fontWeight: 'var(--weight-semibold)', marginBottom: 4, color: 'var(--color-text-primary)' }}>
        {label}
      </div>
      {payload.map((entry, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color }} />
          <span style={{ color: 'var(--color-text-secondary)' }}>{entry.name}:</span>
          <strong style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
            {entry.value != null ? `${Math.round(entry.value)} ms` : '—'}
          </strong>
        </div>
      ))}
    </div>
  );
}

function CustomChecksTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="chart-custom-tooltip">
      <div style={{ fontWeight: 'var(--weight-semibold)', marginBottom: 4, color: 'var(--color-text-primary)' }}>
        {label}
      </div>
      {payload.map((entry, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-xs)', marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color }} />
          <span style={{ color: 'var(--color-text-secondary)' }}>{entry.name}:</span>
          <strong style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
            {entry.value?.toLocaleString()} checks
          </strong>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  // Period filter: '24h' | '7d' | '30d'
  const [period, setPeriod] = useState('24h');

  // Monitor Scope filter: 'all' or monitorId
  const [selectedScope, setSelectedScope] = useState('all');

  // Monitors list for dropdown & enrichment
  const [monitors, setMonitors] = useState([]);

  // Telemetry data
  const [fleetAnalytics, setFleetAnalytics] = useState(null);
  const [singleAnalytics, setSingleAnalytics] = useState(null);
  const [singleChecks, setSingleChecks] = useState([]);

  // UI state
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  // Initial load & scope/period change effect
  useEffect(() => {
    let active = true;

    async function run() {
      try {
        const monRes = await api.get('/api/v1/monitors', { params: { limit: 100 } });
        if (!active) return;
        setMonitors(monRes.data?.data || []);

        const fleetRes = await api.get('/api/v1/analytics', { params: { period } });
        if (!active) return;
        setFleetAnalytics(fleetRes.data?.data || null);

        if (selectedScope !== 'all') {
          const [singleRes, checksRes] = await Promise.allSettled([
            api.get(`/api/v1/monitors/${selectedScope}/analytics`, { params: { period } }),
            api.get(`/api/v1/monitors/${selectedScope}/checks`, { params: { limit: 100, order: 'desc' } }),
          ]);
          if (!active) return;

          if (singleRes.status === 'fulfilled') {
            setSingleAnalytics(singleRes.value.data?.data || null);
          } else {
            setSingleAnalytics(null);
          }

          if (checksRes.status === 'fulfilled') {
            setSingleChecks(checksRes.value.data?.data || []);
          } else {
            setSingleChecks([]);
          }
        } else {
          setSingleAnalytics(null);
          setSingleChecks([]);
        }
      } catch (err) {
        if (!active) return;
        setErrorMessage(
          err.response?.data?.error?.message ||
          err.message ||
          'Failed to synchronize analytics telemetry with backend.'
        );
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
  }, [period, selectedScope]);

  // Background refresh trigger
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setErrorMessage('');

    try {
      const monRes = await api.get('/api/v1/monitors', { params: { limit: 100 } });
      setMonitors(monRes.data?.data || []);

      const fleetRes = await api.get('/api/v1/analytics', { params: { period } });
      setFleetAnalytics(fleetRes.data?.data || null);

      if (selectedScope !== 'all') {
        const [singleRes, checksRes] = await Promise.allSettled([
          api.get(`/api/v1/monitors/${selectedScope}/analytics`, { params: { period } }),
          api.get(`/api/v1/monitors/${selectedScope}/checks`, { params: { limit: 100, order: 'desc' } }),
        ]);

        if (singleRes.status === 'fulfilled') {
          setSingleAnalytics(singleRes.value.data?.data || null);
        } else {
          setSingleAnalytics(null);
        }

        if (checksRes.status === 'fulfilled') {
          setSingleChecks(checksRes.value.data?.data || []);
        } else {
          setSingleChecks([]);
        }
      } else {
        setSingleAnalytics(null);
        setSingleChecks([]);
      }
    } catch (err) {
      setErrorMessage(
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to synchronize analytics telemetry with backend.'
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [period, selectedScope]);

  // 15-second auto refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      handleRefresh();
    }, 15_000);
    return () => clearInterval(interval);
  }, [autoRefresh, handleRefresh]);

  // Active Summary Data (fleet-wide or single monitor)
  const activeSummary = useMemo(() => {
    if (selectedScope !== 'all' && singleAnalytics?.summary) {
      return singleAnalytics.summary;
    }
    return fleetAnalytics?.summary || {
      uptimePercentage: null,
      downtimeSeconds: 0,
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      averageResponseTime: null,
      p95ResponseTime: null,
      p99ResponseTime: null,
      incidentCount: 0,
      incidentDurationSeconds: 0,
    };
  }, [selectedScope, singleAnalytics, fleetAnalytics]);

  // Selected monitor object if in single monitor mode
  const activeMonitorObj = useMemo(() => {
    if (selectedScope === 'all') return null;
    return monitors.find((m) => m.id === selectedScope);
  }, [selectedScope, monitors]);

  // Breakdown across monitors from fleet response
  const monitorBreakdown = useMemo(() => {
    return fleetAnalytics?.monitors || [];
  }, [fleetAnalytics]);

  // Bar Chart Data: Latency comparison across monitors (Fleet mode)
  const latencyChartData = useMemo(() => {
    if (selectedScope === 'all') {
      return monitorBreakdown
        .filter((m) => m.summary?.totalChecks > 0)
        .map((m) => ({
          name: m.name.length > 14 ? `${m.name.substring(0, 14)}…` : m.name,
          fullName: m.name,
          avg: m.summary?.averageResponseTime != null ? Math.round(m.summary.averageResponseTime) : 0,
          p95: m.summary?.p95ResponseTime != null ? Math.round(m.summary.p95ResponseTime) : 0,
          p99: m.summary?.p99ResponseTime != null ? Math.round(m.summary.p99ResponseTime) : 0,
        }))
        .slice(0, 8); // Top 8 for clean readability
    } else {
      // In single monitor mode, chronological time-series from check results
      return [...singleChecks]
        .reverse()
        .map((c) => ({
          time: new Date(c.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          latency: c.responseTimeMs ?? 0,
          success: c.success,
          statusCode: c.statusCode,
        }));
    }
  }, [selectedScope, monitorBreakdown, singleChecks]);

  // Reliability & Checks Chart Data
  const checksChartData = useMemo(() => {
    if (selectedScope === 'all') {
      return monitorBreakdown
        .filter((m) => m.summary?.totalChecks > 0)
        .map((m) => ({
          name: m.name.length > 14 ? `${m.name.substring(0, 14)}…` : m.name,
          fullName: m.name,
          passed: m.summary?.successfulChecks || 0,
          failed: m.summary?.failedChecks || 0,
          total: m.summary?.totalChecks || 0,
          uptime: m.summary?.uptimePercentage ?? null,
        }))
        .slice(0, 8);
    } else {
      // Single monitor check outcome aggregates
      const passed = activeSummary.successfulChecks || 0;
      const failed = activeSummary.failedChecks || 0;
      return [
        { name: 'Successful Probes', count: passed, fill: '#10b981' },
        { name: 'Failed Probes', count: failed, fill: '#ef4444' },
      ];
    }
  }, [selectedScope, monitorBreakdown, activeSummary]);

  // Pass rate calculation
  const totalChecks = activeSummary.totalChecks || 0;
  const passRate = totalChecks > 0 ? (activeSummary.successfulChecks / totalChecks) * 100 : null;
  const failRate = totalChecks > 0 ? (activeSummary.failedChecks / totalChecks) * 100 : null;

  return (
    <div>
      {/* Top Header Section */}
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <h1 className="page-title">Monitoring Analytics</h1>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                fontSize: 'var(--text-xs)',
                color: '#60a5fa',
                fontFamily: 'var(--font-mono)',
              }}
            >
              <Activity size={12} />
              <span>TELEMETRY</span>
            </span>
          </div>
          <p className="page-subtitle">
            Fleet availability, latency percentiles, reliability ratios, and outage telemetry
          </p>
        </div>

        {/* Action Controls */}
        <div className="analytics-header-controls">
          {/* Target Scope Filter Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Layers size={14} style={{ color: 'var(--color-text-muted)' }} />
            <select
              className="analytics-scope-select"
              value={selectedScope}
              onChange={(e) => {
                setSelectedScope(e.target.value);
                setIsLoading(true);
              }}
              disabled={isLoading}
              aria-label="Filter analytics by target monitor"
            >
              <option value="all">Fleet Overview (All Targets)</option>
              {monitors.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.url.replace(/^https?:\/\//, '')})
                </option>
              ))}
            </select>
          </div>

          {/* Period Selector (24h, 7d, 30d) */}
          <div className="period-btn-group">
            {['24h', '7d', '30d'].map((p) => (
              <button
                key={p}
                type="button"
                className={`period-btn ${period === p ? 'active' : ''}`}
                onClick={() => {
                  setPeriod(p);
                  setIsLoading(true);
                }}
                disabled={isLoading}
              >
                {p === '24h' ? '24 Hours' : p === '7d' ? '7 Days' : '30 Days'}
              </button>
            ))}
          </div>

          {/* Auto Refresh Toggle */}
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
              ariaLabel="Toggle automatic telemetry refresh"
            />
          </div>

          {/* Manual Refresh Button */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={isLoading || isRefreshing}
            title="Refresh analytics telemetry"
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            <span>{isRefreshing ? 'Updating…' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Scope Banner if single monitor is selected */}
      {selectedScope !== 'all' && activeMonitorObj && (
        <div
          style={{
            marginBottom: 'var(--space-6)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'rgba(59, 130, 246, 0.06)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <Server size={18} style={{ color: '#60a5fa' }} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                  Filtered: {activeMonitorObj.name}
                </span>
                <StatusBadge status={activeMonitorObj.status} size="sm" showDot />
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                {activeMonitorObj.url} • Method: {activeMonitorObj.method || 'GET'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <Link
              to={`/monitors/${activeMonitorObj.id}`}
              className="btn btn-secondary"
              style={{ fontSize: 'var(--text-xs)', padding: '4px 10px', textDecoration: 'none' }}
            >
              <span>Monitor Detail</span>
              <ArrowUpRight size={13} />
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 'var(--text-xs)', padding: '4px 8px' }}
              onClick={() => setSelectedScope('all')}
            >
              Reset to Fleet View
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <ErrorBanner
            title="Telemetry Analytics Error"
            message={errorMessage}
            onRetry={handleRefresh}
            retrying={isRefreshing}
          />
        </div>
      )}

      {/* Primary KPI Grid (6 Metric Cards: Uptime, Downtime, Avg Latency, P95/P99, Checks, Incidents) */}
      <div className="analytics-kpi-grid">
        {/* 1. Uptime Percentage */}
        <StatCard
          label={`Uptime (${period})`}
          value={isLoading ? null : activeSummary.totalChecks > 0 && activeSummary.uptimePercentage != null ? `${Number(activeSummary.uptimePercentage).toFixed(2)}%` : '—'}
          icon={ShieldCheck}
          variant={
            activeSummary.totalChecks > 0 && activeSummary.uptimePercentage != null
              ? activeSummary.uptimePercentage >= 99.5
                ? 'up'
                : activeSummary.uptimePercentage >= 95
                ? 'warning'
                : 'down'
              : 'default'
          }
          subtext={
            isLoading
              ? 'Computing…'
              : activeSummary.downtimeSeconds > 0
              ? `${formatDuration(activeSummary.downtimeSeconds)} downtime`
              : activeSummary.totalChecks > 0
              ? '100% operational window'
              : 'No data in window'
          }
          loading={isLoading}
        />

        {/* 2. Total Downtime */}
        <StatCard
          label={`Downtime (${period})`}
          value={isLoading ? null : formatDuration(activeSummary.downtimeSeconds || 0)}
          icon={AlertTriangle}
          variant={activeSummary.downtimeSeconds > 0 ? 'down' : 'up'}
          subtext={
            isLoading
              ? 'Computing…'
              : activeSummary.incidentCount > 0
              ? `${activeSummary.incidentCount} outage event${activeSummary.incidentCount > 1 ? 's' : ''}`
              : 'Zero downtime recorded'
          }
          loading={isLoading}
        />

        {/* 3. Average Latency */}
        <StatCard
          label={`Avg Latency (${period})`}
          value={
            isLoading
              ? null
              : activeSummary.averageResponseTime != null
              ? `${Math.round(activeSummary.averageResponseTime)} ms`
              : '—'
          }
          icon={Zap}
          variant="default"
          subtext={
            isLoading
              ? 'Computing…'
              : activeSummary.averageResponseTime != null
              ? activeSummary.averageResponseTime < 300
                ? 'Fast response times'
                : 'Elevated probe latency'
              : 'No latency samples'
          }
          loading={isLoading}
        />

        {/* 4. Tail Latency (P95 & P99) */}
        <StatCard
          label={`Tail Latency (P95 / P99)`}
          value={
            isLoading
              ? null
              : activeSummary.p95ResponseTime != null
              ? `${Math.round(activeSummary.p95ResponseTime)}ms`
              : selectedScope === 'all'
              ? 'Per-target'
              : '—'
          }
          icon={Clock}
          variant="default"
          subtext={
            isLoading
              ? 'Computing…'
              : activeSummary.p99ResponseTime != null
              ? `P99: ${Math.round(activeSummary.p99ResponseTime)} ms`
              : selectedScope === 'all'
              ? 'See breakdown matrix below'
              : 'No percentile data'
          }
          loading={isLoading}
        />

        {/* 5. Successful & Failed Checks */}
        <StatCard
          label={`Probe Reliability`}
          value={isLoading ? null : passRate != null ? `${passRate.toFixed(1)}%` : '—'}
          icon={CheckCircle2}
          variant={passRate != null ? (passRate >= 99 ? 'up' : passRate >= 90 ? 'warning' : 'down') : 'default'}
          subtext={
            isLoading
              ? 'Computing…'
              : totalChecks > 0
              ? `${activeSummary.successfulChecks?.toLocaleString()} pass • ${activeSummary.failedChecks?.toLocaleString()} fail`
              : 'No probes recorded'
          }
          loading={isLoading}
        />

        {/* 6. Incident Frequency & Duration */}
        <StatCard
          label={`Outages & Duration`}
          value={isLoading ? null : `${activeSummary.incidentCount || 0}`}
          icon={ShieldAlert}
          variant={activeSummary.incidentCount > 0 ? 'down' : 'up'}
          subtext={
            isLoading
              ? 'Computing…'
              : activeSummary.incidentDurationSeconds > 0
              ? `Total outage: ${formatDuration(activeSummary.incidentDurationSeconds)}`
              : 'No incidents in window'
          }
          loading={isLoading}
        />
      </div>

      {/* Reliability Summary Strip */}
      {totalChecks > 0 && (
        <div
          className="card"
          style={{
            marginBottom: 'var(--space-6)',
            padding: 'var(--space-4) var(--space-5)',
            background: 'var(--color-bg-secondary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
              <TrendingUp size={14} style={{ color: 'var(--color-up)' }} />
              <span>Probe Execution Ratio ({period})</span>
            </div>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              {activeSummary.successfulChecks?.toLocaleString()} / {totalChecks.toLocaleString()} checks successful ({passRate.toFixed(2)}%)
            </span>
          </div>

          <div className="reliability-bar-container">
            <div
              className="reliability-bar-success"
              style={{ width: `${passRate}%` }}
              title={`Successful Checks: ${activeSummary.successfulChecks} (${passRate.toFixed(1)}%)`}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.6875rem', color: 'var(--color-text-muted)', marginTop: 'var(--space-2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-up)' }} />
              <span>Passed: {activeSummary.successfulChecks?.toLocaleString()} ({passRate.toFixed(1)}%)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-down)' }} />
              <span>Failed: {activeSummary.failedChecks?.toLocaleString()} ({failRate.toFixed(1)}%)</span>
            </div>
          </div>
        </div>
      )}

      {/* Charts 2-Column Grid */}
      <div className="analytics-chart-grid">
        {/* Chart 1: Latency & Response Time Telemetry */}
        <div className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
            <div>
              <h2 className="card-title" style={{ fontSize: 'var(--text-sm)' }}>
                {selectedScope === 'all' ? 'Response Time Comparison by Target' : 'Response Time Trend Over Time'}
              </h2>
              <p className="card-subtitle" style={{ fontSize: 'var(--text-xs)' }}>
                {selectedScope === 'all'
                  ? `Average, P95, and P99 latency across fleet (${period})`
                  : `Chronological probe response time in milliseconds`}
              </p>
            </div>
            <BarChart3 size={18} style={{ color: 'var(--color-brand-hover)' }} />
          </div>

          {isLoading ? (
            <div style={{ height: 260, background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-lg)' }} />
          ) : latencyChartData.length === 0 ? (
            <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
              <span>No latency telemetry available for {period} window.</span>
            </div>
          ) : selectedScope === 'all' ? (
            /* Fleet Mode: Grouped Bar Chart comparing Avg, P95, P99 */
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={latencyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    stroke="var(--color-text-muted)"
                    fontSize={11}
                    tickLine={false}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                  />
                  <YAxis
                    stroke="var(--color-text-muted)"
                    fontSize={11}
                    tickLine={false}
                    unit="ms"
                  />
                  <Tooltip content={<CustomLatencyTooltip />} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                  />
                  <Bar dataKey="avg" name="Average" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="p95" name="P95 Latency" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="p99" name="P99 Latency" fill="#c084fc" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            /* Monitor Mode: Area Chart of chronological probe latency */
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={latencyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="time" stroke="var(--color-text-muted)" fontSize={11} tickLine={false} />
                  <YAxis stroke="var(--color-text-muted)" fontSize={11} tickLine={false} unit="ms" />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload || !payload.length) return null;
                      const data = payload[0].payload;
                      return (
                        <div className="chart-custom-tooltip">
                          <div style={{ fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-primary)' }}>
                            {label}
                          </div>
                          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: data.success ? 'var(--color-up)' : 'var(--color-down)',
                              }}
                            />
                            <span>{data.success ? 'Check Passed' : 'Check Failed'}</span>
                            {data.statusCode && (
                              <span style={{ color: 'var(--color-text-muted)' }}>(HTTP {data.statusCode})</span>
                            )}
                          </div>
                          <div style={{ marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                            Latency: <strong>{data.latency} ms</strong>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="latency"
                    name="Response Time"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#latencyGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Chart 2: Availability & Probe Execution Volume */}
        <div className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
            <div>
              <h2 className="card-title" style={{ fontSize: 'var(--text-sm)' }}>
                {selectedScope === 'all' ? 'Probe Outcomes & Volume by Target' : 'Check Execution Distribution'}
              </h2>
              <p className="card-subtitle" style={{ fontSize: 'var(--text-xs)' }}>
                Successful vs. failed health checks in {period} window
              </p>
            </div>
            <Activity size={18} style={{ color: 'var(--color-up)' }} />
          </div>

          {isLoading ? (
            <div style={{ height: 260, background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-lg)' }} />
          ) : checksChartData.length === 0 ? (
            <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>
              <span>No probe outcome statistics recorded for {period}.</span>
            </div>
          ) : selectedScope === 'all' ? (
            /* Fleet Mode: Stacked Bar Chart of Passed vs Failed checks */
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={checksChartData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    stroke="var(--color-text-muted)"
                    fontSize={11}
                    tickLine={false}
                    interval={0}
                    angle={-20}
                    textAnchor="end"
                  />
                  <YAxis stroke="var(--color-text-muted)" fontSize={11} tickLine={false} />
                  <Tooltip content={<CustomChecksTooltip />} />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                  />
                  <Bar dataKey="passed" name="Passed Checks" fill="#10b981" stackId="a" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="failed" name="Failed Checks" fill="#ef4444" stackId="a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            /* Single Monitor Mode: Bar representation of checks */
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={checksChartData} margin={{ top: 20, right: 20, left: -10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} />
                  <YAxis stroke="var(--color-text-muted)" fontSize={11} tickLine={false} />
                  <Tooltip
                    formatter={(val) => [`${val.toLocaleString()} probes`, 'Count']}
                    contentStyle={{
                      background: 'var(--color-bg-secondary)',
                      borderColor: 'var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--text-xs)',
                    }}
                  />
                  <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Fleet Telemetry Ranking Matrix Table (Fleet mode only) */}
      {selectedScope === 'all' && (
        <div className="analytics-table-card">
          <div className="analytics-table-header">
            <div>
              <h2 className="card-title" style={{ fontSize: 'var(--text-base)' }}>
                Target Performance Matrix
              </h2>
              <p className="card-subtitle" style={{ fontSize: 'var(--text-xs)' }}>
                Aggregated availability, percentile response times, probe counts, and incident frequency for {period}
              </p>
            </div>

            <span className="tag" style={{ fontSize: 'var(--text-xs)' }}>
              {monitorBreakdown.length} Target{monitorBreakdown.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="monitors-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table className="monitors-table">
              <thead>
                <tr>
                  <th>Target Monitor</th>
                  <th>Uptime ({period})</th>
                  <th>Downtime</th>
                  <th>Avg Latency</th>
                  <th>P95 / P99 Latency</th>
                  <th>Checks (Pass / Fail)</th>
                  <th>Incidents</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRowSkeleton key={i} cols={8} />
                  ))
                ) : monitorBreakdown.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 'var(--space-6)' }}>
                      <EmptyState
                        icon={Server}
                        title="No monitors found"
                        description="Configure your first monitor to start generating real-time analytics."
                        actionText="Go to Monitors"
                        onAction={() => window.location.assign('/monitors')}
                      />
                    </td>
                  </tr>
                ) : (
                  monitorBreakdown.map((m) => {
                    const sum = m.summary || {};
                    const uptime = sum.uptimePercentage ?? 100;
                    const downtimeSec = sum.downtimeSeconds || 0;
                    const passChecks = sum.successfulChecks || 0;
                    const failChecks = sum.failedChecks || 0;
                    const totalChecksCount = sum.totalChecks || 0;

                    return (
                      <tr key={m.id}>
                        <td>
                          <div className="monitor-target-cell">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                              <Link to={`/monitors/${m.id}`} className="monitor-name-link">
                                {m.name}
                              </Link>
                              <StatusBadge status={m.status} size="sm" showDot />
                            </div>
                            <a
                              href={m.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="monitor-url-text"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              <span>{m.url}</span>
                              <ExternalLink size={10} style={{ opacity: 0.6 }} />
                            </a>
                          </div>
                        </td>

                         {/* Uptime % */}
                        <td>
                          <span
                            style={{
                              fontWeight: 'var(--weight-semibold)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--text-xs)',
                              color:
                                uptime == null || totalChecksCount === 0
                                  ? 'var(--color-text-muted)'
                                  : uptime >= 99.5
                                  ? 'var(--color-up)'
                                  : uptime >= 95
                                  ? '#f59e0b'
                                  : 'var(--color-down)',
                            }}
                          >
                            {uptime != null && totalChecksCount > 0 ? `${Number(uptime).toFixed(2)}%` : '—'}
                          </span>
                        </td>

                        {/* Downtime */}
                        <td>
                          <span
                            style={{
                              fontSize: 'var(--text-xs)',
                              fontFamily: 'var(--font-mono)',
                              color: downtimeSec > 0 ? 'var(--color-down)' : 'var(--color-text-muted)',
                            }}
                          >
                            {downtimeSec > 0 ? formatDuration(downtimeSec) : '0s'}
                          </span>
                        </td>

                        {/* Average Latency */}
                        <td>
                          {sum.averageResponseTime != null ? (
                            <span
                              style={{
                                fontSize: 'var(--text-xs)',
                                fontFamily: 'var(--font-mono)',
                                color:
                                  sum.averageResponseTime < 300
                                    ? 'var(--color-up)'
                                    : sum.averageResponseTime < 1000
                                    ? '#f59e0b'
                                    : 'var(--color-down)',
                              }}
                            >
                              {Math.round(sum.averageResponseTime)} ms
                            </span>
                          ) : (
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>—</span>
                          )}
                        </td>

                        {/* P95 / P99 Latency */}
                        <td>
                          {sum.p95ResponseTime != null ? (
                            <div className="latency-pill-group">
                              <span className="latency-badge-p95">
                                {Math.round(sum.p95ResponseTime)}ms
                              </span>
                              {sum.p99ResponseTime != null && (
                                <span className="latency-badge-p99">
                                  {Math.round(sum.p99ResponseTime)}ms
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>—</span>
                          )}
                        </td>

                        {/* Checks count */}
                        <td>
                          <div style={{ fontSize: 'var(--text-xs)' }}>
                            <span style={{ color: 'var(--color-up)', fontFamily: 'var(--font-mono)' }}>
                              {passChecks.toLocaleString()}
                            </span>
                            <span style={{ color: 'var(--color-text-muted)', margin: '0 4px' }}>/</span>
                            <span style={{ color: failChecks > 0 ? 'var(--color-down)' : 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                              {failChecks.toLocaleString()}
                            </span>
                            <div style={{ fontSize: '0.625rem', color: 'var(--color-text-muted)' }}>
                              {totalChecksCount.toLocaleString()} total
                            </div>
                          </div>
                        </td>

                        {/* Incidents count & duration */}
                        <td>
                          <div style={{ fontSize: 'var(--text-xs)' }}>
                            <span
                              style={{
                                fontWeight: sum.incidentCount > 0 ? 'var(--weight-semibold)' : 'normal',
                                color: sum.incidentCount > 0 ? 'var(--color-down)' : 'var(--color-text-muted)',
                              }}
                            >
                              {sum.incidentCount || 0} outage{sum.incidentCount === 1 ? '' : 's'}
                            </span>
                            {sum.incidentDurationSeconds > 0 && (
                              <div style={{ fontSize: '0.625rem', color: 'var(--color-text-muted)' }}>
                                {formatDuration(sum.incidentDurationSeconds)}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Actions */}
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: '4px 8px', fontSize: 'var(--text-xs)' }}
                            onClick={() => setSelectedScope(m.id)}
                            title="Drill down into this target's analytics"
                          >
                            <span>Analyze</span>
                            <ArrowUpRight size={13} />
                          </button>
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

      {/* Incident Frequency & Outage Impact Cards (Single Monitor Mode) */}
      {selectedScope !== 'all' && (
        <div className="card" style={{ padding: 'var(--space-5) var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
            <div>
              <h2 className="card-title" style={{ fontSize: 'var(--text-sm)' }}>
                Incident & Outage History ({period})
              </h2>
              <p className="card-subtitle" style={{ fontSize: 'var(--text-xs)' }}>
                Summary of detected downtime events and recovery timing
              </p>
            </div>
            <ShieldAlert size={18} style={{ color: activeSummary.incidentCount > 0 ? 'var(--color-down)' : 'var(--color-up)' }} />
          </div>

          {activeSummary.incidentCount === 0 ? (
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
                  Zero Outages in {period === '24h' ? 'Last 24 Hours' : period === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  This endpoint has maintained 100% continuous uptime throughout the selected monitoring window.
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-4)',
                background: 'rgba(239, 68, 68, 0.06)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: 'var(--radius-lg)',
                flexWrap: 'wrap',
                gap: 'var(--space-3)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <XCircle size={20} style={{ color: 'var(--color-down)', flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                    {activeSummary.incidentCount} Outage Incident{activeSummary.incidentCount > 1 ? 's' : ''} Detected
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    Cumulative downtime: <strong>{formatDuration(activeSummary.downtimeSeconds)}</strong> in {period}
                  </div>
                </div>
              </div>

              <Link
                to={`/monitors/${selectedScope}`}
                className="btn btn-secondary"
                style={{
                  padding: '4px 12px',
                  fontSize: 'var(--text-xs)',
                  borderColor: 'rgba(239, 68, 68, 0.4)',
                  color: 'var(--color-down)',
                  textDecoration: 'none',
                }}
              >
                View Incident Log &rarr;
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
