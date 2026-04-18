import type { ReactNode, HTMLAttributes } from 'react';

/**
 * Badge — smaller, monospaced chip subset used for status/diagnostic
 * annotations (e.g. `N8`, `OK`, `HOT`). Tones map to accent tokens in
 * primitives.css.
 */
interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'default' | 'ok' | 'warn' | 'hot';
  children: ReactNode;
}

export function Badge({ tone = 'default', children, className = '', ...rest }: BadgeProps) {
  const cls = ['badge', tone !== 'default' ? `badge-${tone}` : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  );
}
