// src/features/providers/FallbackOrderList.tsx — Phase 11 Plan 11-03.
//
// Drag-to-reorder list over config.fallback_providers. HTML5 native DnD
// only — no library dependency (D-01 self-built-primitives discipline).
//
// Keyboard-drag support:
//   Space / Enter  → pickup the focused row
//   Arrow Up/Down  → move the picked-up row (virtual move, commits on drop)
//   Space / Enter  → drop
//   Escape         → cancel the keyboard drag (no reorder)
//
// Each keyboard move announces via an aria-live="polite" sr-only region:
//   "Moved {provider} to position {N} of {total}."
//
// "Use all providers with keys" toggle — when enabled, the consumer
// (ProvidersPane) auto-populates the `providers` prop with all providers
// that have stored keys, alphabetically sorted. Disabling does NOT clear
// the list; the user's manual order persists (UI-SPEC Surface B spec).
//
// Props:
//   providers          : string[] — current fallback order
//   capabilityRecords  : Record<string, ProviderCapabilityRecord>
//                        (for showing model names in each row)
//   onChange           : called with the new string[] after reorder
//   useAll?            : optional — controlled value of the toggle
//   onToggleUseAll?    : optional — fires when the toggle flips
//
// @see .planning/phases/11-smart-provider-setup/11-UI-SPEC.md Surface B
// @see .planning/phases/11-smart-provider-setup/11-PATTERNS.md §10
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-57

import { useRef, useState } from 'react';
import { Card, EmptyState, GlassPanel } from '@/design-system/primitives';
import type { ProviderCapabilityRecord } from '@/types/provider';

import './providers.css';

export interface FallbackOrderListProps {
  providers: string[];
  capabilityRecords: Record<string, ProviderCapabilityRecord>;
  onChange: (newOrder: string[]) => void;
  useAll?: boolean;
  onToggleUseAll?: (checked: boolean) => void;
}

/** Immutable splice-reorder — returns a new array with the item at `from`
 *  moved to `to`. If from === to, returns the source array unchanged. */
function reorderArray(list: string[], from: number, to: number): string[] {
  if (from === to) return list;
  if (from < 0 || from >= list.length) return list;
  if (to < 0 || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function FallbackOrderList({
  providers,
  capabilityRecords,
  onChange,
  useAll,
  onToggleUseAll,
}: FallbackOrderListProps) {
  // Mouse-drag state — live during a native DnD gesture.
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  // Keyboard-drag state — separate so mouse + keyboard drags don't collide.
  const [keyboardDragIdx, setKeyboardDragIdx] = useState<number | null>(null);
  // Screen-reader announcement text — mutated per keyboard move.
  const [announce, setAnnounce] = useState<string>('');
  const rowRefs = useRef<Map<number, HTMLLIElement | null>>(new Map());

  const reorder = (from: number, to: number) => {
    const next = reorderArray(providers, from, to);
    if (next !== providers) onChange(next);
  };

  const announceMove = (provider: string, position: number) => {
    setAnnounce(`Moved ${provider} to position ${position} of ${providers.length}.`);
  };

  const handleDragStart = (i: number) => () => {
    setDraggingIdx(i);
  };

  const handleDragOver = (i: number) => (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    setDropIdx(i);
  };

  const handleDrop = (i: number) => (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    if (draggingIdx !== null && draggingIdx !== i) {
      reorder(draggingIdx, i);
    }
    setDraggingIdx(null);
    setDropIdx(null);
  };

  const handleDragEnd = () => {
    setDraggingIdx(null);
    setDropIdx(null);
  };

  const handleKeyDown = (i: number) => (e: React.KeyboardEvent<HTMLLIElement>) => {
    // Space / Enter toggles pickup <-> drop.
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (keyboardDragIdx === null) {
        setKeyboardDragIdx(i);
        setAnnounce(`Picked up ${providers[i]}. Use arrow keys to move, space to drop.`);
      } else {
        // Drop at current focused row.
        if (keyboardDragIdx !== i) {
          reorder(keyboardDragIdx, i);
          announceMove(providers[keyboardDragIdx], i + 1);
        }
        setKeyboardDragIdx(null);
      }
      return;
    }
    if (e.key === 'Escape' && keyboardDragIdx !== null) {
      e.preventDefault();
      setKeyboardDragIdx(null);
      setAnnounce(`Canceled move.`);
      return;
    }
    if (keyboardDragIdx === null) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const newIdx = Math.max(0, keyboardDragIdx - 1);
      if (newIdx !== keyboardDragIdx) {
        reorder(keyboardDragIdx, newIdx);
        announceMove(providers[keyboardDragIdx], newIdx + 1);
        setKeyboardDragIdx(newIdx);
        // Move focus with the row.
        const next = rowRefs.current.get(newIdx);
        next?.focus();
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const newIdx = Math.min(providers.length - 1, keyboardDragIdx + 1);
      if (newIdx !== keyboardDragIdx) {
        reorder(keyboardDragIdx, newIdx);
        announceMove(providers[keyboardDragIdx], newIdx + 1);
        setKeyboardDragIdx(newIdx);
        const next = rowRefs.current.get(newIdx);
        next?.focus();
      }
    }
  };

  return (
    <section className="fallback-order-section" aria-labelledby="fallback-order-heading">
      <h3 id="fallback-order-heading" className="t-h3 fallback-order-section__heading">
        Fallback order
      </h3>
      <p className="t-small fallback-order-section__helper">
        If the primary provider errors, BLADE retries through this chain. Drag to reorder.
        Capability-gated tasks only retry through providers with that capability.
      </p>

      {/* Screen-reader live region — announces keyboard moves (UI-SPEC ARIA). */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="paste-form__sr-only"
      >
        {announce}
      </div>

      <GlassPanel tier={2} style={{ padding: 'var(--s-3)' }}>
        {providers.length === 0 ? (
          <EmptyState
            label="No providers configured yet"
            description="Save a provider key above and it'll show up here. BLADE uses the order to retry on transient errors."
            testId="fallback-order-empty"
          />
        ) : (
          <ul
            className="fallback-order-list"
            role="list"
            aria-label="Provider fallback order, drag to reorder"
          >
            {providers.map((prov, i) => {
              const record = capabilityRecords[prov];
              const model = record?.model ?? '—';
              const isDragging = draggingIdx === i || keyboardDragIdx === i;
              const isDropTarget = dropIdx === i && draggingIdx !== i;
              return (
                <li
                  key={prov}
                  ref={(el) => {
                    rowRefs.current.set(i, el);
                  }}
                  role="listitem"
                  tabIndex={0}
                  draggable
                  aria-grabbed={isDragging}
                  data-dragging={isDragging ? 'true' : 'false'}
                  data-drop-target={isDropTarget ? 'true' : 'false'}
                  data-provider={prov}
                  className="fallback-order-row"
                  onDragStart={handleDragStart(i)}
                  onDragOver={handleDragOver(i)}
                  onDrop={handleDrop(i)}
                  onDragEnd={handleDragEnd}
                  onKeyDown={handleKeyDown(i)}
                >
                  <Card tier={2} padding="sm" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', width: '100%' }}>
                    <span className="fallback-order-row__handle" aria-hidden="true">≡</span>
                    <span className="t-small fallback-order-row__label">{prov}</span>
                    <span className="t-small fallback-order-row__meta"> • {model}</span>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </GlassPanel>

      <label className="fallback-order-toggle">
        <input
          type="checkbox"
          checked={useAll ?? false}
          onChange={(e) => onToggleUseAll?.(e.target.checked)}
          aria-label="Use all providers with keys"
        />
        <span className="t-small">Use all providers with keys</span>
      </label>
    </section>
  );
}
