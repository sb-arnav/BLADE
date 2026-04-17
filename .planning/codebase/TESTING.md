# Testing Patterns

**Analysis Date:** 2026-04-17

## Test Framework Status

**Current state:** No automated test framework is configured. BLADE relies on:
- TypeScript compiler (`tsc --noEmit`) for static type checking
- `cargo check` for Rust compilation
- GitHub Actions CI for smoke testing on all platforms
- Manual testing and integration validation

### Why No Unit Tests?

BLADE is a complex systems integration project (130+ Rust modules, 145+ React components, Tauri IPC). Testing patterns are emerging but not yet standardized:
- Heavy reliance on Tauri command IPC (requires mocking or real runtime)
- State management across Rust↔TypeScript boundary
- Async patterns with tokio and React hooks
- File system, process execution, clipboard monitoring (desktop integration)

Unit tests exist in some modules but are NOT part of the CI pipeline.

## Test Commands

### Frontend (TypeScript)

**Type checking only:**
```bash
npx tsc --noEmit
```

**What it checks:**
- All `.ts` and `.tsx` files in `src/`
- TypeScript `strict: true` (line 18 in `tsconfig.json`)
- No unused locals, no unused parameters, no fallthrough switch cases
- JSX mode: `"react-jsx"`

**Run on:**
- Local development (before commit)
- CI pipeline: `.github/workflows/build.yml` (line 27)

### Backend (Rust)

**Compile check only:**
```bash
cd src-tauri && cargo check
```

**What it checks:**
- Module registration (missing `mod` declarations)
- Type safety
- Borrow checker rules
- All dependencies compile

**Important:** Per `/home/arnav/blade/CLAUDE.md` (line 16):
> "Don't run `cargo check` after every small edit — it takes 1-2 min. Batch edits, check once at the end."

**Run on:**
- After batching changes (not after every edit)
- CI pipeline: `.github/workflows/build.yml` (line 60)

### Full Build

**Development:**
```bash
npm run tauri dev    # Hot reload on file changes
```

**Production:**
```bash
npm run tauri build  # Full optimized build
```

## CI Pipeline

### Smoke Build (`.github/workflows/build.yml`)

Runs on every push to `master` and PRs.

**Steps:**
1. Setup Node (from `.nvmrc`)
2. Install frontend deps (`npm ci`)
3. **Typecheck frontend** (`npx tsc --noEmit`)
4. Build frontend (`npm run build`)
5. Setup Rust stable
6. Install system dependencies (Linux: webkit, GTK, sound, dbus, secrets, etc.)
7. **Rust check** (`cargo check --manifest-path src-tauri/Cargo.toml`)

**Failure gates:**
- TypeScript compile errors block merging
- Rust compile errors block merging
- System dependency issues on Linux (CI installs all required packages)

**Duration:** ~8-12 min depending on cache hits

**Platform:** Ubuntu latest (smoke test only; full cross-platform in release)

### Release Build (`.github/workflows/release.yml`)

Runs on `git push --tags` with `v*` tags.

**Platforms:**
- `windows-latest` (bundles: nsis, msi)
- `macos-latest` (bundles: app, dmg)
- `ubuntu-24.04` (bundles: appimage, deb, rpm)

**All steps same as smoke build, plus:**
- Tauri action builds and signs for each platform
- Publishes GitHub Release with installers
- Generates updater JSON for auto-updates

## Test File Organization

**Current:** No `.test.ts` or `.spec.ts` files in the codebase (Bash confirms none exist).

**If tests were added:**
- **Location:** Co-located with source (e.g., `src/components/ChatWindow.test.tsx`)
- **Naming:** `*.test.ts` or `*.spec.ts`
- **Framework:** Not yet selected (candidate: Vitest + React Testing Library)

## Manual Testing Approach

Since automation is minimal, BLADE relies on:

1. **Type safety:**
   - `npx tsc --noEmit` catches type errors early
   - TypeScript `strict: true` mode enforces safety
   - Result types in Rust enforce error handling

2. **Compilation checks:**
   - `cargo check` catches module registration errors
   - Duplicate command names caught by macro expansion errors
   - Missing config fields cause compile-time errors (if referenced)

3. **Runtime validation:**
   - Tauri IPC roundtrip testing (invoke/listen pattern)
   - Manual end-to-end testing of features
   - Regression testing before releases

4. **Integration testing:**
   - GitHub Actions builds across three platforms (Windows, macOS, Linux)
   - Each platform tests actual Tauri app launch and IPC
   - System dependency presence validated (Ubuntu system packages)

## Coverage

**Target:** Not enforced

**Reality:**
- Type coverage: Very high (TypeScript strict mode)
- Compile coverage: 100% (all code must compile)
- Runtime coverage: Unknown (no instrumentation)

## Common Testing Patterns (If Tests Were Written)

### Testing Tauri Commands (Rust → TypeScript)

**Challenge:** Commands need a running app to invoke.

**Approach (hypothetical):**
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_my_command() {
        // Tauri commands are hard to test in isolation
        // because they depend on AppHandle state.
        // Pattern: mock the state, test business logic separately.
    }
}
```

**Better pattern:** Extract business logic from command handler:
```rust
// Pure function (testable)
pub fn process_input(text: &str) -> Result<String, String> { ... }

// Command (calls pure function)
#[tauri::command]
pub async fn my_command(text: String) -> Result<String, String> {
    process_input(&text)
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_process_input() {
        assert_eq!(process_input("hello"), Ok("HELLO".to_string()));
    }
}
```

### Testing React Components (TypeScript)

**Hypothetical pattern with React Testing Library:**
```typescript
import { render, screen } from "@testing-library/react";
import { GlassCard } from "./GlassCard";

describe("GlassCard", () => {
  it("renders with correct tier class", () => {
    render(<GlassCard tier="floating">Content</GlassCard>);
    // Query and assert
  });
});
```

### Testing Hooks

**Hypothetical pattern with @testing-library/react:**
```typescript
import { renderHook, act } from "@testing-library/react";
import { useSwarm } from "./useSwarm";

describe("useSwarm", () => {
  it("loads swarms on mount", async () => {
    const { result } = renderHook(() => useSwarm());
    
    await act(async () => {
      await result.current.loadSwarms();
    });
    
    expect(result.current.swarms.length).toBeGreaterThan(0);
  });
});
```

## Linting & Formatting

**Configured:** No ESLint or Prettier config files detected in repository root.

**TypeScript compiler serves as linter:**
```json
// tsconfig.json (lines 18–21)
"strict": true,
"noUnusedLocals": true,
"noUnusedParameters": true,
"noFallthroughCasesInSwitch": true
```

**Enforcement:**
- `noUnusedLocals: true` — unused variables are errors
- `noUnusedParameters: true` — unused function params are errors
- `noFallthroughCasesInSwitch: true` — switch fall-through is error
- No imports of unused modules

## Development Workflow

1. **Make changes** (batch edits if touching Rust)
2. **Check types:** `npx tsc --noEmit`
3. **Check Rust:** `cd src-tauri && cargo check` (batch, not after every edit)
4. **Test locally:** `npm run tauri dev` (hot reload available)
5. **Commit:** Follow conventions in CONVENTIONS.md
6. **CI validates:** GitHub Actions runs smoke build on PR

## Known Gaps

1. **No unit test suite** — complex Tauri integration makes this challenging
2. **No E2E automation** — desktop automation tests would require Playwright or similar
3. **No coverage reporting** — no instrumentation in place
4. **No performance benchmarks** — no baseline metrics
5. **Manual regression testing** — features tested by hand before release

## Improvement Opportunities

### Short-term (feasible now)

1. **Add pure-function tests** — Extract business logic from commands/components, test with Vitest
2. **Add type tests** — TypeScript-specific patterns validation
3. **Add integration tests** — Mock Tauri for command testing

### Medium-term (requires infrastructure)

1. **Add Playwright E2E tests** — Test full UI flow with real Tauri app
2. **Add performance benchmarks** — Monitor build time and startup time
3. **Add accessibility tests** — Automated a11y checks

### Long-term

1. **Full test coverage** — Aim for >80% coverage on core modules
2. **Snapshot testing** — Capture UI snapshots for regression detection
3. **Continuous monitoring** — Production telemetry to catch regressions in the wild

## Relevant Files

- CI config: `.github/workflows/build.yml` (typecheck + cargo check)
- Release config: `.github/workflows/release.yml` (cross-platform builds)
- TypeScript config: `tsconfig.json` (strict mode settings)
- Rust config: `src-tauri/Cargo.toml` (dependencies, features)
- Build config: `src-tauri/tauri.conf.json`, `src-tauri/tauri.release.conf.json`

---

*Testing analysis: 2026-04-17*
