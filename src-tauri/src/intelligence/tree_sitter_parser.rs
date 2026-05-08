//! INTEL-01 per-language symbol extraction (TS/JS, Rust, Python).
//!
//! Each language has a static s-expression query that captures function
//! definitions, type definitions, imports, and call sites. Captures are
//! walked into a flat Vec<ParsedSymbol> + Vec<ParsedEdge>; symbol_graph.rs
//! consumes this output and persists into kg_nodes/kg_edges.
//!
//! Catch_unwind discipline lives at the CALLER (symbol_graph::reindex_project) —
//! this module's parse functions return Result<_, String> for clean errors,
//! and the FORCE_PARSE_ERROR seam exists for test injection without crafting
//! malformed source files.

use std::cell::Cell;

#[derive(Debug, Clone)]
pub struct ParsedSymbol {
    pub name: String,
    pub kind: ParsedSymbolKind,
    pub line_start: u32,
    pub line_end: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // Module + Constant variants reserved for v1.6 expanded language coverage (Go, Ruby, Java)
pub enum ParsedSymbolKind {
    Function,
    Type,
    Module,
    Constant,
}

#[derive(Debug, Clone)]
pub struct ParsedEdge {
    #[allow(dead_code)] // resolved at the symbol_graph layer; held for the v1.6 cross-file refactor pass
    pub from_name: String,
    pub to_name: String,
    pub kind: ParsedEdgeKind,
    /// Source line of the edge call/import site (used for from-name resolution
    /// via line-range containment).
    pub source_line: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParsedEdgeKind {
    Calls,
    Imports,
    UsesType,
}

#[derive(Debug, Clone)]
pub struct ParsedFile {
    pub symbols: Vec<ParsedSymbol>,
    pub edges: Vec<ParsedEdge>,
}

thread_local! {
    /// INTEL_FORCE_PARSE_ERROR — test-only seam mirroring Phase 33's LOOP_OVERRIDE
    /// and Phase 35's DECOMP_FORCE_STEP_COUNT. When set to Some(msg), every
    /// parse_* function returns Err(msg) immediately. Production builds carry
    /// this thread_local but never set it.
    pub static INTEL_FORCE_PARSE_ERROR: Cell<Option<String>> = const { Cell::new(None) };
}

fn check_force_error() -> Result<(), String> {
    INTEL_FORCE_PARSE_ERROR.with(|c| {
        let cur = c.take();
        match cur {
            Some(msg) => {
                // Re-set so subsequent calls in the same test see the same error.
                // Test cleanup MUST .set(None).
                c.set(Some(msg.clone()));
                Err(msg)
            }
            None => Ok(()),
        }
    })
}

const TS_QUERY: &str = r#"
(function_declaration name: (identifier) @function.def)
(method_definition name: (property_identifier) @function.def)
(class_declaration name: (type_identifier) @type.def)
(interface_declaration name: (type_identifier) @type.def)
(import_statement source: (string) @import.path)
(call_expression function: (identifier) @function.call)
(call_expression function: (member_expression property: (property_identifier) @function.call))
"#;

const RUST_QUERY: &str = r#"
(function_item name: (identifier) @function.def)
(struct_item name: (type_identifier) @type.def)
(enum_item name: (type_identifier) @type.def)
(trait_item name: (type_identifier) @type.def)
(use_declaration argument: (_) @import.path)
(call_expression function: (identifier) @function.call)
(call_expression function: (field_expression field: (field_identifier) @function.call))
(macro_invocation macro: (identifier) @function.call)
"#;

const PYTHON_QUERY: &str = r#"
(function_definition name: (identifier) @function.def)
(class_definition name: (identifier) @type.def)
(import_statement name: (dotted_name) @import.path)
(import_from_statement module_name: (dotted_name) @import.path)
(call function: (identifier) @function.call)
(call function: (attribute attribute: (identifier) @function.call))
"#;

pub fn parse_typescript(content: &str) -> Result<ParsedFile, String> {
    check_force_error()?;
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_typescript::language_typescript())
        .map_err(|e| format!("set_language ts: {e}"))?;
    run_query(&mut parser, content, TS_QUERY)
}

pub fn parse_rust(content: &str) -> Result<ParsedFile, String> {
    check_force_error()?;
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_rust::language())
        .map_err(|e| format!("set_language rust: {e}"))?;
    run_query(&mut parser, content, RUST_QUERY)
}

pub fn parse_python(content: &str) -> Result<ParsedFile, String> {
    check_force_error()?;
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_python::language())
        .map_err(|e| format!("set_language python: {e}"))?;
    run_query(&mut parser, content, PYTHON_QUERY)
}

/// Walk the parsed tree, collect captures, build ParsedFile. Edges are not
/// scope-resolved here — symbol_graph.rs::reindex_project resolves edges based
/// on file proximity + same-name match.
fn run_query(
    parser: &mut tree_sitter::Parser,
    content: &str,
    query_src: &str,
) -> Result<ParsedFile, String> {
    let tree = parser
        .parse(content, None)
        .ok_or_else(|| "tree-sitter parse failed".to_string())?;
    let language = parser.language().ok_or("no language set")?;
    let query = tree_sitter::Query::new(&language, query_src)
        .map_err(|e| format!("compile query: {e}"))?;
    let mut cursor = tree_sitter::QueryCursor::new();
    let bytes = content.as_bytes();

    let mut symbols: Vec<ParsedSymbol> = Vec::new();
    let mut edges: Vec<ParsedEdge> = Vec::new();

    let capture_names = query.capture_names();

    for m in cursor.matches(&query, tree.root_node(), bytes) {
        for cap in m.captures {
            let cap_name = capture_names[cap.index as usize];
            let node = cap.node;
            let text = node.utf8_text(bytes).unwrap_or("").to_string();
            let line_start = node.start_position().row as u32;
            let line_end = node.end_position().row as u32;
            match cap_name {
                "function.def" => symbols.push(ParsedSymbol {
                    name: text,
                    kind: ParsedSymbolKind::Function,
                    line_start,
                    line_end,
                }),
                "type.def" => symbols.push(ParsedSymbol {
                    name: text,
                    kind: ParsedSymbolKind::Type,
                    line_start,
                    line_end,
                }),
                "function.call" => {
                    edges.push(ParsedEdge {
                        from_name: String::new(), // resolved at symbol_graph layer
                        to_name: text,
                        kind: ParsedEdgeKind::Calls,
                        source_line: line_start,
                    });
                }
                "import.path" => {
                    edges.push(ParsedEdge {
                        from_name: String::new(),
                        to_name: text
                            .trim_matches(|c: char| c == '"' || c == '\'')
                            .to_string(),
                        kind: ParsedEdgeKind::Imports,
                        source_line: line_start,
                    });
                }
                "type.use" => {
                    edges.push(ParsedEdge {
                        from_name: String::new(),
                        to_name: text,
                        kind: ParsedEdgeKind::UsesType,
                        source_line: line_start,
                    });
                }
                _ => {}
            }
        }
    }

    Ok(ParsedFile { symbols, edges })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase36_intel_01_tree_sitter_parses_rust_function_definition() {
        let src = r#"
fn hello() { println!("hi"); }
fn world() { hello(); }
"#;
        let parsed = parse_rust(src).expect("parse rust");
        let names: Vec<&str> = parsed.symbols.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"hello"), "should find fn hello");
        assert!(names.contains(&"world"), "should find fn world");
        // call edge: world calls hello (resolution happens at symbol_graph layer)
        assert!(
            parsed
                .edges
                .iter()
                .any(|e| e.to_name == "hello" && e.kind == ParsedEdgeKind::Calls),
            "should record world->hello call edge"
        );
    }

    #[test]
    fn phase36_intel_01_tree_sitter_parses_typescript_imports() {
        let src = r#"
import { foo } from "./bar";
import React from "react";
function baz() { foo(); }
"#;
        let parsed = parse_typescript(src).expect("parse ts");
        let imports: Vec<&str> = parsed
            .edges
            .iter()
            .filter(|e| e.kind == ParsedEdgeKind::Imports)
            .map(|e| e.to_name.as_str())
            .collect();
        assert!(
            imports.iter().any(|s| s.contains("bar")),
            "should capture ./bar import (got {:?})",
            imports
        );
        assert!(
            imports.iter().any(|s| *s == "react"),
            "should capture react import (got {:?})",
            imports
        );
        assert!(parsed.symbols.iter().any(|s| s.name == "baz"));
    }

    #[test]
    fn phase36_intel_01_tree_sitter_parses_python_class() {
        let src = r#"
import os
class Foo:
    def bar(self):
        os.path.join("a", "b")
"#;
        let parsed = parse_python(src).expect("parse python");
        assert!(parsed
            .symbols
            .iter()
            .any(|s| s.name == "Foo" && s.kind == ParsedSymbolKind::Type));
        assert!(parsed
            .symbols
            .iter()
            .any(|s| s.name == "bar" && s.kind == ParsedSymbolKind::Function));
        assert!(parsed
            .edges
            .iter()
            .any(|e| e.to_name == "os" && e.kind == ParsedEdgeKind::Imports));
    }

    #[test]
    fn phase36_intel_01_force_parse_error_seam_returns_err() {
        INTEL_FORCE_PARSE_ERROR.with(|c| c.set(Some("forced".to_string())));
        let result = parse_rust("fn x() {}");
        INTEL_FORCE_PARSE_ERROR.with(|c| c.set(None));
        assert!(
            result.is_err(),
            "FORCE_PARSE_ERROR seam must short-circuit"
        );
        assert_eq!(result.unwrap_err(), "forced");
    }
}
