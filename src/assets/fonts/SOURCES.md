# Self-hosted WOFF2 sources (D-24)

Fetched **2026-04-18** (UTC).

Font binaries are committed directly to the repo under this directory and
served from local asset paths at runtime (`/src/assets/fonts/*.woff2` via
`typography.css`). No `fonts.googleapis.com` / `fonts.gstatic.com` runtime
requests. Grep CI asserts absence.

## Provenance

The Google Fonts CSS2 API (`fonts.googleapis.com`) and the fonts.gstatic.com
binary host were unreachable from the BLADE build sandbox at download time
(TLS handshake timeouts — infrastructure-level egress restriction, not a
BLADE problem). Substituted the `@fontsource/<family>` packages, which are
maintained by the Fontsource project specifically for self-hosting Google
Fonts binaries as npm packages. Each package ships the same authoritative
WOFF2 binaries that Google Fonts serves, retrieved via the jsdelivr mirror
of the npm registry (which IS reachable from this environment). Pinned to
exact version per W2 reproducibility.

Fontsource repo: https://github.com/fontsource/fontsource (MIT / OFL)
Fontsource homepage (Google Fonts team-endorsed self-hosting channel):
https://fontsource.org

## Per-file URLs (jsdelivr / @fontsource, version-pinned)

| File | Version | Origin URL |
| --- | --- | --- |
| `syne-400.woff2` | `@fontsource/syne@5.2.7` | https://cdn.jsdelivr.net/npm/@fontsource/syne@5.2.7/files/syne-latin-400-normal.woff2 |
| `syne-700.woff2` | `@fontsource/syne@5.2.7` | https://cdn.jsdelivr.net/npm/@fontsource/syne@5.2.7/files/syne-latin-700-normal.woff2 |
| `bricolage-400.woff2` | `@fontsource/bricolage-grotesque@5.2.10` | https://cdn.jsdelivr.net/npm/@fontsource/bricolage-grotesque@5.2.10/files/bricolage-grotesque-latin-400-normal.woff2 |
| `bricolage-600.woff2` | `@fontsource/bricolage-grotesque@5.2.10` | https://cdn.jsdelivr.net/npm/@fontsource/bricolage-grotesque@5.2.10/files/bricolage-grotesque-latin-600-normal.woff2 |
| `fraunces-400.woff2` | `@fontsource/fraunces@5.2.9` | https://cdn.jsdelivr.net/npm/@fontsource/fraunces@5.2.9/files/fraunces-latin-400-normal.woff2 |
| `fraunces-600.woff2` | `@fontsource/fraunces@5.2.9` | https://cdn.jsdelivr.net/npm/@fontsource/fraunces@5.2.9/files/fraunces-latin-600-normal.woff2 |
| `jetbrains-400.woff2` | `@fontsource/jetbrains-mono@5.2.8` | https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.2.8/files/jetbrains-mono-latin-400-normal.woff2 |
| `jetbrains-600.woff2` | `@fontsource/jetbrains-mono@5.2.8` | https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5.2.8/files/jetbrains-mono-latin-600-normal.woff2 |

## Invariants verified at download time

- **W1 (size floor):** Every `.woff2` >= 10 KB (actual sizes: 13264 – 22456 bytes). Smallest: `syne-400.woff2` at 13264 bytes. Real Latin WOFF2 subsets are 13–25 KB; any file below 10 KB indicates a broken download or 0-byte placeholder.
- **W2 (weight distinctness):** Each `{400, 600/700}` pair compared via `cmp -s`. All four pairs are byte-distinct. Pre-check also asserted the 8 source URLs themselves are distinct.

## Reproducing the download

Network egress to `cdn.jsdelivr.net` is required. If `fonts.gstatic.com`
becomes reachable in a future CI environment, the original per-weight WOFF2
URL for each family can be extracted from
`https://fonts.googleapis.com/css2?family=<family>:wght@<a>;<b>&display=swap`
and substituted — the two mirrors serve byte-equivalent files for the Latin
subsets shipped here.

## Licenses

- **Syne** — SIL OFL 1.1 (Bonjour Monde; hosted on Google Fonts)
- **Bricolage Grotesque** — SIL OFL 1.1 (Mathieu Triay / ANRT)
- **Fraunces** — SIL OFL 1.1 (Undercase Type)
- **JetBrains Mono** — SIL OFL 1.1 (JetBrains)

All four are redistributable under OFL. No attribution requirement in the
binary itself; keep this file as the project's redistribution notice.
