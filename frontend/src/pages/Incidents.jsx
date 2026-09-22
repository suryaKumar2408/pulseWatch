import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  RefreshCw,
  RotateCw,
  Search,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import api from '../lib/api';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';
import ErrorBanner from '../components/ui/ErrorBanner';
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

export default function Incidents() {
  const { toast } = useToast();

  // Navigation tabs: 'incidents' | 'notifications'
  const [activeTab, setActiveTab] = useState('incidents');

  // Filters
  const [incidentStatusFilter, setIncidentStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [notifStatusFilter, setNotifStatusFilter] = useState('ALL');
  const [notifEventFilter, setNotifEventFilter] = useState('ALL');

  // Data states
  const [incidents, setIncidents] = useState([]);
  const [notifications, setNotifications] = useState([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Retrying notifications in-flight set
  const [retryingIds, setRetryingIds] = useState(new Set());

  // Data fetching
  const loadData = useCallback(async (isBackground = false) => {
    if (isBackground) {
      setIsRefreshing(true);
    }
    setErrorMessage('');

    try {
      const [incRes, notifRes] = await Promise.allSettled([
        api.get('/api/v1/incidents', { params: { limit: 100, order: 'desc' } }),
        api.get('/api/v1/notifications', { params: { limit: 100, order: 'desc' } }),
      ]);

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
        'Failed to fetch incidents and notifications from server.';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    let active = true;

    async function run() {
      try {
        const [incRes, notifRes] = await Promise.allSettled([
          api.get('/api/v1/incidents', { params: { limit: 100, order: 'desc' } }),
          api.get('/api/v1/notifications', { params: { limit: 100, order: 'desc' } }),
        ]);

        if (!active) return;
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
            'Failed to fetch incidents and notifications from server.'
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
  }, []);

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
      setSuccessMessage('Notification delivery re-attempt dispatched successfully.');
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to retry notification delivery.';
      setErrorMessage(msg);
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(notifId);
        return next;
      });
    }
  };

  // KPI computations
  const openIncidents = useMemo(() => incidents.filter((i) => i.status === 'OPEN'), [incidents]);
  const resolvedIncidents = useMemo(() => incidents.filter((i) => i.status === 'RESOLVED'), [incidents]);

  const totalDowntimeSec = useMemo(() => {
    return incidents.reduce((sum, i) => sum + (i.durationSeconds || 0), 0);
  }, [incidents]);

  const deliveredNotifs = useMemo(() => notifications.filter((n) => n.status === 'DELIVERED'), [notifications]);
  const failedNotifs = useMemo(() => notifications.filter((n) => n.status === 'FAILED'), [notifications]);

  // Filtered incidents
  const filteredIncidents = useMemo(() => {
    return incidents.filter((i) => {
      if (incidentStatusFilter !== 'ALL' && i.status !== incidentStatusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = i.monitor?.name?.toLowerCase().includes(q);
        const matchesCause = i.cause?.toLowerCase().includes(q);
        const matchesCode = i.errorCode?.toLowerCase().includes(q);
        if (!matchesName && !matchesCause && !matchesCode) return false;
      }
      return true;
    });
  }, [incidents, incidentStatusFilter, searchQuery]);

  // Filtered notifications
  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => {
      if (notifStatusFilter !== 'ALL' && n.status !== notifStatusFilter) {
        return false;
      }
      if (notifEventFilter !== 'ALL' && n.event !== notifEventFilter) {
        return false;
      }
      return true;
    });
  }, [notifications, notifStatusFilter, notifEventFilter]);

  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 className="page-title">Incidents &amp; Alerts</h1>
          <p className="page-subtitle">
            Outage tracking, root cause diagnosis, and notification dispatch logs
          </p>
        </div>

        <div className="page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => loadData(true)}
            disabled={isLoading || isRefreshing}
            title="Refresh incidents and alerts"
          >
            <RefreshCw size={14} className={isRefreshing ? 'spin' : ''} />
            <span>{isRefreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Ongoing outage alert banner if open incidents exist */}
      {openIncidents.length > 0 && (
        <div className="ongoing-alert-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-md)',
                background: 'rgba(239, 68, 68, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-down)',
              }}
            >
              <AlertTriangle size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 'var(--weight-bold)', color: '#ffffff', fontSize: 'var(--text-sm)' }}>
                {openIncidents.length} Ongoing Outage Incident{openIncidents.length > 1 ? 's' : ''} Active
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'rgba(255, 255, 255, 0.75)', marginTop: 2 }}>
                Monitoring workers are continuously probing for recovery. Affected services are highlighted below.
              </div>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 'var(--text-xs)', borderColor: 'rgba(239, 68, 68, 0.4)' }}
            onClick={() => {
              setActiveTab('incidents');
              setIncidentStatusFilter('OPEN');
            }}
          >
            Inspect Open Incidents
          </button>
        </div>
      )}

      {/* Error alert */}
      {errorMessage && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <ErrorBanner
            title="Incident Synchronization Error"
            message={errorMessage}
            onRetry={() => loadData(true)}
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

      {/* KPI Stats Grid */}
      <div className="stats-grid" style={{ marginBottom: 'var(--space-6)' }}>
        {/* Open Outages */}
        <StatCard
          label="Active Outages"
          value={isLoading ? null : openIncidents.length}
          icon={XCircle}
          variant={openIncidents.length > 0 ? 'down' : 'up'}
          subtext={openIncidents.length > 0 ? 'Requires attention' : 'All systems normal'}
          loading={isLoading}
        />

        {/* Resolved Incidents */}
        <StatCard
          label="Resolved Incidents"
          value={isLoading ? null : resolvedIncidents.length}
          icon={CheckCircle2}
          variant="default"
          subtext={`${incidents.length} total lifetime incidents`}
          loading={isLoading}
        />

        {/* Total Outage Downtime */}
        <StatCard
          label="Cumulative Downtime"
          value={isLoading ? null : formatDuration(totalDowntimeSec)}
          icon={Clock}
          variant="default"
          subtext="Total duration across incidents"
          loading={isLoading}
        />

        {/* Notification Deliveries */}
        <StatCard
          label="Alert Delivery Rate"
          value={
            isLoading
              ? null
              : notifications.length > 0
              ? `${Math.round((deliveredNotifs.length / notifications.length) * 100)}%`
              : '—'
          }
          icon={Bell}
          variant={failedNotifs.length > 0 ? 'warning' : 'up'}
          subtext={
            notifications.length > 0
              ? `${deliveredNotifs.length} delivered • ${failedNotifs.length} failed`
              : 'No dispatch attempts'
          }
          loading={isLoading}
        />
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="tab-nav">
        <button
          type="button"
          className={`tab-nav-btn ${activeTab === 'incidents' ? 'active' : ''}`}
          onClick={() => setActiveTab('incidents')}
        >
          <ShieldAlert size={16} />
          <span>Outage Incidents ({incidents.length})</span>
        </button>

        <button
          type="button"
          className={`tab-nav-btn ${activeTab === 'notifications' ? 'active' : ''}`}
          onClick={() => setActiveTab('notifications')}
        >
          <Bell size={16} />
          <span>Alert Notifications ({notifications.length})</span>
        </button>
      </div>

      {/* Tab 1: Outage Incidents */}
      {activeTab === 'incidents' && (
        <div>
          {/* Filter and Search Toolbar */}
          <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-3) var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div className="input-group" style={{ flex: '1 1 240px', maxWidth: 360 }}>
                <span className="input-group-icon">
                  <Search size={16} />
                </span>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search by monitor or failure cause…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Filter size={14} style={{ color: 'var(--color-text-muted)' }} />
                <select
                  className="form-select"
                  value={incidentStatusFilter}
                  onChange={(e) => setIncidentStatusFilter(e.target.value)}
                  style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)' }}
                >
                  <option value="ALL">All Statuses ({incidents.length})</option>
                  <option value="OPEN">Open Outages Only ({openIncidents.length})</option>
                  <option value="RESOLVED">Resolved Only ({resolvedIncidents.length})</option>
                </select>
              </div>
            </div>
          </div>

          {/* Incidents List / Cards */}
          {isLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ height: 110, background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-xl)' }} />
              <div style={{ height: 110, background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-xl)' }} />
            </div>
          ) : incidents.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={CheckCircle2}
                title="Zero Incidents Recorded"
                description="No outages or downtime events have been detected across any of your monitored targets."
              />
            </div>
          ) : filteredIncidents.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={Search}
                title="No incidents match filter"
                description={`No outage events match your search "${searchQuery}" or status filter.`}
                actionText="Clear Filters"
                onAction={() => {
                  setSearchQuery('');
                  setIncidentStatusFilter('ALL');
                }}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {filteredIncidents.map((inc) => {
                const isOpen = inc.status === 'OPEN';
                return (
                  <div key={inc.id} className={`incident-card-item ${isOpen ? 'open' : ''}`}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                        <div style={{ marginTop: 2 }}>
                          {isOpen ? (
                            <AlertTriangle size={20} style={{ color: 'var(--color-down)' }} />
                          ) : (
                            <CheckCircle2 size={20} style={{ color: 'var(--color-up)' }} />
                          )}
                        </div>

                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                            <Link
                              to={`/monitors/${inc.monitorId}`}
                              style={{
                                fontWeight: 'var(--weight-semibold)',
                                fontSize: 'var(--text-base)',
                                color: 'var(--color-text-primary)',
                                textDecoration: 'none',
                              }}
                            >
                              {inc.monitor?.name || 'Monitored Target'}
                            </Link>

                            <span className={isOpen ? 'incident-badge-open' : 'incident-badge-resolved'}>
                              {isOpen ? 'ONGOING OUTAGE' : 'RESOLVED'}
                            </span>

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
                          </div>

                          {/* Failure Description */}
                          <div style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)' }}>
                            {inc.cause || 'Target endpoint failed consecutive threshold health checks.'}
                          </div>

                          {inc.monitor?.url && (
                            <a
                              href={inc.monitor.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="monitor-url-text"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4 }}
                            >
                              <span>{inc.monitor.url}</span>
                              <ExternalLink size={11} style={{ opacity: 0.6 }} />
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Right: Duration Badge */}
                      <div style={{ textAlign: 'right' }}>
                        <div
                          style={{
                            fontSize: 'var(--text-sm)',
                            fontWeight: 'var(--weight-bold)',
                            fontFamily: 'var(--font-mono)',
                            color: isOpen ? 'var(--color-down)' : 'var(--color-text-primary)',
                          }}
                        >
                          {isOpen ? 'Active Outage' : `Duration: ${formatDuration(inc.durationSeconds)}`}
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                          Started {formatRelativeTime(inc.startedAt)}
                        </div>
                      </div>
                    </div>

                    {/* Meta Grid */}
                    <div className="incident-meta-grid">
                      <div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                          Outage Started
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-primary)', marginTop: 2 }}>
                          {new Date(inc.startedAt).toLocaleString()}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                          Recovery Time
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-primary)', marginTop: 2 }}>
                          {inc.resolvedAt ? new Date(inc.resolvedAt).toLocaleString() : 'Pending Recovery'}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                          Total Downtime
                        </div>
                        <div style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', fontWeight: 600, color: isOpen ? 'var(--color-down)' : 'var(--color-text-primary)', marginTop: 2 }}>
                          {isOpen ? 'Ongoing' : formatDuration(inc.durationSeconds)}
                        </div>
                      </div>

                      <div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>
                          Target Link
                        </div>
                        <Link
                          to={`/monitors/${inc.monitorId}`}
                          style={{ fontSize: 'var(--text-xs)', color: 'var(--color-brand-hover)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}
                        >
                          <span>Monitor Telemetry</span>
                          <ExternalLink size={12} />
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Alert Notifications */}
      {activeTab === 'notifications' && (
        <div>
          {/* Notifications Filter Toolbar */}
          <div className="card" style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-3) var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Status:</span>
                <select
                  className="form-select"
                  value={notifStatusFilter}
                  onChange={(e) => setNotifStatusFilter(e.target.value)}
                  style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)' }}
                >
                  <option value="ALL">All Outcomes</option>
                  <option value="DELIVERED">Delivered ({deliveredNotifs.length})</option>
                  <option value="FAILED">Failed ({failedNotifs.length})</option>
                  <option value="PENDING">Pending</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Event:</span>
                <select
                  className="form-select"
                  value={notifEventFilter}
                  onChange={(e) => setNotifEventFilter(e.target.value)}
                  style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)' }}
                >
                  <option value="ALL">All Events</option>
                  <option value="MONITOR_DOWN">Down Outages (MONITOR_DOWN)</option>
                  <option value="MONITOR_RECOVERED">Recoveries (MONITOR_RECOVERED)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Notifications Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="monitors-table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
              <table className="monitors-table">
                <thead>
                  <tr>
                    <th>Delivery Status</th>
                    <th>Event Type</th>
                    <th>Target Monitor</th>
                    <th>Recipient</th>
                    <th>Attempts</th>
                    <th>Sent At</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRowSkeleton key={i} cols={7} />
                    ))
                  ) : filteredNotifications.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 'var(--space-6)' }}>
                        <EmptyState
                          icon={Bell}
                          title="No notification dispatches found"
                          description="When state changes occur (outages or recoveries), alert dispatches will appear here."
                        />
                      </td>
                    </tr>
                  ) : (
                    filteredNotifications.map((notif) => {
                      const isDown = notif.event === 'MONITOR_DOWN';
                      const isDelivered = notif.status === 'DELIVERED';
                      const isFailed = notif.status === 'FAILED';
                      const isRetrying = retryingIds.has(notif.id);

                      return (
                        <tr key={notif.id}>
                          <td>
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
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <Link
                                to={`/monitors/${notif.monitorId}`}
                                className="monitor-name-link"
                              >
                                {notif.monitor?.name || 'Monitor'}
                              </Link>
                              {notif.subject && (
                                <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>
                                  {notif.subject}
                                </span>
                              )}
                            </div>
                          </td>

                          <td>
                            <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                              {notif.recipient}
                            </span>
                          </td>

                          <td>
                            <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
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
                                title="Re-dispatch notification"
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
        </div>
      )}
    </div>
  );
}
