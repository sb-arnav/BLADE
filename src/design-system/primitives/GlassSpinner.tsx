/**
 * GlassSpinner — rotating arc indicator.
 *
 * Uses the `@keyframes spin` declared in src/styles/motion.css. Stroke color
 * pulls from var(--t-3) so it tunes with text token opacity automatically.
 */
interface GlassSpinnerProps {
  size?: number;
  label?: string;
}

export function GlassSpinner({ size = 24, label = 'Loading' }: GlassSpinnerProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      style={{
        width: size,
        height: size,
        display: 'inline-block',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        style={{ animation: 'spin 0.9s linear infinite' }}
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="var(--t-3)"
          strokeWidth="2"
          strokeDasharray="14 56"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
