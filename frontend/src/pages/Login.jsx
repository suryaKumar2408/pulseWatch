import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import AuthLayout from './AuthLayout';

export default function Login() {
  /* ── Existing state & logic — UNCHANGED ─────────────────────────── */
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [succeeded, setSucceeded]       = useState(false);

  const { login }    = useAuth();
  const navigate     = useNavigate();
  const location     = useLocation();
  const destination  = location.state?.from?.pathname || '/dashboard';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (!email.trim() || !password) {
      setErrorMessage('Please fill in both email and password.');
      return;
    }

    try {
      setIsSubmitting(true);
      await login(email.trim(), password);
      setSucceeded(true);
      setTimeout(() => navigate(destination, { replace: true }), 600);
    } catch (err) {
      const serverMessage =
        err.response?.data?.error?.message ||
        err.response?.data?.message ||
        'Failed to sign in. Please verify your credentials.';
      setErrorMessage(serverMessage);
      setIsSubmitting(false);
    }
  };
  /* ─────────────────────────────────────────────────────────────────── */

  return (
    <AuthLayout>
      <div className="pa-card" role="main">
        {/* Success overlay */}
        {succeeded && (
          <div className="pa-success-overlay" aria-live="polite">
            <div className="pa-success-icon">
              <CheckCircle size={22} />
            </div>
            <span className="pa-success-text">Signed in — redirecting…</span>
          </div>
        )}

        {/* Header */}
        <div className="pa-card-header">
          <Link to="/" className="pa-logo" aria-label="PulseWatch home">
            <div className="pa-logo-icon" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" fill="rgba(255,255,255,0.3)"/>
                <path d="M12 6v6l4 2-1.5 2.6L9 14V6z" fill="white"/>
              </svg>
            </div>
            <span className="pa-logo-name">Pulse<span>Watch</span></span>
          </Link>

          <h1 className="pa-card-title">Welcome back</h1>
          <p className="pa-card-subtitle">Sign in to your observability dashboard</p>
        </div>

        {/* Error */}
        {errorMessage && (
          <div className="pa-error" role="alert" aria-live="assertive">
            <AlertCircle size={15} className="pa-error-icon" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Form */}
        <form className="pa-form" onSubmit={handleSubmit} noValidate>
          {/* Email */}
          <div className="pa-field">
            <label className="pa-label" htmlFor="login-email">Email Address</label>
            <div className="pa-input-wrap">
              <span className="pa-input-icon"><Mail size={15} /></span>
              <input
                id="login-email"
                type="email"
                className="pa-input"
                placeholder="developer@pulsewatch.io"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting || succeeded}
              />
            </div>
          </div>

          {/* Password */}
          <div className="pa-field">
            <label className="pa-label" htmlFor="login-password">Password</label>
            <div className="pa-input-wrap">
              <span className="pa-input-icon"><Lock size={15} /></span>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="pa-input"
                placeholder="••••••••"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isSubmitting || succeeded}
              />
              <button
                type="button"
                className="pa-input-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="pa-submit-btn"
            disabled={isSubmitting || succeeded}
            id="login-submit-btn"
          >
            {isSubmitting ? (
              <>
                <span className="pa-spinner" aria-hidden="true" />
                Signing in…
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="pa-card-footer">
          Don&apos;t have an account?{' '}
          <Link to="/register">Create one</Link>
        </div>
      </div>
    </AuthLayout>
  );
}
