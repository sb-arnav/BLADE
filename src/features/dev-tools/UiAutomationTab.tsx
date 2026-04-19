// src/features/dev-tools/UiAutomationTab.tsx
//
// ComputerUse sub-tab — wraps the 7 uia_* commands. "Get active window
// snapshot" button renders the element tree; per-element actions invoke
// click/invoke/focus/set-value/wait.
//
// @see .planning/phases/07-dev-tools-admin/07-04-PLAN.md (Task 2 — DEV-10)
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-181
// @see src-tauri/src/ui_automation.rs (7 uia_* commands)

import { useState } from 'react';
import { Button } from '@/design-system/primitives';
import { useToast } from '@/lib/context/ToastContext';
import {
  uiaGetActiveWindowSnapshot,
  uiaDescribeActiveWindow,
  uiaClickElement,
  uiaInvokeElement,
  uiaFocusElement,
  uiaSetElementValue,
  uiaWaitForElement,
} from '@/lib/tauri/dev_tools';
import type { UiaSnapshot, UiSelector, UiElement } from '@/lib/tauri/dev_tools';
import './dev-tools.css';
import './dev-tools-rich-b.css';

export function UiAutomationTab() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<UiaSnapshot | null>(null);
  const [description, setDescription] = useState<string>('');

  // Selector builder state ────────────────────────────────────────────────
  const [selName, setSelName] = useState('');
  const [selAutomationId, setSelAutomationId] = useState('');
  const [selClass, setSelClass] = useState('');
  const [selControlType, setSelControlType] = useState('');
  const [valueToSet, setValueToSet] = useState('');
  const [waitTimeoutMs, setWaitTimeoutMs] = useState('5000');

  const currentSelector = (): UiSelector => ({
    name: selName || null,
    automation_id: selAutomationId || null,
    class_name: selClass || null,
    control_type: selControlType || null,
  });

  const handleSnapshot = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const s = await uiaGetActiveWindowSnapshot({ maxDepth: 4, maxChildren: 60 });
      setSnapshot(s);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Snapshot failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDescribe = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const desc = await uiaDescribeActiveWindow({ maxDepth: 4, maxChildren: 40, maxLines: 80 });
      setDescription(desc);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Describe failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  const wrap = async (label: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await fn();
      toast.show({
        type: 'success',
        title: `${label} OK`,
        message: typeof result === 'string' ? result.slice(0, 100) : undefined,
      });
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

  const adoptElement = (el: UiElement) => {
    setSelName(el.name ?? '');
    setSelAutomationId(el.automation_id ?? '');
    setSelClass(el.class_name ?? '');
    setSelControlType(el.control_type ?? '');
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}
      data-testid="ui-automation-tab-root"
    >
      <div className="computer-use-section">
        <div className="computer-use-section-title">Active window</div>
        <div className="computer-use-inline-form">
          <Button variant="secondary" size="sm" onClick={handleSnapshot} disabled={busy}>
            Get snapshot
          </Button>
          <Button variant="secondary" size="sm" onClick={handleDescribe} disabled={busy}>
            Describe
          </Button>
        </div>
        {snapshot && (
          <>
            <div style={{ fontSize: 12, color: 'var(--t-2)' }}>
              <strong>{snapshot.window_name}</strong> ({snapshot.window_class_name}) ·{' '}
              {snapshot.elements.length} elements
            </div>
            <div className="computer-use-uia-snapshot" data-testid="uia-snapshot">
              {JSON.stringify(
                {
                  window_name: snapshot.window_name,
                  window_class_name: snapshot.window_class_name,
                  bounds: snapshot.bounds,
                  focused: snapshot.focused_element,
                },
                null,
                2,
              )}
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--s-1)',
                maxHeight: 260,
                overflowY: 'auto',
              }}
            >
              {snapshot.elements.map((el, i) => (
                <div
                  key={i}
                  className="computer-use-uia-element"
                  onClick={() => adoptElement(el)}
                >
                  <span>
                    {el.name ?? '(unnamed)'} · {el.control_type ?? '?'}
                  </span>
                  <span style={{ color: 'var(--t-3)' }}>
                    {el.automation_id ?? el.class_name ?? ''}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        {description && (
          <pre
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              background: 'rgba(0,0,0,0.25)',
              padding: 'var(--s-2)',
              borderRadius: 'var(--r-md)',
              maxHeight: 200,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              border: '1px solid var(--line)',
              margin: 0,
            }}
          >
            {description}
          </pre>
        )}
      </div>

      <div className="computer-use-section">
        <div className="computer-use-section-title">Selector</div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Name</span>
          <input
            className="web-automation-selector-input"
            value={selName}
            onChange={(e) => setSelName(e.target.value)}
            placeholder="OK"
          />
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Automation id</span>
          <input
            className="web-automation-selector-input"
            value={selAutomationId}
            onChange={(e) => setSelAutomationId(e.target.value)}
            placeholder="button1"
          />
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Class</span>
          <input
            className="web-automation-selector-input"
            value={selClass}
            onChange={(e) => setSelClass(e.target.value)}
            placeholder="Button"
          />
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Control type</span>
          <input
            className="web-automation-selector-input"
            value={selControlType}
            onChange={(e) => setSelControlType(e.target.value)}
            placeholder="Button"
          />
        </div>
      </div>

      <div className="computer-use-section">
        <div className="computer-use-section-title">Element actions</div>
        <div className="computer-use-inline-form" data-testid="uia-element-action">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => wrap('Click element', () => uiaClickElement(currentSelector()))}
            disabled={busy}
          >
            Click
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => wrap('Invoke element', () => uiaInvokeElement(currentSelector()))}
            disabled={busy}
          >
            Invoke
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => wrap('Focus element', () => uiaFocusElement(currentSelector()))}
            disabled={busy}
          >
            Focus
          </Button>
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Set value</span>
          <input
            className="web-automation-selector-input"
            value={valueToSet}
            onChange={(e) => setValueToSet(e.target.value)}
            placeholder="new value"
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              wrap('Set value', () =>
                uiaSetElementValue({ selector: currentSelector(), value: valueToSet }),
              )
            }
            disabled={busy || !valueToSet}
          >
            Set value
          </Button>
        </div>
        <div className="computer-use-inline-form">
          <span className="computer-use-inline-label">Wait for</span>
          <input
            className="web-automation-selector-input"
            value={waitTimeoutMs}
            onChange={(e) => setWaitTimeoutMs(e.target.value)}
            placeholder="5000"
            style={{ maxWidth: 120 }}
          />
          <span style={{ fontSize: 12, color: 'var(--t-3)' }}>ms</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              wrap('Wait for element', () =>
                uiaWaitForElement({
                  selector: currentSelector(),
                  timeoutMs: Number(waitTimeoutMs) || 5000,
                }),
              )
            }
            disabled={busy}
          >
            Wait
          </Button>
        </div>
      </div>
    </div>
  );
}
