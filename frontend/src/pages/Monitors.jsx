import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
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
  if (!dateString) return 'Never checked';
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

export default function Monitors() {
  const { toast } = useToast();
  const [monitors, setMonitors] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [enabledFilter, setEnabledFilter] = useState('ALL');

  // Modals state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMonitor, setEditingMonitor] = useState(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [monitorToDelete, setMonitorToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Track which monitor IDs are currently being toggled to prevent double-clicks
  const [togglingIds, setTogglingIds] = useState(new Set());

  // Initial load
  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await api.get('/api/v1/monitors', {
          params: { limit: 100, sort: 'createdAt', order: 'desc' },
        });
        if (active) setMonitors(response.data?.data || []);
      } catch (err) {
        if (active) {
          const msg =
            err.response?.data?.error?.message ||
            err.message ||
            'Failed to fetch monitoring endpoints.';
          setErrorMessage(msg);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setErrorMessage('');
    try {
      const response = await api.get('/api/v1/monitors', {
        params: { limit: 100, sort: 'createdAt', order: 'desc' },
      });
      setMonitors(response.data?.data || []);
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to fetch monitoring endpoints.';
      setErrorMessage(msg);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Handle Enable / Disable Toggle
  const handleToggleEnabled = async (monitor, newEnabled) => {
    if (togglingIds.has(monitor.id)) return;

    setTogglingIds((prev) => new Set(prev).add(monitor.id));

    // Optimistic UI update
    setMonitors((prev) =>
      prev.map((m) => (m.id === monitor.id ? { ...m, enabled: newEnabled } : m))
    );

    try {
      const response = await api.patch(`/api/v1/monitors/${monitor.id}`, {
        enabled: newEnabled,
      });
      const updated = response.data?.data;
      if (updated) {
        setMonitors((prev) =>
          prev.map((m) => (m.id === monitor.id ? updated : m))
        );
        toast.success(`Monitor ${newEnabled ? 'enabled' : 'disabled'}`);
      }
    } catch (err) {
      // Revert optimistic update on failure
      setMonitors((prev) =>
        prev.map((m) => (m.id === monitor.id ? { ...m, enabled: !newEnabled } : m))
      );
      const msg =
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to update monitor state.';
      setErrorMessage(msg);
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(monitor.id);
        return next;
      });
    }
  };

  // Open Edit Modal
  const handleEditClick = (monitor) => {
    setEditingMonitor(monitor);
    setModalOpen(true);
  };

  // Open Create Modal
  const handleCreateClick = () => {
    setEditingMonitor(null);
    setModalOpen(true);
  };

  // Handle Save Success (Create or Edit)
  const handleSaveSuccess = (savedMonitor, isEditing) => {
    if (isEditing) {
      setMonitors((prev) =>
        prev.map((m) => (m.id === savedMonitor.id ? savedMonitor : m))
      );
      toast.success(`Updated "${savedMonitor.name}"`);
    } else {
      setMonitors((prev) => [savedMonitor, ...prev]);
      toast.success(`Created monitor "${savedMonitor.name}"`);
    }
  };

  // Prompt Delete Confirmation
  const handleDeletePrompt = (monitor) => {
    setMonitorToDelete(monitor);
    setDeleteConfirmOpen(true);
  };

  // Confirm and execute delete
  const handleConfirmDelete = async () => {
    if (!monitorToDelete) return;
    setIsDeleting(true);

    try {
      await api.delete(`/api/v1/monitors/${monitorToDelete.id}`);
      setMonitors((prev) => prev.filter((m) => m.id !== monitorToDelete.id));
      toast.success(`Deleted monitor "${monitorToDelete.name}"`);
      setDeleteConfirmOpen(false);
      setMonitorToDelete(null);
    } catch (err) {
      const msg =
        err.response?.data?.error?.message ||
        err.message ||
        'Failed to delete monitor.';
      setErrorMessage(msg);
    } finally {
      setIsDeleting(false);
    }
  };

  // Filtered monitors list
  const filteredMonitors = useMemo(() => {
    return monitors.filter((m) => {
      // Status filter
      if (statusFilter !== 'ALL' && m.status !== statusFilter) {
        return false;
      }
      // Enabled filter
      if (enabledFilter === 'ENABLED' && !m.enabled) return false;
      if (enabledFilter === 'DISABLED' && m.enabled) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = m.name?.toLowerCase().includes(q);
        const matchesUrl = m.url?.toLowerCase().includes(q);
        if (!matchesName && !matchesUrl) return false;
      }

      return true;
    });
  }, [monitors, statusFilter, enabledFilter, searchQuery]);

  // Aggregated monitor statistics
  const stats = useMemo(() => {
    const total = monitors.length;
    const up = monitors.filter((m) => m.status === 'UP').length;
    const down = monitors.filter((m) => m.status === 'DOWN').length;
    const paused = monitors.filter((m) => !m.enabled).length;
    return { total, up, down, paused };
  }, [monitors]);

  return (
    <div>
      {/* Top Header Section */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Monitors</h1>
          <p className="page-subtitle">
            Configure, manage, and track real-time availability across your target endpoints
          </p>
        </div>

        <div className="page-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={isLoading || isRefreshing}
            title="Refresh monitor list"
          >
            <RefreshCw size={15} className={isRefreshing ? 'spin' : ''} />
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleCreateClick}
          >
            <Plus size={16} />
            <span>Create Monitor</span>
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <ErrorBanner
            message={errorMessage}
            onRetry={handleRefresh}
            onDismiss={() => setErrorMessage('')}
          />
        </div>
      )}

      {/* Overview Stat Cards */}
      <div className="stats-grid" style={{ marginBottom: 'var(--space-6)' }}>
        <StatCard
          label="Total Endpoints"
          value={stats.total}
          icon={Activity}
          variant="default"
        />
        <StatCard
          label="Operational (UP)"
          value={stats.up}
          icon={CheckCircle2}
          variant="up"
          subtext={stats.total > 0 ? `${Math.round((stats.up / stats.total) * 100)}% operational` : undefined}
        />
        <StatCard
          label="Outages (DOWN)"
          value={stats.down}
          icon={XCircle}
          variant={stats.down > 0 ? 'down' : 'default'}
          subtext={stats.down > 0 ? 'Requires immediate attention' : 'No ongoing outages'}
        />
        <StatCard
          label="Paused / Disabled"
          value={stats.paused}
          icon={Clock}
          variant="muted"
          subtext="Checks paused"
        />
      </div>

      {/* Filter and Search Controls Toolbar */}
      <div
        className="card"
        style={{
          marginBottom: 'var(--space-6)',
          padding: 'var(--space-3) var(--space-4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-3)',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Search box */}
          <div className="input-group" style={{ flex: '1 1 240px', maxWidth: 360 }}>
            <span className="input-group-icon">
              <Search size={16} />
            </span>
            <input
              type="text"
              className="form-input"
              placeholder="Search by name or URL..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Filter dropdowns */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Filter size={14} style={{ color: 'var(--color-text-muted)' }} />
              <select
                className="form-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)' }}
              >
                <option value="ALL">All Statuses</option>
                <option value="UP">UP Only</option>
                <option value="DOWN">DOWN Only</option>
                <option value="UNKNOWN">UNKNOWN Only</option>
              </select>
            </div>

            <select
              className="form-select"
              value={enabledFilter}
              onChange={(e) => setEnabledFilter(e.target.value)}
              style={{ fontSize: 'var(--text-xs)', padding: 'var(--space-2) var(--space-3)' }}
            >
              <option value="ALL">All States</option>
              <option value="ENABLED">Active Only</option>
              <option value="DISABLED">Paused Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Monitors Table / States */}
      {isLoading ? (
        <div className="monitors-table-wrapper">
          <table className="monitors-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Target Endpoint</th>
                <th>Interval / Timeout</th>
                <th>Expected Codes</th>
                <th>Last Checked</th>
                <th>Active</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              <TableRowSkeleton cols={7} />
              <TableRowSkeleton cols={7} />
              <TableRowSkeleton cols={7} />
              <TableRowSkeleton cols={7} />
            </tbody>
          </table>
        </div>
      ) : monitors.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Activity}
            title="No monitors configured yet"
            description="Start monitoring your HTTP/HTTPS endpoints, APIs, and microservices in real-time."
            actionText="Create First Monitor"
            onAction={handleCreateClick}
          />
        </div>
      ) : filteredMonitors.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Search}
            title="No matching monitors"
            description={`No endpoints matched your search "${searchQuery}" or selected filter criteria.`}
            actionText="Clear Filters"
            onAction={() => {
              setSearchQuery('');
              setStatusFilter('ALL');
              setEnabledFilter('ALL');
            }}
          />
        </div>
      ) : (
        <div className="monitors-table-wrapper">
          <table className="monitors-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Target Endpoint</th>
                <th>Interval / Timeout</th>
                <th>Expected Codes</th>
                <th>Last Checked</th>
                <th>Active</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredMonitors.map((m) => {
                const methodLower = (m.method || 'get').toLowerCase();
                const isToggling = togglingIds.has(m.id);

                return (
                  <tr key={m.id}>
                    {/* Status Badge */}
                    <td style={{ width: 140 }}>
                      <StatusBadge status={m.status} showDot size="sm" />
                    </td>

                    {/* Target Endpoint & Name */}
                    <td>
                      <div className="monitor-target-cell">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <span className={`badge-method badge-method-${methodLower}`}>
                            {m.method || 'GET'}
                          </span>
                          <Link
                            to={`/monitors/${m.id}`}
                            className="monitor-name-link"
                            title="View monitor details and telemetry"
                          >
                            {m.name}
                          </Link>
                        </div>

                        <a
                          href={m.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="monitor-url-text"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          title={m.url}
                        >
                          <span>{m.url}</span>
                          <ExternalLink size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
                        </a>
                      </div>
                    </td>

                    {/* Interval / Timeout */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-primary)' }}>
                          Every {m.intervalSeconds}s
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                          {m.timeoutSeconds}s timeout
                        </span>
                      </div>
                    </td>

                    {/* Expected Status Codes */}
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {Array.isArray(m.expectedCodes) && m.expectedCodes.length > 0 ? (
                          m.expectedCodes.map((code) => (
                            <span key={code} className="tag">
                              {code}
                            </span>
                          ))
                        ) : (
                          <span className="tag">200</span>
                        )}
                      </div>
                    </td>

                    {/* Last Checked & Response Time */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-primary)' }}>
                          {formatRelativeTime(m.lastCheckedAt)}
                        </span>
                        {m.lastResponseTimeMs != null && (
                          <span
                            style={{
                              fontSize: '0.7rem',
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--color-brand-hover)',
                            }}
                          >
                            {m.lastResponseTimeMs} ms
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Active State Toggle */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <ToggleSwitch
                          checked={m.enabled}
                          onChange={(nextChecked) => handleToggleEnabled(m, nextChecked)}
                          disabled={isToggling}
                          ariaLabel={`Toggle ${m.name}`}
                        />
                        {isToggling && <Loader2 size={14} className="spin" style={{ color: 'var(--color-text-muted)' }} />}
                      </div>
                    </td>

                    {/* Actions: Edit & Delete */}
                    <td style={{ textAlign: 'right' }}>
                      <div className="action-btn-group" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="icon-action-btn"
                          onClick={() => handleEditClick(m)}
                          title="Edit Monitor"
                          aria-label={`Edit ${m.name}`}
                        >
                          <Pencil size={15} />
                        </button>

                        <button
                          type="button"
                          className="icon-action-btn btn-danger"
                          onClick={() => handleDeletePrompt(m)}
                          title="Delete Monitor"
                          aria-label={`Delete ${m.name}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create / Edit Monitor Modal */}
      {modalOpen && (
        <MonitorModal
          key={editingMonitor ? editingMonitor.id : 'create'}
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setEditingMonitor(null);
          }}
          onSuccess={handleSaveSuccess}
          initialMonitor={editingMonitor}
        />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          if (!isDeleting) {
            setDeleteConfirmOpen(false);
            setMonitorToDelete(null);
          }
        }}
        onConfirm={handleConfirmDelete}
        title="Delete Monitor"
        message={
          monitorToDelete
            ? `Are you sure you want to permanently delete "${monitorToDelete.name}" (${monitorToDelete.url})? All associated health check history will be permanently deleted. This action cannot be undone.`
            : 'Are you sure you want to proceed?'
        }
        confirmText="Delete Monitor"
        confirmVariant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
