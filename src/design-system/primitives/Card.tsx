import type { ReactNode, HTMLAttributes } from 'react';
import { GlassPanel } from './GlassPanel';

/**
 * Card — GlassPanel with padding sugar. The padding literal union maps to
 * spacing tokens so there's no magic px anywhere downstream.
 */
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  tier?: 1 | 2 | 3;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const padMap = { none: 0, sm: 'var(--s-3)', md: 'var(--s-5)', lg: 'var(--s-8)' } as const;

export function Card({ tier = 1, padding = 'md', children, style, ...rest }: CardProps) {
  return (
    <GlassPanel tier={tier} style={{ padding: padMap[padding], ...style }} {...rest}>
      {children}
    </GlassPanel>
  );
}
