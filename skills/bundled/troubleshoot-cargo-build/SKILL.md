---
name: troubleshoot-cargo-build
description: Diagnose Rust cargo build errors and propose minimal fixes. Use when cargo check or cargo build fails and the user wants the error explained without re-running the build.
license: Apache-2.0
metadata:
  category: dev-workflow
  exemplar_for: skill-with-references
---

# troubleshoot-cargo-build

A skill for parsing Rust compiler errors and proposing the smallest fix that
moves the build forward.

## When to use

- The user pastes a `cargo check` / `cargo build` failure.
- The build was just run and the assistant captured the output.
- The user asks "why is this failing?" with a Rust error in the conversation.

Do **not** use this skill when:
- The build is currently passing — there's nothing to diagnose.
- The error is from a tool other than `cargo` (e.g. `rustc` directly, `cargo test`
  failures, linker errors). Those have their own diagnostics surfaces.

## Approach

1. Identify the error code (`E0XXX`) and the primary span (file:line:col).
2. Cross-reference the error code against the canonical patterns in
   [the known-errors reference](references/known-errors.md).
3. Propose the **smallest** patch that resolves the specific error — avoid
   refactoring the surrounding code unless it's necessary for the fix to land.
4. Ask the user to re-run `cargo check` to confirm. Don't claim "fixed" until
   the round-trip is closed.

## Common shapes

- **E0282 type annotations needed** — usually `.into()` or `.collect()` losing
  type context. Fix: pin the target type with `let x: T = ...` or `::<T>`.
- **E0599 method not found** — missing trait import. Fix: `use crate::path::TraitName;`
  or check spelling.
- **E0603 module is private** — non-pub module accessed from a sibling crate
  (e.g. binary trying to use lib's private mod). Fix: `pub mod foo;` if the
  caller is legitimately on the public surface.

See [known-errors.md](references/known-errors.md) for the broader catalogue.

## Output shape

Three sections in this order:

1. **Diagnosis** — what's wrong, in one paragraph.
2. **Patch** — the exact code change(s) the user should apply.
3. **Verify** — the command the user should run to confirm the fix.

## Constraints

- Never propose dependency changes (Cargo.toml edits) unless the error is
  explicitly a missing-crate error.
- Never propose `--allow` or `#[allow(...)]` to silence a real error — only
  use those when the warning is genuinely irrelevant to correctness.
