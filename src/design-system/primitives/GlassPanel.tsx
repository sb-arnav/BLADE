import type { ReactNode, HTMLAttributes } from 'react';

/**
 * GlassPanel — foundational Liquid Glass surface.
 *
 * `tier` maps to `.glass-1 | .glass-2 | .glass-3` in src/styles/glass.css,
 * which bake the blur caps 20 / 12 / 8 (D-07). The component intentionally
 * does NOT expose a blur prop — the ceiling is structural, not per-caller.
 * Consumers that need a custom shape use the `shape` literal union.
 */
interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  tier?: 1 | 2 | 3;
  shape?: 'card' | 'pill' | 'sm';
  interactive?: boolean;
  children: ReactNode;
}

export function GlassPanel({
  tier = 1,
  shape = 'card',
  interactive = false,
  children,
  className = '',
  ...rest
}: GlassPanelProps) {
  const cls = [
    'glass',
    `glass-${tier}`,
    shape === 'pill' ? 'pill' : shape === 'sm' ? 'sm' : '',
    interactive ? 'interactive' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
