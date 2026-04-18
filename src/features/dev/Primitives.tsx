// src/features/dev/Primitives.tsx — DEV-only route, palette-hidden (D-21).
//
// Exhaustive showcase of every primitive × variant × size × state on a glass
// wallpaper. Doubles as the surface for the P-08 WCAG 5-wallpaper eyeball
// spot-check (screenshots into .planning/phases/01-foundation/wcag-screenshots/).
//
// Mounted only in DEV builds via src/windows/main/router.ts import.meta.env.DEV
// gate — Vite tree-shakes the entire module in prod (W6 remediation).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-21, §D-40-palette
// @see .planning/research/PITFALLS.md §P-08

import { useState } from 'react';
import {
  Button,
  Card,
  GlassPanel,
  Input,
  Pill,
  Badge,
  GlassSpinner,
  Dialog,
} from '@/design-system/primitives';

export function Primitives() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');

  return (
    <div
      style={{
        padding: 'var(--s-8)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s-6)',
        maxWidth: 1100,
        margin: '0 auto',
      }}
    >
      <header>
        <h1 className="t-h1">Primitives Showcase</h1>
        <p className="t-body" style={{ color: 'var(--t-2)', marginTop: 'var(--s-3)' }}>
          DEV-only. Every primitive × variant × size × state on glass. Doubles as
          the P-08 WCAG eyeball surface — screenshot over 5 wallpapers and save
          under <code>.planning/phases/01-foundation/wcag-screenshots/</code>.
        </p>
        <div style={{ marginTop: 'var(--s-3)', display: 'flex', gap: 'var(--s-2)' }}>
          <Badge tone="ok">DEV</Badge>
          <Pill tone="free">Phase 1</Pill>
        </div>
      </header>

      {/* ───── Button ─────────────────────────────────────────────────── */}
      <Card>
        <h2 className="t-h3" style={{ marginBottom: 'var(--s-4)' }}>Button</h2>
        <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="primary" size="sm">Primary SM</Button>
          <Button variant="primary" size="md">Primary MD</Button>
          <Button variant="primary" size="lg">Primary LG</Button>
          <Button variant="secondary" size="md">Secondary</Button>
          <Button variant="ghost" size="md">Ghost</Button>
          <Button variant="icon" size="md" aria-label="settings">⚙</Button>
          <Button variant="primary" size="md" disabled>Disabled</Button>
        </div>
      </Card>

      {/* ───── GlassPanel tiers ──────────────────────────────────────── */}
      <Card>
        <h2 className="t-h3" style={{ marginBottom: 'var(--s-4)' }}>
          GlassPanel (tiers 1 / 2 / 3 — blur caps 20 / 12 / 8)
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--s-4)',
          }}
        >
          <GlassPanel tier={1}>
            <div style={{ padding: 'var(--s-5)' }}>
              <div className="t-body">Tier 1</div>
              <div className="t-small" style={{ color: 'var(--t-3)' }}>blur 20</div>
            </div>
          </GlassPanel>
          <GlassPanel tier={2}>
            <div style={{ padding: 'var(--s-5)' }}>
              <div className="t-body">Tier 2</div>
              <div className="t-small" style={{ color: 'var(--t-3)' }}>blur 12</div>
            </div>
          </GlassPanel>
          <GlassPanel tier={3}>
            <div style={{ padding: 'var(--s-5)' }}>
              <div className="t-body">Tier 3</div>
              <div className="t-small" style={{ color: 'var(--t-3)' }}>blur 8</div>
            </div>
          </GlassPanel>
        </div>
      </Card>

      {/* ───── Input ─────────────────────────────────────────────────── */}
      <Card>
        <h2 className="t-h3" style={{ marginBottom: 'var(--s-4)' }}>Input</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
          <Input placeholder="Default text input" value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
          <Input placeholder="Monospace (for keys, tokens)" mono />
          <Input placeholder="Disabled" disabled />
        </div>
      </Card>

      {/* ───── Pill + Badge ──────────────────────────────────────────── */}
      <Card>
        <h2 className="t-h3" style={{ marginBottom: 'var(--s-4)' }}>Pill + Badge</h2>
        <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <Pill>Default</Pill>
          <Pill tone="free">Free</Pill>
          <Pill tone="new">New</Pill>
          <Pill tone="pro">Pro</Pill>
          <Pill tone="free" dot>With dot</Pill>
          <Badge>DEV</Badge>
          <Badge tone="ok">OK</Badge>
          <Badge tone="warn">WARN</Badge>
          <Badge tone="hot">HOT</Badge>
        </div>
      </Card>

      {/* ───── Spinner + Dialog ──────────────────────────────────────── */}
      <Card>
        <h2 className="t-h3" style={{ marginBottom: 'var(--s-4)' }}>Spinner + Dialog</h2>
        <div style={{ display: 'flex', gap: 'var(--s-5)', alignItems: 'center' }}>
          <GlassSpinner />
          <GlassSpinner size={36} />
          <GlassSpinner size={56} />
          <Button variant="primary" onClick={() => setDialogOpen(true)}>Open Dialog</Button>
        </div>
      </Card>

      {/* ───── Text hierarchy (for P-08 eyeball) ─────────────────────── */}
      <Card>
        <h2 className="t-h3" style={{ marginBottom: 'var(--s-4)' }}>Text hierarchy (t-1 / t-2 / t-3 / t-4)</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
          <div className="t-body" style={{ color: 'var(--t-1)' }}>t-1 — primary (.97): The quick brown fox jumps over the lazy dog.</div>
          <div className="t-body" style={{ color: 'var(--t-2)' }}>t-2 — secondary (.72): The quick brown fox jumps over the lazy dog.</div>
          <div className="t-body" style={{ color: 'var(--t-3)' }}>t-3 — tertiary (.50, floor): The quick brown fox jumps over the lazy dog.</div>
          <div className="t-body" style={{ color: 'var(--t-4)' }}>t-4 — quaternary (.32, decorative only): The quick brown fox jumps over the lazy dog.</div>
        </div>
      </Card>

      {/* ───── Dialog overlay (portal-less, native) ──────────────────── */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        ariaLabel="Primitive showcase dialog"
      >
        <h2 className="t-h2">Dialog primitive</h2>
        <p className="t-body" style={{ marginTop: 'var(--s-3)', color: 'var(--t-2)' }}>
          Native <code>&lt;dialog&gt;</code> + <code>showModal()</code>. Browser
          handles focus-trap + ESC close; no Radix dependency (D-01).
        </p>
        <div
          style={{
            marginTop: 'var(--s-5)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--s-2)',
          }}
        >
          <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => setDialogOpen(false)}>OK</Button>
        </div>
      </Dialog>
    </div>
  );
}
