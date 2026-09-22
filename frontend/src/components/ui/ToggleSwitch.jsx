export default function ToggleSwitch({
  checked = false,
  onChange,
  disabled = false,
  ariaLabel = 'Toggle switch',
  title = '',
}) {
  const handleClick = (e) => {
    e.stopPropagation();
    if (disabled || !onChange) return;
    onChange(!checked);
  };

  const handleKeyDown = (e) => {
    if (disabled || !onChange) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onChange(!checked);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title || (checked ? 'Enabled - click to disable' : 'Disabled - click to enable')}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`toggle-switch-btn ${checked ? 'on' : 'off'}`}
    >
      <span className="toggle-switch-track">
        <span className="toggle-switch-thumb" />
      </span>
    </button>
  );
}
