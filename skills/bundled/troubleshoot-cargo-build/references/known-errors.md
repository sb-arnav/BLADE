# Known Rust compiler errors — catalogue

Each entry: error code, what triggers it, smallest fix pattern.

## E0282 — type annotations needed

**Trigger:** Type inference can't pick a unique type. Common at `.into()`,
`.collect()`, `Default::default()` calls where the target isn't pinned.

**Smallest fix:**

```rust
// Before
let v = items.iter().collect();           // E0282

// After
let v: Vec<_> = items.iter().collect();   // explicit collection type
// OR
let v = items.iter().collect::<Vec<_>>();
```

## E0432 / E0433 — unresolved import / use of undeclared crate

**Trigger:** `use foo::bar` where `foo` isn't a declared module / dep.

**Smallest fix:** add to `Cargo.toml` (if external crate) or add `mod foo;` to
the parent (if local).

## E0599 — method not found

**Trigger:** Calling a trait method without importing the trait.

**Smallest fix:**

```rust
use std::io::Write;   // adds .write_all, .flush etc on Write impls
```

## E0603 — module is private

**Trigger:** Accessing a non-pub module from outside its parent.

**Smallest fix:** `pub mod foo;` at the parent — but only if the access is
legitimately on the public surface. If it's internal, refactor instead.

## E0277 — trait bound not satisfied

**Trigger:** Type doesn't implement the required trait.

**Smallest fix:** add the trait impl, or change the bound, or use a wrapper
type (e.g. `String` instead of `&str` for owned-data requirements).

## E0382 — borrow of moved value

**Trigger:** Used a value after moving it (typically passed to a function that
takes ownership).

**Smallest fix:** `.clone()` on the value before the second use, OR change
the consuming function to take `&T` instead of `T`.

## E0106 — missing lifetime specifier

**Trigger:** Reference in a return type without naming whose lifetime it
shares.

**Smallest fix:** add `'a` lifetime parameters: `fn f<'a>(x: &'a str) -> &'a str`.
Most of the time the right answer is the input lifetime.

## E0061 — wrong number of arguments

**Trigger:** Called a function with too few or too many args.

**Smallest fix:** check the signature; the compiler usually points at the
right line. Common cause: closure signature doesn't match the iter method
(e.g. `.map(|x, y| ...)` when only `|x|` is expected).

## E0596 — cannot borrow as mutable

**Trigger:** Trying to mutate through `&T` (immutable borrow).

**Smallest fix:** make the original binding `mut` (e.g. `let mut x = ...`)
and take `&mut` instead of `&`.

## E0277 (specific: Send/Sync)

**Trigger:** Sending a non-Send type across thread boundaries (often `Rc`,
`*const T`, raw pointers, `RefCell`).

**Smallest fix:** use `Arc` instead of `Rc`, `Mutex<T>` instead of `RefCell<T>`.

## Workflow

When applying any of these fixes:

1. Make the smallest change that resolves the named error.
2. Re-run `cargo check`.
3. New error may surface (compiler stops at first error per file). Repeat.
4. Don't fix unrelated warnings on the same pass — keep diffs reviewable.
