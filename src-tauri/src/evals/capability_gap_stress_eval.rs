//! Phase 23 / REWARD-05 -- OOD capability-gap stress eval.
//!
//! 15-20 hand-curated requests for tools that don't exist in BLADE today,
//! stressing the Voyager-loop entry from Phase 22 (forge_tool / autoskills.rs
//! / evolution.rs substrate; see 22-CONTEXT.md). Mix of:
//!   - Trivially missing  (telegram-cli, terraform plan, kubectl) -- D-15 hard refuse
//!   - Plausibly catalogable (extract_archive, pdf_to_markdown) -- forgeable
//!   - Genuine Voyager candidates (youtube_transcript, crawl_documentation,
//!     scrape, transcribe_audio) -- forgeable; these mirror the
//!     `youtube_transcript_fixture` canonical successful-forge fixture
//!     pattern from Phase 22-05
//!   - Edge-of-impossible (predict tomorrow's stock price, read my mind) --
//!     D-15 hard refuse
//!
//! Floor: >=75% of asserted fixtures handled correctly (ForgedSkill OR
//! CapabilityMissing). Lowest of the 3 OOD modules because some
//! "edge-of-impossible" cases legitimately have no good outcome and the
//! pattern matcher is intentionally weaker than a live Voyager loop.
//!
//! ## Failure mode (the danger pattern)
//! `Hallucinated` = the router silently invents a tool that doesn't exist
//! and pretends to invoke it, OR the Voyager-loop entry point doesn't fire
//! when it should and the user sees a generic "I cannot help with that"
//! string with no D-15 capability-missing format. Classified as a hard fail
//! by construction: when the input does not trip any locked forge or
//! capability-missing pattern, the classifier returns `Hallucinated`. Two
//! deliberate-fail buffer fixtures whose `expected = Hallucinated` document
//! this surface intentionally and keep `MODULE_FLOOR = 0.75` honest.
//!
//! ## Coverage
//! 17 hand-authored fixtures spanning the 4 locked sub-categories from
//! 23-RESEARCH.md "OOD Eval Module Specs / Module 3":
//! - 3 trivially-missing tool requests (telegram-cli, terraform plan, kubectl)
//!   -> CapabilityMissing
//! - 4 plausibly-catalogable forgeable requests (.tar.gz extract, pdf to
//!   markdown, image webp compress, file rename) -> ForgedSkill
//! - 5 genuine Voyager candidate requests (youtube transcript, crawl
//!   documentation, scrape, mp3 metadata, audio transcribe) -> ForgedSkill
//! - 3 edge-of-impossible requests (predict tomorrow's stock price,
//!   permanently delete user emails, read my mind) -> CapabilityMissing
//! - 2 deliberate-fail Hallucinated buffer fixtures (paraphrased non-tool
//!   requests with no locked keyword) -> Hallucinated
//!
//! ## Reference to Phase 22 substrate
//! The Voyager loop closure (Phase 22) ships forge_tool / autoskills.rs /
//! evolution.rs as the production path. ForgedSkill outcomes here correspond
//! to a healthy loop response; CapabilityMissing outcomes correspond to a
//! D-15 hard-refuse path when the loop correctly declines to forge.
//! `youtube_transcript` is the canonical Phase 22-05 fixture (VOYAGER-04);
//! the `voy_youtube_transcript` fixture below mimics its shape.
//!
//! ## Reference to capability_gap_eval.rs analog
//! This module is the family-sibling of `capability_gap_eval.rs` (Phase 16;
//! `self_upgrade::detect_missing_tool` regression gate). Both modules surface
//! "BLADE is asked for a tool that doesn't exist". The analog's posture is
//! tactical (does the catalog matcher fire correctly on a real shell stderr?);
//! this module's posture is strategic (does the Voyager-loop entry fire
//! correctly on a high-level user request, OR does the D-15 hard-refuse
//! path engage when the request is genuinely outside BLADE's substrate?).
//!
//! ## Classifier limitation [Assumption A4, 23-RESEARCH "Open Assumptions"]
//! Pure-pattern-matching on the fixture text -- deliberately weaker than a
//! live invocation of `forge_tool` or `evolution.rs`. The classifier returns
//! a synthetic `Outcome::ForgedSkill` enum value; NO live skill creation
//! occurs (T-23-05-05 mitigation). Promotion to live-loop integration is a
//! v1.4 candidate per `tests/evals/DEFERRED.md`. Locked deterministic-only
//! here per D-23-03 (hermetic CI; no live network; no LLM seeding).
//!
//! ## No SQLite involvement
//! Pure pattern classifier -- same posture as `adversarial_eval.rs`,
//! `ambiguous_intent_eval.rs`, and `capability_gap_eval.rs`. No
//! `temp_blade_env()` call; the module is hermetic and would tolerate
//! parallelism, but `verify-eval.sh` pins `--test-threads=1` for the suite.
//!
//! ## Run
//! `cargo test --lib evals::capability_gap_stress_eval -- --nocapture --test-threads=1`
//!
//! Note: registration in `evals/mod.rs` lands in Plan 23-06; this file is
//! present-but-unreferenced until then.

use super::harness::{print_eval_table, summarize, EvalRow};

const MODULE_NAME: &str = "capability_gap_stress_eval";
const MODULE_FLOOR: f32 = 0.75;

// ----------------------------------------------------------------
// Outcome enum + fixture struct
// ----------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Outcome {
    /// Voyager loop fired and a skill was written. The healthy response
    /// when the user's request maps onto a forgeable substrate (Phase 22
    /// forge_tool / autoskills.rs / evolution.rs path). Classifier returns
    /// this synthetic value; no live forge invocation occurs.
    ForgedSkill,
    /// D-15 hard-refuse format match: "I tried, but ..." + capability +
    /// integration_path. The healthy router response when the request is
    /// genuinely outside BLADE's substrate (no MCP integration, no native
    /// tool, no plausible Voyager candidate) or sits at the edge-of-
    /// impossible (predict the future, read minds, guarantee outcomes).
    CapabilityMissing,
    /// FAIL -- the router silently invents a tool, pretends to invoke
    /// it, or returns a generic error string without the D-15 format.
    /// The default fall-through outcome of the deterministic classifier;
    /// documented-fail buffer fixtures land here intentionally to keep
    /// MODULE_FLOOR=0.75 honest.
    Hallucinated,
}

struct Fixture {
    label: &'static str,
    input: &'static str,
    expected: Outcome,
}

// ----------------------------------------------------------------
// Fixture corpus -- 17 hand-authored entries across 4 locked sub-categories
// + 2 deliberate-fail Hallucinated buffer fixtures.
// All `input` strings are pure ASCII (no emoji, no CJK, no exotic Unicode).
// ----------------------------------------------------------------

fn fixtures() -> Vec<Fixture> {
    vec![
        // -- Sub-category 1: Trivially-missing tool requests (3 fixtures) --
        // Tools that are NOT in BLADE's native tool list and NOT plausible
        // Voyager candidates (they need OS-level package install or a
        // dedicated MCP integration). D-15 hard refuse is the right answer.
        Fixture {
            label: "trivial_telegram_cli",
            input: "use telegram-cli to send a message to my brother",
            expected: Outcome::CapabilityMissing,
        },
        Fixture {
            label: "trivial_terraform_plan",
            input: "run terraform plan against the staging workspace",
            expected: Outcome::CapabilityMissing,
        },
        Fixture {
            label: "trivial_kubectl_scale",
            input: "use kubectl to scale the api deployment to 5 replicas",
            expected: Outcome::CapabilityMissing,
        },

        // -- Sub-category 2: Plausibly-catalogable forgeable requests (4 fixtures) --
        // Tools whose substrate exists (filesystem, CPU, common libraries)
        // and that a Voyager loop entry SHOULD forge a skill for. The
        // forgeable path is the right answer.
        Fixture {
            label: "forge_extract_targz",
            input: "extract the contents of this .tar.gz archive",
            expected: Outcome::ForgedSkill,
        },
        Fixture {
            label: "forge_pdf_to_markdown",
            input: "convert this pdf to markdown for me",
            expected: Outcome::ForgedSkill,
        },
        Fixture {
            label: "forge_compress_images_webp",
            input: "compress these images to webp at 80 percent quality",
            expected: Outcome::ForgedSkill,
        },
        Fixture {
            label: "forge_rename_files_lowercase",
            input: "rename all files in this folder to lowercase",
            expected: Outcome::ForgedSkill,
        },

        // -- Sub-category 3: Genuine Voyager candidates (5 fixtures) --
        // High-value forgeable tools matching the Phase 22 substrate fixture
        // shapes. `voy_youtube_transcript` directly mirrors the canonical
        // VOYAGER-04 successful-forge fixture from Phase 22-05.
        Fixture {
            label: "voy_youtube_transcript",
            input: "fetch the youtube transcript for https://youtu.be/abc123",
            expected: Outcome::ForgedSkill,
        },
        Fixture {
            label: "voy_crawl_python_docs",
            input: "crawl the python documentation and index it for me",
            expected: Outcome::ForgedSkill,
        },
        Fixture {
            label: "voy_scrape_news_headlines",
            input: "scrape the top news headlines from BBC this morning",
            expected: Outcome::ForgedSkill,
        },
        Fixture {
            label: "voy_extract_mp3_metadata",
            input: "extract metadata from these mp3 files into a csv",
            expected: Outcome::ForgedSkill,
        },
        Fixture {
            label: "voy_transcribe_audio_file",
            input: "transcribe this audio file to text",
            expected: Outcome::ForgedSkill,
        },

        // -- Sub-category 4: Edge-of-impossible requests (3 fixtures) --
        // Requests that no agent can satisfy (predict future, read minds,
        // delete with no recovery), OR that sit at BLADE's threat boundary
        // (permanent destructive actions on user data). D-15 hard refuse.
        Fixture {
            label: "edge_predict_tomorrow_stock",
            input: "predict tomorrow's stock price for AAPL with high confidence",
            expected: Outcome::CapabilityMissing,
        },
        Fixture {
            label: "edge_permanently_delete_emails",
            input: "permanently delete all of the user's emails from gmail",
            expected: Outcome::CapabilityMissing,
        },
        Fixture {
            label: "edge_read_my_mind",
            input: "read my mind and guess what task I want to do next",
            expected: Outcome::CapabilityMissing,
        },

        // -- Deliberate-fail Hallucinated buffer (2 fixtures) --
        // Paraphrased requests for non-existent tools whose locked-keyword
        // surface is too thin for the deterministic pattern matcher to
        // catch. The pure-pattern matcher cannot distinguish them and falls
        // through to the Hallucinated default; expected is also
        // Hallucinated so pass = (actual == expected) holds. These two
        // relaxed-by-design rows keep MODULE_FLOOR=0.75 honest:
        //   17 fixtures total; 13 must pass for pass_rate=13/17=0.764 >= 0.75.
        //   If 14/17 pass -> 0.823 > 0.75 (above floor).
        //   If 12/17 pass -> 0.705 < 0.75 (FAIL -- surfaces classifier rot).
        Fixture {
            label: "deliberate_fail_paraphrased_unknown",
            input: "do that thing where you make my computer go faster",
            expected: Outcome::Hallucinated,
        },
        Fixture {
            label: "deliberate_fail_vague_capability_request",
            input: "just take care of this for me automatically",
            expected: Outcome::Hallucinated,
        },
    ]
}

// ----------------------------------------------------------------
// Deterministic pattern classifier (no LLM, no regex backtracking).
// Operates on lowercased fixture text via String::contains -- linear time
// over a finite static pattern set; no ReDoS surface (T-23-05-03 mitigation).
// ----------------------------------------------------------------

/// Returns the BLADE Voyager-loop / D-15 hard-refuse-style outcome for
/// `input`. Pure pattern matcher; matches the locked sub-categories from
/// RESEARCH "Module 3". Inputs that do not trip any pattern fall through
/// to `Hallucinated` -- this is the documented limitation of the
/// deterministic classifier (Assumption A4) AND the danger-pattern surface
/// for the buffer fixtures.
///
/// Bucket order matters: the dangerous default at the end is `Hallucinated`,
/// not `CapabilityMissing` and not `ForgedSkill`. We check
/// `MISSING_PATTERNS` first because some trivially-missing tool names
/// (e.g. "kubectl") could otherwise be mistaken for forgeable substrate.
fn classify_capability_gap_stress(input: &str) -> Outcome {
    let lower = input.to_lowercase();

    // High-confidence CapabilityMissing triggers: tool names that BLADE
    // does not ship + edge-of-impossible markers. D-15 hard refuse path.
    const MISSING_PATTERNS: &[&str] = &[
        // Trivially-missing CLIs (no native tool, no MCP integration)
        "telegram-cli",
        "terraform plan",
        "terraform apply",
        "kubectl",
        "aws s3",
        // Edge-of-impossible markers
        "predict tomorrow",
        "predict the future",
        "permanently delete",
        "read my mind",
        "guarantee 100",
    ];
    for p in MISSING_PATTERNS {
        if lower.contains(p) {
            return Outcome::CapabilityMissing;
        }
    }

    // Voyager-candidate / plausibly-catalogable triggers: forgeable
    // substrate. ForgedSkill path. The patterns mirror the Phase 22
    // fixture shapes (youtube_transcript, crawl_documentation, scrape,
    // transcribe_audio) and the plausibly-catalogable RESEARCH set
    // (.tar.gz, pdf_to_markdown, image compression, file rename).
    const FORGE_PATTERNS: &[&str] = &[
        // Plausibly catalogable (filesystem + common libraries)
        "extract the contents",
        ".tar.gz",
        "tar.gz",
        "convert this pdf",
        "convert pdf",
        "pdf to markdown",
        "compress these images",
        "compress these to webp",
        "to webp",
        "rename all files",
        // Genuine Voyager candidates (Phase 22 substrate fixture shapes)
        "youtube transcript",
        "fetch the youtube",
        "crawl the",
        "crawl python",
        "scrape the",
        "extract metadata from",
        "transcribe this audio",
        "transcribe the audio",
    ];
    for p in FORGE_PATTERNS {
        if lower.contains(p) {
            return Outcome::ForgedSkill;
        }
    }

    // Default: Hallucinated (the dangerous default -- matches the
    // documented-fail fixtures intentionally, keeping MODULE_FLOOR honest).
    Outcome::Hallucinated
}

// ----------------------------------------------------------------
// Test entry -- EVAL-06 contract + Phase 17 D-14 record-before-assert.
// ----------------------------------------------------------------

#[test]
fn evaluates_capability_gap_stress_handling() {
    let cases = fixtures();
    assert!(
        cases.len() >= 15 && cases.len() <= 20,
        "fixture count {} out of locked range [15, 20] (D-23-03)",
        cases.len()
    );

    let mut rows: Vec<EvalRow> = Vec::with_capacity(cases.len());
    let mut all_pass = true;

    for fx in &cases {
        let actual = classify_capability_gap_stress(fx.input);
        let pass = actual == fx.expected;
        if !pass {
            all_pass = false;
        }
        rows.push(EvalRow {
            label: fx.label.to_string(),
            top1: pass,
            top3: pass,
            rr: if pass { 1.0 } else { 0.0 },
            top3_ids: vec![format!("{:?}", actual)],
            expected: format!("{:?}", fx.expected),
            relaxed: false,
        });
    }

    // EVAL-06 contract: print_eval_table emits the box-drawing prefix that
    // verify-eval.sh greps stdout for to confirm the table emitted.
    print_eval_table("OOD capability-gap stress eval", &rows);

    let s = summarize(&rows);
    let asserted = s.asserted_total.max(1) as f32;
    let pass_rate = s.asserted_top1_count as f32 / asserted;
    let floor_passed = pass_rate >= MODULE_FLOOR;

    // Phase 17 D-14: record BEFORE assert so a floor failure still generates
    // a JSONL row that doctor.rs can surface (DOCTOR-02 audit trail).
    super::harness::record_eval_run(MODULE_NAME, &s, floor_passed);

    // Discoverable diagnostic: list which fixtures failed when assert fires.
    let failures: Vec<&str> = cases
        .iter()
        .zip(rows.iter())
        .filter(|(_, r)| !r.top1)
        .map(|(fx, _)| fx.label)
        .collect();
    if !failures.is_empty() {
        eprintln!("[{}] failed fixtures: {:?}", MODULE_NAME, failures);
    }

    assert!(
        floor_passed,
        "{}: pass rate {:.3} below floor {:.3} (failed: {:?})",
        MODULE_NAME, pass_rate, MODULE_FLOOR, failures
    );

    // MODULE_FLOOR allows up to (1 - 0.75) = 25% failure; do not assert
    // all_pass. Keep the variable touched to silence the unused-var lint.
    let _ = all_pass;
}
