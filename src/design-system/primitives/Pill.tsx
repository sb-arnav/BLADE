import type { ReactNode, HTMLAttributes } from 'react';

/**
 * Pill — `.chip` primitive (shared.css:300-315).
 *
 * `tone` drives the border/text tint via primitives.css:
 *   - `default` → base chip
 *   - `free`    → accent-ok
 *   - `new`     → accent-warm
 *   - `pro`     → accent-cool
 * `dot` adds the leading ok-color dot indicator.
 */
interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'default' | 'free' | 'new' | 'pro';
  dot?: boolean;
  children: ReactNode;
}

export function Pill({ tone = 'default', dot = false, children, className = '', ...rest }: PillProps) {
  const cls = [
    'chip',
    tone !== 'default' ? tone : '',
    dot ? 'dot' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
