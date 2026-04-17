import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitFileStatus {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: Array<{ path: string; status: "added" | "modified" | "deleted" | "renamed" }>;
  unstaged: Array<{ path: string; status: "modified" | "deleted" | "untracked" }>;
  stashes: number;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: number;
  filesChanged: number;
}

export interface GitDiff {
  path: string;
  additions: number;
  deletions: number;
  hunks: Array<{ header: string; lines: string[] }>;
}

export interface GitBranch {
  name: string;
  current: boolean;
  lastCommit: string;
}

// ---------------------------------------------------------------------------
// Helpers — run git commands through the Tauri backend
// ---------------------------------------------------------------------------

async function gitExec(args: string[], cwd: string): Promise<string> {
  return invoke<string>("git_command", { args, cwd });
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function parseStatusCode(code: string): GitFileStatus["status"] {
  switch (code) {
    case "A": return "added";
    case "M": return "modified";
    case "D": return "deleted";
    case "R": return "renamed";
    case "?": return "untracked";
    default:  return "modified";
  }
}

function parseStatus(raw: string): Pick<GitStatus, "staged" | "unstaged"> {
  const staged: GitStatus["staged"] = [];
  const unstaged: GitStatus["unstaged"] = [];

  for (const line of raw.split("\n").filter(Boolean)) {
    const index = line[0];
    const work = line[1];
    const path = line.slice(3).trim();

    if (index === "?" && work === "?") {
      unstaged.push({ path, status: "untracked" });
    } else {
      if (index && index !== " " && index !== "?") {
        staged.push({ path, status: parseStatusCode(index) as GitStatus["staged"][0]["status"] });
      }
      if (work && work !== " " && work !== "?") {
        unstaged.push({ path, status: parseStatusCode(work) as GitStatus["unstaged"][0]["status"] });
      }
    }
  }

  return { staged, unstaged };
}

function parseBranchInfo(raw: string): { branch: string; ahead: number; behind: number } {
  let branch = "HEAD (detached)";
  let ahead = 0;
  let behind = 0;

  const branchMatch = raw.match(/^## (\S+?)(?:\.\.\.(\S+))?(?:\s+\[(.+)])?$/m);
  if (branchMatch) {
    branch = branchMatch[1];
    const tracking = branchMatch[3] || "";
    const aheadMatch = tracking.match(/ahead (\d+)/);
    const behindMatch = tracking.match(/behind (\d+)/);
    if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
    if (behindMatch) behind = parseInt(behindMatch[1], 10);
  }

  return { branch, ahead, behind };
}

function parseLog(raw: string): GitCommit[] {
  if (!raw.trim()) return [];
  return raw
    .trim()
    .split("\n")
    .map((line) => {
      const [hash, shortHash, author, dateStr, filesStr, ...msgParts] = line.split("\x00");
      return {
        hash,
        shortHash,
        message: msgParts.join("\x00"),
        author,
        date: parseInt(dateStr, 10) * 1000,
        filesChanged: parseInt(filesStr, 10) || 0,
      };
    })
    .filter((c) => c.hash);
}

function parseDiff(raw: string): GitDiff[] {
  const diffs: GitDiff[] = [];
  const fileBlocks = raw.split(/^diff --git /m).filter(Boolean);

  for (const block of fileBlocks) {
    const pathMatch = block.match(/^a\/(.+?) b\//);
    const path = pathMatch ? pathMatch[1] : "unknown";
    let additions = 0;
    let deletions = 0;
    const hunks: GitDiff["hunks"] = [];

    const lines = block.split("\n");
    let currentHunk: GitDiff["hunks"][0] | null = null;

    for (const line of lines) {
      const hunkHeader = line.match(/^@@\s+(.+?)\s+@@(.*)$/);
      if (hunkHeader) {
        if (currentHunk) hunks.push(currentHunk);
        currentHunk = { header: hunkHeader[1] + (hunkHeader[2] ? " " + hunkHeader[2] : ""), lines: [] };
        continue;
      }
      if (currentHunk) {
        currentHunk.lines.push(line);
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
    }
    if (currentHunk) hunks.push(currentHunk);

    diffs.push({ path, additions, deletions, hunks });
  }

  return diffs;
}

function parseBranches(raw: string): GitBranch[] {
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const current = line.startsWith("*");
      const parts = line.replace(/^\*?\s+/, "").split(/\s+/);
      return {
        name: parts[0],
        current,
        lastCommit: parts.slice(1).join(" "),
      };
    });
}

function parseStashCount(raw: string): number {
  return raw.trim() ? raw.trim().split("\n").length : 0;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGit(repoPath?: string) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [log, setLog] = useState<GitCommit[]>([]);
  const [diff, setDiff] = useState<GitDiff[]>([]);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cwdRef = useRef(repoPath || ".");

  useEffect(() => {
    if (repoPath) cwdRef.current = repoPath;
  }, [repoPath]);

  const cwd = () => cwdRef.current;

  // -- Refresh all git state -----------------------------------------------
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [porcelain, branchRaw, logRaw, diffRaw, stashRaw, branchList] = await Promise.all([
        gitExec(["status", "--porcelain"], cwd()),
        gitExec(["status", "--branch", "--porcelain"], cwd()),
        gitExec(["log", "--format=%H%x00%h%x00%an%x00%ct%x00%x00%s", "-30"], cwd()),
        gitExec(["diff"], cwd()),
        gitExec(["stash", "list"], cwd()),
        gitExec(["branch", "-v", "--no-color"], cwd()),
      ]);

      const { staged, unstaged } = parseStatus(porcelain);
      const { branch, ahead, behind } = parseBranchInfo(branchRaw);
      const stashes = parseStashCount(stashRaw);

      setStatus({ branch, ahead, behind, staged, unstaged, stashes });
      setLog(parseLog(logRaw));
      setDiff(parseDiff(diffRaw));
      setBranches(parseBranches(branchList));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // -- Stage / unstage -----------------------------------------------------
  const stage = useCallback(async (paths: string[]) => {
    await gitExec(["add", "--", ...paths], cwd());
    await refresh();
  }, [refresh]);

  const unstage = useCallback(async (paths: string[]) => {
    await gitExec(["reset", "HEAD", "--", ...paths], cwd());
    await refresh();
  }, [refresh]);

  const stageAll = useCallback(async () => {
    await gitExec(["add", "-A"], cwd());
    await refresh();
  }, [refresh]);

  const unstageAll = useCallback(async () => {
    await gitExec(["reset", "HEAD"], cwd());
    await refresh();
  }, [refresh]);

  // -- Commit --------------------------------------------------------------
  const commit = useCallback(async (message: string) => {
    await gitExec(["commit", "-m", message], cwd());
    await refresh();
  }, [refresh]);

  // -- Branch ops ----------------------------------------------------------
  const checkout = useCallback(async (branchName: string) => {
    await gitExec(["checkout", branchName], cwd());
    await refresh();
  }, [refresh]);

  const createBranch = useCallback(async (branchName: string) => {
    await gitExec(["checkout", "-b", branchName], cwd());
    await refresh();
  }, [refresh]);

  // -- Stash ---------------------------------------------------------------
  const stash = useCallback(async () => {
    await gitExec(["stash", "push"], cwd());
    await refresh();
  }, [refresh]);

  const unstash = useCallback(async () => {
    await gitExec(["stash", "pop"], cwd());
    await refresh();
  }, [refresh]);

  // -- Push / Pull ---------------------------------------------------------
  const push = useCallback(async () => {
    await gitExec(["push"], cwd());
    await refresh();
  }, [refresh]);

  const pull = useCallback(async () => {
    await gitExec(["pull"], cwd());
    await refresh();
  }, [refresh]);

  // -- AI helpers ----------------------------------------------------------
  const aiCommitMessage = useCallback(async (): Promise<string> => {
    const stagedDiff = await gitExec(["diff", "--cached"], cwd());
    if (!stagedDiff.trim()) {
      const allDiff = await gitExec(["diff"], cwd());
      if (!allDiff.trim()) return "No changes to describe.";
      return `[AI] Suggested commit message for unstaged changes:\n\nPlease stage files first, then request an AI commit message.\n\nCurrent diff preview:\n\`\`\`diff\n${allDiff.slice(0, 3000)}\n\`\`\``;
    }
    const prompt = `Generate a concise, conventional commit message for these staged changes. Use the format: type(scope): description\n\nDiff:\n\`\`\`diff\n${stagedDiff.slice(0, 4000)}\n\`\`\`\n\nRespond with ONLY the commit message, nothing else.`;
    return prompt;
  }, []);

  const aiReviewDiff = useCallback(async (): Promise<string> => {
    const currentDiff = await gitExec(["diff"], cwd());
    const stagedDiff = await gitExec(["diff", "--cached"], cwd());
    const fullDiff = (stagedDiff + "\n" + currentDiff).trim();
    if (!fullDiff) return "No changes to review.";
    return `Review this code diff. Point out bugs, security issues, performance concerns, and suggest improvements:\n\n\`\`\`diff\n${fullDiff.slice(0, 6000)}\n\`\`\``;
  }, []);

  const getCommitDiff = useCallback(async (hash: string): Promise<GitDiff[]> => {
    const raw = await gitExec(["show", "--format=", hash], cwd());
    return parseDiff(raw);
  }, []);

  // -- Auto-refresh on mount -----------------------------------------------
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    status,
    log,
    diff,
    branches,
    loading,
    error,
    stage,
    unstage,
    stageAll,
    unstageAll,
    commit,
    checkout,
    createBranch,
    stash,
    unstash,
    push,
    pull,
    aiCommitMessage,
    aiReviewDiff,
    getCommitDiff,
    refresh,
  };
}
