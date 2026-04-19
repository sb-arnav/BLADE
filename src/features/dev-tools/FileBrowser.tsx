// src/features/dev-tools/FileBrowser.tsx — Plan 07-03 Task 1 (DEV-02).
//
// Real body per D-173 — two-pane tree + preview surface with:
//   - Left pane: FileBrowserTree (eager depth 2, lazy 3+).
//   - Right pane: fileRead preview (`<pre>`, 200KB truncation + Load more).
//   - Top actions: Search (file_index_search), Re-index, Stats Dialog, Watch.
//   - Tabs: "Files" (tree+preview) / "Projects" (blade_list_indexed_projects).
//
// Home directory resolved via @tauri-apps/api/path homeDir() — NOT banned by
// verify:no-raw-tauri (script only bans /core and /event imports outside their
// allowed dirs).
//
// @see .planning/phases/07-dev-tools-admin/07-03-PLAN.md Task 1
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §6

import { useCallback, useEffect, useMemo, useState } from 'react';
import { homeDir } from '@tauri-apps/api/path';
import { GlassPanel, Button, Dialog, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  fileTree,
  fileRead,
  fileIndexSearch,
  fileIndexScanNow,
  fileIndexStats,
  bladeListIndexedProjects,
  bladeProjectSummary,
  bladeFindSymbol,
  bladeIndexProject,
  watcherAdd,
  watcherListAll,
} from '@/lib/tauri/dev_tools';
import type {
  FileTreeRoot,
  FileIndexEntry,
  FileIndexStats,
  IndexedProject,
  Watcher,
} from '@/lib/tauri/dev_tools';
import { FileBrowserTree } from './FileBrowserTree';
import './dev-tools.css';
import './dev-tools-rich-a.css';

type TabKey = 'files' | 'projects';
const HOME_FALLBACK = '/home/arnav';
// 200KB truncation threshold per D-173 — increased in 200KB steps via "Load more".
const PREVIEW_STEP = 200 * 1024;

export function FileBrowser() {
  const toast = useToast();

  const [tab, setTab] = useState<TabKey>('files');
  const [home, setHome] = useState<string>(HOME_FALLBACK);
  const [root, setRoot] = useState<FileTreeRoot | null>(null);
  const [rootLoading, setRootLoading] = useState(true);

  // Preview state
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewLimit, setPreviewLimit] = useState<number>(PREVIEW_STEP);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileIndexEntry[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);

  // Stats / watcher state
  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState<FileIndexStats | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [watcherBusy, setWatcherBusy] = useState(false);

  // Projects tab state
  const [projects, setProjects] = useState<IndexedProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectSummary, setProjectSummary] = useState<Record<string, string>>({});
  const [symbolQuery, setSymbolQuery] = useState<Record<string, string>>({});
  const [symbolResult, setSymbolResult] = useState<Record<string, string>>({});
  const [indexOpen, setIndexOpen] = useState(false);
  const [indexName, setIndexName] = useState('');
  const [indexPath, setIndexPath] = useState('');
  const [indexBusy, setIndexBusy] = useState(false);

  // Resolve home dir + initial tree on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let resolvedHome = HOME_FALLBACK;
      try {
        resolvedHome = await homeDir();
      } catch {
        // Plugin not registered / denied — use hardcoded fallback per plan.
      }
      if (cancelled) return;
      setHome(resolvedHome);
      setRootLoading(true);
      try {
        const tree = await fileTree({ path: resolvedHome, depth: 2 });
        if (!cancelled) setRoot(tree);
      } catch (err) {
        if (!cancelled) {
          toast.show({
            type: 'error',
            title: 'Could not load file tree',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (!cancelled) setRootLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  // Load watcher list + projects list lazily.
  useEffect(() => {
    let cancelled = false;
    watcherListAll()
      .then((ws) => {
        if (!cancelled) setWatchers(ws);
      })
      .catch(() => {
        /* non-critical — silent */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab !== 'projects') return;
    let cancelled = false;
    setProjectsLoading(true);
    bladeListIndexedProjects()
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.show({
            type: 'error',
            title: 'Could not list indexed projects',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, toast]);

  const loadPreview = useCallback(
    async (path: string, limit: number) => {
      setPreviewLoading(true);
      try {
        const content = await fileRead(path);
        // Client-side truncation; fileRead returns the whole text blob today.
        setPreviewContent(content.length > limit ? content.slice(0, limit) : content);
        setPreviewLimit(limit);
      } catch (err) {
        setPreviewContent('');
        toast.show({
          type: 'error',
          title: 'File read failed',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setPreviewLoading(false);
      }
    },
    [toast],
  );

  const onSelectPath = useCallback(
    (path: string) => {
      setSelectedPath(path);
      setPreviewLimit(PREVIEW_STEP);
      void loadPreview(path, PREVIEW_STEP);
    },
    [loadPreview],
  );

  const loadMore = useCallback(() => {
    if (!selectedPath) return;
    void loadPreview(selectedPath, previewLimit + PREVIEW_STEP);
  }, [selectedPath, previewLimit, loadPreview]);

  const doSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (q.length === 0) {
      setSearchResults([]);
      return;
    }
    setSearchBusy(true);
    try {
      const results = await fileIndexSearch({ query: q, limit: 50 });
      setSearchResults(results);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Search failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSearchBusy(false);
    }
  }, [searchQuery, toast]);

  const doReindex = useCallback(async () => {
    try {
      const count = await fileIndexScanNow();
      toast.show({
        type: 'success',
        title: 'File index scan complete',
        message: `${count} files indexed`,
      });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Scan failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [toast]);

  const openStats = useCallback(async () => {
    setStatsOpen(true);
    setStatsBusy(true);
    try {
      const s = await fileIndexStats();
      setStats(s);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Stats failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setStatsBusy(false);
    }
  }, [toast]);

  const addWatcher = useCallback(async () => {
    if (!root) return;
    setWatcherBusy(true);
    try {
      // watcher_add (Rust) takes url+label+interval_mins. We use the resolved
      // root path as a label + url placeholder; this is documented as an
      // interim mapping — watcher.rs treats arbitrary identifiers as labels.
      await watcherAdd({
        url: root.path,
        label: `dir:${root.path}`,
        intervalMins: 15,
      });
      const ws = await watcherListAll();
      setWatchers(ws);
      toast.show({
        type: 'success',
        title: 'Watcher added',
        message: root.path,
      });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Watcher add failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setWatcherBusy(false);
    }
  }, [root, toast]);

  const isWatched = useMemo(() => {
    if (!root) return false;
    return watchers.some((w) => w.label === `dir:${root.path}`);
  }, [watchers, root]);

  const loadProjectSummary = useCallback(
    async (project: string) => {
      try {
        const summary = await bladeProjectSummary(project);
        setProjectSummary((prev) => ({ ...prev, [project]: summary }));
      } catch (err) {
        toast.show({
          type: 'error',
          title: `Summary failed for ${project}`,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [toast],
  );

  const doFindSymbol = useCallback(
    async (project: string) => {
      const q = (symbolQuery[project] ?? '').trim();
      if (q.length === 0) return;
      try {
        const result = await bladeFindSymbol({ query: q, project });
        setSymbolResult((prev) => ({ ...prev, [project]: result }));
      } catch (err) {
        toast.show({
          type: 'error',
          title: 'Find symbol failed',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [symbolQuery, toast],
  );

  const doIndexProject = useCallback(async () => {
    const name = indexName.trim();
    const path = indexPath.trim();
    if (!name || !path) return;
    setIndexBusy(true);
    try {
      const status = await bladeIndexProject({ project: name, path });
      toast.show({ type: 'success', title: 'Indexed', message: status });
      const list = await bladeListIndexedProjects();
      setProjects(list);
      setIndexOpen(false);
      setIndexName('');
      setIndexPath('');
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Index failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIndexBusy(false);
    }
  }, [indexName, indexPath, toast]);

  return (
    <GlassPanel tier={1} className="dev-surface" data-testid="file-browser-root">
      {/* Top tabs */}
      <div className="dev-tab-row">
        {(['files', 'projects'] as const).map((t) => (
          <button
            key={t}
            className="dev-tab-pill"
            data-active={tab === t}
            onClick={() => setTab(t)}
            data-testid={`file-browser-tab-${t}`}
          >
            {t === 'files' ? 'Files' : 'Projects'}
          </button>
        ))}
      </div>

      {tab === 'files' && (
        <>
          <div className="file-browser-topbar">
            <span className="file-browser-path" title={root?.path ?? home}>
              {root?.path ?? home}
            </span>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void doSearch();
                }
              }}
              placeholder="Search indexed files…"
              style={{ flex: 1, minWidth: 200 }}
              data-testid="file-browser-search-input"
              aria-label="Search indexed files"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={doSearch}
              disabled={searchBusy}
              data-testid="file-browser-search-button"
            >
              {searchBusy ? 'Searching…' : 'Search'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={doReindex}
              data-testid="file-browser-reindex"
            >
              Re-index
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={openStats}
              data-testid="file-browser-stats"
            >
              Stats
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={addWatcher}
              disabled={watcherBusy || isWatched}
              data-testid="file-browser-watch"
            >
              {isWatched ? 'Watching' : 'Watch this dir'}
            </Button>
          </div>

          {searchResults.length > 0 && (
            <div
              className="file-browser-search-results"
              data-testid="file-browser-search-results"
            >
              {searchResults.map((r) => (
                <div
                  key={r.id}
                  className="file-browser-search-row"
                  onClick={() => onSelectPath(r.path)}
                  title={r.path}
                >
                  {r.filename}{' '}
                  <span style={{ color: 'var(--t-3)', fontSize: 10 }}>— {r.folder}</span>
                </div>
              ))}
            </div>
          )}

          <div className="file-browser-layout">
            <div className="file-browser-tree-pane">
              {rootLoading && <div className="dev-placeholder-hint">Loading tree…</div>}
              {!rootLoading && !root && (
                <div className="dev-placeholder-hint">Tree unavailable.</div>
              )}
              {!rootLoading && root && (
                <FileBrowserTree
                  root={root}
                  onSelect={onSelectPath}
                  selectedPath={selectedPath}
                />
              )}
            </div>
            <div className="file-browser-preview-pane">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--s-1)',
                }}
              >
                <span
                  className="file-browser-path"
                  style={{ maxWidth: '100%' }}
                  title={selectedPath ?? ''}
                >
                  {selectedPath ?? 'Select a file to preview'}
                </span>
                {selectedPath && previewContent.length >= previewLimit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadMore}
                    disabled={previewLoading}
                    data-testid="file-browser-load-more"
                  >
                    Load more
                  </Button>
                )}
              </div>
              <pre className="file-browser-preview" data-testid="file-browser-preview">
                {previewLoading
                  ? 'Loading…'
                  : previewContent || (selectedPath ? '(empty file)' : '')}
              </pre>
            </div>
          </div>
        </>
      )}

      {tab === 'projects' && (
        <>
          <div className="file-browser-topbar">
            <span style={{ color: 'var(--t-3)', fontSize: 13 }}>
              {projectsLoading
                ? 'Loading projects…'
                : `${projects.length} indexed project${projects.length === 1 ? '' : 's'}`}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIndexOpen(true)}
              data-testid="file-browser-index-new"
            >
              Index new
            </Button>
          </div>
          <div
            className="file-browser-projects"
            data-testid="file-browser-projects"
          >
            {projects.map((p) => (
              <div key={p.project} className="dev-card" data-testid="file-browser-project-card">
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong style={{ color: 'var(--t-1)' }}>{p.project}</strong>
                  <span style={{ color: 'var(--t-3)', fontSize: 11 }}>
                    {p.file_count} files · {p.symbol_count} symbols
                  </span>
                </div>
                <div style={{ color: 'var(--t-3)', fontSize: 12, wordBreak: 'break-all' }}>
                  {p.root_path}
                </div>
                <div style={{ display: 'flex', gap: 'var(--s-1)', flexWrap: 'wrap' }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => loadProjectSummary(p.project)}
                  >
                    Summary
                  </Button>
                </div>
                {projectSummary[p.project] && (
                  <pre
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                      margin: 0,
                      color: 'var(--t-2)',
                      maxHeight: 180,
                      overflow: 'auto',
                      background: 'rgba(0,0,0,0.2)',
                      padding: 'var(--s-1)',
                      borderRadius: 'var(--r-xs)',
                    }}
                  >
                    {projectSummary[p.project]}
                  </pre>
                )}
                <div style={{ display: 'flex', gap: 'var(--s-1)' }}>
                  <Input
                    value={symbolQuery[p.project] ?? ''}
                    onChange={(e) =>
                      setSymbolQuery((prev) => ({
                        ...prev,
                        [p.project]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void doFindSymbol(p.project);
                      }
                    }}
                    placeholder="Find symbol…"
                    style={{ flex: 1 }}
                    aria-label={`Find symbol in ${p.project}`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => doFindSymbol(p.project)}
                  >
                    Find
                  </Button>
                </div>
                {symbolResult[p.project] && (
                  <pre
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      whiteSpace: 'pre-wrap',
                      margin: 0,
                      color: 'var(--t-2)',
                      maxHeight: 180,
                      overflow: 'auto',
                      background: 'rgba(0,0,0,0.2)',
                      padding: 'var(--s-1)',
                      borderRadius: 'var(--r-xs)',
                    }}
                  >
                    {symbolResult[p.project]}
                  </pre>
                )}
              </div>
            ))}
            {!projectsLoading && projects.length === 0 && (
              <div className="dev-placeholder-hint">
                No indexed projects yet. Click "Index new" to add one.
              </div>
            )}
          </div>
        </>
      )}

      {/* Stats Dialog */}
      <Dialog open={statsOpen} onClose={() => setStatsOpen(false)} ariaLabel="File index stats">
        <h3 className="dialog-title">File index stats</h3>
        <div className="dialog-body">
          {statsBusy && <div>Loading…</div>}
          {!statsBusy && stats && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '4px 16px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--t-2)',
              }}
            >
              {stats.map(([type, count]) => (
                <div
                  key={type}
                  style={{ display: 'contents' }}
                >
                  <span>{type || '(other)'}</span>
                  <span style={{ color: 'var(--t-1)' }}>{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <Button variant="primary" onClick={() => setStatsOpen(false)}>
            Close
          </Button>
        </div>
      </Dialog>

      {/* Index new project Dialog */}
      <Dialog open={indexOpen} onClose={() => setIndexOpen(false)} ariaLabel="Index new project">
        <h3 className="dialog-title">Index new project</h3>
        <div className="dialog-body">
          <label>
            Project name
            <Input
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              placeholder="my-project"
              aria-label="Project name"
            />
          </label>
          <label>
            Absolute path
            <Input
              mono
              value={indexPath}
              onChange={(e) => setIndexPath(e.target.value)}
              placeholder="/home/arnav/my-project"
              aria-label="Project absolute path"
            />
          </label>
        </div>
        <div className="dialog-actions">
          <Button
            variant="ghost"
            onClick={() => setIndexOpen(false)}
            disabled={indexBusy}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={doIndexProject}
            disabled={indexBusy || !indexName.trim() || !indexPath.trim()}
          >
            {indexBusy ? 'Indexing…' : 'Index'}
          </Button>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
