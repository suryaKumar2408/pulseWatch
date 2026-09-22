export function SkeletonBlock({ height = '16px', width = '100%', style = {} }) {
  return <div className="skeleton" style={{ height, width, ...style }} />;
}

export function StatCardSkeleton() {
  return (
    <div className="stat-card">
      <SkeletonBlock height="12px" width="55%" style={{ marginBottom: 'var(--space-3)' }} />
      <SkeletonBlock height="32px" width="40%" style={{ marginBottom: 'var(--space-2)' }} />
      <SkeletonBlock height="10px" width="30%" />
    </div>
  );
}

export function TableRowSkeleton({ columns = 5 }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, idx) => (
        <td key={idx}>
          <SkeletonBlock
            height="14px"
            width={idx === 0 ? '140px' : idx === 1 ? '200px' : '65px'}
            style={{ borderRadius: idx === 2 ? 'var(--radius-full)' : undefined }}
          />
        </td>
      ))}
    </tr>
  );
}

export function PulseSpinner({ size = 20 }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        border: '2px solid var(--color-border)',
        borderTopColor: 'var(--color-brand)',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        display: 'inline-block',
      }}
      role="status"
      aria-label="Loading"
    />
  );
}
