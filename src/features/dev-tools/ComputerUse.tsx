// src/features/dev-tools/ComputerUse.tsx
//
// DEV-10 — Vision-driven desktop agent + 25-command automation/UIA surface.
// Top: live active-task card + Stop. Screenshot pane with Refresh. Main:
// goal input + Start. Tabs: Automation / UI Automation (per D-181).
//
// @see .planning/phases/07-dev-tools-admin/07-04-PLAN.md (Task 2 — DEV-10)
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-181
// @see src-tauri/src/computer_use.rs:55,339,345

import { useCallback, useEffect, useState } from 'react';
import { GlassPanel, Button } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context/ToastContext';
import {
  computerUseTask,
  computerUseStop,
  computerUseScreenshot,
} from '@/lib/tauri/dev_tools';
import type { ComputerUseTask as ComputerUseTaskResult } from '@/lib/tauri/dev_tools';
import { AutomationTab } from './AutomationTab';
import { UiAutomationTab } from './UiAutomationTab';
import './dev-tools.css';
import './dev-tools-rich-b.css';

type CuTab = 'automation' | 'ui-automation';
const TAB_PREFIX = 'cu:';

export function ComputerUse() {
  const { prefs, setPref } = usePrefs();
  const toast = useToast();

  const rawTab = prefs['devTools.activeTab'];
  const activeTab: CuTab =
    typeof rawTab === 'string' && rawTab.startsWith(TAB_PREFIX)
      ? ((rawTab.slice(TAB_PREFIX.length) as CuTab) ?? 'automation')
      : 'automation';
  const setActiveTab = (t: CuTab) => setPref('devTools.activeTab', `${TAB_PREFIX}${t}`);

  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotBusy, setScreenshotBusy] = useState(false);
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);
  const [lastTask, setLastTask] = useState<ComputerUseTaskResult | null>(null);
  const [stopBusy, setStopBusy] = useState(false);

  const refreshScreenshot = useCallback(async () => {
    if (screenshotBusy) return;
    setScreenshotBusy(true);
    try {
      const b64 = await computerUseScreenshot();
      setScreenshot(b64);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Screenshot failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setScreenshotBusy(false);
    }
  }, [screenshotBusy, toast]);

  useEffect(() => {
    void refreshScreenshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStart = async () => {
    if (running || !goal.trim()) return;
    setRunning(true);
    setLastTask(null);
    try {
      const result = await computerUseTask({ goal });
      setLastTask(result);
      toast.show({
        type: result.success ? 'success' : 'warn',
        title: result.success ? 'Task complete' : 'Task finished with issues',
        message: `${result.steps_taken} step${result.steps_taken === 1 ? '' : 's'}`,
      });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Task failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRunning(false);
    }
  };

  const handleStop = async () => {
    if (stopBusy) return;
    setStopBusy(true);
    try {
      await computerUseStop();
      toast.show({ type: 'info', title: 'Stop requested' });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Stop failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setStopBusy(false);
    }
  };

  return (
    <GlassPanel tier={1} className="dev-surface" data-testid="computer-use-root">
      <div className="computer-use-layout">
        <div
          className="computer-use-task-card"
          data-running={String(running)}
          data-testid="computer-use-task-card"
        >
          <div className="devtools-b-section-header">
            <h3>{running ? 'Task running' : 'Task idle'}</h3>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleStop}
              disabled={stopBusy}
              data-testid="computer-use-stop-button"
            >
              {stopBusy ? 'Stopping…' : 'Stop'}
            </Button>
          </div>
          {lastTask ? (
            <div style={{ fontSize: 12, color: 'var(--t-2)' }}>
              Last run: {lastTask.success ? 'success' : 'partial'} · {lastTask.steps_taken} step
              {lastTask.steps_taken === 1 ? '' : 's'}
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--t-3)',
                  marginTop: 'var(--s-1)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {lastTask.result}
              </div>
            </div>
          ) : (
            <div className="dev-placeholder-hint">No task run yet.</div>
          )}
          <textarea
            className="computer-use-textarea"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Describe a goal for BLADE to accomplish on your desktop…"
            data-testid="computer-use-goal-input"
          />
          <Button
            variant="primary"
            onClick={handleStart}
            disabled={running || !goal.trim()}
            data-testid="computer-use-start-button"
          >
            {running ? 'Running…' : 'Start task'}
          </Button>
        </div>

        <div className="computer-use-screenshot" data-testid="computer-use-screenshot">
          <div className="devtools-b-section-header">
            <h3>Screenshot</h3>
            <Button
              variant="secondary"
              size="sm"
              onClick={refreshScreenshot}
              disabled={screenshotBusy}
              data-testid="computer-use-refresh-screenshot"
            >
              {screenshotBusy ? 'Loading…' : 'Refresh'}
            </Button>
          </div>
          {screenshot ? (
            <img
              src={`data:image/png;base64,${screenshot}`}
              alt="Current screen"
            />
          ) : (
            <div className="dev-placeholder-hint">
              {screenshotBusy ? 'Capturing…' : 'No screenshot yet.'}
            </div>
          )}
        </div>
      </div>

      <div className="dev-tab-row" style={{ marginTop: 'var(--s-2)' }}>
        {(['automation', 'ui-automation'] as CuTab[]).map((t) => (
          <button
            key={t}
            type="button"
            className="dev-tab-pill"
            data-active={String(activeTab === t)}
            onClick={() => setActiveTab(t)}
            data-testid="computer-use-tab"
          >
            {t === 'automation' ? 'Automation' : 'UI Automation'}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 'var(--s-2)' }}>
        {activeTab === 'automation' ? <AutomationTab /> : <UiAutomationTab />}
      </div>
    </GlassPanel>
  );
}
