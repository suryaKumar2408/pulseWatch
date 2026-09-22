export default function EmptyState({
  icon: Icon,
  title = 'No items found',
  description = 'Get started by creating your first item.',
  actionLabel,
  onAction,
  actionIcon: ActionIcon,
}) {
  return (
    <div className="empty-state">
      {Icon && (
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 'var(--radius-xl)',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 'var(--space-4)',
            color: 'var(--color-text-muted)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <Icon size={26} />
        </div>
      )}
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-text">{description}</p>}
      {actionLabel && onAction && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={onAction}
          style={{ marginTop: 'var(--space-2)' }}
        >
          {ActionIcon && <ActionIcon size={16} />}
          {actionLabel}
        </button>
      )}
    </div>
  );
}
