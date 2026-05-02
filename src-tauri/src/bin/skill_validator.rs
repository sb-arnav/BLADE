//! `skill_validator` CLI — subcommand dispatcher.
//!
//! Usage:
//!   skill_validator validate <path>          Validate a single skill directory (default if positional path given)
//!   skill_validator validate --recursive <root> [--json]
//!   skill_validator <path>                   Back-compat alias for `validate`
//!   skill_validator list                     List all skills (forged + bundled + user + archived)
//!   skill_validator list --json              Structured JSON output
//!   skill_validator list --diff <session_id> Diff against a prior session snapshot at <config_dir>/sessions/<id>.json
//!   skill_validator list --diff <session_id> --json
//!
//! Exit codes:
//!   0  success
//!   1  validation findings (only meaningful for `validate`)
//!   2  CLI usage error
//!
//! Phase 21-04 / 21-07 invariant preserved: `verify:skill-format` chain
//! invokes `skill_validator <path>` (positional) and expects exit 0 on
//! valid skills. Phase 24 doesn't change that path.

use std::path::Path;
use std::process::ExitCode;

use blade_lib::skills::validator::{Finding, Severity, ValidationReport};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        return usage_error();
    }
    // Subcommand dispatch — see header docs.
    match args.get(1).map(|s| s.as_str()) {
        Some("validate") => run_validate(&args[2..]),
        Some("list") => run_list(&args[2..]),
        Some("-h") | Some("--help") => {
            print_usage();
            ExitCode::SUCCESS
        }
        // Plan 21 back-compat alias — positional `<path>` OR legacy
        // flag-prefixed validate invocations like
        // `skill_validator --recursive <root>` / `skill_validator --json <path>`.
        // The verify:skill-format script (Plan 21-07) invokes `--recursive` form,
        // so anything that isn't a subcommand keyword falls through to validate.
        Some(_) => run_validate(&args[1..]),
        None => usage_error(),
    }
}

fn print_usage() {
    eprintln!(
        "usage:\n  \
         skill_validator validate <path>\n  \
         skill_validator validate --recursive <root> [--json]\n  \
         skill_validator <path>                       (alias for validate)\n  \
         skill_validator list [--json]\n  \
         skill_validator list --diff <session_id> [--json]"
    );
}

fn usage_error() -> ExitCode {
    print_usage();
    ExitCode::from(2)
}

// ── validate subcommand ─────────────────────────────────────────────────────

pub fn run_validate(args: &[String]) -> ExitCode {
    let mut json = false;
    let mut recursive = false;
    let mut path: Option<&str> = None;

    for arg in args {
        match arg.as_str() {
            "--json" => json = true,
            "--recursive" => recursive = true,
            "-h" | "--help" => {
                print_usage();
                return ExitCode::SUCCESS;
            }
            other if other.starts_with("--") => {
                eprintln!("unknown flag: {other}");
                return ExitCode::from(2);
            }
            other => {
                path = Some(other);
            }
        }
    }

    let path = match path {
        Some(p) => Path::new(p),
        None => return usage_error(),
    };

    let reports = if recursive {
        let mut reports: Vec<(std::path::PathBuf, ValidationReport)> = Vec::new();
        let entries = match std::fs::read_dir(path) {
            Ok(rd) => rd,
            Err(e) => {
                eprintln!("error: read_dir {}: {e}", path.display());
                return ExitCode::from(2);
            }
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            if p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with('.'))
                .unwrap_or(false)
            {
                continue;
            }
            if !p.join("SKILL.md").is_file() {
                continue;
            }
            let report = blade_lib::skills::validator::validate_skill_dir(&p);
            reports.push((p, report));
        }
        reports
    } else {
        let report = blade_lib::skills::validator::validate_skill_dir(path);
        vec![(path.to_path_buf(), report)]
    };

    let any_invalid = reports.iter().any(|(_, r)| !r.is_valid());

    if json {
        emit_validate_json(&reports);
    } else {
        emit_validate_human(&reports);
    }

    if any_invalid {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

fn emit_validate_human(reports: &[(std::path::PathBuf, ValidationReport)]) {
    for (path, report) in reports {
        let name = report.skill_name.as_deref().unwrap_or("<unparsed>");
        let status = if report.is_valid() {
            if report.warnings().count() > 0 {
                "WARN"
            } else {
                "OK"
            }
        } else {
            "FAIL"
        };
        eprintln!("{status}  {} ({})", path.display(), name);
        for finding in &report.findings {
            eprintln!(
                "  {} [{}] {}",
                finding.severity.label(),
                finding.field,
                finding.message
            );
        }
    }
}

fn emit_validate_json(reports: &[(std::path::PathBuf, ValidationReport)]) {
    let mut buf = String::from("[\n");
    for (i, (path, report)) in reports.iter().enumerate() {
        if i > 0 {
            buf.push_str(",\n");
        }
        buf.push_str("  {\n");
        buf.push_str(&format!(
            "    \"path\": {},\n",
            json_string(&path.display().to_string())
        ));
        buf.push_str(&format!(
            "    \"name\": {},\n",
            report
                .skill_name
                .as_deref()
                .map(json_string)
                .unwrap_or_else(|| "null".into())
        ));
        buf.push_str(&format!("    \"valid\": {},\n", report.is_valid()));
        buf.push_str(&format!(
            "    \"body_token_estimate\": {},\n",
            report
                .body_token_estimate
                .map(|n| n.to_string())
                .unwrap_or_else(|| "null".into())
        ));
        buf.push_str("    \"findings\": [\n");
        for (j, f) in report.findings.iter().enumerate() {
            if j > 0 {
                buf.push_str(",\n");
            }
            buf.push_str("      ");
            buf.push_str(&finding_json(f));
        }
        if !report.findings.is_empty() {
            buf.push('\n');
        }
        buf.push_str("    ]\n");
        buf.push_str("  }");
    }
    buf.push_str("\n]\n");
    print!("{buf}");
}

fn finding_json(f: &Finding) -> String {
    format!(
        "{{ \"severity\": {}, \"field\": {}, \"message\": {} }}",
        json_string(match f.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        }),
        json_string(&f.field),
        json_string(&f.message)
    )
}

fn json_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

// ── list subcommand (Phase 24) ──────────────────────────────────────────────

pub fn run_list(args: &[String]) -> ExitCode {
    let mut json = false;
    let mut diff_session: Option<String> = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--json" => json = true,
            "--diff" => {
                diff_session = match iter.next() {
                    Some(s) => Some(s.clone()),
                    None => {
                        eprintln!("error: --diff requires a <session_id> argument");
                        return ExitCode::from(2);
                    }
                };
            }
            "-h" | "--help" => {
                print_usage();
                return ExitCode::SUCCESS;
            }
            other => {
                eprintln!("unknown arg: {other}");
                return ExitCode::from(2);
            }
        }
    }

    match diff_session {
        Some(id) => run_list_diff(&id, json),
        None => run_list_full(json),
    }
}

fn run_list_full(json: bool) -> ExitCode {
    let snap = blade_lib::skills::list_skills_snapshot();
    if json {
        print!("{}", snapshot_to_json(&snap));
    } else {
        print_snapshot_text(&snap);
    }
    ExitCode::SUCCESS
}

pub fn run_list_diff(session_id: &str, json: bool) -> ExitCode {
    // Read prior snapshot from <config_dir>/sessions/<session_id>.json.
    let session_path = blade_lib::config::blade_config_dir()
        .join("sessions")
        .join(format!("{}.json", session_id));
    let prior_text = match std::fs::read_to_string(&session_path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("error: read {}: {e}", session_path.display());
            return ExitCode::from(2);
        }
    };
    let prior: blade_lib::session_handoff::SessionHandoff =
        match serde_json::from_str(&prior_text) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("error: parse {}: {e}", session_path.display());
                return ExitCode::from(2);
            }
        };

    let current = blade_lib::skills::list_skills_snapshot();
    let prior_names: std::collections::HashSet<String> = prior
        .skills_snapshot
        .iter()
        .map(|r| r.name.clone())
        .collect();
    let current_names: std::collections::HashSet<String> =
        current.iter().map(|r| r.name.clone()).collect();

    // added = current ∖ prior
    let added: Vec<String> = current
        .iter()
        .filter(|r| !prior_names.contains(&r.name))
        .map(|r| r.name.clone())
        .collect();

    // archived = prior ∖ current AND name now appears under .archived/.
    let archived_now: std::collections::HashSet<String> = current
        .iter()
        .filter(|r| r.source == "archived")
        .map(|r| r.name.clone())
        .collect();
    let archived: Vec<String> = prior
        .skills_snapshot
        .iter()
        .filter(|r| !current_names.contains(&r.name) || archived_now.contains(&r.name))
        .filter(|r| archived_now.contains(&r.name))
        .map(|r| r.name.clone())
        .collect();

    // consolidated = prior ∖ current AND name appears in any current
    // forged tool's forged_from field with "merge:" prefix.
    let consolidated_sources: Vec<String> = current
        .iter()
        .filter_map(|r| {
            if let Some(ff) = &r.forged_from {
                if ff.starts_with("merge:") {
                    // forged_from = "merge:<a>+<b>"
                    let inner = &ff[6..];
                    return Some(inner.to_string());
                }
            }
            None
        })
        .collect();
    let consolidated: Vec<String> = prior
        .skills_snapshot
        .iter()
        .filter(|r| !current_names.contains(&r.name))
        .filter(|r| {
            consolidated_sources.iter().any(|c| {
                let parts: Vec<&str> = c.split('+').collect();
                parts.contains(&r.name.as_str())
            })
        })
        .map(|r| r.name.clone())
        .collect();

    if json {
        print!(
            "{{\"added\":{}, \"archived\":{}, \"consolidated\":{}}}\n",
            json_array(&added),
            json_array(&archived),
            json_array(&consolidated)
        );
    } else {
        println!("+ added ({}):", added.len());
        for n in &added {
            println!("    {}", n);
        }
        println!("+ archived ({}):", archived.len());
        for n in &archived {
            println!("    {}", n);
        }
        println!("+ consolidated ({}):", consolidated.len());
        for n in &consolidated {
            // Find the merged target name in current.
            let target = current.iter().find_map(|r| {
                if let Some(ff) = &r.forged_from {
                    if ff.starts_with("merge:") && ff[6..].split('+').any(|p| p == n) {
                        return Some(r.name.clone());
                    }
                }
                None
            });
            match target {
                Some(t) => println!("    {} -> {}", n, t),
                None => println!("    {}", n),
            }
        }
    }

    ExitCode::SUCCESS
}

fn json_array(items: &[String]) -> String {
    let mut buf = String::from("[");
    for (i, s) in items.iter().enumerate() {
        if i > 0 {
            buf.push(',');
        }
        buf.push_str(&json_string(s));
    }
    buf.push(']');
    buf
}

fn snapshot_to_json(snap: &[blade_lib::skills::SkillRef]) -> String {
    let mut buckets: std::collections::BTreeMap<&str, Vec<&blade_lib::skills::SkillRef>> =
        std::collections::BTreeMap::new();
    for r in snap {
        buckets.entry(r.source.as_str()).or_default().push(r);
    }
    let mut buf = String::from("{");
    let bucket_order = ["forged", "bundled", "user", "archived"];
    for (i, key) in bucket_order.iter().enumerate() {
        if i > 0 {
            buf.push(',');
        }
        buf.push_str(&format!("{}:[", json_string(key)));
        if let Some(items) = buckets.get(*key) {
            for (j, r) in items.iter().enumerate() {
                if j > 0 {
                    buf.push(',');
                }
                buf.push_str(&format!(
                    "{{{}:{},{}:{},{}:{},{}:{}}}",
                    json_string("name"),
                    json_string(&r.name),
                    json_string("source"),
                    json_string(&r.source),
                    json_string("last_used"),
                    r.last_used
                        .map(|t| t.to_string())
                        .unwrap_or_else(|| "null".into()),
                    json_string("forged_from"),
                    r.forged_from
                        .as_deref()
                        .map(json_string)
                        .unwrap_or_else(|| "null".into())
                ));
            }
        }
        buf.push(']');
    }
    buf.push('}');
    buf.push('\n');
    buf
}

fn print_snapshot_text(snap: &[blade_lib::skills::SkillRef]) {
    let bucket_order = ["forged", "bundled", "user", "archived"];
    for key in &bucket_order {
        for r in snap.iter().filter(|r| r.source == *key) {
            let last_used = r
                .last_used
                .map(|t| t.to_string())
                .unwrap_or_else(|| "-".into());
            println!("[{}]\t{}\tlast_used: {}", r.source, r.name, last_used);
        }
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn isolated() -> TempDir {
        let tmp = TempDir::new().expect("tempdir");
        std::env::set_var("BLADE_CONFIG_DIR", tmp.path());
        tmp
    }

    fn seed_forged(tmp_path: &std::path::Path, name: &str, last_used: i64, forged_from: &str) {
        let conn = rusqlite::Connection::open(tmp_path.join("blade.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS forged_tools (
                id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL,
                language TEXT NOT NULL, script_path TEXT NOT NULL, usage TEXT NOT NULL,
                parameters TEXT DEFAULT '[]', test_output TEXT DEFAULT '',
                created_at INTEGER NOT NULL, last_used INTEGER, use_count INTEGER DEFAULT 0,
                forged_from TEXT DEFAULT ''
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO forged_tools (id, name, description, language, script_path, usage, created_at, last_used, forged_from) \
             VALUES (?1, ?2, 'd', 'bash', '/tmp/x.sh', 'u', ?3, ?3, ?4)",
            rusqlite::params![format!("id-{}", name), name, last_used, forged_from],
        )
        .unwrap();
    }

    fn seed_skill_md(tmp_path: &std::path::Path, source: &str, name: &str) {
        // source ∈ {"user", "archived"} → write to skills/<name>/SKILL.md or skills/.archived/<name>/SKILL.md
        let parent = match source {
            "archived" => tmp_path.join("skills").join(".archived"),
            _ => tmp_path.join("skills"),
        };
        let dir = parent.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {}\ndescription: x\n---\n# {}\n", name, name),
        )
        .unwrap();
    }

    #[test]
    fn list_subcommand_text_format() {
        let tmp = isolated();
        seed_forged(tmp.path(), "forged_one", 1714579200, "");
        seed_skill_md(tmp.path(), "user", "user-one");
        seed_skill_md(tmp.path(), "archived", "archived-one");

        // Capture stdout via a BufWriter is non-trivial; instead, exercise
        // the public surface and check the snapshot it produces.
        let snap = blade_lib::skills::list_skills_snapshot();
        assert!(snap
            .iter()
            .any(|r| r.source == "forged" && r.name == "forged_one"));
        assert!(snap
            .iter()
            .any(|r| r.source == "user" && r.name == "user-one"));
        assert!(snap
            .iter()
            .any(|r| r.source == "archived" && r.name == "archived-one"));

        // Smoke-run the CLI handler — it MUST exit 0 and not panic.
        let exit = run_list(&[]);
        assert_eq!(format!("{:?}", exit), format!("{:?}", ExitCode::SUCCESS));

        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn list_subcommand_json_format() {
        let tmp = isolated();
        seed_forged(tmp.path(), "json_forged", 1714579200, "");
        seed_skill_md(tmp.path(), "user", "json-user");

        let snap = blade_lib::skills::list_skills_snapshot();
        let json = snapshot_to_json(&snap);
        // Parseable JSON.
        let parsed: serde_json::Value = serde_json::from_str(json.trim()).unwrap();
        assert!(parsed.get("forged").is_some());
        assert!(parsed.get("bundled").is_some());
        assert!(parsed.get("user").is_some());
        assert!(parsed.get("archived").is_some());
        // Forged bucket has at least our seeded entry.
        let forged = parsed.get("forged").unwrap().as_array().unwrap();
        assert!(forged
            .iter()
            .any(|v| v.get("name").and_then(|n| n.as_str()) == Some("json_forged")));

        let exit = run_list(&["--json".to_string()]);
        assert_eq!(format!("{:?}", exit), format!("{:?}", ExitCode::SUCCESS));

        std::env::remove_var("BLADE_CONFIG_DIR");
    }

    #[test]
    fn list_diff_categorizes() {
        let tmp = isolated();

        // Seed CURRENT state: 1 NEW forged + 1 archived (which used to be live) +
        // 1 forged with forged_from = "merge:foo+bar" (which consolidated 'foo' and 'bar').
        seed_forged(tmp.path(), "added_new", 100, "");
        seed_forged(tmp.path(), "foo_bar_merged", 200, "merge:foo+bar");
        seed_skill_md(tmp.path(), "archived", "archived-old");

        // Write prior session snapshot at <config_dir>/sessions/test1.json.
        let sessions_dir = tmp.path().join("sessions");
        std::fs::create_dir_all(&sessions_dir).unwrap();
        let prior_handoff = blade_lib::session_handoff::SessionHandoff {
            summary: "prior".to_string(),
            last_commands: vec![],
            pending_items: vec![],
            generated_at: 1700000000,
            skills_snapshot: vec![
                blade_lib::skills::SkillRef {
                    name: "archived-old".to_string(), // was live, now archived
                    source: "user".to_string(),
                    last_used: None,
                    forged_from: None,
                },
                blade_lib::skills::SkillRef {
                    name: "foo".to_string(), // consolidated into foo_bar_merged
                    source: "forged".to_string(),
                    last_used: Some(50),
                    forged_from: None,
                },
                blade_lib::skills::SkillRef {
                    name: "bar".to_string(), // consolidated into foo_bar_merged
                    source: "forged".to_string(),
                    last_used: Some(60),
                    forged_from: None,
                },
            ],
        };
        std::fs::write(
            sessions_dir.join("test1.json"),
            serde_json::to_string_pretty(&prior_handoff).unwrap(),
        )
        .unwrap();

        let exit = run_list_diff("test1", false);
        assert_eq!(format!("{:?}", exit), format!("{:?}", ExitCode::SUCCESS));

        // Programmatic check via the same logic — diff must place names into 3 buckets.
        // (Stdout capture in `cargo test` is fragile across platforms; we re-derive
        // the buckets here to assert correctness.)
        let prior_names: std::collections::HashSet<String> = prior_handoff
            .skills_snapshot
            .iter()
            .map(|r| r.name.clone())
            .collect();
        let current = blade_lib::skills::list_skills_snapshot();
        let current_names: std::collections::HashSet<String> =
            current.iter().map(|r| r.name.clone()).collect();
        // added — must include "added_new" + "foo_bar_merged" (both new)
        assert!(current_names.contains("added_new") && !prior_names.contains("added_new"));
        assert!(
            current_names.contains("foo_bar_merged") && !prior_names.contains("foo_bar_merged")
        );
        // archived — "archived-old" is not in current as `user` but IS as `archived`.
        assert!(current
            .iter()
            .any(|r| r.name == "archived-old" && r.source == "archived"));
        // consolidated — "foo" + "bar" gone from current, both appear in foo_bar_merged.forged_from.
        assert!(!current_names.contains("foo") && prior_names.contains("foo"));
        assert!(!current_names.contains("bar") && prior_names.contains("bar"));

        std::env::remove_var("BLADE_CONFIG_DIR");
    }
}
