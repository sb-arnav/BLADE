# Coding Conventions

**Analysis Date:** 2026-04-17

## Overview

BLADE uses explicit, prescriptive coding conventions documented in `/home/arnav/blade/CLAUDE.md`. This codebase follows strict patterns for module registration, configuration management, and command/route definition to avoid costly runtime bugs.

## Rust Conventions

### Module Registration (CRITICAL: 3-Step Rule)

Every new Rust module requires changes in THREE places or it silently breaks:

1. **Module declaration in `lib.rs`:**
   - Add `mod module_name;` at the top of `/home/arnav/blade/src-tauri/src/lib.rs`
   - Example from codebase (lines 1–150):
     ```rust
     mod accountability;
     mod agent_commands;
     mod autoskills;
     // ... 140+ more modules
     mod auto_reply;
     mod streak_stats;
     ```

2. **Command registration in `generate_handler![]`:**
   - If the module exports `#[tauri::command]` functions, add them to the `generate_handler![]` macro in `lib.rs`
   - This is how Tauri's command IPC knows about Rust→TypeScript calls
   - Without this, `invoke("command_name", ...)` from TypeScript fails silently

3. **For configuration fields: 6-Place Rule**
   - Adding a new config field requires changes in SIX places (documented in `/home/arnav/blade/CLAUDE.md`):
     1. `DiskConfig` struct definition (lines 55–150 in `config.rs`)
     2. `DiskConfig::default()` implementation
     3. `BladeConfig` struct (runtime in-memory version)
     4. `BladeConfig::default()` implementation
     5. `load_config()` function (deserialization)
     6. `save_config()` function (serialization)
   - Example from `config.rs` (lines 77–87):
     ```rust
     #[serde(default = "default_god_mode_tier")]
     pub god_mode_tier: String,
     #[serde(default = "default_voice_mode")]
     pub voice_mode: String,
     #[serde(default = "default_tts_voice")]
     pub tts_voice: String,
     ```
   - Default functions use pattern:
     ```rust
     fn default_my_field() -> String { "default".to_string() }
     ```

### Command Definition Pattern

All Tauri commands follow this exact pattern:

```rust
#[tauri::command]
pub async fn my_command(app: tauri::AppHandle, param: String) -> Result<String, String> {
    // Work here
    Ok(result)
}
```

**Key rules:**
- Always return `Result<T, String>` for proper error serialization to TypeScript
- Include `app: tauri::AppHandle` if you need access to state, emitting events, or app-level APIs
- Use `async` unless synchronous computation only
- Error messages are strings (TypeScript receives them as error text)

### Error Handling

**Pattern:**
```rust
try { const result = await invoke<ResultType>("command_name", { arg1, arg2 }); }
catch (e) { setError(typeof e === "string" ? e : String(e)); }
```

**Rust returns errors as strings:**
- Successful: `Ok(value)` → TypeScript receives `value`
- Error: `Err("message".to_string())` → TypeScript catch block receives `"message"`

### Background Tasks (Singletons)

Use `AtomicBool` for one-shot initialization of background loops:

```rust
static RUNNING: AtomicBool = AtomicBool::new(false);

pub fn start_my_loop(app: AppHandle) {
    if RUNNING.swap(true, Ordering::SeqCst) { return; }  // Already running
    tauri::async_runtime::spawn(async move {
        loop {
            /* work */
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}
```

### Cancellation Pattern

Use `AtomicBool` between loop iterations:

```rust
static CANCEL: AtomicBool = AtomicBool::new(false);

// In loop:
if CANCEL.load(Ordering::SeqCst) { break; }

// From command to stop:
CANCEL.store(true, Ordering::SeqCst);
```

### Safe String Slicing

**CRITICAL:** Non-ASCII text (emoji, CJK, accents) cannot be sliced with `&text[..n]` in Rust.

**Correct pattern:**
```rust
use crate::safe_slice;
let truncated = safe_slice(user_input, 100);  // Safe for any Unicode
```

**Location:** `safe_slice` is defined in `/home/arnav/blade/src-tauri/src/lib.rs` (line 163)

**Wrong (breaks on emoji):**
```rust
let truncated = &text[..100];  // Panic if byte boundary is in emoji
```

### Common Mistakes (That Waste Hours)

1. **Missing `use tauri::Manager;`**
   - Error: "no method named `state`"
   - Fix: Add `use tauri::Manager;` at top of module before calling `app.state()`

2. **Double quotes in SQL strings with `execute_batch!` macro**
   - Macro breaks if SQL contains double-quoted strings
   - **Wrong:** `"SELECT * FROM \"users\""`
   - **Right:** Use backticks or escape properly in macro context

3. **Empty slices `&[]`**
   - Rust can't coerce `&[T; 0]` in all contexts
   - **Wrong:** `fn takes_slice(v: &[T]) { ... }; takes_slice(&[])`
   - **Right:** `let no_items: Vec<T> = vec![]; fn_call(&no_items);`

4. **Duplicate `#[tauri::command]` names across modules**
   - Tauri's macro namespace is FLAT — compiler can't tell which is which
   - Solution: Rename one of them (e.g., `send_message` vs `send_message_from_chat`)

5. **Assuming `whisper-rs` is available**
   - Speech-to-text requires LLVM/libclang
   - Feature-gated: `local-whisper` flag, default build skips it
   - Check `/home/arnav/blade/src-tauri/Cargo.toml` (lines 57–61)

### Naming Conventions (Rust)

- **Modules:** snake_case (e.g., `audio_timeline`, `perception_fusion`)
- **Functions:** snake_case (e.g., `send_message_stream`, `record_error`)
- **Structs/Traits:** PascalCase (e.g., `BladeConfig`, `ConversationMessage`)
- **Constants:** SCREAMING_SNAKE_CASE (e.g., `MAX_OUTPUT`, `BASH_TIMEOUT_MS`)
- **Commands exposed to TypeScript:** snake_case (e.g., `cancel_chat`, `swarm_list`)

## TypeScript/Frontend Conventions

### Route Definition (3-Place Rule)

Adding a new route requires changes in THREE places in `/home/arnav/blade/src/App.tsx`:

1. **Add to Route union type** (line 71):
   ```typescript
   type Route = "chat" | "settings" | "discovery" | ... | "my_new_route";
   ```

2. **Lazy-load the component** (lines 73–142):
   ```typescript
   const MyView = lazy(() => 
     import("./components/MyView").then(m => ({ default: m.MyView }))
   );
   ```

3. **Add to fullPageRoutes object:**
   ```typescript
   "my_new_route": <MyView onBack={() => openRoute("chat")} />,
   ```

4. **Add to command palette** (optional but expected for discoverability):
   ```typescript
   { label: "My View", action: () => openRoute("my_new_route"), section: "Features" }
   ```

### Tauri Invocation Pattern

All command calls use `invoke<T>()` with typed results:

```typescript
try {
  const result = await invoke<ResultType>("command_name", { arg1, arg2 });
  // Use result
} catch (e) {
  setError(typeof e === "string" ? e : String(e));
}
```

**Key rules:**
- Always provide a type parameter `<T>` for the return type
- Arguments are an object (even single args: `{ text }`)
- Errors come back as strings in the catch block
- Use `typeof e === "string"` because Tauri can return different error formats

### Event Listening Pattern (with Cleanup)

All event listeners must clean up in `useEffect` return:

```typescript
useEffect(() => {
  const unlisten = listen("event_name", (e) => {
    // Handle event
    const payload = e.payload as EventPayload;
  });

  return () => {
    unlisten.then(fn => fn());  // Clean up on unmount
  };
}, []);
```

**Key rules:**
- `listen()` returns a promise, not a function
- Call `.then(fn => fn())` in cleanup to unsubscribe
- Omit cleanup = memory leak and event handler firing after unmount

### Component Naming & Structure

**Files:**
- PascalCase for component files: `ChatWindow.tsx`, `GlassCard.tsx`
- File name = exported component name (no re-exports unless necessary)

**Component Examples from codebase:**
- `/home/arnav/blade/src/components/GlassCard.tsx` — reusable primitive
  ```typescript
  interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
    tier?: "inline" | "standard" | "floating";
    accent?: boolean;
    padding?: "none" | "sm" | "md" | "lg" | "xl";
  }
  export function GlassCard({ tier = "standard", ... }: GlassCardProps) { ... }
  ```

- `/home/arnav/blade/src/components/NudgeOverlay.tsx` — auto-dismiss overlay
  ```typescript
  interface NudgeAction {
    label: string;
    icon: string;
    action: () => void;
  }
  ```

### Hooks Pattern

Custom hooks live in `/home/arnav/blade/src/hooks/` and return structured state:

```typescript
// Example: useSwarm hook
export function useSwarm() {
  const [swarms, setSwarms] = useState<Swarm[]>([]);
  const [activeSwarm, setActiveSwarm] = useState<Swarm | null>(null);

  const loadSwarms = useCallback(async () => {
    try {
      const list = await invoke<Swarm[]>("swarm_list", { limit: 20 });
      setSwarms(list);
    } catch (e) {
      console.error("[swarm] loadSwarms:", e);
    }
  }, []);

  return { swarms, activeSwarm, loadSwarms };
}
```

### Naming (TypeScript)

- **Components:** PascalCase (e.g., `ChatWindow`, `GlassCard`, `NudgeOverlay`)
- **Functions:** camelCase (e.g., `loadSwarms`, `nudgeActions`)
- **Types/Interfaces:** PascalCase (e.g., `TimelineEvent`, `GlassCardProps`)
- **Constants:** SCREAMING_SNAKE_CASE or camelCase depending on scope
- **Event handlers:** `onEventName` (e.g., `onBack`, `onSendToChat`)
- **CSS classes:** kebab-case with `blade-` prefix (e.g., `blade-glass`, `blade-bg`)

### Styling (Tailwind v4)

**Approach:** Utility-first Tailwind with custom `blade-*` design tokens

**Examples:**
- `className="blade-glass"` — standard glass card background
- `className="blade-glass-accent"` — accent variant
- `className="blade-bg"` — page background
- `className="px-4 py-1.5 rounded-lg"` — standard spacing

**Glass tiers:**
```typescript
tier === "floating"
  ? "blade-glass-floating"
  : tier === "inline"
    ? "blade-glass-inline"
    : "blade-glass";
```

### Icons

Uses **Lucide React** for all icons:
```typescript
import { Search, Settings, X } from "lucide-react";

<Search className="w-4 h-4" />
```

No hardcoded emoji for structure; emoji reserved for accent (e.g., nudge actions).

## Commit Style

**Pattern (from git history):**
```
<type>: <description>

Optional body paragraph.
```

**Examples from codebase:**
- `docs(architecture): add frontend architecture doc (pair to body-architecture)`
- `feat: port Settings header + QuickAsk to prototype design`
- `fix: voice history JSON — match ConversationMessage enum variants`
- `chore: v0.7.9 — full UI port (onboarding, dashboard, settings, quickask)`

**Types:**
- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation
- `chore:` — version bump, build config, dependencies
- `polish:` — visual refinement, no functional change
- `cleanup:` — code cleanup, warnings
- `refactor:` — structure change, no new behavior

**Co-Authored-By:** Technically the history includes Claude Co-Authored-By lines, but `/home/arnav/blade/CLAUDE.md` (line 166) explicitly states "Don't add Co-Authored-By lines to commits — Arnav is the author". Assume this directive overrides historical practice.

## Import Organization

**Rust:**
1. Standard library (`std::`)
2. External crates (`tauri::`, `serde::`, `tokio::`)
3. Module paths (`crate::`)
4. Type re-exports

**TypeScript:**
1. React imports (`import React, { ... } from "react"`)
2. Tauri API (`from "@tauri-apps/api"`)
3. Internal components/hooks (`from "./components"`, `from "./hooks"`)
4. Utilities/types (`from "./utils"`, `from "./types"`)
5. Styles/constants

## Logging

**Rust:**
- Use `log::` crate (e.g., `log::error!("[module] message")`)
- Prefixes: `[module_name]` for context

**TypeScript:**
- Use `console.error()`, `console.log()` with context prefix
- Example: `console.error("[swarm] loadSwarms:", e)`

## Documentation

**JSDoc/TSDoc:** Used sparingly on exported types and complex logic

**Rust Doc Comments:** Minimal; inline comments explain non-obvious patterns

**Code Comments:**
- When pattern is non-obvious (e.g., circuit breaker logic in `commands.rs`)
- When documenting a safety constraint (e.g., `safe_slice` for Unicode)
- Avoid obvious comments ("increment i")

## Validation

**TypeScript:**
- `zod` for runtime schema validation (see `package.json` line 40)
- TypeScript compiler for static checks

**Rust:**
- Compiler-enforced (Result types, lifetimes)
- `serde` validation on deserialization

---

*Convention analysis: 2026-04-17*
