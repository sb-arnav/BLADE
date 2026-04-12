/// BLADE ROLES — Specialist operating modes.
///
/// Inspired by GStack's virtual team model and Vibe-Trading's domain skill packs.
/// Each role changes: system prompt context, tool priorities, thinking style, and
/// what BLADE proactively notices. Switch roles in one click.
///
/// Roles are NOT personas — BLADE stays BLADE. Roles are lenses that focus
/// what BLADE pays attention to and reaches for first.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BladeRole {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub tagline: String,
    pub description: String,
    /// System prompt prefix injected at the top of every call in this mode
    pub system_injection: String,
    /// MCP tools to prioritize (shown first in tool selection)
    pub tool_priorities: Vec<String>,
    /// Skill pack bundled with this role (MCP servers to auto-suggest)
    pub skill_pack: Vec<SkillPackEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillPackEntry {
    pub name: String,
    pub package: String,
    pub command: String,
    pub args: Vec<String>,
    pub auto_install: bool,
    pub description: String,
}

pub fn all_roles() -> Vec<BladeRole> {
    vec![
        BladeRole {
            id: "engineering".to_string(),
            name: "Engineering".to_string(),
            icon: "⚙️".to_string(),
            tagline: "Build, ship, debug".to_string(),
            description: "Full code toolchain. Computer use, background agents, codebase indexing, terminal. Default mode.".to_string(),
            system_injection: r#"
ACTIVE ROLE: Engineering
You are operating in Engineering mode. Your priorities:
- Prefer code execution and tool use over explanation
- Use computer use for UI tasks, native tools for file/terminal operations
- Think in terms of: build → test → ship → monitor
- When given a task, decompose it and start executing immediately
- Spawn background agents for long-running code work
- Index and understand codebases before suggesting changes
- Always show diffs, never just describe what you'd change
"#.to_string(),
            tool_priorities: vec!["bash".to_string(), "file_read".to_string(), "file_write".to_string()],
            skill_pack: vec![
                SkillPackEntry {
                    name: "GitHub".to_string(),
                    package: "@modelcontextprotocol/server-github".to_string(),
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "@modelcontextprotocol/server-github".to_string()],
                    auto_install: false,
                    description: "PR reviews, issue tracking, code search".to_string(),
                },
                SkillPackEntry {
                    name: "Supabase".to_string(),
                    package: "@supabase/mcp-server-supabase".to_string(),
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "@supabase/mcp-server-supabase".to_string()],
                    auto_install: false,
                    description: "Query and manage your Supabase database".to_string(),
                },
                SkillPackEntry {
                    name: "Browser Automation".to_string(),
                    package: "@modelcontextprotocol/server-puppeteer".to_string(),
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "@modelcontextprotocol/server-puppeteer".to_string()],
                    auto_install: true,
                    description: "Test UIs, scrape data, automate browser workflows".to_string(),
                },
            ],
        },

        BladeRole {
            id: "research".to_string(),
            name: "Research".to_string(),
            icon: "🔬".to_string(),
            tagline: "Deep dive, synthesize, cite".to_string(),
            description: "Web research, source verification, structured synthesis. Turns any topic into a dense briefing.".to_string(),
            system_injection: r#"
ACTIVE ROLE: Research
You are operating in Research mode. Your priorities:
- Go deep, not broad — exhaust a topic before moving on
- Always cite sources. Never state facts without backing
- Synthesize across multiple sources — find contradictions, gaps, consensus
- Structure output: Executive Summary → Key Findings → Sources → Open Questions
- Use web search aggressively. Your knowledge has a cutoff; the web doesn't
- Prefer primary sources (papers, official docs, founder interviews) over summaries
- Flag uncertainty explicitly: distinguish "established" from "claimed" from "speculative"
"#.to_string(),
            tool_priorities: vec!["web_search".to_string(), "web_fetch".to_string()],
            skill_pack: vec![
                SkillPackEntry {
                    name: "Brave Search".to_string(),
                    package: "@modelcontextprotocol/server-brave-search".to_string(),
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "@modelcontextprotocol/server-brave-search".to_string()],
                    auto_install: false,
                    description: "Privacy-first web search with full result content".to_string(),
                },
                SkillPackEntry {
                    name: "Fetch".to_string(),
                    package: "@modelcontextprotocol/server-fetch".to_string(),
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "@modelcontextprotocol/server-fetch".to_string()],
                    auto_install: true,
                    description: "Fetch and parse any URL, including JS-rendered pages".to_string(),
                },
            ],
        },

        BladeRole {
            id: "marketing".to_string(),
            name: "Marketing".to_string(),
            icon: "📣".to_string(),
            tagline: "Copy, reach, convert".to_string(),
            description: "Copywriting, social media, launch strategy, A/B thinking. Turns ideas into compelling messages.".to_string(),
            system_injection: r#"
ACTIVE ROLE: Marketing
You are operating in Marketing mode. Your priorities:
- Every word has to earn its place — cut ruthlessly
- Think audience-first: who is this for, what do they already believe, what do you need to move?
- Hook → Proof → CTA is the structure for everything
- Never generic. Specific details outperform adjectives every time
- When writing copy: generate 3 variants, note which you'd bet on and why
- Think in channels: what works on X doesn't work in email doesn't work in a landing page
- Distribution is strategy. A great post no one sees is nothing
"#.to_string(),
            tool_priorities: vec!["web_fetch".to_string()],
            skill_pack: vec![
                SkillPackEntry {
                    name: "Buffer/Social Scheduler".to_string(),
                    package: "@buffer/mcp-server".to_string(),
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "@buffer/mcp-server".to_string()],
                    auto_install: false,
                    description: "Schedule and analyze social posts across platforms".to_string(),
                },
            ],
        },

        BladeRole {
            id: "operations".to_string(),
            name: "Operations".to_string(),
            icon: "📋".to_string(),
            tagline: "Organize, delegate, ship".to_string(),
            description: "Calendar, email, tasks, meeting prep. The operator that keeps everything moving.".to_string(),
            system_injection: r#"
ACTIVE ROLE: Operations
You are operating in Operations mode. Your priorities:
- Turn vague goals into concrete next actions with owners and deadlines
- Scan for blockers: what's waiting on someone? What's overdue? What has no owner?
- Meeting prep means: agenda, pre-reads, decisions needed, parking lot
- For any email: what's the actual ask? What's the stakes? What's the right response?
- Weekly review: what shipped, what slipped, what changed in priorities?
- Surface time sinks — if something takes more than 30 min to do manually, it should be automated
"#.to_string(),
            tool_priorities: vec!["bash".to_string()],
            skill_pack: vec![
                SkillPackEntry {
                    name: "Google Calendar".to_string(),
                    package: "@modelcontextprotocol/server-google-calendar".to_string(),
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "@modelcontextprotocol/server-google-calendar".to_string()],
                    auto_install: false,
                    description: "Read and create calendar events from BLADE".to_string(),
                },
                SkillPackEntry {
                    name: "Gmail".to_string(),
                    package: "@modelcontextprotocol/server-gmail".to_string(),
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "@modelcontextprotocol/server-gmail".to_string()],
                    auto_install: false,
                    description: "Read, search, and draft emails from BLADE".to_string(),
                },
                SkillPackEntry {
                    name: "Linear".to_string(),
                    package: "@linear/mcp-server".to_string(),
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "@linear/mcp-server".to_string()],
                    auto_install: false,
                    description: "Create and track issues in Linear".to_string(),
                },
                SkillPackEntry {
                    name: "Notion".to_string(),
                    package: "@notionhq/notion-mcp-server".to_string(),
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "@notionhq/notion-mcp-server".to_string()],
                    auto_install: false,
                    description: "Read and write Notion docs and databases".to_string(),
                },
            ],
        },

        BladeRole {
            id: "trading".to_string(),
            name: "Trading".to_string(),
            icon: "📈".to_string(),
            tagline: "Analyze, backtest, position".to_string(),
            description: "Inspired by Vibe-Trading. Market analysis, quant thinking, risk assessment. Finance-first mindset with 64-skill depth.".to_string(),
            system_injection: r#"
ACTIVE ROLE: Trading / Finance
You are operating in Trading mode. Your priorities:
- Think in risk/reward, not just upside. Always state max drawdown and expected value
- Backtest before asserting — historical data beats intuition
- Separate signal from noise: what's the actual thesis, what data supports it, what would invalidate it?
- Position sizing matters as much as entry — never assume "all in" is the answer
- Macro context first: what's the Fed doing, what's the credit cycle, what's the dollar doing?
- For any trade idea: entry, stop, target, size, timeframe, catalyst, invalidation
- Distinguish: trend-following vs mean-reversion vs momentum vs fundamentals
- Always ask: who is on the other side of this trade and why are they wrong?
"#.to_string(),
            tool_priorities: vec!["web_fetch".to_string(), "bash".to_string()],
            skill_pack: vec![
                SkillPackEntry {
                    name: "Alpha Vantage (Market Data)".to_string(),
                    package: "@modelcontextprotocol/server-alpha-vantage".to_string(),
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "@modelcontextprotocol/server-alpha-vantage".to_string()],
                    auto_install: false,
                    description: "Real-time and historical market data, fundamentals, news".to_string(),
                },
                SkillPackEntry {
                    name: "Financial Datasets".to_string(),
                    package: "financial-datasets-mcp".to_string(),
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "financial-datasets-mcp".to_string()],
                    auto_install: false,
                    description: "SEC filings, earnings data, financial statements".to_string(),
                },
            ],
        },

        BladeRole {
            id: "security".to_string(),
            name: "Security".to_string(),
            icon: "🛡️".to_string(),
            tagline: "Find it before they do".to_string(),
            description: "Pentest mode. Threat modeling, recon, vulnerability analysis. Requires authorization verification.".to_string(),
            system_injection: r#"
ACTIVE ROLE: Security / Pentest
You are operating in Security mode. Authorization is required for any active testing.
Your priorities:
- Threat model first: what are the crown jewels, who are the adversaries, what are the attack paths?
- Enumerate before exploiting: full recon, surface mapping, dependency analysis
- Document everything — findings, evidence, reproduction steps, CVSS scores
- Distinguish: vulnerability (weakness) vs exploit (active attack) vs risk (business impact)
- Follow responsible disclosure: report to owner before public
- For any finding: severity, exploitability, business impact, remediation
- Think like an attacker, report like a defender
"#.to_string(),
            tool_priorities: vec!["bash".to_string(), "web_fetch".to_string()],
            skill_pack: vec![],
        },
    ]
}

pub fn get_role(id: &str) -> Option<BladeRole> {
    all_roles().into_iter().find(|r| r.id == id)
}

pub fn role_system_injection(active_role: &str) -> String {
    get_role(active_role)
        .map(|r| r.system_injection)
        .unwrap_or_default()
}

#[tauri::command]
pub fn roles_list() -> Vec<BladeRole> {
    all_roles()
}

#[tauri::command]
pub fn roles_get_active() -> BladeRole {
    let config = crate::config::load_config();
    get_role(&config.active_role)
        .unwrap_or_else(|| get_role("engineering").unwrap())
}

#[tauri::command]
pub fn roles_set_active(id: String) -> Result<BladeRole, String> {
    let valid_ids: Vec<String> = all_roles().iter().map(|r| r.id.clone()).collect();
    if !valid_ids.contains(&id) {
        return Err(format!("Unknown role: {}. Valid: {:?}", id, valid_ids));
    }
    let mut config = crate::config::load_config();
    config.active_role = id.clone();
    crate::config::save_config(&config)?;
    get_role(&id).ok_or_else(|| "Role not found".to_string())
}
