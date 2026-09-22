import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, Lock, Mail, Eye, EyeOff, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!email.trim() || !password) {
      setErrorMessage('Please fill in all required fields.');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    try {
      setIsSubmitting(true);
      await register(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      const serverMessage =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        'Failed to register account. Please try again.';
      setErrorMessage(serverMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="auth-header">
          <div className="brand" style={{ justifyContent: 'center', marginBottom: 'var(--space-2)' }}>
            <div className="brand-logo">
              <Activity size={20} />
            </div>
            <span className="brand-name">PulseWatch</span>
          </div>
          <h1 className="auth-title">Create an account</h1>
          <p className="auth-subtitle">Get started with real-time uptime monitoring</p>
        </div>

        {errorMessage && (
          <div
            className="alert alert-danger"
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-4)',
              fontSize: 'var(--text-sm)',
              padding: 'var(--space-3)'
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="register-email">
              Email Address
            </label>
            <div className="input-group">
              <span className="input-group-icon">
                <Mail size={16} />
              </span>
              <input
                id="register-email"
                type="email"
                className="form-input"
                placeholder="developer@pulsewatch.io"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="register-password">
              Password <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>(min. 8 characters)</span>
            </label>
            <div className="input-group">
              <span className="input-group-icon">
                <Lock size={16} />
              </span>
              <input
                id="register-password"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                placeholder="••••••••"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting}
              />
              <button
                type="button"
                className="input-icon-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 'var(--space-6)' }}>
            <label className="form-label" htmlFor="register-confirm-password">
              Confirm Password
            </label>
            <div className="input-group">
              <span className="input-group-icon">
                <Lock size={16} />
              </span>
              <input
                id="register-confirm-password"
                type={showPassword ? 'text' : 'password'}
                className="form-input"
                placeholder="••••••••"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isSubmitting}
              />
              {password && confirmPassword && password === confirmPassword && (
                <span className="input-icon-btn" style={{ color: 'var(--color-success)', cursor: 'default' }}>
                  <CheckCircle2 size={16} />
                </span>
              )}
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="spin" />
                Creating account...
              </>
            ) : (
              'Create Account'
            )}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--color-brand-hover)', fontWeight: 500 }}>
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
