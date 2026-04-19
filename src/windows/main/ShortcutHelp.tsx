// src/windows/main/ShortcutHelp.tsx — Phase 9 Plan 09-05 (D-222, SC-4).
//
// ⌘? shortcut help panel. Renders a transient <Dialog> with a 2-column grid of
// every keyboard shortcut in the shell — global (⌘K, ⌘1, ⌘/, …) plus every
// RouteDefinition.shortcut from ALL_ROUTES. kbd tokens are monospace on a
// --g-fill glass tint, labels in body font (--t-2).
//
// SC-4 direct falsifier: pressing ⌘? opens this panel; Escape closes it. The
// real Playwright spec lives in Plan 09-06; this file ships the affordance.
//
// Dialog primitive (D-01) is the native <dialog> wrapper with no `title` prop —
// heading is rendered inline so screen readers announce it via role="heading".
//
// @see .planning/phases/09-polish/09-PATTERNS.md §5
// @see .planning/phases/09-polish/09-CONTEXT.md §D-222

import { Fragment } from 'react';
import { Dialog } from '@/design-system/primitives';
import { ALL_ROUTES } from './router';

const GLOBAL_SHORTCUTS: Array<{ combo: string; label: string }> = [
  { combo: '⌘K',        label: 'Command palette' },
  { combo: '⌘1',        label: 'Dashboard' },
  { combo: '⌘/',        label: 'Chat' },
  { combo: '⌘,',        label: 'Settings' },
  { combo: '⌘[',        label: 'Back' },
  { combo: '⌘]',        label: 'Forward' },
  { combo: '⌘?',        label: 'Shortcut help' },
  { combo: 'Alt+Space', label: 'QuickAsk' },
];

interface ShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  const routeShortcuts = ALL_ROUTES
    .filter((r) => r.shortcut)
    .map((r) => ({ combo: r.shortcut!, label: r.label }));

  const allShortcuts = [...GLOBAL_SHORTCUTS, ...routeShortcuts];

  return (
    <Dialog open={open} onClose={onClose} ariaLabel="Keyboard shortcuts">
      <div style={{ padding: 'var(--s-5)', minWidth: 420 }}>
        <h2 className="t-h3" style={{ margin: 0, marginBottom: 'var(--s-4)' }}>
          Keyboard shortcuts
        </h2>
        <div
          role="list"
          data-testid="shortcut-help-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'min-content 1fr',
            gap: 'var(--s-2) var(--s-5)',
            alignItems: 'center',
          }}
        >
          {allShortcuts.map((s) => (
            <Fragment key={`${s.combo}-${s.label}`}>
              <kbd
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--t-1)',
                  padding: '2px 8px',
                  background: 'var(--g-fill)',
                  borderRadius: 4,
                  whiteSpace: 'nowrap',
                }}
              >
                {s.combo}
              </kbd>
              <span className="t-body" style={{ color: 'var(--t-2)' }}>
                {s.label}
              </span>
            </Fragment>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
