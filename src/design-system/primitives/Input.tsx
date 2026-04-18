import { forwardRef, type InputHTMLAttributes } from 'react';

/**
 * Input — text entry primitive with an optional monospace variant.
 *
 * `forwardRef` is required so Phase 3 Chat can focus the composer on mount
 * (useRef pattern). `mono` toggles JetBrains Mono for hex/token entry fields.
 */
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { mono = false, className = '', ...rest },
  ref,
) {
  const cls = ['input', mono ? 'mono' : '', className].filter(Boolean).join(' ');
  return <input ref={ref} className={cls} {...rest} />;
});
