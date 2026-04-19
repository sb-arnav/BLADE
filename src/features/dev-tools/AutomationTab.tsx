// src/features/dev-tools/AutomationTab.tsx
//
// ComputerUse sub-tab — wraps the 15 automation::* commands as inline
// mini-forms grouped by concern. Destructive/OS-action commands use
// Dialog-confirm per D-181.
//
// @see .planning/phases/07-dev-tools-admin/07-04-PLAN.md (Task 2 — DEV-10)
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-181
// @see src-tauri/src/automation.rs (15 auto_* commands)

import { useState } from 'react';
import { Button, Dialog } from '@/design-system/primitives';
import { useToast } from '@/lib/context/ToastContext';
import {
  autoTypeText,
  autoPressKey,
  autoKeyCombo,
  autoMouseMove,
  autoGetMousePosition,
  autoMouseClick,
  autoMouseClickRelative,
  autoMouseDoubleClick,
  autoMouseDrag,
  autoScroll,
  autoOpenUrl,
  autoOpenPath,
  autoLaunchApp,
  autoCopyToClipboard,
  autoPasteClipboard,
} from '@/lib/tauri/dev_tools';
import './dev-tools.css';
import './dev-tools-rich-b.css';

interface DangerConfirm {
  title: string;
  body: string;
  run: () => Promise<void>;
}

export function AutomationTab() {
  const toast = useToast();
  const [danger, setDanger] = useState<DangerConfirm | null>(null);
  const [busy, setBusy] = useState(false);

  // Keyboard state ────────────────────────────────────────────────────────
  const [typeText, setTypeText] = useState('');
  const [keyName, setKeyName] = useState('Return');
  const [comboMods, setComboMods] = useState('Ctrl,Shift');
  const [comboKey, setComboKey] = useState('A');

  // Mouse state ───────────────────────────────────────────────────────────
  const [moveX, setMoveX] = useState('500');
  const [moveY, setMoveY] = useState('500');
  const [clickX, setClickX] = useState('');
  const [clickY, setClickY] = useState('');
  const [clickButton, setClickButton] = useState('left');
  const [relDx, setRelDx] = useState('10');
  const [relDy, setRelDy] = useState('0');
  const [dragFromX, setDragFromX] = useState('100');
  const [dragFromY, setDragFromY] = useState('100');
  const [dragToX, setDragToX] = useState('500');
  const [dragToY, setDragToY] = useState('500');
  const [scrollDx, setScrollDx] = useState('0');
  const [scrollDy, setScrollDy] = useState('-3');
  const [lastMousePos, setLastMousePos] = useState<string>('');

  // Apps & paths ──────────────────────────────────────────────────────────
  const [urlToOpen, setUrlToOpen] = useState('');
  const [pathToOpen, setPathToOpen] = useState('');
  const [appCmd, setAppCmd] = useState('');
  const [appArgs, setAppArgs] = useState('');

  // Clipboard ─────────────────────────────────────────────────────────────
  const [clipText, setClipText] = useState('');

  // Shared helpers ────────────────────────────────────────────────────────
  const wrap = async (label: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast.show({ type: 'success', title: `${label} OK` });
    } catch (e) {
      toast.show({
        type: 'error',
        title: `${label} failed`,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmDanger = (title: string, body: string, run: () => Promise<void>) => {
    setDanger({ title, body, run });
  };

  const runDanger = async () => {
    if (!danger) return;
    setBusy(true);
    try {
      await danger.run();
      toast.show({ type: 'success', title: `${danger.title} OK` });
    } catch (e) {
      toast.show({
        type: 'error',
        title: `${danger.title} failed`,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
      setDanger(null);
    }
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}
      data-testid="automation-tab-root"
    >
      {/* Keyboard section */}
      <div className="computer-use-section" data-testid="automation-section">
        <div className="computer-use-section-title">Keyboard</div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Type text</span>
          <input
            className="web-automation-selector-input"
            value={typeText}
            onChange={(e) => setTypeText(e.target.value)}
            placeholder="Hello world"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => wrap('Type text', () => autoTypeText(typeText))}
            disabled={busy || !typeText}
          >
            Type
          </Button>
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Press key</span>
          <input
            className="web-automation-selector-input"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="Return / Tab / Escape"
            style={{ maxWidth: 200 }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => wrap('Press key', () => autoPressKey(keyName))}
            disabled={busy || !keyName}
          >
            Press
          </Button>
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Key combo</span>
          <input
            className="web-automation-selector-input"
            value={comboMods}
            onChange={(e) => setComboMods(e.target.value)}
            placeholder="Ctrl,Shift"
            style={{ maxWidth: 160 }}
          />
          <span style={{ fontSize: 12, color: 'var(--t-3)' }}>+</span>
          <input
            className="web-automation-selector-input"
            value={comboKey}
            onChange={(e) => setComboKey(e.target.value)}
            placeholder="A"
            style={{ maxWidth: 80 }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              wrap('Key combo', () =>
                autoKeyCombo({
                  modifiers: comboMods
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                  key: comboKey,
                }),
              )
            }
            disabled={busy || !comboKey || !comboMods}
          >
            Combo
          </Button>
        </div>
      </div>

      {/* Mouse section */}
      <div className="computer-use-section" data-testid="automation-section">
        <div className="computer-use-section-title">Mouse</div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Move</span>
          <input
            className="web-automation-selector-input"
            value={moveX}
            onChange={(e) => setMoveX(e.target.value)}
            placeholder="x"
            style={{ maxWidth: 80 }}
          />
          <input
            className="web-automation-selector-input"
            value={moveY}
            onChange={(e) => setMoveY(e.target.value)}
            placeholder="y"
            style={{ maxWidth: 80 }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              wrap('Mouse move', () =>
                autoMouseMove({ x: Number(moveX) || 0, y: Number(moveY) || 0 }),
              )
            }
            disabled={busy}
          >
            Move
          </Button>
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Position</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              try {
                const p = await autoGetMousePosition();
                setLastMousePos(`x=${p.x} y=${p.y}`);
                toast.show({ type: 'info', title: 'Mouse position', message: `x=${p.x} y=${p.y}` });
              } catch (e) {
                toast.show({
                  type: 'error',
                  title: 'Get position failed',
                  message: e instanceof Error ? e.message : String(e),
                });
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            Get
          </Button>
          {lastMousePos && (
            <span style={{ fontSize: 12, color: 'var(--t-2)' }}>{lastMousePos}</span>
          )}
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Click</span>
          <input
            className="web-automation-selector-input"
            value={clickX}
            onChange={(e) => setClickX(e.target.value)}
            placeholder="x (opt)"
            style={{ maxWidth: 80 }}
          />
          <input
            className="web-automation-selector-input"
            value={clickY}
            onChange={(e) => setClickY(e.target.value)}
            placeholder="y (opt)"
            style={{ maxWidth: 80 }}
          />
          <select
            value={clickButton}
            onChange={(e) => setClickButton(e.target.value)}
            className="web-automation-selector-input"
            style={{ maxWidth: 80 }}
          >
            <option value="left">left</option>
            <option value="right">right</option>
            <option value="middle">middle</option>
          </select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              confirmDanger(
                'Mouse click',
                `Click ${clickButton} button${clickX && clickY ? ` at (${clickX}, ${clickY})` : ' at current position'}?`,
                () =>
                  autoMouseClick({
                    x: clickX ? Number(clickX) : undefined,
                    y: clickY ? Number(clickY) : undefined,
                    button: clickButton,
                  }).then(() => undefined),
              )
            }
            disabled={busy}
            data-testid="automation-action-danger"
          >
            Click
          </Button>
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Rel click</span>
          <input
            className="web-automation-selector-input"
            value={relDx}
            onChange={(e) => setRelDx(e.target.value)}
            placeholder="dx"
            style={{ maxWidth: 80 }}
          />
          <input
            className="web-automation-selector-input"
            value={relDy}
            onChange={(e) => setRelDy(e.target.value)}
            placeholder="dy"
            style={{ maxWidth: 80 }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              wrap('Relative click', () =>
                autoMouseClickRelative({
                  dx: Number(relDx) || 0,
                  dy: Number(relDy) || 0,
                  button: clickButton,
                }),
              )
            }
            disabled={busy}
          >
            Click rel
          </Button>
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Dbl click</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              wrap('Double click', () =>
                autoMouseDoubleClick({
                  x: clickX ? Number(clickX) : undefined,
                  y: clickY ? Number(clickY) : undefined,
                  button: clickButton,
                }),
              )
            }
            disabled={busy}
          >
            Double click
          </Button>
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Drag</span>
          <input
            className="web-automation-selector-input"
            value={dragFromX}
            onChange={(e) => setDragFromX(e.target.value)}
            placeholder="fromX"
            style={{ maxWidth: 80 }}
          />
          <input
            className="web-automation-selector-input"
            value={dragFromY}
            onChange={(e) => setDragFromY(e.target.value)}
            placeholder="fromY"
            style={{ maxWidth: 80 }}
          />
          <input
            className="web-automation-selector-input"
            value={dragToX}
            onChange={(e) => setDragToX(e.target.value)}
            placeholder="toX"
            style={{ maxWidth: 80 }}
          />
          <input
            className="web-automation-selector-input"
            value={dragToY}
            onChange={(e) => setDragToY(e.target.value)}
            placeholder="toY"
            style={{ maxWidth: 80 }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              wrap('Drag', () =>
                autoMouseDrag({
                  fromX: Number(dragFromX) || 0,
                  fromY: Number(dragFromY) || 0,
                  toX: Number(dragToX) || 0,
                  toY: Number(dragToY) || 0,
                }),
              )
            }
            disabled={busy}
          >
            Drag
          </Button>
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Scroll</span>
          <input
            className="web-automation-selector-input"
            value={scrollDx}
            onChange={(e) => setScrollDx(e.target.value)}
            placeholder="dx"
            style={{ maxWidth: 80 }}
          />
          <input
            className="web-automation-selector-input"
            value={scrollDy}
            onChange={(e) => setScrollDy(e.target.value)}
            placeholder="dy"
            style={{ maxWidth: 80 }}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              wrap('Scroll', () =>
                autoScroll({ dx: Number(scrollDx) || 0, dy: Number(scrollDy) || 0 }),
              )
            }
            disabled={busy}
          >
            Scroll
          </Button>
        </div>
      </div>

      {/* Apps & paths section */}
      <div className="computer-use-section" data-testid="automation-section">
        <div className="computer-use-section-title">Apps & paths</div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Open URL</span>
          <input
            className="web-automation-selector-input"
            value={urlToOpen}
            onChange={(e) => setUrlToOpen(e.target.value)}
            placeholder="https://…"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              confirmDanger('Open URL', `Open ${urlToOpen} in the default browser?`, () =>
                autoOpenUrl(urlToOpen).then(() => undefined),
              )
            }
            disabled={busy || !urlToOpen}
            data-testid="automation-action-danger"
          >
            Open
          </Button>
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Open path</span>
          <input
            className="web-automation-selector-input"
            value={pathToOpen}
            onChange={(e) => setPathToOpen(e.target.value)}
            placeholder="/absolute/path/to/file"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              confirmDanger('Open path', `Open ${pathToOpen} in the system default app?`, () =>
                autoOpenPath(pathToOpen).then(() => undefined),
              )
            }
            disabled={busy || !pathToOpen}
            data-testid="automation-action-danger"
          >
            Open
          </Button>
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Launch app</span>
          <input
            className="web-automation-selector-input"
            value={appCmd}
            onChange={(e) => setAppCmd(e.target.value)}
            placeholder="executable / app name"
            style={{ maxWidth: 200 }}
          />
          <input
            className="web-automation-selector-input"
            value={appArgs}
            onChange={(e) => setAppArgs(e.target.value)}
            placeholder="args (comma-separated)"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              confirmDanger(
                'Launch app',
                `Launch '${appCmd}' with args [${appArgs}]?`,
                () =>
                  autoLaunchApp({
                    command: appCmd,
                    launchArgs: appArgs
                      ? appArgs.split(',').map((s) => s.trim()).filter(Boolean)
                      : undefined,
                  }).then(() => undefined),
              )
            }
            disabled={busy || !appCmd}
            data-testid="automation-action-danger"
          >
            Launch
          </Button>
        </div>
      </div>

      {/* Clipboard section */}
      <div className="computer-use-section" data-testid="automation-section">
        <div className="computer-use-section-title">Clipboard</div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Copy</span>
          <input
            className="web-automation-selector-input"
            value={clipText}
            onChange={(e) => setClipText(e.target.value)}
            placeholder="Text to copy"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => wrap('Copy to clipboard', () => autoCopyToClipboard(clipText))}
            disabled={busy || !clipText}
          >
            Copy
          </Button>
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Paste</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => wrap('Paste clipboard', () => autoPasteClipboard())}
            disabled={busy}
          >
            Paste
          </Button>
        </div>
      </div>

      <Dialog
        open={danger !== null}
        onClose={() => setDanger(null)}
        ariaLabel="Confirm automation action"
      >
        <div style={{ padding: 'var(--s-3)', maxWidth: 420 }}>
          <div className="devtools-b-danger-banner">{danger?.title ?? 'Confirm'} — OS ACTION</div>
          <p style={{ margin: 0, fontSize: 13 }}>{danger?.body}</p>
          <div className="devtools-b-dialog-actions">
            <Button variant="ghost" onClick={() => setDanger(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={runDanger}>
              Confirm
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
