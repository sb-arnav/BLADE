// src/features/dev-tools/GitPanel.tsx — Plan 07-03 Task 1 (DEV-03).
//
// Real body per D-174 — git style miner with honest deferral for diff/history.
// Backend currently exposes ONLY the style miner (git_style.rs), so the panel
// surfaces that directly and is explicit about what ships in Phase 9 polish.
//
// Destructive ops gated behind Dialog confirm (T-07-03-03 mitigation).
//
// @see .planning/phases/07-dev-tools-admin/07-03-PLAN.md Task 1
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-174

import { useCallback, useEffect, useState } from 'react';
import { GlassPanel, Button, Dialog, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { gitStyleGet, gitStyleMine, gitStyleClear } from '@/lib/tauri/dev_tools';
import type { GitStyle } from '@/lib/tauri/dev_tools';
import './dev-tools.css';
import './dev-tools-rich-a.css';

const DEFAULT_REPO = '/home/arnav/blade';

function formatTimestamp(ts: number): string {
  if (!Number.isFinite(ts)) return '—';
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms).toLocaleString();
}

export function GitPanel() {
  const toast = useToast();

  const [style, setStyle] = useState<GitStyle | null>(null);
  const [loading, setLoading] = useState(true);
  const [repoPath, setRepoPath] = useState<string>(DEFAULT_REPO);

  // Mine dialog state
  const [mineOpen, setMineOpen] = useState(false);
  const [mineRepo, setMineRepo] = useState(DEFAULT_REPO);
  const [mineBusy, setMineBusy] = useState(false);

  // Clear confirm state
  const [clearOpen, setClearOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);

  const loadStyle = useCallback(
    async (repo: string) => {
      setLoading(true);
      try {
        const s = await gitStyleGet(repo);
        setStyle(s);
      } catch (err) {
        toast.show({
          type: 'error',
          title: 'Load style failed',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void loadStyle(repoPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doMine = useCallback(async () => {
    const target = mineRepo.trim();
    if (!target) return;
    setMineBusy(true);
    try {
      const result = await gitStyleMine(target);
      setStyle(result);
      setRepoPath(target);
      toast.show({
        type: 'success',
        title: 'Style mined',
        message: `${result.commit_count_sampled} commits sampled`,
      });
      setMineOpen(false);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Mine failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setMineBusy(false);
    }
  }, [mineRepo, toast]);

  const doClear = useCallback(async () => {
    setClearBusy(true);
    try {
      await gitStyleClear(repoPath);
      setStyle(null);
      toast.show({ type: 'success', title: 'Style cleared' });
      setClearOpen(false);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Clear failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setClearBusy(false);
    }
  }, [repoPath, toast]);

  return (
    <GlassPanel tier={1} className="dev-surface" data-testid="git-panel-root">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--s-2)',
          gap: 'var(--s-2)',
        }}
      >
        <div>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              color: 'var(--t-1)',
              margin: 0,
            }}
          >
            Git style
          </h2>
          <p style={{ color: 'var(--t-3)', fontSize: 13, margin: '4px 0 0' }}>
            Commit-message style mined from your recent history.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-1)' }}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setMineRepo(repoPath);
              setMineOpen(true);
            }}
            data-testid="git-style-mine-button"
          >
            Mine git style
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setClearOpen(true)}
            disabled={!style}
            data-testid="git-style-clear-button"
          >
            Clear style
          </Button>
        </div>
      </div>

      <div className="dev-card git-style-card" data-testid="git-style-card">
        {loading && <div className="dev-placeholder-hint">Loading style…</div>}
        {!loading && !style && (
          <div className="dev-placeholder-hint">
            No style mined yet for <code>{repoPath}</code>. Click "Mine git style" above to
            generate one from your recent commits.
          </div>
        )}
        {!loading && style && (
          <>
            <div className="git-style-meta">
              <span>
                <strong style={{ color: 'var(--t-2)' }}>Repo:</strong>{' '}
                <code style={{ fontFamily: 'var(--font-mono)' }}>{style.repo_path}</code>
              </span>
              <span>
                <strong style={{ color: 'var(--t-2)' }}>Commits sampled:</strong>{' '}
                {style.commit_count_sampled}
              </span>
              <span>
                <strong style={{ color: 'var(--t-2)' }}>Generated:</strong>{' '}
                {formatTimestamp(style.generated_at)}
              </span>
              {style.languages_detected.length > 0 && (
                <span>
                  <strong style={{ color: 'var(--t-2)' }}>Languages:</strong>{' '}
                  {style.languages_detected.join(', ')}
                </span>
              )}
            </div>
            <pre className="git-style-guide" data-testid="git-style-guide">
              {style.style_guide}
            </pre>
          </>
        )}
      </div>

      <div style={{ marginTop: 'var(--s-2)' }}>
        <div className="deferred-card" data-testid="git-deferred-card">
          <h3>Git operations</h3>
          <p>
            Diff viewer, commit history browsing, and PR management ship in Phase 9 polish —
            backend currently exposes only the style miner via{' '}
            <code>git_style.rs</code>.
          </p>
        </div>
      </div>

      {/* Mine Dialog */}
      <Dialog open={mineOpen} onClose={() => setMineOpen(false)} ariaLabel="Mine git style">
        <h3 className="dialog-title">Mine git style</h3>
        <div className="dialog-body">
          <label>
            Repo path
            <Input
              mono
              value={mineRepo}
              onChange={(e) => setMineRepo(e.target.value)}
              placeholder="/home/arnav/blade"
              aria-label="Repository path"
              data-testid="git-mine-repo-input"
            />
          </label>
          <p style={{ color: 'var(--t-3)', fontSize: 12, margin: 0 }}>
            Samples up to 100 recent commits from the repo and extracts your typical
            commit-message structure.
          </p>
        </div>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => setMineOpen(false)} disabled={mineBusy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={doMine}
            disabled={mineBusy || !mineRepo.trim()}
            data-testid="git-mine-confirm"
          >
            {mineBusy ? 'Mining…' : 'Mine'}
          </Button>
        </div>
      </Dialog>

      {/* Clear confirm Dialog */}
      <Dialog open={clearOpen} onClose={() => setClearOpen(false)} ariaLabel="Clear git style">
        <h3 className="dialog-title">Clear git style?</h3>
        <div className="dialog-body">
          <p style={{ color: 'var(--t-2)', margin: 0 }}>
            This removes the cached style guide for <code>{repoPath}</code>. You can mine
            a fresh one anytime.
          </p>
        </div>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => setClearOpen(false)} disabled={clearBusy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={doClear}
            disabled={clearBusy}
            data-testid="git-clear-confirm"
          >
            {clearBusy ? 'Clearing…' : 'Clear'}
          </Button>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
