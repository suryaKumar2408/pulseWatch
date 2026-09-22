import { useState, useEffect, useRef } from 'react';
import { Activity, AlertCircle, Globe, Loader2, X } from 'lucide-react';
import api from '../../lib/api';
import ToggleSwitch from '../ui/ToggleSwitch';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const INTERVAL_PRESETS = [
  { label: '30s', value: 30 },
  { label: '1m',  value: 60 },
  { label: '5m',  value: 300 },
  { label: '15m', value: 900 },
  { label: '1h',  value: 3600 },
];

const TIMEOUT_PRESETS = [
  { label: '5s',  value: 5 },
  { label: '10s', value: 10 },
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
];

const STATUS_CODE_PRESETS = [
  { label: '200 OK', codes: '200' },
  { label: '2xx Success', codes: '200, 201, 202, 204' },
  { label: '200 + Redirects', codes: '200, 301, 302, 307, 308' },
];

export default function MonitorModal({
  isOpen = false,
  onClose,
  onSuccess,
  initialMonitor = null,
}) {
  const isEditing = Boolean(initialMonitor);
  const nameInputRef = useRef(null);

  const [name, setName] = useState(initialMonitor?.name || '');
  const [url, setUrl] = useState(initialMonitor?.url || 'https://');
  const [method, setMethod] = useState(initialMonitor?.method || 'GET');
  const [intervalSeconds, setIntervalSeconds] = useState(initialMonitor?.intervalSeconds ?? 60);
  const [timeoutSeconds, setTimeoutSeconds] = useState(initialMonitor?.timeoutSeconds ?? 10);
  const [expectedCodesText, setExpectedCodesText] = useState(
    Array.isArray(initialMonitor?.expectedCodes) && initialMonitor.expectedCodes.length > 0
      ? initialMonitor.expectedCodes.join(', ')
      : '200'
  );
  const [enabled, setEnabled] = useState(initialMonitor?.enabled !== false);

  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      nameInputRef.current?.focus();
      const handleEscape = (e) => {
        if (e.key === 'Escape' && !isSubmitting) {
          onClose();
        }
      };
      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const parseExpectedCodes = (text) => {
    const parts = text
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    if (parts.length === 0) return null;

    const codes = [];
    for (const p of parts) {
      const num = parseInt(p, 10);
      if (isNaN(num) || num < 100 || num > 599) {
        return null;
      }
      if (!codes.includes(num)) {
        codes.push(num);
      }
    }
    return codes;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    // 1. Validation
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorMessage('Monitor name is required.');
      return;
    }
    if (trimmedName.length > 100) {
      setErrorMessage('Monitor name must be 100 characters or fewer.');
      return;
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setErrorMessage('Target URL is required.');
      return;
    }
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      setErrorMessage('Target URL must begin with http:// or https://');
      return;
    }

    try {
      new URL(trimmedUrl);
    } catch {
      setErrorMessage('Please enter a valid URL (e.g., https://api.example.com/health).');
      return;
    }

    const interval = Number(intervalSeconds);
    if (isNaN(interval) || interval < 30 || interval > 86400) {
      setErrorMessage('Check interval must be between 30 and 86400 seconds (24 hours).');
      return;
    }

    const timeout = Number(timeoutSeconds);
    if (isNaN(timeout) || timeout < 1 || timeout > 30) {
      setErrorMessage('Timeout must be between 1 and 30 seconds.');
      return;
    }

    if (timeout >= interval) {
      setErrorMessage('Timeout must be strictly less than the monitoring interval.');
      return;
    }

    const parsedCodes = parseExpectedCodes(expectedCodesText);
    if (!parsedCodes) {
      setErrorMessage('Expected status codes must be valid HTTP numbers between 100 and 599 (e.g. 200, 204).');
      return;
    }

    const payload = {
      name: trimmedName,
      url: trimmedUrl,
      method,
      intervalSeconds: interval,
      timeoutSeconds: timeout,
      expectedCodes: parsedCodes,
      enabled,
    };

    try {
      setIsSubmitting(true);
      let response;

      if (isEditing) {
        response = await api.patch(`/api/v1/monitors/${initialMonitor.id}`, payload);
      } else {
        response = await api.post('/api/v1/monitors', payload);
      }

      const saved = response.data?.data;
      if (onSuccess) {
        onSuccess(saved, isEditing);
      }
      onClose();
    } catch (err) {
      const serverMsg =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        err.message ||
        'Failed to save monitor configuration.';
      setErrorMessage(serverMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!isSubmitting) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="monitor-modal-title"
    >
      <div
        className="modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id="monitor-modal-title">
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-brand-muted)',
                border: '1px solid var(--color-border-brand)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-brand-hover)',
              }}
            >
              <Activity size={18} />
            </div>
            <span>{isEditing ? 'Edit Monitor' : 'Create New Monitor'}</span>
          </div>

          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {errorMessage && (
              <div
                className="alert alert-danger"
                role="alert"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--space-2)',
                  fontSize: 'var(--text-sm)',
                  padding: 'var(--space-3)',
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Monitor Name */}
            <div className="form-group">
              <label className="form-label" htmlFor="monitor-name">
                Monitor Name <span style={{ color: 'var(--color-down)' }}>*</span>
              </label>
              <input
                ref={nameInputRef}
                id="monitor-name"
                type="text"
                className="form-input"
                placeholder="Production API Health"
                maxLength={100}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isSubmitting}
              />
            </div>

            {/* HTTP Method & Target URL */}
            <div className="form-row">
              <div className="form-group" style={{ maxWidth: 120 }}>
                <label className="form-label" htmlFor="monitor-method">
                  Method
                </label>
                <select
                  id="monitor-method"
                  className="form-select"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  disabled={isSubmitting}
                >
                  {HTTP_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" htmlFor="monitor-url">
                  Target Endpoint URL <span style={{ color: 'var(--color-down)' }}>*</span>
                </label>
                <div className="input-group">
                  <span className="input-group-icon">
                    <Globe size={16} />
                  </span>
                  <input
                    id="monitor-url"
                    type="url"
                    className="form-input"
                    placeholder="https://api.example.com/health"
                    required
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </div>

            {/* Check Interval & Timeout */}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="monitor-interval">
                  Check Interval (seconds)
                </label>
                <input
                  id="monitor-interval"
                  type="number"
                  className="form-input"
                  min={30}
                  max={86400}
                  required
                  value={intervalSeconds}
                  onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                  disabled={isSubmitting}
                />
                <div className="preset-pills">
                  {INTERVAL_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className={`preset-pill ${intervalSeconds === preset.value ? 'active' : ''}`}
                      onClick={() => setIntervalSeconds(preset.value)}
                      disabled={isSubmitting}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="form-hint">Minimum 30s, maximum 24h</div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="monitor-timeout">
                  Timeout (seconds)
                </label>
                <input
                  id="monitor-timeout"
                  type="number"
                  className="form-input"
                  min={1}
                  max={30}
                  required
                  value={timeoutSeconds}
                  onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                  disabled={isSubmitting}
                />
                <div className="preset-pills">
                  {TIMEOUT_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className={`preset-pill ${timeoutSeconds === preset.value ? 'active' : ''}`}
                      onClick={() => setTimeoutSeconds(preset.value)}
                      disabled={isSubmitting}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="form-hint">Must be less than interval (1-30s)</div>
              </div>
            </div>

            {/* Expected Status Codes */}
            <div className="form-group">
              <label className="form-label" htmlFor="monitor-codes">
                Expected HTTP Status Codes
              </label>
              <input
                id="monitor-codes"
                type="text"
                className="form-input"
                placeholder="200, 201, 204"
                value={expectedCodesText}
                onChange={(e) => setExpectedCodesText(e.target.value)}
                disabled={isSubmitting}
              />
              <div className="preset-pills">
                {STATUS_CODE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={`preset-pill ${expectedCodesText === preset.codes ? 'active' : ''}`}
                    onClick={() => setExpectedCodesText(preset.codes)}
                    disabled={isSubmitting}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="form-hint">Comma-separated list of expected status codes</div>
            </div>

            {/* Enabled State */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-3) var(--space-4)',
                background: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                marginTop: 'var(--space-2)',
              }}
            >
              <div>
                <div style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-sm)' }}>
                  Active Polling
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  When enabled, PulseWatch worker continuously probes this endpoint.
                </div>
              </div>

              <ToggleSwitch
                checked={enabled}
                onChange={setEnabled}
                disabled={isSubmitting}
                ariaLabel="Enable or disable monitoring"
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="spin" />
                  {isEditing ? 'Updating...' : 'Creating...'}
                </>
              ) : isEditing ? (
                'Save Changes'
              ) : (
                'Create Monitor'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
