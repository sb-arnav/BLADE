import type { ReactNode, ButtonHTMLAttributes } from 'react';

/**
 * Button — primary action primitive.
 *
 * Variant + size are strict string literal unions (D-20). No CVA; the joined
 * class list composes against rules in primitives.css. The `className` prop
 * is intentionally omitted from the surface (D-20 discipline) so callers
 * can't bypass the variant API.
 */
interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', children, ...rest }: ButtonProps) {
  const cls = [
    'btn',
    variant === 'primary' ? 'primary' : variant === 'ghost' ? 'ghost' : variant === 'icon' ? 'icon' : '',
    size === 'sm' ? 'sm' : size === 'lg' ? 'lg' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
