import { useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import './AuthPage.css';

/* ── Static node data ───────────────────────────────────────────────────── */
const LEFT_NODES = [
  { name: 'API Gateway',   url: 'api.acme.io/health',  status: 'up',   uptime: 99.98, lat: '142ms' },
  { name: 'Auth Service',  url: 'auth.acme.io/ping',   status: 'up',   uptime: 100,   lat: '89ms'  },
  { name: 'Payment API',   url: 'pay.acme.io/status',  status: 'down', uptime: 96.4,  lat: '—'     },
];

const RIGHT_NODES = [
  { name: 'CDN Edge',      url: 'cdn.acme.io/__health',  status: 'up',   uptime: 100,  lat: '34ms'  },
  { name: 'DB Proxy',      url: 'db.acme.io/health',     status: 'warn', uptime: 99.1, lat: '382ms' },
  { name: 'Worker Queue',  url: 'queue.acme.io/ping',    status: 'up',   uptime: 99.9, lat: '61ms'  },
];

/* ── SVG heartbeat path helper ───────────────────────────────────────────── */
function HeartbeatSVG({ color = '#06d6a0' }) {
  return (
    <svg className="pa-hb-svg" viewBox="0 0 188 36" fill="none" aria-hidden="true">
      <path
        d="M0 18 L28 18 L36 8 L44 28 L52 4 L60 32 L68 18 L188 18"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
        className="pa-hb-path"
      />
    </svg>
  );
}

/* ── Monitor node card ────────────────────────────────────────────────────── */
function NodeCard({ node }) {
  const fillPct = node.status === 'down' ? 0 : node.uptime;
  return (
    <div className="pa-node-card">
      <div className="pa-node-header">
        <div className={`pa-node-dot ${node.status}`} aria-hidden="true" />
        <span className="pa-node-name">{node.name}</span>
      </div>
      <div className="pa-node-url">{node.url}</div>
      <div className="pa-node-bar">
        <div
          className={`pa-node-bar-fill ${node.status}`}
          style={{ width: `${fillPct}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="pa-node-stats">
        <span>{node.uptime}% uptime</span>
        <span className={node.status}>{node.lat}</span>
      </div>
    </div>
  );
}

/* ── Network SVG background ──────────────────────────────────────────────── */
function NetworkSVG() {
  /* Static nodes for the network graph */
  const nodes = [
    { x: '10%',  y: '20%' }, { x: '25%', y: '60%' }, { x: '15%', y: '80%' },
    { x: '35%',  y: '35%' }, { x: '45%', y: '70%' }, { x: '55%', y: '25%' },
    { x: '65%',  y: '55%' }, { x: '75%', y: '30%' }, { x: '80%', y: '75%' },
    { x: '90%',  y: '45%' }, { x: '50%', y: '10%' }, { x: '30%', y: '88%' },
  ];

  const edges = [
    [0,3],[3,5],[5,7],[7,9],[9,6],[6,4],[4,1],[1,2],[2,11],[11,4],[3,4],[5,6],[7,6],[0,1],[10,5],[10,7],
  ];

  return (
    <svg className="pa-bg-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <radialGradient id="paNodeGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#06d6a0" stopOpacity="0.6"/>
          <stop offset="100%" stopColor="#06d6a0" stopOpacity="0"/>
        </radialGradient>
        <linearGradient id="paEdgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#06d6a0" stopOpacity="0"/>
          <stop offset="50%" stopColor="#06d6a0" stopOpacity="0.15"/>
          <stop offset="100%" stopColor="#06d6a0" stopOpacity="0"/>
        </linearGradient>
      </defs>

      {/* Edge lines */}
      {edges.map(([a, b], i) => {
        const na = nodes[a], nb = nodes[b];
        return (
          <line
            key={i}
            x1={na.x} y1={na.y}
            x2={nb.x} y2={nb.y}
            stroke="url(#paEdgeGrad)"
            strokeWidth="0.15"
          />
        );
      })}

      {/* Animated signal dots travelling along edges */}
      {edges.slice(0, 6).map(([a, b], i) => {
        const na = nodes[a], nb = nodes[b];
        return (
          <circle key={`signal-${i}`} r="0.35" fill="#06d6a0" opacity="0.7">
            <animateMotion
              dur={`${4 + i * 1.2}s`}
              repeatCount="indefinite"
              begin={`${i * 0.8}s`}
            >
              <mpath />
              <animateMotion
                path={`M ${na.x.replace('%','')} ${na.y.replace('%','')} L ${nb.x.replace('%','')} ${nb.y.replace('%','')}`}
                dur={`${4 + i * 1.2}s`}
                repeatCount="indefinite"
                begin={`${i * 0.8}s`}
              />
            </animateMotion>
          </circle>
        );
      })}

      {/* Node dots */}
      {nodes.map((n, i) => (
        <g key={`node-${i}`}>
          <circle cx={n.x} cy={n.y} r="0.8" fill="url(#paNodeGlow)" opacity="0.6">
            <animate attributeName="opacity" values="0.4;0.8;0.4" dur={`${3 + (i % 3)}s`} repeatCount="indefinite"/>
          </circle>
          <circle cx={n.x} cy={n.y} r="0.35" fill="#06d6a0" opacity="0.7"/>
        </g>
      ))}
    </svg>
  );
}

/* ── Floating particles ───────────────────────────────────────────────────── */
function Particles() {
  const particles = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    size: 1.5 + (i % 3) * 1,
    left: `${5 + (i * 37) % 90}%`,
    top:  `${10 + (i * 53) % 80}%`,
    duration: `${8 + (i % 5) * 2.5}s`,
    delay: `${(i * 1.3) % 6}s`,
    color: i % 5 === 0 ? '#818cf8' : '#06d6a0',
    opacity: 0.25 + (i % 3) * 0.1,
  }));

  return (
    <>
      {particles.map((p) => (
        <div
          key={p.id}
          className="pa-particle"
          aria-hidden="true"
          style={{
            width: p.size,
            height: p.size,
            left: p.left,
            top: p.top,
            background: p.color,
            boxShadow: `0 0 ${p.size * 3}px ${p.color}`,
            animationDuration: p.duration,
            animationDelay: p.delay,
          }}
        />
      ))}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN EXPORTED WRAPPER
   ══════════════════════════════════════════════════════════════════════════ */
export default function AuthLayout({ children }) {
  const rootRef = useRef(null);

  /* Mouse-parallax on background glows */
  const handleMouseMove = useCallback((e) => {
    if (!rootRef.current) return;
    const { clientX: x, clientY: y } = e;
    const { innerWidth: w, innerHeight: h } = window;
    const dx = (x / w - 0.5) * 30;
    const dy = (y / h - 0.5) * 30;
    const glow1 = rootRef.current.querySelector('.pa-bg-glow-1');
    const glow2 = rootRef.current.querySelector('.pa-bg-glow-2');
    if (glow1) glow1.style.transform = `translate(${dx * 0.4}px, ${dy * 0.4}px)`;
    if (glow2) glow2.style.transform = `translate(${-dx * 0.3}px, ${-dy * 0.3}px)`;
  }, []);

  useEffect(() => {
    const mm = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mm.matches) return;
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [handleMouseMove]);

  return (
    <div className="pa-root" ref={rootRef}>
      {/* ── Background ─────────────────────────────────────────────── */}
      <div className="pa-bg" aria-hidden="true">
        <div className="pa-bg-grid" />
        <div className="pa-bg-glow-1" />
        <div className="pa-bg-glow-2" />
        <div className="pa-bg-glow-3" />
        <NetworkSVG />
        <Particles />
      </div>

      {/* ── Side monitor widgets (desktop) ─────────────────────────── */}
      <aside className="pa-side-panel left" aria-hidden="true">
        {LEFT_NODES.map((n) => <NodeCard key={n.name} node={n} />)}
        <div className="pa-heartbeat-card">
          <div className="pa-hb-label">Probe Activity</div>
          <HeartbeatSVG />
        </div>
      </aside>

      <aside className="pa-side-panel right" aria-hidden="true">
        {RIGHT_NODES.map((n) => <NodeCard key={n.name} node={n} />)}
        <div className="pa-heartbeat-card">
          <div className="pa-hb-label">Response Time</div>
          <HeartbeatSVG color="#818cf8" />
        </div>
      </aside>

      {/* ── Back to home ────────────────────────────────────────────── */}
      <Link to="/" className="pa-back-link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back to home
      </Link>

      {/* ── Auth card ───────────────────────────────────────────────── */}
      <div className="pa-card-wrap">
        {children}
      </div>
    </div>
  );
}
