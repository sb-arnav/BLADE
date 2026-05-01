//! `skill_validator` CLI — thin shim around `blade_lib::skills::validator`.
//!
//! Usage:
//!   skill_validator <skill-dir>
//!   skill_validator --json <skill-dir>      Emit structured JSON to stdout
//!   skill_validator --recursive <root>      Validate every immediate subdir
//!
//! Exit codes:
//!   0  all skills valid (warnings allowed)
//!   1  at least one skill has errors
//!   2  CLI usage error
//!
//! Wired into `verify:skill-format` (Plan 21-07) which iterates bundled +
//! workspace skills and asserts exit 0.

use std::path::Path;
use std::process::ExitCode;

use blade_lib::skills::validator::{Finding, Severity, ValidationReport};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: skill_validator [--json] [--recursive] <path>");
        return ExitCode::from(2);
    }

    let mut json = false;
    let mut recursive = false;
    let mut path: Option<&str> = None;

    for arg in &args[1..] {
        match arg.as_str() {
            "--json" => json = true,
            "--recursive" => recursive = true,
            "-h" | "--help" => {
                println!("usage: skill_validator [--json] [--recursive] <path>");
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
        None => {
            eprintln!("usage: skill_validator [--json] [--recursive] <path>");
            return ExitCode::from(2);
        }
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
            // Only validate dirs that look like skill dirs (contain SKILL.md)
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
        emit_json(&reports);
    } else {
        emit_human(&reports);
    }

    if any_invalid {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

fn emit_human(reports: &[(std::path::PathBuf, ValidationReport)]) {
    for (path, report) in reports {
        let name = report
            .skill_name
            .as_deref()
            .unwrap_or("<unparsed>");
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

fn emit_json(reports: &[(std::path::PathBuf, ValidationReport)]) {
    let mut buf = String::from("[\n");
    for (i, (path, report)) in reports.iter().enumerate() {
        if i > 0 {
            buf.push_str(",\n");
        }
        buf.push_str("  {\n");
        buf.push_str(&format!("    \"path\": {},\n", json_string(&path.display().to_string())));
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
