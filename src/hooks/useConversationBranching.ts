import { useState, useCallback, useEffect, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BranchMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

export interface ConversationBranch {
  id: string;
  parentBranchId: string | null;
  name: string;
  branchPoint: number; // message index where this branch diverged
  messages: BranchMessage[];
  createdAt: number;
  isActive: boolean;
}

export interface BranchTree {
  branches: ConversationBranch[];
  activeBranchId: string;
  conversationId: string;
}

export interface BranchComparison {
  branchA: { id: string; name: string };
  branchB: { id: string; name: string };
  shared: BranchMessage[];
  onlyA: BranchMessage[];
  onlyB: BranchMessage[];
  divergeIndex: number;
}

export interface BranchTreeNode {
  branch: ConversationBranch;
  children: BranchTreeNode[];
  depth: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function storageKey(conversationId: string): string {
  return `blade-branches-${conversationId}`;
}

function generateId(): string {
  return `br_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadTree(conversationId: string): BranchTree | null {
  try {
    const raw = localStorage.getItem(storageKey(conversationId));
    if (!raw) return null;
    return JSON.parse(raw) as BranchTree;
  } catch {
    return null;
  }
}

function saveTree(tree: BranchTree): void {
  try {
    localStorage.setItem(storageKey(tree.conversationId), JSON.stringify(tree));
  } catch {
    // storage full — silently degrade
  }
}

function createMainBranch(): ConversationBranch {
  return {
    id: "main",
    parentBranchId: null,
    name: "main",
    branchPoint: 0,
    messages: [],
    createdAt: Date.now(),
    isActive: true,
  };
}

function buildTreeNodes(branches: ConversationBranch[]): BranchTreeNode[] {
  const map = new Map<string | null, ConversationBranch[]>();
  for (const b of branches) {
    const parent = b.parentBranchId;
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent)!.push(b);
  }

  function recurse(parentId: string | null, depth: number): BranchTreeNode[] {
    const children = map.get(parentId) ?? [];
    return children
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((branch) => ({
        branch,
        children: recurse(branch.id, depth + 1),
        depth,
      }));
  }

  return recurse(null, 0);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useConversationBranching(conversationId: string) {
  const [tree, setTree] = useState<BranchTree>(() => {
    const existing = loadTree(conversationId);
    if (existing) return existing;
    const main = createMainBranch();
    return { branches: [main], activeBranchId: "main", conversationId };
  });

  // Re-load when conversationId changes
  useEffect(() => {
    const existing = loadTree(conversationId);
    if (existing) {
      setTree(existing);
    } else {
      const main = createMainBranch();
      setTree({ branches: [main], activeBranchId: "main", conversationId });
    }
  }, [conversationId]);

  // Persist every change
  useEffect(() => {
    saveTree(tree);
  }, [tree]);

  // ---- Derived ----

  const branches = tree.branches;

  const activeBranch = useMemo(
    () => branches.find((b) => b.id === tree.activeBranchId) ?? branches[0],
    [branches, tree.activeBranchId],
  );

  // ---- Sync messages into the active branch (call from chat) ----

  const syncMessages = useCallback(
    (messages: BranchMessage[]) => {
      setTree((prev) => ({
        ...prev,
        branches: prev.branches.map((b) =>
          b.id === prev.activeBranchId ? { ...b, messages } : b,
        ),
      }));
    },
    [],
  );

  // ---- Create branch ----

  const createBranch = useCallback(
    (name: string, atMessageIndex: number): ConversationBranch => {
      const parentBranch =
        tree.branches.find((b) => b.id === tree.activeBranchId) ?? tree.branches[0];

      const copiedMessages = parentBranch.messages.slice(0, atMessageIndex + 1);

      const newBranch: ConversationBranch = {
        id: generateId(),
        parentBranchId: parentBranch.id,
        name: name.trim() || `branch-${tree.branches.length}`,
        branchPoint: atMessageIndex,
        messages: copiedMessages.map((m) => ({ ...m })),
        createdAt: Date.now(),
        isActive: false,
      };

      setTree((prev) => ({
        ...prev,
        branches: [
          ...prev.branches.map((b) => ({ ...b, isActive: false })),
          { ...newBranch, isActive: true },
        ],
        activeBranchId: newBranch.id,
      }));

      return newBranch;
    },
    [tree],
  );

  // ---- Switch branch ----

  const switchBranch = useCallback(
    (branchId: string) => {
      setTree((prev) => {
        const target = prev.branches.find((b) => b.id === branchId);
        if (!target) return prev;
        return {
          ...prev,
          branches: prev.branches.map((b) => ({
            ...b,
            isActive: b.id === branchId,
          })),
          activeBranchId: branchId,
        };
      });
    },
    [],
  );

  // ---- Delete branch ----

  const deleteBranch = useCallback(
    (branchId: string): boolean => {
      if (branchId === "main") return false; // can never delete main

      setTree((prev) => {
        const filtered = prev.branches.filter((b) => b.id !== branchId);
        // If we deleted the active branch, fall back to main
        const needsFallback = prev.activeBranchId === branchId;
        const newActive = needsFallback ? "main" : prev.activeBranchId;
        return {
          ...prev,
          branches: filtered.map((b) => ({
            ...b,
            isActive: b.id === newActive,
            // Reparent children of deleted branch to its parent
            parentBranchId:
              b.parentBranchId === branchId
                ? prev.branches.find((d) => d.id === branchId)?.parentBranchId ?? null
                : b.parentBranchId,
          })),
          activeBranchId: newActive,
        };
      });

      return true;
    },
    [],
  );

  // ---- Merge branch into main ----

  const mergeBranch = useCallback(
    (branchId: string) => {
      setTree((prev) => {
        const source = prev.branches.find((b) => b.id === branchId);
        const main = prev.branches.find((b) => b.id === "main");
        if (!source || !main) return prev;

        // Find the unique messages that are only in the source branch
        const mainIds = new Set(main.messages.map((m) => m.id));
        const uniqueMessages = source.messages.filter((m) => !mainIds.has(m.id));

        const mergedMain: ConversationBranch = {
          ...main,
          messages: [...main.messages, ...uniqueMessages],
          isActive: true,
        };

        return {
          ...prev,
          branches: prev.branches.map((b) => {
            if (b.id === "main") return mergedMain;
            return { ...b, isActive: false };
          }),
          activeBranchId: "main",
        };
      });
    },
    [],
  );

  // ---- Rename branch ----

  const renameBranch = useCallback(
    (branchId: string, newName: string) => {
      if (branchId === "main") return; // main is immutable
      setTree((prev) => ({
        ...prev,
        branches: prev.branches.map((b) =>
          b.id === branchId ? { ...b, name: newName.trim() || b.name } : b,
        ),
      }));
    },
    [],
  );

  // ---- Compare branches ----

  const compareBranches = useCallback(
    (branchAId: string, branchBId: string): BranchComparison | null => {
      const a = tree.branches.find((b) => b.id === branchAId);
      const bBranch = tree.branches.find((b) => b.id === branchBId);
      if (!a || !bBranch) return null;

      // Walk both message arrays to find where they diverge
      const minLen = Math.min(a.messages.length, bBranch.messages.length);
      let divergeIndex = minLen;
      for (let i = 0; i < minLen; i++) {
        if (a.messages[i].id !== bBranch.messages[i].id) {
          divergeIndex = i;
          break;
        }
      }

      return {
        branchA: { id: a.id, name: a.name },
        branchB: { id: bBranch.id, name: bBranch.name },
        shared: a.messages.slice(0, divergeIndex),
        onlyA: a.messages.slice(divergeIndex),
        onlyB: bBranch.messages.slice(divergeIndex),
        divergeIndex,
      };
    },
    [tree.branches],
  );

  // ---- Build visual tree ----

  const getBranchTree = useCallback((): BranchTreeNode[] => {
    return buildTreeNodes(tree.branches);
  }, [tree.branches]);

  return {
    branches,
    activeBranch,
    createBranch,
    switchBranch,
    deleteBranch,
    mergeBranch,
    renameBranch,
    compareBranches,
    getBranchTree,
    syncMessages,
    tree,
  };
}
