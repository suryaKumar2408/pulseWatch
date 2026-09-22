import { AlertCircle, Monitor, BarChart3, Settings } from 'lucide-react';
import EmptyState from '../components/ui/EmptyState';

const placeholders = {
  '/monitors':  { icon: Monitor,    title: 'Monitors',   desc: 'Configure, enable/disable, and organize monitored targets.' },
  '/incidents': { icon: AlertCircle, title: 'Incidents', desc: 'Track and review active outages and historical resolutions.' },
  '/analytics': { icon: BarChart3,  title: 'Analytics',  desc: 'P95/P99 response time percentiles and uptime aggregations.' },
  '/settings':  { icon: Settings,   title: 'Settings',   desc: 'Account preferences, API keys, and notification channels.' },
};

export default function PlaceholderPage({ path }) {
  const { icon: Icon, title, desc } = placeholders[path] || {
    icon: AlertCircle,
    title: 'Coming Soon',
    desc: 'This page is not yet implemented.',
  };

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{desc}</p>
        </div>
      </div>

      <div className="card">
        <EmptyState
          icon={Icon}
          title={`${title} Module`}
          description="This section is part of the planned build sequence and will be unlocked in the upcoming stage."
        />
      </div>
    </div>
  );
}
