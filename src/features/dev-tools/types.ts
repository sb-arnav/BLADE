// src/features/dev-tools/types.ts
// Cluster-local barrel — re-exports Tauri wrapper types + UI-only types.
//
// Plans 07-03 and 07-04 import payload types from here (single import path)
// and add their own UI-only types via future extensions.
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-188

export type {
  ShellResult,
  FileListEntry,
  FileTreeNode,
  FileTreeRoot,
  FileIndexEntry,
  FileIndexStats,
  IndexedProject,
  GitStyle,
  SandboxResult,
  BrowserActionResult,
  BrowserAgentStep,
  BrowserSessionStatus,
  PageDescription,
  AutoReplyDraft,
  AutoReplyBatchItem,
  Document,
  DocSearchResult,
  DocAnswer,
  DocSynthesis,
  StudyNotes,
  ComputerUseTask,
  ComputerUseScreenshot,
  AutomationResult,
  MousePosition,
  UiSelector,
  UiBounds,
  UiElement,
  UiaSnapshot,
  Reminder,
  ReminderParsed,
  Watcher,
  CronJob,
  CronSchedule,
  CronAction,
  CronRun,
} from '@/lib/tauri/dev_tools';

// ─── Cluster-only UI types ───────────────────────────────────────────────────

export type DevToolsTabKey = string;

export interface TerminalLine {
  type: 'cmd' | 'stdout' | 'stderr';
  text: string;
}
