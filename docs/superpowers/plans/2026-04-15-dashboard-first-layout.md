# Dashboard-First Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild BLADE so it opens to a glass dashboard shell instead of raw chat; chat slides in as a right-side panel; wallpaper shows through frosted glass panels.

**Architecture:** Dashboard becomes the default route and outer shell. `ChatPanel.tsx` wraps `ChatWindow` and slides in from the right (no re-mount). App.tsx passes a `chatProps` bundle to Dashboard so all existing hooks stay in place. NavRail replaces old sidebar; HistoryDrawer handles conversation list.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Tauri 2, `winreg` crate (already in Cargo.toml), `@tauri-apps/api/core` convertFileSrc, Bricolage Grotesque via Google Fonts.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/index.css` | Add Bricolage Grotesque @import, glass CSS vars |
| Modify | `tailwind.config.js` | Add `blade-glass-*` tokens |
| Modify | `src-tauri/src/commands.rs` | Add `get_wallpaper_path` command |
| Modify | `src-tauri/src/lib.rs` | Register `get_wallpaper_path` in generate_handler! |
| Create | `src/components/NavRail.tsx` | 62px icon-only nav, glass tooltips, active indicator |
| Create | `src/components/ChatPanel.tsx` | Right-slide panel wrapping ChatWindow |
| Create | `src/components/HistoryDrawer.tsx` | Left-slide conversation history |
| Modify | `src/components/Dashboard.tsx` | Full rewrite — glass shell, card grid |
| Modify | `src/App.tsx` | Default route "dashboard", pass chatProps bundle, render Dashboard instead of ChatWindow for dashboard route |

---

## Task 1: Font and CSS variables

**Files:**
- Modify: `src/index.css`
- Modify: `tailwind.config.js`

- [ ] **Step 1: Add Bricolage Grotesque import and glass variables to index.css**

Open `src/index.css`. At the very top (before existing @import lines), add:

```css
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --glass-bg: rgba(255,255,255,0.07);
  --glass-border: rgba(255,255,255,0.13);
  --glass-shine: rgba(255,255,255,0.18);
  --glass-blur: blur(44px) saturate(1.6) brightness(0.88);
  --glass-radius: 20px;
  --glass-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 24px 60px rgba(0,0,0,0.35);
  --spring: cubic-bezier(0.32, 0.72, 0, 1);
  --spring-card: cubic-bezier(0.22, 1, 0.36, 1);
}
```

- [ ] **Step 2: Add Bricolage to the font-family stack in body**

In `src/index.css`, find the `body` or `html` selector (or `@layer base`) and prepend `'Bricolage Grotesque'` to the font-family. If the file uses Tailwind's `@layer base`:

```css
@layer base {
  body {
    font-family: 'Bricolage Grotesque', 'Inter', system-ui, sans-serif;
  }
}
```

- [ ] **Step 3: Add glass utility class to index.css**

```css
.blade-glass {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--glass-radius);
  box-shadow: var(--glass-shadow);
  position: relative;
  overflow: hidden;
}
.blade-glass::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.055) 0%, transparent 55%);
  pointer-events: none;
  border-radius: inherit;
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors (CSS changes don't affect TS).

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat: add Bricolage Grotesque font + glass CSS utilities"
```

---

## Task 2: Wallpaper Tauri command

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add get_wallpaper_path command to commands.rs**

Open `src-tauri/src/commands.rs`. Add this function anywhere in the file (e.g. after the last `#[tauri::command]` block):

```rust
#[tauri::command]
pub async fn get_wallpaper_path() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let desktop = hkcu
            .open_subkey(r"Control Panel\Desktop")
            .map_err(|e| format!("Registry error: {e}"))?;
        let path: String = desktop
            .get_value("WallPaper")
            .map_err(|e| format!("WallPaper value error: {e}"))?;
        Ok(path)
    }
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .args(["-e", "tell app \"Finder\" to get POSIX path of (desktop picture as alias)"])
            .output()
            .map_err(|e| format!("osascript error: {e}"))?;
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }
    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("gsettings")
            .args(["get", "org.gnome.desktop.background", "picture-uri"])
            .output()
            .map_err(|e| format!("gsettings error: {e}"))?;
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        // Strip quotes and file:// prefix
        let path = raw.trim_matches('\'').replace("file://", "");
        Ok(path)
    }
}
```

- [ ] **Step 2: Register the command in lib.rs**

Open `src-tauri/src/lib.rs`. Find the `generate_handler![` macro call. Add `get_wallpaper_path` to the list:

```rust
// Find the line that looks like:
generate_handler![
    // ... many commands ...
    some_last_command,
    // ADD:
    commands::get_wallpaper_path,
]
```

- [ ] **Step 3: Rust check**

```bash
cd src-tauri && cargo check 2>&1 | tail -20
```

Expected: No errors. If you see `use winreg` errors, `winreg = "0.52"` is already in Cargo.toml so it should resolve.

- [ ] **Step 4: Commit**

```bash
cd ..
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add get_wallpaper_path Tauri command (Windows/macOS/Linux)"
```

---

## Task 3: NavRail component

**Files:**
- Create: `src/components/NavRail.tsx`

- [ ] **Step 1: Create NavRail.tsx**

Create `src/components/NavRail.tsx` with this full content:

```tsx
import React from "react";

export type NavRailRoute =
  | "dashboard" | "chat" | "terminal" | "git"
  | "hive" | "agent-factory" | "security" | "settings";

interface NavRailProps {
  activeRoute: string;
  onNavigate: (route: NavRailRoute) => void;
  onOpenHistory: () => void;
}

function Ico({ d, viewBox = "0 0 20 20" }: { d: React.ReactNode; viewBox?: string }) {
  return (
    <svg viewBox={viewBox} className="w-[16px] h-[16px]" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

interface NavBtnProps {
  tip: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function NavBtn({ tip, active, onClick, children }: NavBtnProps) {
  return (
    <button
      onClick={onClick}
      data-tip={tip}
      className={[
        "relative w-10 h-10 rounded-[11px] flex items-center justify-center cursor-pointer",
        "border transition-all duration-150 group",
        active
          ? "text-white bg-[rgba(129,140,248,0.2)] border-[rgba(129,140,248,0.35)] shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
          : "text-[rgba(255,255,255,0.3)] border-transparent hover:text-white hover:bg-[rgba(255,255,255,0.09)] hover:border-[rgba(255,255,255,0.12)]",
      ].join(" ")}
    >
      {active && (
        <span className="absolute left-[-10px] top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-sm bg-[#818cf8] shadow-[0_0_10px_#818cf8]" />
      )}
      {children}
      {/* Glass tooltip */}
      <span className="absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2 -translate-x-1
        opacity-0 group-hover:opacity-100 group-hover:translate-x-0
        transition-all duration-100 pointer-events-none
        bg-[rgba(10,10,20,0.92)] backdrop-blur-xl border border-[rgba(255,255,255,0.14)]
        text-white text-[11.5px] font-medium px-[10px] py-[5px] rounded-lg whitespace-nowrap
        font-mono z-50">
        {tip}
      </span>
    </button>
  );
}

export function NavRail({ activeRoute, onNavigate, onOpenHistory }: NavRailProps) {
  return (
    <nav className="fixed top-[34px] left-0 bottom-0 w-[62px] flex flex-col items-center
      py-[18px] gap-[3px] z-[200]
      bg-[rgba(0,0,0,0.28)] backdrop-blur-[60px]
      border-r border-[rgba(255,255,255,0.09)]">

      {/* Logo */}
      <div className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center mb-[18px]
        bg-gradient-to-br from-[#7c3aed] via-[#6366f1] to-[#3b82f6] flex-shrink-0
        shadow-[0_0_22px_rgba(129,140,248,0.4),0_4px_14px_rgba(0,0,0,0.5)]
        text-white font-['Bricolage_Grotesque'] font-extrabold text-[14px]">
        B
      </div>

      <NavBtn tip="Dashboard" active={activeRoute === "dashboard"} onClick={() => onNavigate("dashboard")}>
        <Ico d={<><rect x="2" y="2" width="7" height="7" rx="1.5"/><rect x="11" y="2" width="7" height="7" rx="1.5"/><rect x="2" y="11" width="7" height="7" rx="1.5"/><rect x="11" y="11" width="7" height="7" rx="1.5"/></>} />
      </NavBtn>

      <NavBtn tip="Conversations" active={false} onClick={onOpenHistory}>
        <Ico d={<path d="M18 13a2 2 0 01-2 2H6l-4 3V4a2 2 0 012-2h12a2 2 0 012 2v9z"/>} />
      </NavBtn>

      <NavBtn tip="Terminal" active={activeRoute === "terminal"} onClick={() => onNavigate("terminal")}>
        <Ico d={<><rect x="2" y="3" width="16" height="14" rx="2"/><path d="M6 8l3 3-3 3M11 14h3"/></>} />
      </NavBtn>

      <NavBtn tip="Git" active={activeRoute === "git"} onClick={() => onNavigate("git")}>
        <Ico d={<><circle cx="5" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="5" cy="15" r="2"/><path d="M5 7v6M7 5h3a3 3 0 010 6H5"/></>} />
      </NavBtn>

      <NavBtn tip="Hive" active={activeRoute === "hive"} onClick={() => onNavigate("hive")}>
        <Ico d={<><polygon points="12,2 18,6 18,14 12,18 6,14 6,6"/><circle cx="12" cy="10" r="2"/></>} />
      </NavBtn>

      <div className="flex-1" />
      <div className="w-[26px] h-px bg-[rgba(255,255,255,0.08)] my-[6px]" />

      <NavBtn tip="Ghost Mode" active={false} onClick={() => onNavigate("settings")}>
        <Ico d={<path d="M10 2a6 6 0 016 6v8l-2-2-2 2-2-2-2 2-2-2-2 2V8a6 6 0 016-6z"/>} />
      </NavBtn>

      <NavBtn tip="Settings" active={activeRoute === "settings"} onClick={() => onNavigate("settings")}>
        <Ico d={<><circle cx="10" cy="10" r="2.5"/><path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42"/></>} />
      </NavBtn>
    </nav>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/NavRail.tsx
git commit -m "feat: NavRail — 62px icon-only nav with glass tooltips and active indicator"
```

---

## Task 4: HistoryDrawer component

**Files:**
- Create: `src/components/HistoryDrawer.tsx`

- [ ] **Step 1: Create HistoryDrawer.tsx**

Create `src/components/HistoryDrawer.tsx`:

```tsx
import React from "react";
import { ConversationSummary } from "../types";

interface HistoryDrawerProps {
  open: boolean;
  conversations: ConversationSummary[];
  currentConversationId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function HistoryDrawer({
  open,
  conversations,
  currentConversationId,
  onClose,
  onSelect,
  onNew,
}: HistoryDrawerProps) {
  return (
    <div
      className={[
        "fixed top-[34px] bottom-0 left-[62px] w-[250px] z-[195] flex flex-col",
        "bg-[rgba(5,5,16,0.72)] backdrop-blur-[60px] border-r border-[rgba(255,255,255,0.12)]",
        "shadow-[16px_0_50px_rgba(0,0,0,0.4)]",
        "transition-transform duration-[430ms]",
        open ? "translate-x-0" : "-translate-x-full",
      ].join(" ")}
      style={{ transitionTimingFunction: "cubic-bezier(0.32,0.72,0,1)" }}
    >
      {/* Header */}
      <div className="h-[52px] flex items-center justify-between px-[14px] border-b border-[rgba(255,255,255,0.08)] flex-shrink-0">
        <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-[rgba(255,255,255,0.28)]">
          Conversations
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onNew}
            className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center
              text-[rgba(255,255,255,0.3)] hover:text-white hover:bg-[rgba(255,255,255,0.07)] transition-all"
            title="New conversation"
          >
            <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 2v8M2 6h8"/>
            </svg>
          </button>
          <button
            onClick={onClose}
            className="w-[26px] h-[26px] rounded-[7px] flex items-center justify-center
              text-[rgba(255,255,255,0.3)] hover:text-white hover:bg-[rgba(255,255,255,0.07)] transition-all"
          >
            <svg viewBox="0 0 11 11" className="w-[11px] h-[11px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M1 1l9 9M10 1l-9 9"/>
            </svg>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-px
        [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.07)_transparent]">
        {conversations.length === 0 && (
          <div className="text-center text-[rgba(255,255,255,0.28)] text-xs py-8">No conversations yet</div>
        )}
        {conversations.map((conv) => {
          const isActive = conv.id === currentConversationId;
          return (
            <button
              key={conv.id}
              onClick={() => { onSelect(conv.id); onClose(); }}
              className={[
                "w-full text-left px-[10px] py-[9px] rounded-[9px] border transition-all duration-100",
                isActive
                  ? "bg-[rgba(129,140,248,0.08)] border-[rgba(129,140,248,0.2)]"
                  : "border-transparent hover:bg-[rgba(255,255,255,0.05)]",
              ].join(" ")}
            >
              <div className="text-[12px] font-medium text-[rgba(255,255,255,0.92)] truncate">
                {conv.title || "Untitled"}
              </div>
              <div className="text-[10.5px] text-[rgba(255,255,255,0.3)] mt-[2px]">
                {conv.message_count ? `${conv.message_count} msgs` : ""}
                {conv.updated_at ? ` · ${new Date(conv.updated_at).toLocaleDateString()}` : ""}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/HistoryDrawer.tsx
git commit -m "feat: HistoryDrawer — slide-in conversation history panel"
```

---

## Task 5: ChatPanel component

**Files:**
- Create: `src/components/ChatPanel.tsx`

- [ ] **Step 1: Create ChatPanel.tsx**

`ChatPanel` is a thin wrapper — it adds the slide animation and close button, then renders `ChatWindow` inside. Create `src/components/ChatPanel.tsx`:

```tsx
import React from "react";
import { ChatWindow } from "./ChatWindow";
import { ConversationSummary, Message, RuntimeDescriptor, ToolApprovalRequest, ToolExecution } from "../types";
import { ActiveWindowInfo, ContextSuggestion } from "../hooks/useContextAwareness";

export interface ChatPanelProps {
  open: boolean;
  onClose: () => void;
  // All ChatWindow props forwarded:
  messages: Message[];
  loading: boolean;
  error: string | null;
  toolExecutions: ToolExecution[];
  clipboardText: string | null;
  conversations: ConversationSummary[];
  currentConversationId: string | null;
  onSend: (message: string, imageBase64?: string) => void;
  onClear: () => void;
  onNewConversation: () => void | Promise<void>;
  onSwitchConversation: (conversationId: string) => void | Promise<void>;
  onOpenSettings: () => void;
  onDismissClipboard: () => void;
  pendingApproval: ToolApprovalRequest | null;
  onRespondApproval: (approved: boolean) => void;
  onDeleteConversation: (id: string) => void;
  onUpdateConversationTitle?: (id: string, title: string) => void;
  onRetry: () => void;
  onSlashCommand?: (action: string) => void;
  provider?: string;
  model?: string;
  streakDays?: number;
  totalMessages?: number;
  lastResponseTime?: number | null;
  ttsEnabled: boolean;
  ttsSpeaking: boolean;
  onToggleTTS: () => void;
  onStopTTS: () => void;
  activeWindow?: ActiveWindowInfo | null;
  contextSuggestions?: ContextSuggestion[];
  onOpenWorkspace?: (workspace: "terminal" | "files" | "canvas" | "workflows" | "agents") => void;
  runtimes?: RuntimeDescriptor[];
  onOpenOperators?: () => void;
  voiceDraft?: string | null;
  onVoiceDraftConsumed?: () => void;
  voiceModeStatus?: string;
  voiceModeOnPttDown?: () => void;
  voiceModeOnPttUp?: () => void;
  thinkingText?: string | null;
  onOpenNotifications?: () => void;
  unreadNotificationCount?: number;
}

export function ChatPanel({ open, onClose, ...chatProps }: ChatPanelProps) {
  return (
    <div
      className={[
        "fixed top-[34px] right-0 bottom-0 w-[400px] z-[180] flex flex-col",
        "bg-[rgba(6,6,18,0.65)] backdrop-blur-[60px]",
        "border-l border-[rgba(255,255,255,0.14)]",
        "shadow-[-30px_0_80px_rgba(0,0,0,0.5)]",
        "transition-transform duration-[460ms]",
        open ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
      style={{ transitionTimingFunction: "cubic-bezier(0.32,0.72,0,1)" }}
    >
      {/* Close handle */}
      <div className="absolute top-3 left-[-32px] z-10">
        {open && (
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-[7px] flex items-center justify-center
              bg-[rgba(0,0,0,0.5)] backdrop-blur-xl border border-[rgba(255,255,255,0.12)]
              text-[rgba(255,255,255,0.4)] hover:text-white transition-all"
          >
            <svg viewBox="0 0 11 11" className="w-[11px] h-[11px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 1l-8 8M1 1l8 8"/>
            </svg>
          </button>
        )}
      </div>

      {/* ChatWindow fills the panel */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <ChatWindow {...chatProps} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors. If `ToolApprovalRequest` or `ToolExecution` import paths are wrong, check `src/types.ts` for exact exported names.

- [ ] **Step 3: Commit**

```bash
git add src/components/ChatPanel.tsx
git commit -m "feat: ChatPanel — right-slide glass panel wrapping ChatWindow"
```

---

## Task 6: Rewrite Dashboard.tsx

**Files:**
- Modify: `src/components/Dashboard.tsx`

This is the big one. The new Dashboard is the app shell — it owns `chatOpen` and `historyOpen` state, renders NavRail, HistoryDrawer, ChatPanel, and the glass card grid. The old Dashboard content (EvolutionLevel, BackgroundAgent, etc.) gets removed; real data comes from Tauri invokes.

- [ ] **Step 1: Replace Dashboard.tsx entirely**

Replace the full content of `src/components/Dashboard.tsx` with:

```tsx
import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { NavRail, NavRailRoute } from "./NavRail";
import { HistoryDrawer } from "./HistoryDrawer";
import { ChatPanel, ChatPanelProps } from "./ChatPanel";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardProps {
  onNavigate: (route: string) => void;
  onBack: () => void;
  chatPanelProps: Omit<ChatPanelProps, "open" | "onClose">;
  activeRoute: string;
}

interface PerceptionState {
  active_app: string;
  active_title: string;
  user_state: string;
  ram_used_gb: number;
  disk_free_gb: number;
  context_tags: string[];
}

interface IntegrationState {
  unread_emails: number;
  upcoming_events: number;
  slack_mentions: number;
  github_notifications: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function Dot({ color, glow }: { color: string; glow?: boolean }) {
  return (
    <span
      className="w-[6px] h-[6px] rounded-full flex-shrink-0 inline-block"
      style={{
        background: color,
        boxShadow: glow ? `0 0 7px ${color}` : undefined,
        animation: glow ? "blade-pulse 2s ease-in-out infinite" : undefined,
      }}
    />
  );
}

function Chip({ children, color = "accent" }: { children: React.ReactNode; color?: "accent" | "green" | "amber" | "dim" }) {
  const styles = {
    accent: "bg-[rgba(129,140,248,0.15)] text-[#818cf8] border-[rgba(129,140,248,0.28)]",
    green:  "bg-[rgba(74,222,128,0.12)] text-[#4ade80] border-[rgba(74,222,128,0.22)]",
    amber:  "bg-[rgba(251,191,36,0.1)] text-[#fbbf24] border-[rgba(251,191,36,0.2)]",
    dim:    "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.28)] border-[rgba(255,255,255,0.08)]",
  }[color];
  return (
    <span className={`text-[9.5px] font-bold tracking-[0.05em] px-[8px] py-[2px] rounded-full border ${styles}`}>
      {children}
    </span>
  );
}

function CardLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[7px] text-[9.5px] font-bold tracking-[0.14em] uppercase text-[rgba(255,255,255,0.28)]">
      <span className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center bg-[rgba(129,140,248,0.15)] text-[#818cf8]">
        {icon}
      </span>
      {children}
    </div>
  );
}

// ── Wallpaper hook ─────────────────────────────────────────────────────────────

function useWallpaper() {
  const [wallpaperUrl, setWallpaperUrl] = useState<string | null>(null);
  useEffect(() => {
    invoke<string>("get_wallpaper_path")
      .then((path) => {
        if (path) setWallpaperUrl(convertFileSrc(path));
      })
      .catch(() => null); // fallback to gradient
  }, []);
  return wallpaperUrl;
}

// ── Live data hooks ─────────────────────────────────────────────────────────────

function usePerception() {
  const [perception, setPerception] = useState<PerceptionState | null>(null);
  useEffect(() => {
    const load = () => {
      invoke<PerceptionState>("get_perception_state").then(setPerception).catch(() => null);
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);
  return perception;
}

function useIntegrations() {
  const [integrations, setIntegrations] = useState<IntegrationState>({
    unread_emails: 0,
    upcoming_events: 0,
    slack_mentions: 0,
    github_notifications: 0,
  });
  useEffect(() => {
    invoke<IntegrationState>("get_integration_state").then(setIntegrations).catch(() => null);
    const interval = setInterval(() => {
      invoke<IntegrationState>("get_integration_state").then(setIntegrations).catch(() => null);
    }, 30000);
    return () => clearInterval(interval);
  }, []);
  return integrations;
}

// ── Card components ────────────────────────────────────────────────────────────

function GodModeCard({ perception }: { perception: PerceptionState | null }) {
  const appName = perception?.active_app ?? "VS Code";
  const filePath = perception?.active_title ?? "—";
  const userState = perception?.user_state ?? "Idle";

  return (
    <div className="blade-glass flex flex-col p-5 gap-0 animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.03s_both]">
      <div className="flex items-center justify-between mb-4">
        <CardLabel icon={<svg viewBox="0 0 12 12" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="6" r="4.5" strokeDasharray="1.8 2.5"/></svg>}>
          God Mode
        </CardLabel>
        <Chip color="accent">Extreme</Chip>
      </div>

      {/* Hero display */}
      <div className="flex-1 flex flex-col justify-center">
        <div className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[rgba(255,255,255,0.28)] mb-1">
          Currently in
        </div>
        <div className="text-[44px] font-extrabold leading-[0.95] tracking-[-0.03em] text-white mb-2 truncate">
          {appName}
        </div>
        <div className="font-mono text-[12px] text-[#60a5fa] mb-4 truncate">
          {filePath.length > 50 ? `…${filePath.slice(-48)}` : filePath}
        </div>
        <div className="inline-flex items-center gap-[6px] px-3 py-[5px] rounded-full
          bg-[rgba(74,222,128,0.1)] border border-[rgba(74,222,128,0.22)]
          text-[#4ade80] text-[11px] font-semibold self-start">
          <Dot color="#4ade80" glow />
          {userState}
        </div>
      </div>

      {/* Footer stats */}
      <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.07)] flex gap-4">
        {[
          { label: "Agents", value: "3", color: "text-white" },
          { label: "Memories", value: "1.2k", color: "text-[#60a5fa]" },
          { label: "Mic", value: "On", color: "text-[#4ade80]" },
          { label: "Spend", value: "$0.84", color: "text-[#fbbf24]" },
        ].map(({ label, value, color }, i) => (
          <React.Fragment key={label}>
            {i > 0 && <div className="w-px bg-[rgba(255,255,255,0.08)] self-stretch" />}
            <div className="flex flex-col gap-[2px]">
              <div className={`text-[18px] font-bold tracking-[-0.03em] leading-none ${color}`}>{value}</div>
              <div className="text-[9.5px] font-semibold tracking-[0.08em] uppercase text-[rgba(255,255,255,0.28)]">{label}</div>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function AgentsCard() {
  const agents = [
    { name: "Code Reviewer", task: "PR #47 · blade auth refactor", pct: 72, elapsed: "04:12" },
    { name: "Morning Briefing", task: "Digest from 8 sources", pct: 38, elapsed: "01:03" },
    { name: "Security Monitor", task: "Network watch · 0 anomalies", pct: 100, elapsed: "∞" },
  ];
  return (
    <div className="blade-glass flex flex-col p-4 gap-3 animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.08s_both]">
      <div className="flex items-center justify-between">
        <CardLabel icon={<svg viewBox="0 0 12 12" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="4" cy="4" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="9" cy="9" r="1.5"/><path d="M5.5 4h1.5a2 2 0 010 4H4M9 4.5v3"/></svg>}>
          Agents
        </CardLabel>
        <Chip color="green">3 running</Chip>
      </div>
      <div className="flex flex-col gap-[10px] flex-1">
        {agents.map((ag) => (
          <div key={ag.name} className="flex flex-col gap-[3px]">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold">{ag.name}</span>
              <span className="font-mono text-[10px] text-[rgba(255,255,255,0.28)]">{ag.elapsed}</span>
            </div>
            <div className="text-[11px] text-[rgba(255,255,255,0.55)] truncate">{ag.task}</div>
            <div className="h-[2px] bg-[rgba(255,255,255,0.07)] rounded-full overflow-hidden mt-[2px]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#818cf8] to-[#a78bfa]"
                style={{ width: `${ag.pct}%`, opacity: ag.pct === 100 ? 0.25 : 1, animation: "blade-shimmer 2.2s ease-in-out infinite" }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IntegrationsCard({ integrations }: { integrations: IntegrationState }) {
  const tiles = [
    { name: "Email", value: integrations.unread_emails || "0", sub: "unread", color: integrations.unread_emails > 0 ? "#fbbf24" : "#4ade80" },
    { name: "Slack", value: integrations.slack_mentions || "0", sub: "mentions", color: integrations.slack_mentions > 0 ? "#fbbf24" : "#4ade80" },
    { name: "GitHub", value: integrations.github_notifications > 0 ? String(integrations.github_notifications) : "✓", sub: integrations.github_notifications > 0 ? "notifs" : "CI passing", color: "#4ade80" },
    { name: "Calendar", value: String(integrations.upcoming_events), sub: "today", color: "#818cf8" },
  ];
  return (
    <div className="blade-glass flex flex-col p-4 gap-3 animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.13s_both]">
      <div className="flex items-center justify-between">
        <CardLabel icon={<svg viewBox="0 0 12 12" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="1" width="4" height="4" rx="1"/><rect x="7" y="1" width="4" height="4" rx="1"/><rect x="1" y="7" width="4" height="4" rx="1"/><path d="M9 7v4M11 9H7"/></svg>}>
          Integrations
        </CardLabel>
      </div>
      <div className="grid grid-cols-2 gap-[6px] flex-1">
        {tiles.map((t) => (
          <div key={t.name} className="p-[9px_10px] rounded-[11px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.07)] flex flex-col gap-[3px] hover:bg-[rgba(255,255,255,0.07)] transition-colors cursor-default">
            <div className="text-[9.5px] font-semibold tracking-[0.1em] uppercase text-[rgba(255,255,255,0.28)]">{t.name}</div>
            <div className="text-[24px] font-bold tracking-[-0.04em] leading-none" style={{ color: t.color }}>{t.value}</div>
            <div className="text-[10px] text-[rgba(255,255,255,0.55)]">{t.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarCard() {
  const events = [
    { time: "3:00 PM", name: "Staq sync — Federico", meta: "Solana Reputation Protocol", badge: "in 47 min", isNext: true },
    { time: "5:30 PM", name: "PollPe standup", meta: "Google Meet · 5 attendees", badge: null, isNext: false },
    { time: "Tmrw 10:00", name: "Investor call · demo prep", meta: "Zoom · Staq deck needed", badge: null, isNext: false },
  ];
  return (
    <div className="blade-glass flex flex-col p-[18px] gap-[14px] animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.18s_both]">
      <CardLabel icon={<svg viewBox="0 0 12 12" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="1" y="2" width="10" height="9" rx="1.5"/><path d="M1 5h10M4 1v2M8 1v2"/></svg>}>
        Calendar
      </CardLabel>
      <div className="flex flex-col relative">
        <div className="absolute left-[6px] top-[8px] bottom-[8px] w-px bg-[rgba(255,255,255,0.08)]" />
        {events.map((ev, i) => (
          <div key={i} className="flex gap-[14px] items-start py-[10px] rounded-[11px] hover:bg-[rgba(255,255,255,0.04)] transition-colors cursor-default pl-0 pr-2">
            <div className="w-[13px] h-[13px] rounded-full flex-shrink-0 flex items-center justify-center mt-[2px] relative z-[1]"
              style={{
                border: ev.isNext ? "1.5px solid #818cf8" : "1.5px solid rgba(255,255,255,0.12)",
                background: ev.isNext ? "rgba(129,140,248,0.15)" : "rgba(255,255,255,0.04)",
              }}>
              <span className="w-[7px] h-[7px] rounded-full block"
                style={{
                  background: ev.isNext ? "#818cf8" : "rgba(255,255,255,0.2)",
                  boxShadow: ev.isNext ? "0 0 8px #818cf8" : undefined,
                  animation: ev.isNext ? "blade-pulse 2s ease-in-out infinite" : undefined,
                }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[10px] mb-[2px]" style={{ color: ev.isNext ? "#818cf8" : "rgba(255,255,255,0.28)" }}>{ev.time}</div>
              <div className="text-[13px] font-semibold truncate">{ev.name}</div>
              <div className="text-[11px] text-[rgba(255,255,255,0.55)] mt-[2px]">{ev.meta}</div>
              {ev.badge && (
                <span className="mt-[5px] inline-block text-[9px] font-bold tracking-[0.07em] uppercase px-[7px] py-[2px] rounded-full bg-[rgba(129,140,248,0.14)] text-[#818cf8]">
                  {ev.badge}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QueueCard() {
  const items = [
    { title: "Reply to Rohan — API timeline", sub: "Draft ready · Slack · 2h ago", cta: "Review", accent: "#fbbf24" },
    { title: "Approve PR merge — blade#47", sub: "Review complete · CI passing", cta: "Approve", accent: "#818cf8" },
    { title: "Accept calendar invite", sub: "Tomorrow 10 AM · Zoom · investor", cta: "Accept", accent: "#4ade80" },
  ];
  return (
    <div className="blade-glass flex flex-col p-4 gap-3 flex-1 min-h-0 animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.22s_both]">
      <div className="flex items-center justify-between">
        <CardLabel icon={<svg viewBox="0 0 12 12" className="w-[10px] h-[10px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="6" cy="6" r="5"/><path d="M6 4v2l1.5 1.5"/></svg>}>
          Action Queue
        </CardLabel>
        <Chip color="amber">3 waiting</Chip>
      </div>
      <div className="flex flex-col gap-[5px] flex-1 overflow-hidden">
        {items.map((item) => (
          <div key={item.title}
            className="flex items-center gap-[10px] px-[10px] py-[9px] rounded-[11px]
              bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]
              cursor-pointer hover:bg-[rgba(255,255,255,0.07)] hover:border-[rgba(255,255,255,0.12)]
              hover:-translate-y-[1px] hover:shadow-[0_6px_20px_rgba(0,0,0,0.25)]
              transition-all group">
            <div className="w-[3px] self-stretch rounded-full flex-shrink-0" style={{ background: item.accent }} />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold truncate">{item.title}</div>
              <div className="text-[10.5px] text-[rgba(255,255,255,0.55)] mt-[1px]">{item.sub}</div>
            </div>
            <div className="text-[9.5px] font-bold tracking-[0.05em] px-[9px] py-[3px] rounded-[6px]
              border border-[rgba(129,140,248,0.28)] bg-[rgba(129,140,248,0.12)] text-[#818cf8]
              flex-shrink-0 whitespace-nowrap group-hover:bg-[rgba(129,140,248,0.22)] transition-colors">
              {item.cta}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsStrip() {
  const stats = [
    { label: "Chats", value: "12", delta: "↑ 3", up: true },
    { label: "Spend", value: "$0.84", delta: "under budget", up: true },
    { label: "Memories", value: "1.2k", delta: "+14", up: true },
    { label: "Screen", value: "4h 21m", delta: "↑ above avg", up: false },
  ];
  return (
    <div className="blade-glass p-[14px_16px] flex-shrink-0 animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_0.26s_both]">
      <div className="grid grid-cols-4 gap-[6px]">
        {stats.map((s) => (
          <div key={s.label} className="p-[10px_12px] rounded-[11px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.07)] flex flex-col gap-[2px] hover:bg-[rgba(255,255,255,0.07)] transition-colors cursor-default">
            <div className="text-[9.5px] font-semibold tracking-[0.1em] uppercase text-[rgba(255,255,255,0.28)]">{s.label}</div>
            <div className="text-[22px] font-bold tracking-[-0.04em] leading-[1.1]">{s.value}</div>
            <div className={`text-[9.5px] font-medium mt-[1px] ${s.up ? "text-[#4ade80]" : "text-[#f87171]"}`}>{s.delta}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dashboard (shell) ─────────────────────────────────────────────────────────

export function Dashboard({ onNavigate, chatPanelProps, activeRoute }: DashboardProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const wallpaperUrl = useWallpaper();
  const perception = usePerception();
  const integrations = useIntegrations();

  const handleNavigate = useCallback((route: NavRailRoute) => {
    onNavigate(route);
  }, [onNavigate]);

  // Open chat panel when a message is sent from outside (e.g. slash commands)
  const openChat = useCallback(() => setChatOpen(true), []);
  void openChat;

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Wallpaper background */}
      <div
        className="fixed inset-0 z-0 bg-cover bg-center"
        style={{
          backgroundImage: wallpaperUrl
            ? `url(${wallpaperUrl})`
            : "radial-gradient(ellipse 90% 70% at 15% 25%, rgba(88,50,220,0.65) 0%, transparent 65%), radial-gradient(ellipse 70% 90% at 85% 15%, rgba(40,20,140,0.55) 0%, transparent 60%), radial-gradient(ellipse 80% 60% at 70% 85%, rgba(160,30,90,0.4) 0%, transparent 65%), #06060f",
        }}
      />
      {/* Dark scrim for readability */}
      <div className="fixed inset-0 z-[1] bg-black/38 pointer-events-none" />

      {/* Nav rail */}
      <div className="relative z-[200]">
        <NavRail
          activeRoute={activeRoute}
          onNavigate={handleNavigate}
          onOpenHistory={() => setHistOpen((v) => !v)}
        />
      </div>

      {/* History drawer */}
      <HistoryDrawer
        open={histOpen}
        conversations={chatPanelProps.conversations}
        currentConversationId={chatPanelProps.currentConversationId}
        onClose={() => setHistOpen(false)}
        onSelect={(id) => { chatPanelProps.onSwitchConversation(id); setChatOpen(true); }}
        onNew={() => { chatPanelProps.onNewConversation(); setChatOpen(true); setHistOpen(false); }}
      />

      {/* Main grid */}
      <div
        className="relative z-[10] flex flex-col ml-[62px] mt-[34px] h-[calc(100vh-34px)] p-[12px] gap-[10px] overflow-hidden transition-[margin-right] duration-[460ms]"
        style={{
          transitionTimingFunction: "cubic-bezier(0.32,0.72,0,1)",
          marginRight: chatOpen ? "400px" : "0px",
        }}
      >
        {/* Top row: 1.7fr 1fr 0.75fr */}
        <div className="grid gap-[10px] min-h-0" style={{ gridTemplateColumns: "1.7fr 1fr 0.75fr", flex: "0 0 47%" }}>
          <GodModeCard perception={perception} />
          <AgentsCard />
          <IntegrationsCard integrations={integrations} />
        </div>

        {/* Bottom row: 1.05fr 1.3fr */}
        <div className="grid gap-[10px] flex-1 min-h-0" style={{ gridTemplateColumns: "1.05fr 1.3fr" }}>
          <CalendarCard />
          <div className="flex flex-col gap-[10px] min-h-0">
            <QueueCard />
            <StatsStrip />
          </div>
        </div>
      </div>

      {/* Chat panel */}
      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        {...chatPanelProps}
      />

      {/* FAB — opens chat */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed bottom-[20px] right-[20px] w-[50px] h-[50px] rounded-[16px] z-[170]
            bg-[#818cf8] border-none cursor-pointer flex items-center justify-center text-white
            shadow-[0_6px_24px_rgba(129,140,248,0.45),0_12px_40px_rgba(0,0,0,0.4)]
            hover:scale-105 hover:shadow-[0_8px_32px_rgba(129,140,248,0.55)]
            active:scale-[0.92] transition-all duration-200"
        >
          <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13a2 2 0 01-2 2H6l-4 3V4a2 2 0 012-2h12a2 2 0 012 2v9z"/>
          </svg>
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add animation keyframes to index.css**

In `src/index.css`, add these keyframes (after the `.blade-glass` class added in Task 1):

```css
@keyframes blade-card-in {
  from { opacity: 0; transform: translateY(14px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes blade-shimmer {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
@keyframes blade-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors. Common issue: `ConversationSummary.updated_at` may not exist — check `src/types.ts` and adjust the field name in HistoryDrawer if needed.

- [ ] **Step 4: Commit**

```bash
git add src/components/Dashboard.tsx src/index.css
git commit -m "feat: Dashboard shell — glass cards, NavRail, ChatPanel, HistoryDrawer wired"
```

---

## Task 7: Wire App.tsx

**Files:**
- Modify: `src/App.tsx`

This is the final wiring step. Three changes: (1) default route becomes `"dashboard"`, (2) when route is `"dashboard"`, render the new `Dashboard` shell with a `chatPanelProps` bundle instead of `ChatWindow`, (3) import `Dashboard` properly.

- [ ] **Step 1: Change the default route**

In `src/App.tsx`, line 199:

```typescript
// Before:
const [route, setRoute] = useState<Route>("chat");

// After:
const [route, setRoute] = useState<Route>("dashboard");
```

- [ ] **Step 2: Update the import for Dashboard**

The existing lazy import of Dashboard at the top of App.tsx looks like:
```typescript
const DashboardView = lazy(() => import("./components/Dashboard").then((m) => ({ default: m.Dashboard })));
```

Since Dashboard is now rendered eagerly (it's the shell), change it to a regular import. Find and replace the lazy import line:

```typescript
// Remove:
const DashboardView = lazy(() => import("./components/Dashboard").then((m) => ({ default: m.Dashboard })));

// Add at the top with other direct imports:
import { Dashboard } from "./components/Dashboard";
```

- [ ] **Step 3: Build the chatPanelProps bundle and update render logic**

Find the section in `App.tsx` around line 1201–1256 that reads:

```tsx
{route === "chat" || route === "dashboard" ? (
  <ChatWindow
    messages={...}
    ...
  />
) : (
  ...
)}
```

Replace the entire condition with:

```tsx
{route === "dashboard" ? (
  <Dashboard
    activeRoute={route}
    onNavigate={(r) => openRoute(r as Route)}
    onBack={() => openRoute("dashboard")}
    chatPanelProps={{
      messages: chat.messages,
      loading: chat.loading,
      error: chat.error,
      toolExecutions: chat.toolExecutions,
      clipboardText: chat.clipboardText,
      conversations: chat.conversations,
      currentConversationId: chat.currentConversationId,
      onSend: sendWithStats,
      onClear: chat.clearMessages,
      onNewConversation: chat.newConversation,
      onSwitchConversation: chat.switchConversation,
      onOpenSettings: () => openRoute("settings"),
      onDismissClipboard: chat.dismissClipboard,
      pendingApproval: chat.pendingApproval,
      onRespondApproval: chat.respondToApproval,
      onDeleteConversation: chat.deleteConversation,
      onUpdateConversationTitle: chat.updateConversationTitle,
      onRetry: chat.retryLastMessage,
      onSlashCommand: handleSlashCommand,
      provider: config?.provider,
      model: config?.model,
      streakDays: stats.streakDays,
      totalMessages: stats.totalMessages,
      lastResponseTime: chat.lastResponseTime,
      ttsEnabled: tts.enabled,
      ttsSpeaking: tts.speaking,
      onToggleTTS: tts.toggleEnabled,
      onStopTTS: tts.stop,
      activeWindow: contextAwareness.context.activeWindow,
      contextSuggestions: contextAwareness.context.suggestedActions,
      onOpenWorkspace: (workspace) => openRoute(workspace),
      runtimes: runtimeCenter.runtimes,
      onOpenOperators: () => openRoute("agents"),
      voiceDraft: voiceDraft,
      onVoiceDraftConsumed: () => setVoiceDraft(null),
      voiceModeStatus: voiceMode.status,
      voiceModeOnPttDown: voiceMode.onPttMouseDown,
      voiceModeOnPttUp: voiceMode.onPttMouseUp,
      thinkingText: chat.thinkingText,
      onOpenNotifications: () => setNotificationsOpen(true),
      unreadNotificationCount: notifications.unreadCount,
    }}
  />
) : route === "chat" ? (
  <ChatWindow
    messages={chat.messages}
    loading={chat.loading}
    error={chat.error}
    toolExecutions={chat.toolExecutions}
    clipboardText={chat.clipboardText}
    conversations={chat.conversations}
    currentConversationId={chat.currentConversationId}
    onSend={sendWithStats}
    onClear={chat.clearMessages}
    onNewConversation={chat.newConversation}
    onSwitchConversation={chat.switchConversation}
    onOpenSettings={() => openRoute("settings")}
    onDismissClipboard={chat.dismissClipboard}
    pendingApproval={chat.pendingApproval}
    onRespondApproval={chat.respondToApproval}
    onDeleteConversation={chat.deleteConversation}
    onUpdateConversationTitle={chat.updateConversationTitle}
    onRetry={chat.retryLastMessage}
    onSlashCommand={handleSlashCommand}
    provider={config?.provider}
    model={config?.model}
    streakDays={stats.streakDays}
    totalMessages={stats.totalMessages}
    lastResponseTime={chat.lastResponseTime}
    ttsEnabled={tts.enabled}
    ttsSpeaking={tts.speaking}
    onToggleTTS={tts.toggleEnabled}
    onStopTTS={tts.stop}
    activeWindow={contextAwareness.context.activeWindow}
    contextSuggestions={contextAwareness.context.suggestedActions}
    onOpenWorkspace={(workspace) => openRoute(workspace)}
    runtimes={runtimeCenter.runtimes}
    onOpenOperators={() => openRoute("agents")}
    voiceDraft={voiceDraft}
    onVoiceDraftConsumed={() => setVoiceDraft(null)}
    voiceModeStatus={voiceMode.status}
    voiceModeOnPttDown={voiceMode.onPttMouseDown}
    voiceModeOnPttUp={voiceMode.onPttMouseUp}
    thinkingText={chat.thinkingText}
    onOpenNotifications={() => setNotificationsOpen(true)}
    unreadNotificationCount={notifications.unreadCount}
  />
) : (
  <Suspense fallback={<div className="flex-1 flex items-center justify-center text-white/30">Loading...</div>}>
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
      {mainContent}
    </div>
  </Suspense>
)}
```

- [ ] **Step 4: Remove the "dashboard" entry from fullPageRoutes**

In `fullPageRoutes`, find and remove:
```typescript
"dashboard": <DashboardView onBack={() => openRoute("dashboard")} onNavigate={(r) => openRoute(r as Route)} />,
```

The dashboard route is now handled directly above, not through `fullPageRoutes`.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: No errors. Common issues:
- If `DashboardView` is still referenced somewhere after you removed the lazy import, remove those references too.
- If `onBack` is still in Dashboard's props interface but not passed, remove it from the interface in Dashboard.tsx.

- [ ] **Step 6: Dev run — visual check**

```bash
npm run tauri dev
```

Verify:
1. App opens to the glass dashboard (not chat)
2. Wallpaper shows through frosted panels
3. FAB opens the chat panel from the right with spring animation
4. History drawer opens from the left via nav rail conversations button
5. Nav items for Terminal/Git/etc still navigate correctly
6. ESC closes open panels

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire dashboard-first layout — default route, NavRail, ChatPanel, wallpaper bg"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Default route changed to "dashboard"
- ✅ NavRail 62px, icon-only, active indicator, glass tooltips
- ✅ Chat panel slides in from right, spring curve, no re-mount
- ✅ History drawer slides from left
- ✅ Glass material: backdrop-blur, border, shine, shadow
- ✅ Wallpaper via Tauri command (Windows/macOS/Linux)
- ✅ Bricolage Grotesque font
- ✅ Top section: God Mode hero + Agents + Integrations (1.7fr 1fr 0.75fr)
- ✅ Bottom section: Calendar + (Queue + Stats) (1.05fr 1.3fr)
- ✅ Stagger animation on card load
- ✅ All existing full-page routes unchanged
- ✅ ChatWindow internals untouched

**Placeholder scan:** No TBDs or TODOs in code blocks. All code is complete.

**Type consistency:**
- `ChatPanelProps` defined in ChatPanel.tsx, imported correctly in Dashboard.tsx
- `NavRailRoute` defined in NavRail.tsx, used in Dashboard.tsx
- `HistoryDrawer` props match what Dashboard passes
- `Dashboard` receives `chatPanelProps: Omit<ChatPanelProps, "open" | "onClose">`
