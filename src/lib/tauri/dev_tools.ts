// src/lib/tauri/dev_tools.ts
//
// Typed wrappers for the Dev Tools cluster — one per registered Rust
// #[tauri::command] across native_tools.rs, files.rs, file_indexer.rs,
// indexer.rs, git_style.rs, code_sandbox.rs, workflow_builder.rs,
// browser_agent.rs, browser_native.rs, auto_reply.rs, document_intelligence.rs,
// computer_use.rs, automation.rs, ui_automation.rs, reminders.rs, watcher.rs,
// cron.rs (D-167 inventory — 17 modules, ~90 commands).
//
// D-166: per-cluster wrapper module lives HERE (dev-tools cluster only).
// D-167: zero Rust expansion in Phase 7 — every command below is already
//        registered in src-tauri/src/lib.rs generate_handler!.
// D-186: @see Rust cite in JSDoc; invokeTyped only; ESLint no-raw-tauri.
// D-38:  camelCase JS API, snake_case at the invoke boundary. No raw invoke.
//        Return types mirror Rust #[derive(Serialize)] shape verbatim
//        (snake_case fields preserved to match the wire payload).
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-166..D-191
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §1
// @see src-tauri/src/lib.rs:574-1394 generate_handler!

import { invokeTyped } from './_base';

// ═══════════════════════════════════════════════════════════════════════════
// Types — mirror Rust Serialize shape verbatim (snake_case preserved).
// All interfaces carry `[k: string]: unknown` for forward-compat (D-38-payload).
// ═══════════════════════════════════════════════════════════════════════════

// ─── native_tools.rs types ───────────────────────────────────────────────────
//
// Note: `run_shell` and `run_code_block` return `String` (not a structured
// ShellResult). The stdout/stderr/exit_code split happens inside the Rust
// helper `bash()`; the command-level surface flattens to a single text blob.
// Plan 07-03 Terminal will treat the string as stdout for display.

export interface ShellResult {
  /** Combined stdout+stderr text from the shell command. */
  text: string;
  [k: string]: unknown;
}

// ─── files.rs types ──────────────────────────────────────────────────────────

/** @see src-tauri/src/files.rs:7 FileInfo */
export interface FileListEntry {
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
  extension?: string | null;
  [k: string]: unknown;
}

/** @see src-tauri/src/files.rs:23 FileTreeEntry */
export interface FileTreeNode {
  path: string;
  name: string;
  is_dir: boolean;
  extension?: string | null;
  children?: FileTreeNode[] | null;
  [k: string]: unknown;
}

/** @see src-tauri/src/files.rs:17 FileTree (root wrapper) */
export interface FileTreeRoot {
  path: string;
  name: string;
  children: FileTreeNode[];
  [k: string]: unknown;
}

// ─── file_indexer.rs types ───────────────────────────────────────────────────

/** @see src-tauri/src/file_indexer.rs:38 IndexedFile */
export interface FileIndexEntry {
  id: number;
  path: string;
  filename: string;
  extension: string;
  file_type: string;
  size_bytes: number;
  folder: string;
  depth: number;
  created_at: number;
  modified_at: number;
  indexed_at: number;
  [k: string]: unknown;
}

/** Tuple shape of `file_index_stats` — [file_type, count]. */
export type FileIndexStats = Array<[string, number]>;

// ─── indexer.rs types ────────────────────────────────────────────────────────

/** @see src-tauri/src/indexer.rs:35 ProjectIndex */
export interface IndexedProject {
  project: string;
  root_path: string;
  file_count: number;
  symbol_count: number;
  last_indexed: number;
  language_breakdown: Record<string, number>;
  [k: string]: unknown;
}

// ─── git_style.rs types ──────────────────────────────────────────────────────

/** @see src-tauri/src/git_style.rs:19 GitStyleWiki */
export interface GitStyle {
  repo_path: string;
  generated_at: number;
  style_guide: string;
  commit_count_sampled: number;
  languages_detected: string[];
  [k: string]: unknown;
}

// ─── code_sandbox.rs types ───────────────────────────────────────────────────

/** @see src-tauri/src/code_sandbox.rs:17 SandboxResult */
export interface SandboxResult {
  language: string;
  code: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
  success: boolean;
  [k: string]: unknown;
}

// ─── browser_agent.rs + browser_native.rs types ──────────────────────────────
//
// `browser_action` takes a raw `serde_json::Value` (free-form action spec) and
// returns a String result. `browser_agent_loop` returns a String summary.
// `browser_session_status` returns a `serde_json::Value` (shape varies by
// runtime); we type it permissively.

export interface BrowserActionResult {
  result_text: string;
  [k: string]: unknown;
}

export interface BrowserAgentStep {
  step: number;
  action?: string;
  description?: string;
  [k: string]: unknown;
}

export type BrowserSessionStatus = Record<string, unknown>;

export type PageDescription = string;

// ─── auto_reply.rs types ─────────────────────────────────────────────────────
//
// `auto_reply_draft` returns a String draft; `auto_reply_draft_batch` returns
// `Vec<serde_json::Value>` — treat batch items permissively.

export interface AutoReplyDraft {
  draft: string;
  [k: string]: unknown;
}

export type AutoReplyBatchItem = Record<string, unknown>;

// ─── document_intelligence.rs types ──────────────────────────────────────────

/** @see src-tauri/src/document_intelligence.rs:14 Document */
export interface Document {
  id: string;
  title: string;
  file_path: string;
  doc_type: string;
  content: string;
  summary: string;
  key_points: string[];
  topics: string[];
  word_count: number;
  added_at: number;
  last_accessed: number;
  [k: string]: unknown;
}

/** Document search results are `Vec<Document>` — same shape. */
export type DocSearchResult = Document;

/** @see src-tauri/src/document_intelligence.rs:37 DocQA */
export interface DocAnswer {
  question: string;
  answer: string;
  doc_ids_used: string[];
  confidence: number;
  relevant_quotes: string[];
  [k: string]: unknown;
}

/** `doc_cross_synthesis` returns a String synthesis. */
export type DocSynthesis = string;

/** `doc_generate_study_notes` returns a String notes blob. */
export type StudyNotes = string;

// ─── computer_use.rs types ───────────────────────────────────────────────────

/** @see src-tauri/src/computer_use.rs:46 ComputerUseResult */
export interface ComputerUseTask {
  success: boolean;
  steps_taken: number;
  result: string;
  [k: string]: unknown;
}

/** `computer_use_screenshot` returns a base64 PNG string. */
export type ComputerUseScreenshot = string;

// ─── automation.rs types ─────────────────────────────────────────────────────

/** @see src-tauri/src/automation.rs:5 AutomationResult */
export interface AutomationResult {
  success: boolean;
  message: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/automation.rs:12 MousePosition */
export interface MousePosition {
  x: number;
  y: number;
  [k: string]: unknown;
}

// ─── ui_automation.rs types ──────────────────────────────────────────────────

/** @see src-tauri/src/ui_automation.rs:38 UiSelector */
export interface UiSelector {
  name?: string | null;
  automation_id?: string | null;
  class_name?: string | null;
  control_type?: string | null;
  [k: string]: unknown;
}

/** Bounds shape (ui_automation.rs UiBounds). */
export interface UiBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  [k: string]: unknown;
}

/** Per-element summary (ui_automation.rs UiElementSummary). */
export interface UiElement {
  name?: string;
  class_name?: string;
  control_type?: string;
  automation_id?: string;
  is_enabled?: boolean;
  is_focused?: boolean;
  bounds?: UiBounds;
  [k: string]: unknown;
}

/** @see src-tauri/src/ui_automation.rs:27 UiWindowSnapshot */
export interface UiaSnapshot {
  window_name: string;
  window_class_name: string;
  window_control_type: string;
  bounds: UiBounds;
  focused_element?: UiElement | null;
  elements: UiElement[];
  [k: string]: unknown;
}

// ─── reminders.rs types ──────────────────────────────────────────────────────

/** @see src-tauri/src/reminders.rs:17 Reminder */
export interface Reminder {
  id: string;
  title: string;
  note: string;
  fire_at: number;
  fired: boolean;
  created_at: number;
  [k: string]: unknown;
}

/** `reminder_parse_time` returns `Option<i64>` — unix timestamp or null. */
export type ReminderParsed = number | null;

// ─── watcher.rs types ────────────────────────────────────────────────────────

/** @see src-tauri/src/watcher.rs:24 Watcher */
export interface Watcher {
  id: string;
  url: string;
  label: string;
  interval_mins: number;
  last_content_hash: string;
  last_checked: number;
  last_changed: number;
  active: boolean;
  created_at: number;
  [k: string]: unknown;
}

// ─── cron.rs types ───────────────────────────────────────────────────────────

/** @see src-tauri/src/cron.rs:37 CronSchedule */
export interface CronSchedule {
  /** "daily" | "weekly" | "interval" | "hourly" */
  kind: string;
  time_of_day?: number | null;
  day_of_week?: number | null;
  interval_secs?: number | null;
  [k: string]: unknown;
}

/** CronAction is a free-form Rust struct that varies by action kind. */
export type CronAction = Record<string, unknown>;

/** @see src-tauri/src/cron.rs:23 CronTask */
export interface CronJob {
  id: string;
  name: string;
  description: string;
  schedule: CronSchedule;
  action: CronAction;
  enabled: boolean;
  last_run?: number | null;
  next_run: number;
  run_count: number;
  created_at: number;
  [k: string]: unknown;
}

/** Cron run log — not a distinct Rust struct today; placeholder for Plan 07-03. */
export type CronRun = Record<string, unknown>;

// ═══════════════════════════════════════════════════════════════════════════
// native_tools.rs — bash + code block + ask AI (3 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/native_tools.rs:2988 run_shell
 * Rust signature: `run_shell(command: String, cwd: Option<String>) -> Result<String, String>`.
 * Returns combined stdout+stderr as a single text blob (D-167 note — no
 * structured ShellResult at the command surface).
 */
export function runShell(args: { command: string; cwd?: string }): Promise<string> {
  return invokeTyped<string, { command: string; cwd?: string }>('run_shell', {
    command: args.command,
    cwd: args.cwd,
  });
}

/**
 * @see src-tauri/src/native_tools.rs:2977 run_code_block
 * Rust signature: `run_code_block(command: String) -> Result<String, String>`.
 * Note: Despite the name, Rust takes a single `command` string and executes via
 * bash (not a language+code pair). Plan 07-04 CodeSandbox uses `sandboxRun` for
 * structured multi-language execution.
 */
export function runCodeBlock(command: string): Promise<string> {
  return invokeTyped<string, { command: string }>('run_code_block', { command });
}

/**
 * @see src-tauri/src/native_tools.rs:2997 ask_ai
 * Rust signature: `ask_ai(prompt: String) -> Result<String, String>`.
 */
export function askAi(prompt: string): Promise<string> {
  return invokeTyped<string, { prompt: string }>('ask_ai', { prompt });
}

// ═══════════════════════════════════════════════════════════════════════════
// files.rs — filesystem primitives (6 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/files.rs:33 file_read
 * Rust signature: `file_read(path: String) -> Result<String, String>`.
 */
export function fileRead(path: string): Promise<string> {
  return invokeTyped<string, { path: string }>('file_read', { path });
}

/**
 * @see src-tauri/src/files.rs:53 file_write
 * Rust signature: `file_write(path: String, content: String) -> Result<(), String>`.
 */
export function fileWrite(args: { path: string; content: string }): Promise<void> {
  return invokeTyped<void, { path: string; content: string }>('file_write', {
    path: args.path,
    content: args.content,
  });
}

/**
 * @see src-tauri/src/files.rs:63 file_list
 * Rust signature: `file_list(path: String) -> Result<Vec<FileInfo>, String>`.
 */
export function fileList(path: string): Promise<FileListEntry[]> {
  return invokeTyped<FileListEntry[], { path: string }>('file_list', { path });
}

/**
 * @see src-tauri/src/files.rs:103 file_tree
 * Rust signature: `file_tree(path: String, max_depth: Option<u32>) -> Result<FileTree, String>`.
 * Note: Rust parameter is `max_depth`, not `depth`. Plan 07-03 FileBrowser
 * passes `depth: 2` and we convert at the invoke boundary.
 */
export function fileTree(args: { path: string; depth?: number }): Promise<FileTreeRoot> {
  return invokeTyped<FileTreeRoot, { path: string; max_depth?: number }>('file_tree', {
    path: args.path,
    max_depth: args.depth,
  });
}

/**
 * @see src-tauri/src/files.rs:171 file_exists
 * Rust signature: `file_exists(path: String) -> bool`.
 */
export function fileExists(path: string): Promise<boolean> {
  return invokeTyped<boolean, { path: string }>('file_exists', { path });
}

/**
 * @see src-tauri/src/files.rs:177 file_mkdir
 * Rust signature: `file_mkdir(path: String) -> Result<(), String>`.
 */
export function fileMkdir(path: string): Promise<void> {
  return invokeTyped<void, { path: string }>('file_mkdir', { path });
}

// ═══════════════════════════════════════════════════════════════════════════
// file_indexer.rs — system-wide file index (4 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/file_indexer.rs:429 file_index_scan_now
 * Rust signature: `file_index_scan_now() -> u32`.
 */
export function fileIndexScanNow(): Promise<number> {
  return invokeTyped<number>('file_index_scan_now');
}

/**
 * @see src-tauri/src/file_indexer.rs:434 file_index_search
 * Rust signature: `file_index_search(query: String, file_type: Option<String>, limit: Option<usize>) -> Vec<IndexedFile>`.
 */
export function fileIndexSearch(args: {
  query: string;
  fileType?: string;
  limit?: number;
}): Promise<FileIndexEntry[]> {
  return invokeTyped<FileIndexEntry[], { query: string; file_type?: string; limit?: number }>(
    'file_index_search',
    {
      query: args.query,
      file_type: args.fileType,
      limit: args.limit,
    },
  );
}

/**
 * @see src-tauri/src/file_indexer.rs:439 file_index_recent
 * Rust signature: `file_index_recent(hours: Option<u32>, limit: Option<usize>) -> Vec<IndexedFile>`.
 */
export function fileIndexRecent(args: {
  hours?: number;
  limit?: number;
}): Promise<FileIndexEntry[]> {
  return invokeTyped<FileIndexEntry[], { hours?: number; limit?: number }>('file_index_recent', {
    hours: args.hours,
    limit: args.limit,
  });
}

/**
 * @see src-tauri/src/file_indexer.rs:444 file_index_stats
 * Rust signature: `file_index_stats() -> Vec<(String, i64)>`.
 */
export function fileIndexStats(): Promise<FileIndexStats> {
  return invokeTyped<FileIndexStats>('file_index_stats');
}

// ═══════════════════════════════════════════════════════════════════════════
// indexer.rs — project-scoped code index (5 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/indexer.rs:574 blade_index_project
 * Rust signature: `blade_index_project(project: String, path: String) -> Result<String, String>`.
 */
export function bladeIndexProject(args: {
  project: string;
  path: string;
}): Promise<string> {
  return invokeTyped<string, { project: string; path: string }>('blade_index_project', {
    project: args.project,
    path: args.path,
  });
}

/**
 * @see src-tauri/src/indexer.rs:585 blade_find_symbol
 * Rust signature: `blade_find_symbol(query: String, project: Option<String>) -> String`.
 * Returns a formatted string of matches (not a structured list).
 */
export function bladeFindSymbol(args: { query: string; project?: string }): Promise<string> {
  return invokeTyped<string, { query: string; project?: string }>('blade_find_symbol', {
    query: args.query,
    project: args.project,
  });
}

/**
 * @see src-tauri/src/indexer.rs:598 blade_list_indexed_projects
 * Rust signature: `blade_list_indexed_projects() -> Vec<ProjectIndex>`.
 */
export function bladeListIndexedProjects(): Promise<IndexedProject[]> {
  return invokeTyped<IndexedProject[]>('blade_list_indexed_projects');
}

/**
 * @see src-tauri/src/indexer.rs:604 blade_reindex_file
 * Rust signature: `blade_reindex_file(file_path: String, project: String) -> Result<usize, String>`.
 */
export function bladeReindexFile(args: {
  filePath: string;
  project: string;
}): Promise<number> {
  return invokeTyped<number, { file_path: string; project: string }>('blade_reindex_file', {
    file_path: args.filePath,
    project: args.project,
  });
}

/**
 * @see src-tauri/src/indexer.rs:611 blade_project_summary
 * Rust signature: `blade_project_summary(project: String) -> String`.
 */
export function bladeProjectSummary(project: string): Promise<string> {
  return invokeTyped<string, { project: string }>('blade_project_summary', { project });
}

// ═══════════════════════════════════════════════════════════════════════════
// git_style.rs — commit-style mining (3 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/git_style.rs:209 git_style_mine
 * Rust signature: `git_style_mine(repo_path: String) -> Result<GitStyleWiki, String>`.
 */
export function gitStyleMine(repoPath: string): Promise<GitStyle> {
  return invokeTyped<GitStyle, { repo_path: string }>('git_style_mine', {
    repo_path: repoPath,
  });
}

/**
 * @see src-tauri/src/git_style.rs:214 git_style_get
 * Rust signature: `git_style_get(repo_path: String) -> Option<GitStyleWiki>`.
 */
export function gitStyleGet(repoPath: string): Promise<GitStyle | null> {
  return invokeTyped<GitStyle | null, { repo_path: string }>('git_style_get', {
    repo_path: repoPath,
  });
}

/**
 * @see src-tauri/src/git_style.rs:219 git_style_clear
 * Rust signature: `git_style_clear(repo_path: String)`.
 */
export function gitStyleClear(repoPath: string): Promise<void> {
  return invokeTyped<void, { repo_path: string }>('git_style_clear', {
    repo_path: repoPath,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// code_sandbox.rs — safe multi-language execution (4 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/code_sandbox.rs:696 sandbox_run
 * Rust signature: `sandbox_run(language: String, code: String, timeout_secs: Option<u64>) -> Result<SandboxResult, String>`.
 */
export function sandboxRun(args: {
  language: string;
  code: string;
  timeoutSecs?: number;
}): Promise<SandboxResult> {
  return invokeTyped<SandboxResult, { language: string; code: string; timeout_secs?: number }>(
    'sandbox_run',
    {
      language: args.language,
      code: args.code,
      timeout_secs: args.timeoutSecs,
    },
  );
}

/**
 * @see src-tauri/src/code_sandbox.rs:707 sandbox_run_explain
 * Rust signature: `sandbox_run_explain(language: String, code: String) -> Result<String, String>`.
 */
export function sandboxRunExplain(args: { language: string; code: string }): Promise<string> {
  return invokeTyped<string, { language: string; code: string }>('sandbox_run_explain', {
    language: args.language,
    code: args.code,
  });
}

/**
 * @see src-tauri/src/code_sandbox.rs:716 sandbox_fix_and_run
 * Rust signature: `sandbox_fix_and_run(language: String, code: String, error: String, app: AppHandle) -> Result<SandboxResult, String>`.
 * Note: `app` is injected by Tauri — JS only passes the first three args.
 */
export function sandboxFixAndRun(args: {
  language: string;
  code: string;
  error: string;
}): Promise<SandboxResult> {
  return invokeTyped<SandboxResult, { language: string; code: string; error: string }>(
    'sandbox_fix_and_run',
    {
      language: args.language,
      code: args.code,
      error: args.error,
    },
  );
}

/**
 * @see src-tauri/src/code_sandbox.rs:727 sandbox_detect_language
 * Rust signature: `sandbox_detect_language(code: String) -> String`.
 */
export function sandboxDetectLanguage(code: string): Promise<string> {
  return invokeTyped<string, { code: string }>('sandbox_detect_language', { code });
}

// ═══════════════════════════════════════════════════════════════════════════
// browser_agent.rs — CDP automation + vision-driven agent (2 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/browser_agent.rs:115 browser_action
 * Rust signature: `browser_action(action_json: serde_json::Value) -> Result<String, String>`.
 */
export function browserAction(actionJson: unknown): Promise<string> {
  return invokeTyped<string, { action_json: unknown }>('browser_action', {
    action_json: actionJson,
  });
}

/**
 * @see src-tauri/src/browser_agent.rs:181 browser_agent_loop
 * Rust signature: `browser_agent_loop(app: AppHandle, goal: String, max_steps: u32) -> Result<String, String>`.
 */
export function browserAgentLoop(args: {
  goal: string;
  maxSteps: number;
}): Promise<string> {
  return invokeTyped<string, { goal: string; max_steps: number }>('browser_agent_loop', {
    goal: args.goal,
    max_steps: args.maxSteps,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// browser_native.rs — browser session orchestration (4 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/browser_native.rs:536 web_action
 * Rust signature: `web_action(session_id: String, action_type: String, target: String, value: String, ...) -> ...`.
 * Note: accepts additional optional fields per the Rust fn; only the four
 * required strings are surfaced here — Plan 07-04 WebAutomation passes them.
 */
export function webAction(args: {
  sessionId: string;
  actionType: string;
  target: string;
  value: string;
}): Promise<string> {
  return invokeTyped<
    string,
    { session_id: string; action_type: string; target: string; value: string }
  >('web_action', {
    session_id: args.sessionId,
    action_type: args.actionType,
    target: args.target,
    value: args.value,
  });
}

/**
 * @see src-tauri/src/browser_native.rs:531 browser_describe_page
 * Rust signature: `browser_describe_page(session_id: String) -> Result<String, String>`.
 */
export function browserDescribePage(sessionId: string): Promise<PageDescription> {
  return invokeTyped<PageDescription, { session_id: string }>('browser_describe_page', {
    session_id: sessionId,
  });
}

/**
 * @see src-tauri/src/browser_native.rs:494 browser_session_status
 * Rust signature: `browser_session_status() -> Result<serde_json::Value, String>`.
 */
export function browserSessionStatus(): Promise<BrowserSessionStatus> {
  return invokeTyped<BrowserSessionStatus>('browser_session_status');
}

/**
 * @see src-tauri/src/browser_native.rs:104 connect_to_user_browser
 * Rust signature: `connect_to_user_browser() -> Result<String, String>`.
 */
export function connectToUserBrowser(): Promise<string> {
  return invokeTyped<string>('connect_to_user_browser');
}

// ═══════════════════════════════════════════════════════════════════════════
// auto_reply.rs — draft replies in user's style (3 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/auto_reply.rs:223 auto_reply_draft
 * Rust signature: `auto_reply_draft(sender: String, message: String, platform: String, thread_context: Option<String>) -> Result<String, String>`.
 */
export function autoReplyDraft(args: {
  sender: string;
  message: string;
  platform: string;
  threadContext?: string;
}): Promise<string> {
  return invokeTyped<
    string,
    { sender: string; message: string; platform: string; thread_context?: string }
  >('auto_reply_draft', {
    sender: args.sender,
    message: args.message,
    platform: args.platform,
    thread_context: args.threadContext,
  });
}

/**
 * @see src-tauri/src/auto_reply.rs:241 auto_reply_learn_from_edit
 * Rust signature: `auto_reply_learn_from_edit(sender: String, original: String, edited: String)`.
 */
export function autoReplyLearnFromEdit(args: {
  sender: string;
  original: string;
  edited: string;
}): Promise<void> {
  return invokeTyped<void, { sender: string; original: string; edited: string }>(
    'auto_reply_learn_from_edit',
    {
      sender: args.sender,
      original: args.original,
      edited: args.edited,
    },
  );
}

/**
 * @see src-tauri/src/auto_reply.rs:275 auto_reply_draft_batch
 * Rust signature: `auto_reply_draft_batch(messages: Vec<serde_json::Value>) -> Vec<serde_json::Value>`.
 */
export function autoReplyDraftBatch(messages: unknown[]): Promise<AutoReplyBatchItem[]> {
  return invokeTyped<AutoReplyBatchItem[], { messages: unknown[] }>('auto_reply_draft_batch', {
    messages,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// document_intelligence.rs — ingest + search + Q&A over docs (8 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/document_intelligence.rs:790 doc_ingest
 * Rust signature: `doc_ingest(file_path: String) -> Result<Document, String>`.
 */
export function docIngest(filePath: string): Promise<Document> {
  return invokeTyped<Document, { file_path: string }>('doc_ingest', { file_path: filePath });
}

/**
 * @see src-tauri/src/document_intelligence.rs:795 doc_search
 * Rust signature: `doc_search(query: String) -> Vec<Document>`.
 */
export function docSearch(query: string): Promise<DocSearchResult[]> {
  return invokeTyped<DocSearchResult[], { query: string }>('doc_search', { query });
}

/**
 * @see src-tauri/src/document_intelligence.rs:801 doc_get
 * Rust signature: `doc_get(id: String) -> Option<Document>`.
 */
export function docGet(id: string): Promise<Document | null> {
  return invokeTyped<Document | null, { id: string }>('doc_get', { id });
}

/**
 * @see src-tauri/src/document_intelligence.rs:815 doc_list
 * Rust signature: `doc_list(limit: Option<usize>) -> Vec<Document>`.
 */
export function docList(limit?: number): Promise<Document[]> {
  return invokeTyped<Document[], { limit?: number }>('doc_list', { limit });
}

/**
 * @see src-tauri/src/document_intelligence.rs:821 doc_delete
 * Rust signature: `doc_delete(id: String) -> Result<(), String>`.
 */
export function docDelete(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('doc_delete', { id });
}

/**
 * @see src-tauri/src/document_intelligence.rs:827 doc_answer_question
 * Rust signature: `doc_answer_question(question: String, doc_ids: Option<Vec<String>>) -> Result<DocQA, String>`.
 */
export function docAnswerQuestion(args: {
  question: string;
  docIds?: string[];
}): Promise<DocAnswer> {
  return invokeTyped<DocAnswer, { question: string; doc_ids?: string[] }>('doc_answer_question', {
    question: args.question,
    doc_ids: args.docIds,
  });
}

/**
 * @see src-tauri/src/document_intelligence.rs:835 doc_cross_synthesis
 * Rust signature: `doc_cross_synthesis(question: String) -> String`.
 */
export function docCrossSynthesis(question: string): Promise<DocSynthesis> {
  return invokeTyped<DocSynthesis, { question: string }>('doc_cross_synthesis', { question });
}

/**
 * @see src-tauri/src/document_intelligence.rs:840 doc_generate_study_notes
 * Rust signature: `doc_generate_study_notes(doc_id: String) -> String`.
 */
export function docGenerateStudyNotes(docId: string): Promise<StudyNotes> {
  return invokeTyped<StudyNotes, { doc_id: string }>('doc_generate_study_notes', {
    doc_id: docId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// computer_use.rs — vision-driven desktop agent (3 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/computer_use.rs:55 computer_use_task
 * Rust signature: `computer_use_task(app: AppHandle, goal: String, max_steps: Option<usize>) -> Result<ComputerUseResult, String>`.
 */
export function computerUseTask(args: {
  goal: string;
  maxSteps?: number;
}): Promise<ComputerUseTask> {
  return invokeTyped<ComputerUseTask, { goal: string; max_steps?: number }>(
    'computer_use_task',
    {
      goal: args.goal,
      max_steps: args.maxSteps,
    },
  );
}

/**
 * @see src-tauri/src/computer_use.rs:339 computer_use_stop
 * Rust signature: `computer_use_stop()`.
 */
export function computerUseStop(): Promise<void> {
  return invokeTyped<void>('computer_use_stop');
}

/**
 * @see src-tauri/src/computer_use.rs:345 computer_use_screenshot
 * Rust signature: `computer_use_screenshot() -> Result<String, String>`.
 * Returns a base64-encoded PNG of the current screen.
 */
export function computerUseScreenshot(): Promise<ComputerUseScreenshot> {
  return invokeTyped<ComputerUseScreenshot>('computer_use_screenshot');
}

// ═══════════════════════════════════════════════════════════════════════════
// automation.rs — enigo-backed input + app launch (15 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/automation.rs:21 auto_type_text
 * Rust signature: `auto_type_text(text: String) -> Result<AutomationResult, String>`.
 */
export function autoTypeText(text: string): Promise<AutomationResult> {
  return invokeTyped<AutomationResult, { text: string }>('auto_type_text', { text });
}

/**
 * @see src-tauri/src/automation.rs:33 auto_press_key
 * Rust signature: `auto_press_key(key: String) -> Result<AutomationResult, String>`.
 */
export function autoPressKey(key: string): Promise<AutomationResult> {
  return invokeTyped<AutomationResult, { key: string }>('auto_press_key', { key });
}

/**
 * @see src-tauri/src/automation.rs:46 auto_key_combo
 * Rust signature: `auto_key_combo(modifiers: Vec<String>, key: String) -> Result<AutomationResult, String>`.
 */
export function autoKeyCombo(args: {
  modifiers: string[];
  key: string;
}): Promise<AutomationResult> {
  return invokeTyped<AutomationResult, { modifiers: string[]; key: string }>('auto_key_combo', {
    modifiers: args.modifiers,
    key: args.key,
  });
}

/**
 * @see src-tauri/src/automation.rs:76 auto_mouse_move
 * Rust signature: `auto_mouse_move(x: i32, y: i32) -> Result<AutomationResult, String>`.
 */
export function autoMouseMove(args: { x: number; y: number }): Promise<AutomationResult> {
  return invokeTyped<AutomationResult, { x: number; y: number }>('auto_mouse_move', {
    x: args.x,
    y: args.y,
  });
}

/**
 * @see src-tauri/src/automation.rs:88 auto_get_mouse_position
 * Rust signature: `auto_get_mouse_position() -> Result<MousePosition, String>`.
 */
export function autoGetMousePosition(): Promise<MousePosition> {
  return invokeTyped<MousePosition>('auto_get_mouse_position');
}

/**
 * @see src-tauri/src/automation.rs:95 auto_mouse_click
 * Rust signature: `auto_mouse_click(x: Option<i32>, y: Option<i32>, button: Option<String>) -> Result<AutomationResult, String>`.
 */
export function autoMouseClick(args: {
  x?: number;
  y?: number;
  button?: string;
}): Promise<AutomationResult> {
  return invokeTyped<AutomationResult, { x?: number; y?: number; button?: string }>(
    'auto_mouse_click',
    { x: args.x, y: args.y, button: args.button },
  );
}

/**
 * @see src-tauri/src/automation.rs:122 auto_mouse_click_relative
 * Rust signature: `auto_mouse_click_relative(dx: i32, dy: i32, button: Option<String>) -> Result<AutomationResult, String>`.
 */
export function autoMouseClickRelative(args: {
  dx: number;
  dy: number;
  button?: string;
}): Promise<AutomationResult> {
  return invokeTyped<AutomationResult, { dx: number; dy: number; button?: string }>(
    'auto_mouse_click_relative',
    { dx: args.dx, dy: args.dy, button: args.button },
  );
}

/**
 * @see src-tauri/src/automation.rs:152 auto_mouse_double_click
 * Rust signature: `auto_mouse_double_click(x: Option<i32>, y: Option<i32>, button: Option<String>) -> Result<AutomationResult, String>`.
 */
export function autoMouseDoubleClick(args: {
  x?: number;
  y?: number;
  button?: string;
}): Promise<AutomationResult> {
  return invokeTyped<AutomationResult, { x?: number; y?: number; button?: string }>(
    'auto_mouse_double_click',
    { x: args.x, y: args.y, button: args.button },
  );
}

/**
 * @see src-tauri/src/automation.rs:182 auto_mouse_drag
 * Rust signature: `auto_mouse_drag(from_x: i32, from_y: i32, to_x: i32, to_y: i32, ...) -> Result<AutomationResult, String>`.
 */
export function autoMouseDrag(args: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}): Promise<AutomationResult> {
  return invokeTyped<
    AutomationResult,
    { from_x: number; from_y: number; to_x: number; to_y: number }
  >('auto_mouse_drag', {
    from_x: args.fromX,
    from_y: args.fromY,
    to_x: args.toX,
    to_y: args.toY,
  });
}

/**
 * @see src-tauri/src/automation.rs:276 auto_scroll
 * Rust signature: `auto_scroll(dx: i32, dy: i32) -> Result<AutomationResult, String>`.
 */
export function autoScroll(args: { dx: number; dy: number }): Promise<AutomationResult> {
  return invokeTyped<AutomationResult, { dx: number; dy: number }>('auto_scroll', {
    dx: args.dx,
    dy: args.dy,
  });
}

/**
 * @see src-tauri/src/automation.rs:218 auto_open_url
 * Rust signature: `auto_open_url(url: String) -> Result<AutomationResult, String>`.
 */
export function autoOpenUrl(url: string): Promise<AutomationResult> {
  return invokeTyped<AutomationResult, { url: string }>('auto_open_url', { url });
}

/**
 * @see src-tauri/src/automation.rs:245 auto_open_path
 * Rust signature: `auto_open_path(path: String) -> Result<AutomationResult, String>`.
 */
export function autoOpenPath(path: string): Promise<AutomationResult> {
  return invokeTyped<AutomationResult, { path: string }>('auto_open_path', { path });
}

/**
 * @see src-tauri/src/automation.rs:227 auto_launch_app
 * Rust signature: `auto_launch_app(command: String, args: Option<Vec<String>>) -> Result<AutomationResult, String>`.
 * Note: Rust parameter is `args` but colliding with our JS outer arg object —
 * we expose `launchArgs` on the JS side and convert at the invoke boundary.
 */
export function autoLaunchApp(args: {
  command: string;
  launchArgs?: string[];
}): Promise<AutomationResult> {
  return invokeTyped<AutomationResult, { command: string; args?: string[] }>('auto_launch_app', {
    command: args.command,
    args: args.launchArgs,
  });
}

/**
 * @see src-tauri/src/automation.rs:254 auto_copy_to_clipboard
 * Rust signature: `auto_copy_to_clipboard(text: String) -> Result<AutomationResult, String>`.
 */
export function autoCopyToClipboard(text: string): Promise<AutomationResult> {
  return invokeTyped<AutomationResult, { text: string }>('auto_copy_to_clipboard', { text });
}

/**
 * @see src-tauri/src/automation.rs:263 auto_paste_clipboard
 * Rust signature: `auto_paste_clipboard() -> Result<AutomationResult, String>`.
 */
export function autoPasteClipboard(): Promise<AutomationResult> {
  return invokeTyped<AutomationResult>('auto_paste_clipboard');
}

// ═══════════════════════════════════════════════════════════════════════════
// ui_automation.rs — Windows UI Automation (7 commands, stubs on non-Windows)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/ui_automation.rs:53 uia_get_active_window_snapshot
 * Rust signature: `uia_get_active_window_snapshot(max_depth: Option<u32>, max_children: Option<u32>) -> Result<UiWindowSnapshot, String>`.
 */
export function uiaGetActiveWindowSnapshot(args: {
  maxDepth?: number;
  maxChildren?: number;
}): Promise<UiaSnapshot> {
  return invokeTyped<UiaSnapshot, { max_depth?: number; max_children?: number }>(
    'uia_get_active_window_snapshot',
    {
      max_depth: args.maxDepth,
      max_children: args.maxChildren,
    },
  );
}

/**
 * @see src-tauri/src/ui_automation.rs:61 uia_describe_active_window
 * Rust signature: `uia_describe_active_window(max_depth: Option<u32>, max_children: Option<u32>, max_lines: Option<u32>) -> Result<String, String>`.
 */
export function uiaDescribeActiveWindow(args: {
  maxDepth?: number;
  maxChildren?: number;
  maxLines?: number;
}): Promise<string> {
  return invokeTyped<
    string,
    { max_depth?: number; max_children?: number; max_lines?: number }
  >('uia_describe_active_window', {
    max_depth: args.maxDepth,
    max_children: args.maxChildren,
    max_lines: args.maxLines,
  });
}

/**
 * @see src-tauri/src/ui_automation.rs:70 uia_click_element
 * Rust signature: `uia_click_element(selector: UiSelector) -> Result<String, String>`.
 */
export function uiaClickElement(selector: UiSelector): Promise<string> {
  return invokeTyped<string, { selector: UiSelector }>('uia_click_element', { selector });
}

/**
 * @see src-tauri/src/ui_automation.rs:80 uia_invoke_element
 * Rust signature: `uia_invoke_element(selector: UiSelector) -> Result<String, String>`.
 */
export function uiaInvokeElement(selector: UiSelector): Promise<string> {
  return invokeTyped<string, { selector: UiSelector }>('uia_invoke_element', { selector });
}

/**
 * @see src-tauri/src/ui_automation.rs:96 uia_focus_element
 * Rust signature: `uia_focus_element(selector: UiSelector) -> Result<String, String>`.
 */
export function uiaFocusElement(selector: UiSelector): Promise<string> {
  return invokeTyped<string, { selector: UiSelector }>('uia_focus_element', { selector });
}

/**
 * @see src-tauri/src/ui_automation.rs:106 uia_set_element_value
 * Rust signature: `uia_set_element_value(selector: UiSelector, value: String) -> Result<String, String>`.
 */
export function uiaSetElementValue(args: {
  selector: UiSelector;
  value: string;
}): Promise<string> {
  return invokeTyped<string, { selector: UiSelector; value: string }>('uia_set_element_value', {
    selector: args.selector,
    value: args.value,
  });
}

/**
 * @see src-tauri/src/ui_automation.rs:128 uia_wait_for_element
 * Rust signature: `uia_wait_for_element(selector: UiSelector, timeout_ms: Option<u64>) -> Result<String, String>`.
 */
export function uiaWaitForElement(args: {
  selector: UiSelector;
  timeoutMs?: number;
}): Promise<string> {
  return invokeTyped<string, { selector: UiSelector; timeout_ms?: number }>(
    'uia_wait_for_element',
    {
      selector: args.selector,
      timeout_ms: args.timeoutMs,
    },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// reminders.rs — time-based reminders (5 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/reminders.rs:320 reminder_add
 * Rust signature: `reminder_add(title: String, note: String, fire_at: i64) -> Result<String, String>`.
 */
export function reminderAdd(args: {
  title: string;
  note: string;
  fireAt: number;
}): Promise<string> {
  return invokeTyped<string, { title: string; note: string; fire_at: number }>('reminder_add', {
    title: args.title,
    note: args.note,
    fire_at: args.fireAt,
  });
}

/**
 * @see src-tauri/src/reminders.rs:341 reminder_add_natural
 * Rust signature: `reminder_add_natural(title: String, note: String, time_expression: String) -> Result<String, String>`.
 */
export function reminderAddNatural(args: {
  title: string;
  note: string;
  timeExpression: string;
}): Promise<string> {
  return invokeTyped<
    string,
    { title: string; note: string; time_expression: string }
  >('reminder_add_natural', {
    title: args.title,
    note: args.note,
    time_expression: args.timeExpression,
  });
}

/**
 * @see src-tauri/src/reminders.rs:353 reminder_list
 * Rust signature: `reminder_list() -> Vec<Reminder>`.
 */
export function reminderList(): Promise<Reminder[]> {
  return invokeTyped<Reminder[]>('reminder_list');
}

/**
 * @see src-tauri/src/reminders.rs:358 reminder_delete
 * Rust signature: `reminder_delete(id: String) -> Result<(), String>`.
 */
export function reminderDelete(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('reminder_delete', { id });
}

/**
 * @see src-tauri/src/reminders.rs:367 reminder_parse_time
 * Rust signature: `reminder_parse_time(expression: String) -> Option<i64>`.
 */
export function reminderParseTime(expression: string): Promise<ReminderParsed> {
  return invokeTyped<ReminderParsed, { expression: string }>('reminder_parse_time', {
    expression,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// watcher.rs — URL change watchers (4 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/watcher.rs:289 watcher_add
 * Rust signature: `watcher_add(url: String, label: String, interval_mins: Option<i64>) -> Result<String, String>`.
 */
export function watcherAdd(args: {
  url: string;
  label: string;
  intervalMins?: number;
}): Promise<string> {
  return invokeTyped<string, { url: string; label: string; interval_mins?: number }>(
    'watcher_add',
    {
      url: args.url,
      label: args.label,
      interval_mins: args.intervalMins,
    },
  );
}

/**
 * @see src-tauri/src/watcher.rs:312 watcher_list_all
 * Rust signature: `watcher_list_all() -> Vec<Watcher>`.
 */
export function watcherListAll(): Promise<Watcher[]> {
  return invokeTyped<Watcher[]>('watcher_list_all');
}

/**
 * @see src-tauri/src/watcher.rs:317 watcher_remove
 * Rust signature: `watcher_remove(id: String) -> Result<(), String>`.
 */
export function watcherRemove(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('watcher_remove', { id });
}

/**
 * @see src-tauri/src/watcher.rs:325 watcher_toggle
 * Rust signature: `watcher_toggle(id: String, active: bool) -> Result<(), String>`.
 */
export function watcherToggle(args: { id: string; active: boolean }): Promise<void> {
  return invokeTyped<void, { id: string; active: boolean }>('watcher_toggle', {
    id: args.id,
    active: args.active,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// cron.rs — scheduled tasks (5 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/cron.rs:299 cron_add
 * Rust signature: `cron_add(name: String, description: String, schedule_text: String, action_kind: String, ...) -> Result<String, String>`.
 * Note: Rust fn takes a fifth `action_payload: serde_json::Value` for action
 * config; we pass it as an optional `actionPayload` arg.
 */
export function cronAdd(args: {
  name: string;
  description: string;
  scheduleText: string;
  actionKind: string;
  actionPayload?: unknown;
}): Promise<string> {
  return invokeTyped<
    string,
    {
      name: string;
      description: string;
      schedule_text: string;
      action_kind: string;
      action_payload?: unknown;
    }
  >('cron_add', {
    name: args.name,
    description: args.description,
    schedule_text: args.scheduleText,
    action_kind: args.actionKind,
    action_payload: args.actionPayload,
  });
}

/**
 * @see src-tauri/src/cron.rs:335 cron_list
 * Rust signature: `cron_list() -> Vec<CronTask>`.
 */
export function cronList(): Promise<CronJob[]> {
  return invokeTyped<CronJob[]>('cron_list');
}

/**
 * @see src-tauri/src/cron.rs:349 cron_delete
 * Rust signature: `cron_delete(id: String) -> Result<(), String>`.
 */
export function cronDelete(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('cron_delete', { id });
}

/**
 * @see src-tauri/src/cron.rs:357 cron_toggle
 * Rust signature: `cron_toggle(id: String, enabled: bool) -> Result<(), String>`.
 */
export function cronToggle(args: { id: string; enabled: boolean }): Promise<void> {
  return invokeTyped<void, { id: string; enabled: boolean }>('cron_toggle', {
    id: args.id,
    enabled: args.enabled,
  });
}

/**
 * @see src-tauri/src/cron.rs:388 cron_run_now
 * Rust signature: `cron_run_now(app: AppHandle, id: String) -> Result<(), String>`.
 */
export function cronRunNow(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('cron_run_now', { id });
}
