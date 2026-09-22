import { StatCardSkeleton } from './LoadingSkeleton';

export default function StatCard({ label, value, sub, icon: Icon, loading = false, statusColor }) {
  if (loading) {
    return <StatCardSkeleton />;
  }

  return (
    <div className="stat-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="stat-label">{label}</div>
          <div
            className="stat-value"
            style={{ color: statusColor ? `var(--color-${statusColor})` : undefined }}
          >
            {value ?? '—'}
          </div>
          {sub && <div className="stat-sub">{sub}</div>}
        </div>
        {Icon && (
          <div
            style={{
              padding: 'var(--space-2)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: statusColor ? `var(--color-${statusColor})` : 'var(--color-text-secondary)',
            }}
          >
            <Icon size={18} />
          </div>
        )}
      </div>
    </div>
  );
}
