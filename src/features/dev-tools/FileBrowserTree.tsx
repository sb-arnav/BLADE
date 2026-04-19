// src/features/dev-tools/FileBrowserTree.tsx — Plan 07-03 Task 1 (DEV-02 sub).
//
// Recursive tree sub-component per Pattern §6 + D-173:
//   - Depth-2 eager render from parent; deeper folders lazy-load on expand.
//   - Expanded-paths stored as newline-joined string in Prefs (single-blob
//     discipline D-12).
//   - Leaf click → onSelect(path) callback to parent for preview pane.
//
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §6
// @see .planning/phases/07-dev-tools-admin/07-03-PLAN.md Task 1

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { FileTreeNode, FileTreeRoot } from '@/lib/tauri/dev_tools';
import { fileTree } from '@/lib/tauri/dev_tools';
import { usePrefs } from '@/hooks/usePrefs';

const EXPANDED_KEY = 'devTools.fileBrowser.expandedPaths' as const;

interface Props {
  root: FileTreeRoot;
  onSelect: (path: string) => void;
  selectedPath?: string | null;
}

function nodesByPath(root: FileTreeRoot): Map<string, FileTreeNode[]> {
  // Keep a flat lookup so lazy-loaded children can be injected without
  // rewriting the whole tree. Key is parent path.
  const map = new Map<string, FileTreeNode[]>();
  const walk = (node: FileTreeNode) => {
    if (node.children) {
      map.set(node.path, node.children);
      node.children.forEach(walk);
    }
  };
  map.set(root.path, root.children);
  root.children.forEach(walk);
  return map;
}

export function FileBrowserTree({ root, onSelect, selectedPath }: Props) {
  const { prefs, setPref } = usePrefs();
  const expandedRaw = (prefs[EXPANDED_KEY] as string | undefined) ?? '';
  const expanded = useMemo(
    () => new Set(expandedRaw.split('\n').filter((s) => s.length > 0)),
    [expandedRaw],
  );

  // Lazy-loaded children, keyed by parent path; separate from the eagerly
  // loaded tree so we don't mutate props.
  const [lazyChildren, setLazyChildren] = useState<Map<string, FileTreeNode[]>>(
    () => new Map(),
  );
  const [loadingPath, setLoadingPath] = useState<string | null>(null);

  const eagerChildren = useMemo(() => nodesByPath(root), [root]);

  const childrenFor = useCallback(
    (node: FileTreeNode | FileTreeRoot): FileTreeNode[] | undefined => {
      const lazy = lazyChildren.get(node.path);
      if (lazy) return lazy;
      if ('children' in node && node.children && node.children.length > 0) {
        return node.children;
      }
      const eager = eagerChildren.get(node.path);
      if (eager) return eager;
      return undefined;
    },
    [lazyChildren, eagerChildren],
  );

  const toggleExpand = useCallback(
    async (node: FileTreeNode) => {
      const isExpanding = !expanded.has(node.path);
      const next = new Set(expanded);
      if (isExpanding) {
        next.add(node.path);
        // Lazy-load children if we don't have any yet (depth 3+ per D-173).
        const existing = childrenFor(node);
        if (!existing || existing.length === 0) {
          setLoadingPath(node.path);
          try {
            const fresh = await fileTree({ path: node.path, depth: 1 });
            setLazyChildren((prev) => {
              const m = new Map(prev);
              m.set(node.path, fresh.children);
              return m;
            });
          } catch {
            // Silently treat failed expand as empty; parent surface will toast
            // on explicit user actions (preview, search). Avoid double-toast.
          } finally {
            setLoadingPath(null);
          }
        }
      } else {
        next.delete(node.path);
      }
      setPref(EXPANDED_KEY, Array.from(next).join('\n'));
    },
    [expanded, setPref, childrenFor],
  );

  const renderNode = useCallback(
    (node: FileTreeNode, depth: number): ReactNode => {
      const isOpen = expanded.has(node.path);
      const isLoading = loadingPath === node.path;
      const kids = isOpen ? childrenFor(node) : undefined;
      const isSelected = selectedPath === node.path;
      return (
        <div
          key={node.path}
          className="file-tree-row"
          style={{ paddingLeft: depth * 12 }}
          data-testid="file-tree-row"
        >
          {node.is_dir ? (
            <button
              className="file-tree-toggle"
              onClick={() => void toggleExpand(node)}
              aria-expanded={isOpen}
              title={node.path}
            >
              {isLoading ? '…' : isOpen ? '▾' : '▸'} {node.name}
            </button>
          ) : (
            <button
              className="file-tree-file"
              onClick={() => onSelect(node.path)}
              title={node.path}
              data-selected={isSelected}
              style={isSelected ? { background: 'rgba(255,255,255,0.08)' } : undefined}
            >
              {node.name}
            </button>
          )}
          {isOpen && kids && kids.map((c) => renderNode(c, depth + 1))}
        </div>
      );
    },
    [expanded, loadingPath, toggleExpand, onSelect, childrenFor, selectedPath],
  );

  return (
    <div className="file-tree" data-testid="file-browser-tree">
      <div
        className="file-tree-row"
        style={{ paddingLeft: 0, fontWeight: 600 }}
        data-testid="file-tree-row"
      >
        <span style={{ color: 'var(--t-3)' }} title={root.path}>{root.name || root.path}</span>
      </div>
      {root.children.map((c) => renderNode(c, 1))}
    </div>
  );
}
