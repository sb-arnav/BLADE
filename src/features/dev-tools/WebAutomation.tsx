// src/features/dev-tools/WebAutomation.tsx
//
// DEV-06 — Browser agent surface. Directly falsifies ROADMAP Phase 7 SC-2:
// "WebAutomation accepts a goal, calls browser_agent_* commands, and displays
// live screen feedback." Real Rust emit is `browser_agent_step` — we subscribe
// via BLADE_EVENTS.BROWSER_AGENT_STEP (Plan 07-01 added the constant after
// audit; speculative BROWSER_AGENT_EVENT in Plan 07-04 draft was wrong).
//
// @see .planning/phases/07-dev-tools-admin/07-04-PLAN.md (Task 1 — DEV-06)
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-177
// @see .planning/phases/07-dev-tools-admin/07-01-SUMMARY.md (BROWSER_AGENT_STEP)
// @see src-tauri/src/browser_agent.rs:268,284 (emit site)

import { useCallback, useEffect, useRef, useState } from 'react';
import { GlassPanel, Button } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context/ToastContext';
import { CapabilityGap, useCapability } from '@/features/providers';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { BrowserAgentStepPayload } from '@/lib/events/payloads';
import {
  browserAction,
  browserAgentLoop,
  browserDescribePage,
  browserSessionStatus,
  connectToUserBrowser,
  webAction,
} from '@/lib/tauri/dev_tools';
import type { BrowserSessionStatus } from '@/lib/tauri/dev_tools';
import './dev-tools.css';
import './dev-tools-rich-b.css';

type ToolTab = 'click' | 'describe' | 'navigate';

interface TraceStep {
  step: number;
  action: string;
  result: string;
  screenshot_b64?: string | null;
  done: boolean;
  is_error?: boolean;
  ts: number;
}

const TAB_PREFIX = 'web:';
const MAX_TRACE_ROWS = 200;

// Phase 11 Plan 11-05 (PROV-08) — capability wrapper. Web automation runs a
// tool-calling agent loop; gate the surface on `tools` capability.
export function WebAutomation() {
  const { hasCapability: hasTools } = useCapability('tools');
  if (!hasTools) {
    return (
      <div style={{ padding: 'var(--s-6)' }} data-testid="web-automation-root">
        <CapabilityGap capability="tools" surfaceLabel="Web automation" />
      </div>
    );
  }
  return <WebAutomationBody />;
}

function WebAutomationBody() {
  const { prefs, setPref } = usePrefs();
  const toast = useToast();

  // Session + agent state ────────────────────────────────────────────────
  const [sessionStatus, setSessionStatus] = useState<BrowserSessionStatus | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [goal, setGoal] = useState('');
  const [maxSteps, setMaxSteps] = useState(10);
  const [running, setRunning] = useState(false);
  const [finalSummary, setFinalSummary] = useState<string | null>(null);

  // Live trace is a ref buffer + rAF flush (mirrors useAgentTimeline pattern
  // from Phase 5, referenced in plan read_first). Cap at 200 steps.
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const bufferRef = useRef<TraceStep[]>([]);
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (bufferRef.current.length === 0) return;
      const incoming = bufferRef.current;
      bufferRef.current = [];
      setTrace((prev) => {
        const next = prev.concat(incoming);
        return next.length > MAX_TRACE_ROWS
          ? next.slice(next.length - MAX_TRACE_ROWS)
          : next;
      });
    });
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // Live-trace subscription (BROWSER_AGENT_STEP — Plan 07-01 added this).
  useTauriEvent<BrowserAgentStepPayload>(BLADE_EVENTS.BROWSER_AGENT_STEP, (e) => {
    const p = e.payload;
    if (!p) return;
    bufferRef.current.push({
      step: p.step,
      action: p.action,
      result: p.result,
      screenshot_b64: p.screenshot_b64 ?? null,
      done: Boolean(p.done),
      is_error: Boolean(p.is_error),
      ts: Date.now(),
    });
    flush();
  });

  // Initial session status fetch.
  const refreshStatus = useCallback(async () => {
    try {
      const s = await browserSessionStatus();
      setSessionStatus(s);
      setSessionError(null);
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const connected = Boolean(
    sessionStatus && (sessionStatus.connected === true || sessionStatus.active === true),
  );

  // Connect to user browser.
  const handleConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const result = await connectToUserBrowser();
      toast.show({
        type: 'success',
        title: 'Browser connected',
        message: result.slice(0, 80),
      });
      await refreshStatus();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Connect failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConnecting(false);
    }
  };

  // Run the agent loop.
  const handleRun = async () => {
    if (running || !goal.trim()) return;
    setRunning(true);
    setTrace([]);
    bufferRef.current = [];
    setFinalSummary(null);
    try {
      const summary = await browserAgentLoop({ goal, maxSteps });
      setFinalSummary(summary);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Agent loop failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRunning(false);
    }
  };

  // Tool panel state ─────────────────────────────────────────────────────
  const activeToolRaw = prefs['devTools.activeTab'];
  const activeTool: ToolTab =
    typeof activeToolRaw === 'string' && activeToolRaw.startsWith(TAB_PREFIX)
      ? ((activeToolRaw.slice(TAB_PREFIX.length) as ToolTab) ?? 'click')
      : 'click';
  const setActiveTool = (t: ToolTab) => {
    setPref('devTools.activeTab', `${TAB_PREFIX}${t}`);
  };

  const [clickSelector, setClickSelector] = useState('');
  const [navUrl, setNavUrl] = useState('');
  const [describeResult, setDescribeResult] = useState<string>('');
  const [toolBusy, setToolBusy] = useState(false);
  const [toolScreenshot, setToolScreenshot] = useState<string | null>(null);

  const handleClick = async () => {
    if (toolBusy || !clickSelector.trim()) return;
    setToolBusy(true);
    try {
      const result = await browserAction({
        action: 'click',
        selector: clickSelector,
      });
      toast.show({ type: 'info', title: 'Click dispatched', message: result.slice(0, 100) });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Click failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setToolBusy(false);
    }
  };

  const handleDescribe = async () => {
    if (toolBusy) return;
    setToolBusy(true);
    try {
      const result = await browserDescribePage('');
      setDescribeResult(result);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Describe failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setToolBusy(false);
    }
  };

  const handleNavigate = async () => {
    if (toolBusy || !navUrl.trim()) return;
    setToolBusy(true);
    try {
      const result = await webAction({
        sessionId: '',
        actionType: 'navigate',
        target: navUrl,
        value: '',
      });
      toast.show({
        type: 'info',
        title: 'Navigation dispatched',
        message: result.slice(0, 100),
      });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Navigate failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setToolBusy(false);
    }
  };

  // Screenshot from latest trace step (if any).
  const latestStepScreenshot = (() => {
    for (let i = trace.length - 1; i >= 0; i -= 1) {
      const s = trace[i];
      if (s.screenshot_b64) return s.screenshot_b64;
    }
    return null;
  })();

  const displayScreenshot = toolScreenshot ?? latestStepScreenshot;

  return (
    <GlassPanel tier={1} className="dev-surface" data-testid="web-automation-root">
      {/* Top bar: session status chip + connect button */}
      <div className="web-automation-topbar">
        <span
          className="web-automation-status-chip"
          data-connected={String(connected)}
          data-testid="web-automation-session-chip"
        >
          {connected ? 'Session connected' : sessionError ? 'Session error' : 'No session'}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleConnect}
          disabled={connecting}
          data-testid="web-automation-connect-button"
        >
          {connecting ? 'Connecting…' : 'Connect'}
        </Button>
      </div>

      {/* Goal input + run */}
      <div className="dev-card" style={{ marginTop: 'var(--s-2)' }}>
        <div className="devtools-b-section-header">
          <h3>Goal</h3>
          <span style={{ fontSize: 12, color: 'var(--t-3)' }}>
            Max steps: {maxSteps}
          </span>
        </div>
        <textarea
          className="web-automation-textarea"
          placeholder="Describe the task for the browser agent…"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          data-testid="web-automation-goal-input"
        />
        <div className="web-automation-inline-row">
          <label style={{ fontSize: 12, color: 'var(--t-3)' }}>Max steps</label>
          <input
            type="number"
            min={1}
            max={50}
            value={maxSteps}
            onChange={(e) => setMaxSteps(Math.max(1, Number(e.target.value) || 1))}
            className="web-automation-selector-input"
            style={{ width: 80 }}
          />
          <Button
            variant="primary"
            onClick={handleRun}
            disabled={running || !goal.trim()}
            data-testid="web-automation-run-button"
          >
            {running ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      {/* Tool panel (pill tabs) */}
      <div className="dev-card" style={{ marginTop: 'var(--s-2)' }}>
        <div className="dev-tab-row">
          {(['click', 'describe', 'navigate'] as ToolTab[]).map((t) => (
            <button
              key={t}
              type="button"
              className="dev-tab-pill"
              data-active={String(activeTool === t)}
              onClick={() => setActiveTool(t)}
              data-testid={`web-automation-tool-tab-${t}`}
            >
              {t === 'click' ? 'Click' : t === 'describe' ? 'Describe page' : 'Navigate'}
            </button>
          ))}
        </div>
        {activeTool === 'click' && (
          <div className="web-automation-inline-row">
            <input
              className="web-automation-selector-input"
              placeholder="CSS selector…"
              value={clickSelector}
              onChange={(e) => setClickSelector(e.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleClick}
              disabled={toolBusy || !clickSelector.trim()}
            >
              Click
            </Button>
          </div>
        )}
        {activeTool === 'describe' && (
          <div className="web-automation-inline-row">
            <Button variant="secondary" size="sm" onClick={handleDescribe} disabled={toolBusy}>
              Describe
            </Button>
            {describeResult && (
              <pre
                className="web-automation-step-row"
                style={{ marginTop: 'var(--s-2)', flex: 1, maxHeight: 160 }}
              >
                {describeResult}
              </pre>
            )}
          </div>
        )}
        {activeTool === 'navigate' && (
          <div className="web-automation-inline-row">
            <input
              className="web-automation-selector-input"
              placeholder="https://…"
              value={navUrl}
              onChange={(e) => setNavUrl(e.target.value)}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleNavigate}
              disabled={toolBusy || !navUrl.trim()}
            >
              Go
            </Button>
          </div>
        )}
      </div>

      {/* Split: live trace + screenshot pane */}
      <div className="web-automation-layout" style={{ marginTop: 'var(--s-2)' }}>
        <div className="dev-card">
          <div className="devtools-b-section-header">
            <h3>Live trace</h3>
            <span style={{ fontSize: 11, color: 'var(--t-3)' }}>
              {trace.length} step{trace.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="web-automation-trace" data-testid="web-automation-trace">
            {trace.length === 0 ? (
              <div className="dev-placeholder-hint">
                {running ? 'Awaiting step events…' : 'Run a goal to populate the trace.'}
              </div>
            ) : (
              trace.map((s, i) => (
                <div
                  key={`${s.step}-${i}`}
                  className="web-automation-step-row"
                  data-final={String(s.done)}
                  data-error={String(Boolean(s.is_error))}
                  data-testid="web-automation-step-row"
                >
                  <strong>[{s.step}] {s.action}</strong>
                  {'\n'}
                  {s.result}
                </div>
              ))
            )}
          </div>
          {finalSummary && (
            <div
              className="web-automation-step-row"
              style={{ marginTop: 'var(--s-2)', borderLeft: '3px solid var(--status-success)' }}
              data-testid="web-automation-summary"
            >
              <strong>Summary</strong>
              {'\n'}
              {finalSummary}
            </div>
          )}
        </div>
        <div className="dev-card web-automation-screenshot">
          <div className="devtools-b-section-header">
            <h3>Screenshot</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setToolScreenshot(null)}
              disabled={!toolScreenshot}
            >
              Clear
            </Button>
          </div>
          {displayScreenshot ? (
            <img
              src={`data:image/png;base64,${displayScreenshot}`}
              alt="Latest browser screenshot"
              data-testid="web-automation-screenshot"
            />
          ) : (
            <div className="dev-placeholder-hint">
              No screenshot yet. Run a goal or invoke a tool that returns one.
            </div>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
