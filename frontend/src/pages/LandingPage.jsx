import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import './LandingPage.css';

/* ─── Mock analytics data ─────────────────────────────────────────────────── */
const ANALYTICS_DATA = [
  { t: '00:00', uptime: 100,  lat: 142 },
  { t: '02:00', uptime: 100,  lat: 138 },
  { t: '04:00', uptime: 99.8, lat: 151 },
  { t: '06:00', uptime: 100,  lat: 134 },
  { t: '08:00', uptime: 97.2, lat: 289 },
  { t: '10:00', uptime: 94.1, lat: 412 },
  { t: '12:00', uptime: 100,  lat: 159 },
  { t: '14:00', uptime: 100,  lat: 143 },
  { t: '16:00', uptime: 99.9, lat: 136 },
  { t: '18:00', uptime: 100,  lat: 128 },
  { t: '20:00', uptime: 100,  lat: 141 },
  { t: '22:00', uptime: 100,  lat: 139 },
  { t: 'Now',   uptime: 100,  lat: 133 },
];

/* ─── Mock monitor rows ───────────────────────────────────────────────────── */
const MONITORS = [
  { name: 'API Gateway',     url: 'api.acme.io/v2/health',    status: 'up',   lat: '142ms', uptime: '99.98%' },
  { name: 'Auth Service',    url: 'auth.acme.io/ping',        status: 'up',   lat: '89ms',  uptime: '100%'   },
  { name: 'Payment API',     url: 'pay.acme.io/status',       status: 'down', lat: '—',     uptime: '96.4%'  },
  { name: 'CDN Edge',        url: 'cdn.acme.io/__health',     status: 'up',   lat: '34ms',  uptime: '100%'   },
  { name: 'Database Proxy',  url: 'db-proxy.acme.io/health',  status: 'warn', lat: '382ms', uptime: '99.1%'  },
];

/* ─── Mock reliability table ──────────────────────────────────────────────── */
const RELIABILITY = [
  { name: 'API Gateway',    uptime: '99.98%', lat: '142ms', inc: 0 },
  { name: 'Auth Service',   uptime: '100%',   lat: '89ms',  inc: 0 },
  { name: 'Payment API',    uptime: '96.4%',  lat: '—',     inc: 3 },
  { name: 'Database Proxy', uptime: '99.1%',  lat: '382ms', inc: 1 },
];

/* ─── Status cycle steps ──────────────────────────────────────────────────── */
const CYCLE_STEPS = [
  {
    key: 'healthy',
    label: 'Healthy',
    icon: '✓',
    desc: 'All probes returning 200 OK',
    time: '09:41:02',
  },
  {
    key: 'degraded',
    label: 'Degraded',
    icon: '!',
    desc: 'Response time elevated — 2× threshold',
    time: '09:44:18',
  },
  {
    key: 'down',
    label: 'Incident Created',
    icon: '✕',
    desc: '3 consecutive failures → Incident #47 opened',
    time: '09:45:30',
  },
  {
    key: 'recovered',
    label: 'Recovered',
    icon: '↑',
    desc: 'Service restored · Duration: 4m 28s',
    time: '09:49:58',
  },
];

/* ─── Custom chart tooltip ────────────────────────────────────────────────── */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(4, 8, 22, 0.95)',
      border: '1px solid rgba(6,214,160,0.2)',
      borderRadius: 8,
      padding: '8px 14px',
      fontSize: '0.78rem',
      color: '#e8eeff',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    }}>
      <div style={{ color: '#5a6a8a', marginBottom: 4 }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ color: p.color, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <span>{p.dataKey === 'uptime' ? 'Uptime' : 'Latency'}</span>
          <strong>{p.dataKey === 'uptime' ? `${p.value}%` : `${p.value}ms`}</strong>
        </div>
      ))}
    </div>
  );
}

/* ─── Animated counter hook ───────────────────────────────────────────────── */
function useCountUp(target, duration = 1800, started = false) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!started) return;
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const pct = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - pct, 3);
      setValue(Math.floor(ease * target));
      if (pct < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration, started]);
  return value;
}

/* ─── Main landing page component ────────────────────────────────────────── */
export default function LandingPage() {
  const { user, loading, isLoading } = useAuth();
  const authLoading = loading !== undefined ? loading : isLoading;
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [analyticsVisible, setAnalyticsVisible] = useState(false);
  const analyticsRef = useRef(null);
  const sectionsRef = useRef([]);
  const tiltRefs = useRef([]);

  /* Navbar scroll effect */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* Scroll-reveal via IntersectionObserver */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add('lp-visible');
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
    );
    document.querySelectorAll('.lp-reveal').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  /* Analytics section visibility (for chart + counter animation) */
  useEffect(() => {
    if (!analyticsRef.current) return;
    const observer = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setAnalyticsVisible(true); },
      { threshold: 0.2 }
    );
    observer.observe(analyticsRef.current);
    return () => observer.disconnect();
  }, []);

  /* Status cycle animation */
  useEffect(() => {
    const id = setInterval(() => {
      setActiveStep((s) => (s + 1) % CYCLE_STEPS.length);
    }, 2200);
    return () => clearInterval(id);
  }, []);

  /* Subtle card tilt on mouse-move */
  const handleTilt = useCallback((e, el) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / rect.width;
    const dy = (e.clientY - cy) / rect.height;
    el.style.transform = `perspective(1200px) rotateY(${dx * 3}deg) rotateX(${-dy * 3}deg)`;
  }, []);

  const handleTiltReset = useCallback((el) => {
    if (!el) return;
    el.style.transform = 'perspective(1200px) rotateY(0deg) rotateX(0deg)';
    el.style.transition = 'transform 0.5s ease';
    setTimeout(() => { if (el) el.style.transition = ''; }, 500);
  }, []);

  /* Counter animations */
  const uptimeCnt = useCountUp(9998, 1600, analyticsVisible);
  const latencyCnt = useCountUp(142, 1400, analyticsVisible);
  const monitorsCnt = useCountUp(5, 1000, analyticsVisible);
  const incidentsCnt = useCountUp(2, 800, analyticsVisible);

  if (!authLoading && user) {
    return <Navigate to="/dashboard" replace />;
  }

  /* ── Render ── */
  return (
    <div className="lp-root">
      {/* Atmospheric layers */}
      <div className="lp-bg-atmosphere" aria-hidden="true" />
      <div className="lp-bg-grid" aria-hidden="true" />

      {/* ── NAVBAR ─────────────────────────────────────────────────────────── */}
      <nav className={`lp-navbar${scrolled ? ' scrolled' : ''}`} role="navigation" aria-label="Main navigation">
        <Link to="/" className="lp-navbar-logo" aria-label="PulseWatch home">
          <div className="lp-logo-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" fill="rgba(255,255,255,0.3)"/>
              <path d="M12 6v6l4 2-1.5 2.6L9 14V6z" fill="white"/>
            </svg>
          </div>
          <span className="lp-logo-text">Pulse<span>Watch</span></span>
        </Link>

        <nav className="lp-navbar-nav" aria-label="Page sections">
          <a href="#monitoring" className="lp-nav-link">Monitoring</a>
          <a href="#incidents"  className="lp-nav-link">Incidents</a>
          <a href="#analytics"  className="lp-nav-link">Analytics</a>
        </nav>

        <div className="lp-navbar-actions">
          <button className="lp-btn lp-btn-ghost" onClick={() => navigate('/login')} id="nav-login-btn">
            Log In
          </button>
          <button className="lp-btn lp-btn-primary" onClick={() => navigate('/register')} id="nav-signup-btn">
            Get Started
          </button>
        </div>
      </nav>

      {/* ── CONTENT ─────────────────────────────────────────────────────────── */}
      <div className="lp-content">
        <main className="lp-page" id="main-content">

          {/* ════════════════════════════════════════
              1. HERO CARD
          ════════════════════════════════════════ */}
          <section
            className="lp-section-card lp-tilt"
            aria-labelledby="hero-headline"
            ref={(el) => { tiltRefs.current[0] = el; }}
            onMouseMove={(e) => handleTilt(e, tiltRefs.current[0])}
            onMouseLeave={() => handleTiltReset(tiltRefs.current[0])}
          >
            <div className="lp-card-accent-line" aria-hidden="true" />
            <div className="lp-hero">
              {/* Left copy */}
              <div className="lp-hero-left">
                <div className="lp-reveal lp-hero-eyebrow" role="text">
                  <span className="lp-hero-eyebrow-dot" aria-hidden="true" />
                  Real-time uptime monitoring
                </div>

                <h1 className="lp-reveal lp-reveal-delay-1 lp-hero-headline" id="hero-headline">
                  KNOW WHEN<br />
                  YOUR <span className="lp-accent">SYSTEM</span><br />
                  GOES DOWN.
                </h1>

                <p className="lp-reveal lp-reveal-delay-2 lp-hero-sub">
                  PulseWatch continuously monitors your websites and APIs — detecting outages,
                  tracking performance, and alerting you the moment something goes wrong.
                </p>

                <div className="lp-reveal lp-reveal-delay-3 lp-hero-actions">
                  <button
                    className="lp-btn lp-btn-primary lp-btn-lg"
                    onClick={() => navigate('/register')}
                    id="hero-start-btn"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="3" fill="currentColor"/>
                      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1l2.1-2.1M17 7l2.1-2.1"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                    START MONITORING
                  </button>
                  <button
                    className="lp-btn lp-btn-outline lp-btn-lg"
                    onClick={() => navigate('/login')}
                    id="hero-dashboard-btn"
                  >
                    VIEW DASHBOARD
                  </button>
                </div>

                <div className="lp-reveal lp-reveal-delay-4 lp-hero-meta" role="list" aria-label="Key metrics">
                  <div className="lp-hero-stat" role="listitem">
                    <span className="lp-hero-stat-value">30s</span>
                    <span className="lp-hero-stat-label">Check Interval</span>
                  </div>
                  <div className="lp-hero-stat-divider" aria-hidden="true" />
                  <div className="lp-hero-stat" role="listitem">
                    <span className="lp-hero-stat-value">99.9%</span>
                    <span className="lp-hero-stat-label">Platform Uptime</span>
                  </div>
                  <div className="lp-hero-stat-divider" aria-hidden="true" />
                  <div className="lp-hero-stat" role="listitem">
                    <span className="lp-hero-stat-value">&lt;2s</span>
                    <span className="lp-hero-stat-label">Incident Alert</span>
                  </div>
                </div>
              </div>

              {/* Right — 3D orb visual */}
              <div className="lp-hero-right" aria-hidden="true">
                <div className="lp-hero-tag-group">
                  <span className="lp-hero-tag">UPTIME</span>
                  <span className="lp-hero-tag">LATENCY</span>
                  <span className="lp-hero-tag">INCIDENTS</span>
                </div>

                <div className="lp-hero-visual-wrap">
                  {/* Rings */}
                  <div className="lp-hero-glow-ring" />
                  <div className="lp-hero-glow-ring lp-hero-glow-ring-2" />
                  <div className="lp-hero-glow-ring lp-hero-glow-ring-3" />

                  {/* Orbit dots */}
                  <div className="lp-orbit-dot" style={{ top: '50%', left: '50%', marginTop: -4, marginLeft: -4 }} />
                  <div className="lp-orbit-dot lp-orbit-dot-2" style={{ top: '50%', left: '50%', marginTop: -2.5, marginLeft: -2.5 }} />
                  <div className="lp-orbit-dot lp-orbit-dot-3" style={{ top: '50%', left: '50%', marginTop: -3, marginLeft: -3 }} />

                  {/* 3D orb */}
                  <div className="lp-orb-3d">
                    <div className="lp-orb-inner">
                      <svg className="lp-orb-svg" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg">
                        {/* Equator */}
                        <ellipse cx="90" cy="90" rx="88" ry="28" stroke="rgba(6,214,160,0.25)" strokeWidth="0.8"/>
                        {/* Mid latitude */}
                        <ellipse cx="90" cy="90" rx="72" ry="50" stroke="rgba(6,214,160,0.18)" strokeWidth="0.8"/>
                        {/* Tropic */}
                        <ellipse cx="90" cy="90" rx="46" ry="68" stroke="rgba(6,214,160,0.14)" strokeWidth="0.8"/>
                        {/* Meridians */}
                        <path d="M90 2 Q140 90 90 178" stroke="rgba(6,214,160,0.2)" strokeWidth="0.8" fill="none"/>
                        <path d="M90 2 Q40 90 90 178"  stroke="rgba(6,214,160,0.2)" strokeWidth="0.8" fill="none"/>
                        <line x1="2" y1="90" x2="178" y2="90" stroke="rgba(6,214,160,0.18)" strokeWidth="0.6"/>
                        {/* Glow dot on top */}
                        <circle cx="90" cy="20" r="3" fill="rgba(6,214,160,0.7)" filter="url(#glow)"/>
                        <circle cx="90" cy="160" r="2" fill="rgba(99,102,241,0.6)"/>
                        {/* Heartbeat pulse on equator */}
                        <path d="M40 90 L55 90 L60 78 L65 102 L72 82 L78 98 L84 90 L140 90"
                          stroke="#06d6a0" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"
                          opacity="0.9"/>
                        <defs>
                          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="3" result="blur"/>
                            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                          </filter>
                        </defs>
                      </svg>
                    </div>
                  </div>

                  {/* Floating status labels */}
                  <FloatingLabel label="API · 142ms" color="#06d6a0" top="18%" right="5%" delay="0s" />
                  <FloatingLabel label="UP · 99.9%"  color="#10b981" top="65%" right="3%" delay="1.2s" />
                  <FloatingLabel label="DOWN · 0"    color="#ef4444" top="40%" left="2%"  delay="0.6s" />
                </div>
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════
              2. MONITORING CARD
          ════════════════════════════════════════ */}
          <section
            id="monitoring"
            className="lp-section-card lp-reveal"
            aria-labelledby="monitor-headline"
            ref={(el) => { tiltRefs.current[1] = el; }}
            onMouseMove={(e) => handleTilt(e, tiltRefs.current[1])}
            onMouseLeave={() => handleTiltReset(tiltRefs.current[1])}
          >
            <div className="lp-card-accent-line" aria-hidden="true" />
            <div className="lp-monitor">
              {/* Left copy */}
              <div className="lp-monitor-left">
                <span className="lp-section-label lp-reveal lp-reveal-delay-1">Uptime Monitoring</span>
                <h2 className="lp-reveal lp-reveal-delay-2 lp-section-headline" id="monitor-headline">
                  MONITOR<br />
                  EVERYTHING.<br />
                  <span style={{ color: 'var(--lp-cyan)' }}>MISS NOTHING.</span>
                </h2>
                <p className="lp-reveal lp-reveal-delay-3 lp-section-sub">
                  PulseWatch checks your endpoints every 30 seconds from multiple locations —
                  HTTP status, response time, SSL certificates — giving you a complete picture
                  of your infrastructure's health.
                </p>
                <ul className="lp-reveal lp-reveal-delay-4 lp-feature-list" aria-label="Monitoring features">
                  {[
                    'HTTP/HTTPS endpoint monitoring',
                    'Real-time response latency tracking',
                    'Consecutive-failure outage detection',
                    'SSL certificate expiry alerts',
                    'Granular uptime percentage history',
                  ].map((f) => (
                    <li key={f} className="lp-feature-item">
                      <span className="lp-feature-check" aria-hidden="true">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5.5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="lp-reveal lp-reveal-delay-5">
                  <button className="lp-btn lp-btn-primary" onClick={() => navigate('/register')} id="monitor-cta-btn">
                    Set Up Monitors →
                  </button>
                </div>
              </div>

              {/* Right — mock dashboard widget */}
              <div className="lp-monitor-right" aria-label="Live monitoring dashboard preview">
                <div className="lp-monitor-widget lp-reveal lp-reveal-delay-2" role="presentation">
                  <div className="lp-widget-header">
                    <span className="lp-widget-title">Active Monitors</span>
                    <span className="lp-live-badge">
                      <span className="lp-live-dot" aria-hidden="true" />
                      Live
                    </span>
                  </div>

                  {/* Column headers */}
                  <div className="lp-monitor-row" style={{ padding: '8px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <div />
                    <div style={{ fontSize: '0.65rem', color: 'var(--lp-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Name</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--lp-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right' }}>Latency</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--lp-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'right' }}>Uptime</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--lp-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Status</div>
                  </div>

                  <div className="lp-monitor-rows" role="list" aria-label="Monitor list">
                    {MONITORS.map((m) => (
                      <div key={m.name} className="lp-monitor-row" role="listitem">
                        <span className={`lp-row-status-dot ${m.status}`} aria-label={`Status: ${m.status}`} />
                        <div>
                          <div className="lp-row-name">{m.name}</div>
                          <div className="lp-row-url">{m.url}</div>
                        </div>
                        <div className={`lp-row-latency${m.status === 'warn' ? ' ' : ''}`}
                          style={m.status === 'warn' ? { color: 'var(--lp-warn)' } : {}}>
                          {m.lat}
                        </div>
                        <div className={`lp-row-uptime${m.status === 'down' ? ' warn' : ''}`}>
                          {m.uptime}
                        </div>
                        <span className={`lp-row-badge ${m.status}`}>
                          {m.status === 'up' ? '200 OK' : m.status === 'down' ? '503' : 'SLOW'}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Probe activity bar */}
                  <div className="lp-probe-bar" aria-label="Probe activity timeline" role="img">
                    <span className="lp-probe-label">Probes</span>
                    {Array.from({ length: 25 }).map((_, i) => (
                      <div key={i} className="lp-probe-tick" aria-hidden="true" />
                    ))}
                  </div>
                </div>

                {/* Mini stat row */}
                <div className="lp-reveal lp-reveal-delay-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {[
                    { label: 'Monitors Active', value: '5' },
                    { label: 'Checks Today',    value: '14.4k' },
                    { label: 'Avg Response',    value: '197ms' },
                  ].map((s) => (
                    <div key={s.label} style={{
                      background: 'rgba(255,255,255,0.025)',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: 10,
                      padding: '12px 14px',
                    }}>
                      <div style={{ fontSize: '0.65rem', color: 'var(--lp-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                        {s.label}
                      </div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--lp-cyan)', fontFamily: 'var(--lp-mono)', letterSpacing: '-0.02em' }}>
                        {s.value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════
              3. INCIDENT CARD
          ════════════════════════════════════════ */}
          <section
            id="incidents"
            className="lp-section-card lp-reveal"
            aria-labelledby="incident-headline"
            ref={(el) => { tiltRefs.current[2] = el; }}
            onMouseMove={(e) => handleTilt(e, tiltRefs.current[2])}
            onMouseLeave={() => handleTiltReset(tiltRefs.current[2])}
          >
            <div className="lp-card-accent-line" style={{ background: 'linear-gradient(90deg, transparent, rgba(239,68,68,0.35), transparent)' }} aria-hidden="true" />
            <div className="lp-incident">
              {/* Left — status cycle */}
              <div className="lp-incident-left">
                <span className="lp-section-label lp-reveal lp-reveal-delay-1" style={{ color: '#f87171' }}>
                  <span style={{ background: '#f87171' }} />
                  Incident Detection
                </span>
                <h2 className="lp-reveal lp-reveal-delay-2 lp-section-headline" id="incident-headline">
                  THREE FAILURES.<br />
                  ONE CLEAR<br />
                  <span style={{ color: '#f87171' }}>INCIDENT.</span>
                </h2>
                <p className="lp-reveal lp-reveal-delay-3 lp-section-sub">
                  PulseWatch uses consecutive-failure detection — requiring 3 back-to-back probe
                  failures before opening an incident. No false alarms. No alert fatigue.
                  Just precise outage detection.
                </p>

                {/* Animated status cycle */}
                <div className="lp-reveal lp-reveal-delay-4">
                  <div className="lp-status-cycle" role="list" aria-label="Incident lifecycle">
                    {CYCLE_STEPS.map((step, i) => (
                      <div
                        key={step.key}
                        className={`lp-status-step${activeStep === i ? ' active' : ''}`}
                        role="listitem"
                        aria-current={activeStep === i ? 'step' : undefined}
                      >
                        {i < CYCLE_STEPS.length - 1 && <div className="lp-status-step-line" aria-hidden="true" />}
                        <span className={`lp-status-step-icon ${step.key}`} aria-hidden="true">
                          {step.icon}
                        </span>
                        <div className="lp-status-step-info">
                          <span className="lp-status-step-name">{step.label}</span>
                          <span className="lp-status-step-desc">{step.desc}</span>
                        </div>
                        <span className="lp-status-step-time" aria-label={`Time: ${step.time}`}>{step.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right — incident card demo */}
              <div className="lp-incident-right">
                <div className="lp-reveal lp-reveal-delay-2 lp-incident-card-demo" role="presentation" aria-label="Example incident card">
                  <div className="lp-incident-header-row">
                    <span className="lp-incident-badge-open" aria-label="Status: Open">● OPEN</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--lp-text-muted)', fontFamily: 'var(--lp-mono)' }}>#INC-0047</span>
                  </div>

                  <div className="lp-incident-name">Payment API — Service Unreachable</div>

                  {/* 3 consecutive failures */}
                  <div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--lp-text-muted)', marginBottom: 10 }}>
                      Consecutive failures that triggered this incident:
                    </div>
                    <div className="lp-failure-dots">
                      <span className="lp-failure-dot" aria-label="Failure 1">✕</span>
                      <span className="lp-failure-arrow" aria-hidden="true">›</span>
                      <span className="lp-failure-dot" aria-label="Failure 2">✕</span>
                      <span className="lp-failure-arrow" aria-hidden="true">›</span>
                      <span className="lp-failure-dot" aria-label="Failure 3">✕</span>
                      <span className="lp-failure-arrow" aria-hidden="true">→</span>
                      <span className="lp-incident-created-badge" aria-label="Incident created">INCIDENT CREATED</span>
                    </div>
                  </div>

                  <div className="lp-incident-meta-grid" role="list" aria-label="Incident details">
                    {[
                      { label: 'Started',      value: '09:45:30' },
                      { label: 'Duration',     value: '4m 28s'   },
                      { label: 'HTTP Status',  value: '503'       },
                      { label: 'Monitor',      value: 'Payment API' },
                    ].map((item) => (
                      <div key={item.label} className="lp-incident-meta-item" role="listitem">
                        <span className="lp-incident-meta-label">{item.label}</span>
                        <span className="lp-incident-meta-value">{item.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Recovery bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--lp-text-muted)' }}>Recovery progress</span>
                      <span style={{ fontSize: '0.7rem', color: '#34d399', fontFamily: 'var(--lp-mono)' }}>RESOLVED ✓</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 9999, background: 'rgba(16,185,129,0.1)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: activeStep === 3 ? '100%' : `${[20, 50, 80, 100][activeStep]}%`,
                        background: activeStep === 3 ? '#10b981' : activeStep === 2 ? '#ef4444' : '#f59e0b',
                        borderRadius: 9999,
                        transition: 'width 1s ease, background 0.5s ease',
                        boxShadow: activeStep === 3 ? '0 0 8px rgba(16,185,129,0.4)' : 'none',
                      }} />
                    </div>
                  </div>
                </div>

                {/* Callout */}
                <div className="lp-reveal lp-reveal-delay-3 lp-consec-callout">
                  <strong>3 consecutive failures required</strong> before PulseWatch opens an incident —
                  eliminating transient network blips that would otherwise flood your inbox.
                </div>

                {/* Bottom CTA */}
                <div className="lp-reveal lp-reveal-delay-4">
                  <button className="lp-btn lp-btn-outline" onClick={() => navigate('/register')} id="incident-cta-btn"
                    style={{ '--lp-btn-outline-border': 'rgba(239,68,68,0.3)' }}>
                    See Incident Dashboard →
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════
              4. ANALYTICS CARD
          ════════════════════════════════════════ */}
          <section
            id="analytics"
            className="lp-section-card lp-reveal"
            aria-labelledby="analytics-headline"
            ref={(el) => { analyticsRef.current = el; tiltRefs.current[3] = el; }}
            onMouseMove={(e) => handleTilt(e, tiltRefs.current[3])}
            onMouseLeave={() => handleTiltReset(tiltRefs.current[3])}
          >
            <div className="lp-card-accent-line" aria-hidden="true" />
            <div className="lp-analytics">
              {/* Left — KPIs */}
              <div className="lp-analytics-left">
                <span className="lp-section-label lp-reveal lp-reveal-delay-1">Analytics & Intelligence</span>
                <h2 className="lp-reveal lp-reveal-delay-2 lp-section-headline" id="analytics-headline">
                  FULL<br />
                  MONITORING<br />
                  <span style={{ color: 'var(--lp-cyan)' }}>INTELLIGENCE.</span>
                </h2>
                <p className="lp-reveal lp-reveal-delay-3 lp-section-sub">
                  Track uptime, latency trends, incident frequency and reliability scores
                  across all your monitors. Understand the health of your system at a glance.
                </p>

                <div className="lp-reveal lp-reveal-delay-4 lp-kpi-grid" role="list" aria-label="Key performance indicators">
                  <div className="lp-kpi-card" role="listitem">
                    <div className="lp-kpi-label">Uptime</div>
                    <div className="lp-kpi-value green" aria-live="polite">
                      {analyticsVisible ? `${(uptimeCnt / 100).toFixed(2)}%` : '0%'}
                    </div>
                    <div className="lp-kpi-sub">Last 30 days</div>
                  </div>
                  <div className="lp-kpi-card" role="listitem">
                    <div className="lp-kpi-label">Avg Latency</div>
                    <div className="lp-kpi-value cyan" aria-live="polite">
                      {analyticsVisible ? `${latencyCnt}ms` : '0ms'}
                    </div>
                    <div className="lp-kpi-sub">P50 response time</div>
                  </div>
                  <div className="lp-kpi-card" role="listitem">
                    <div className="lp-kpi-label">Monitors</div>
                    <div className="lp-kpi-value blue" aria-live="polite">
                      {analyticsVisible ? monitorsCnt : '0'}
                    </div>
                    <div className="lp-kpi-sub">Active endpoints</div>
                  </div>
                  <div className="lp-kpi-card" role="listitem">
                    <div className="lp-kpi-label">Incidents</div>
                    <div className="lp-kpi-value red" aria-live="polite">
                      {analyticsVisible ? incidentsCnt : '0'}
                    </div>
                    <div className="lp-kpi-sub">Open right now</div>
                  </div>
                </div>

                <div className="lp-reveal lp-reveal-delay-5">
                  <button className="lp-btn lp-btn-primary" onClick={() => navigate('/register')} id="analytics-cta-btn">
                    Explore Analytics →
                  </button>
                </div>
              </div>

              {/* Right — Charts */}
              <div className="lp-analytics-right">
                <div className="lp-reveal lp-reveal-delay-2">
                  <div className="lp-chart-header">
                    <span className="lp-chart-title">Uptime & Latency · Last 24h</span>
                    <div className="lp-chart-legend" aria-label="Chart legend">
                      <span className="lp-legend-item">
                        <span className="lp-legend-dot" style={{ background: '#06d6a0' }} aria-hidden="true" />
                        Uptime %
                      </span>
                      <span className="lp-legend-item">
                        <span className="lp-legend-dot" style={{ background: '#818cf8' }} aria-hidden="true" />
                        Latency ms
                      </span>
                    </div>
                  </div>

                  <div className="lp-chart-wrap" aria-label="Area chart showing uptime and latency over time">
                    {analyticsVisible && (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={ANALYTICS_DATA} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
                          <defs>
                            <linearGradient id="gradUptime" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%"   stopColor="#06d6a0" stopOpacity={0.25} />
                              <stop offset="100%" stopColor="#06d6a0" stopOpacity={0}    />
                            </linearGradient>
                            <linearGradient id="gradLatency" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%"   stopColor="#818cf8" stopOpacity={0.25} />
                              <stop offset="100%" stopColor="#818cf8" stopOpacity={0}    />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                          <XAxis
                            dataKey="t"
                            tick={{ fill: '#5a6a8a', fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            yAxisId="left"
                            domain={[90, 100]}
                            tick={{ fill: '#5a6a8a', fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => `${v}%`}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            domain={[0, 500]}
                            tick={{ fill: '#5a6a8a', fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => `${v}ms`}
                          />
                          <Tooltip content={<ChartTooltip />} />
                          <Area
                            yAxisId="left"
                            type="monotone"
                            dataKey="uptime"
                            stroke="#06d6a0"
                            strokeWidth={2}
                            fill="url(#gradUptime)"
                            dot={false}
                            isAnimationActive={true}
                            animationDuration={1400}
                          />
                          <Area
                            yAxisId="right"
                            type="monotone"
                            dataKey="lat"
                            stroke="#818cf8"
                            strokeWidth={2}
                            fill="url(#gradLatency)"
                            dot={false}
                            isAnimationActive={true}
                            animationDuration={1800}
                            animationBegin={200}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Reliability table */}
                <div className="lp-reveal lp-reveal-delay-3 lp-reliability-table" role="table" aria-label="Monitor reliability summary">
                  <div className="lp-rel-row header" role="row">
                    <div className="lp-rel-header-cell" role="columnheader">Monitor</div>
                    <div className="lp-rel-header-cell" style={{ textAlign: 'right' }} role="columnheader">Uptime</div>
                    <div className="lp-rel-header-cell" style={{ textAlign: 'right' }} role="columnheader">Latency</div>
                    <div className="lp-rel-header-cell" style={{ textAlign: 'center' }} role="columnheader">Incidents</div>
                  </div>
                  {RELIABILITY.map((r) => (
                    <div key={r.name} className="lp-rel-row" role="row">
                      <div className="lp-rel-name" role="cell">{r.name}</div>
                      <div className="lp-rel-uptime" role="cell">{r.uptime}</div>
                      <div className="lp-rel-latency" role="cell">{r.lat}</div>
                      <div className="lp-rel-incidents" role="cell">{r.inc || '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════
              5. FINAL CTA
          ════════════════════════════════════════ */}
          <section
            className="lp-section-card lp-cta lp-reveal"
            aria-labelledby="cta-headline"
          >
            <div className="lp-card-accent-line" aria-hidden="true" />

            <div className="lp-cta-eyebrow" aria-hidden="true">
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--lp-cyan)', display: 'inline-block' }} />
              Get Started For Free
            </div>

            <h2 className="lp-cta-headline" id="cta-headline">
              YOUR APPLICATIONS<br />
              SHOULD NEVER <span className="lp-accent">FAIL</span><br />
              SILENTLY.
            </h2>

            <p className="lp-cta-sub">
              Start monitoring in under 2 minutes. Add your first endpoint, set your alert thresholds,
              and let PulseWatch watch while you focus on building.
            </p>

            <div className="lp-cta-actions">
              <button
                className="lp-btn lp-btn-primary lp-btn-lg"
                onClick={() => navigate('/register')}
                id="cta-register-btn"
              >
                Register
              </button>
              <button className="lp-btn lp-btn-outline lp-btn-lg" onClick={() => navigate('/login')} id="cta-login-btn">
                Log In
              </button>
            </div>

            {/* Trust indicators */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 32,
              marginTop: 48,
              flexWrap: 'wrap',
            }} role="list" aria-label="Trust indicators">
              {[
                { icon: '🔒', text: 'No credit card required' },
                { icon: '⚡', text: 'Up in under 2 minutes' },
                { icon: '🛡️', text: 'Free tier always available' },
              ].map((t) => (
                <div key={t.text} style={{ display: 'flex', alignItems: 'center', gap: 8 }} role="listitem">
                  <span style={{ fontSize: '1rem' }} aria-hidden="true">{t.icon}</span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--lp-text-muted)' }}>{t.text}</span>
                </div>
              ))}
            </div>
          </section>

        </main>

        {/* ── FOOTER ──────────────────────────────────────────────────────── */}
        <footer className="lp-footer" role="contentinfo">
          <div className="lp-footer-brand">
            <div className="lp-logo-icon" style={{ width: 28, height: 28 }} aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" fill="rgba(255,255,255,0.3)"/>
                <path d="M12 6v6l4 2-1.5 2.6L9 14V6z" fill="white"/>
              </svg>
            </div>
            <span className="lp-footer-brand-name">PulseWatch</span>
          </div>

          <nav className="lp-footer-links" aria-label="Footer navigation">
            <a href="#monitoring" className="lp-footer-link">Monitoring</a>
            <a href="#incidents"  className="lp-footer-link">Incidents</a>
            <a href="#analytics"  className="lp-footer-link">Analytics</a>
            <button className="lp-footer-link" onClick={() => navigate('/login')}>Sign In</button>
            <button className="lp-footer-link" onClick={() => navigate('/register')}>Register</button>
          </nav>

          <span className="lp-footer-copy">
            © {new Date().getFullYear()} PulseWatch. Built for developers.
          </span>
        </footer>
      </div>
    </div>
  );
}

/* ─── Floating label helper component ────────────────────────────────────── */
function FloatingLabel({ label, color, top, right, left, delay }) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top,
        right,
        left,
        background: 'rgba(4, 8, 22, 0.85)',
        border: `1px solid ${color}33`,
        borderRadius: 6,
        padding: '4px 10px',
        fontSize: '0.68rem',
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600,
        color,
        whiteSpace: 'nowrap',
        boxShadow: `0 0 12px ${color}22`,
        animation: `lp-float 6s ease-in-out ${delay} infinite`,
        zIndex: 2,
      }}
    >
      {label}
    </div>
  );
}
