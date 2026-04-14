/// BLADE Financial Brain — Personal Finance Intelligence
///
/// The user logs transactions manually. BLADE analyzes spending patterns,
/// generates insights (e.g. "You're 40% over on food"), suggests investments
/// based on monthly surplus, tracks financial goals, and injects financial
/// context into the system prompt when meaningful data exists (>5 transactions).
///
/// All DB work is done synchronously before any `.await` points, so no
/// rusqlite::Connection is held across an await boundary.

use chrono::Datelike;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ── DB helpers ────────────────────────────────────────────────────────────────

fn db_path() -> std::path::PathBuf {
    crate::config::blade_config_dir().join("blade.db")
}

fn open_db() -> Result<Connection, String> {
    Connection::open(db_path()).map_err(|e| format!("DB open failed: {e}"))
}

// ── Structs ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    /// positive = income, negative = expense
    pub amount: f64,
    /// "food" | "rent" | "transport" | "entertainment" | "income" | "investment" | "savings"
    pub category: String,
    pub description: String,
    pub date: String, // YYYY-MM-DD
    pub tags: Vec<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinancialSnapshot {
    pub month: String, // YYYY-MM
    pub income: f64,
    pub expenses: f64,
    pub savings_rate: f64,
    pub top_categories: Vec<(String, f64)>, // (category, total_spent)
    pub vs_last_month: HashMap<String, f64>, // category -> % change
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinancialInsight {
    pub insight_type: String, // "warning" | "opportunity" | "trend" | "achievement"
    pub title: String,
    pub description: String,
    pub action_items: Vec<String>,
    pub urgency: String, // "low" | "medium" | "high"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinancialGoal {
    pub id: String,
    pub name: String,
    pub target_amount: f64,
    pub current_amount: f64,
    pub deadline: String, // YYYY-MM-DD
    pub monthly_required: f64, // auto-calculated
    pub status: String,  // "on_track" | "at_risk" | "completed"
}

// ── Schema ────────────────────────────────────────────────────────────────────

pub fn ensure_tables() {
    if let Ok(conn) = open_db() {
        let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS fin_transactions (
                id TEXT PRIMARY KEY,
                amount REAL NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                date TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS fin_goals (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                target_amount REAL NOT NULL,
                current_amount REAL NOT NULL DEFAULT 0,
                deadline TEXT NOT NULL,
                monthly_required REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'on_track',
                created_at INTEGER NOT NULL
            );",
        );
    }
}

// ── Heuristic categoriser ─────────────────────────────────────────────────────

/// Map a free-text description to a category using keyword heuristics.
pub fn categorize_transaction(description: &str) -> String {
    let d = description.to_lowercase();

    // Income signals
    if d.contains("salary") || d.contains("paycheck") || d.contains("payroll")
        || d.contains("deposit") || d.contains("freelance") || d.contains("invoice")
        || d.contains("client") || d.contains("revenue") || d.contains("dividend")
    {
        return "income".to_string();
    }

    // Savings / investments first so they don't fall into generic
    if d.contains("savings") || d.contains("saving") || d.contains("piggy") {
        return "savings".to_string();
    }
    if d.contains("invest") || d.contains("stock") || d.contains("etf")
        || d.contains("mutual fund") || d.contains("crypto") || d.contains("bitcoin")
        || d.contains("zerodha") || d.contains("groww") || d.contains("robinhood")
        || d.contains("fidelity") || d.contains("vanguard") || d.contains("401k")
        || d.contains("ira") || d.contains("brokerage")
    {
        return "investment".to_string();
    }

    // Housing
    if d.contains("rent") || d.contains("mortgage") || d.contains("landlord")
        || d.contains("electricity") || d.contains("water bill") || d.contains("utility")
        || d.contains("internet") || d.contains("wifi") || d.contains("broadband")
        || d.contains("maintenance") || d.contains("hoa")
    {
        return "rent".to_string();
    }

    // Transport
    if d.contains("uber") || d.contains("ola") || d.contains("lyft")
        || d.contains("taxi") || d.contains("metro") || d.contains("subway")
        || d.contains("bus") || d.contains("train") || d.contains("flight")
        || d.contains("airline") || d.contains("fuel") || d.contains("petrol")
        || d.contains("gas station") || d.contains("parking") || d.contains("toll")
        || d.contains("rapido") || d.contains("auto rickshaw")
    {
        return "transport".to_string();
    }

    // Food & dining
    if d.contains("swiggy") || d.contains("zomato") || d.contains("doordash")
        || d.contains("grubhub") || d.contains("ubereats") || d.contains("restaurant")
        || d.contains("cafe") || d.contains("coffee") || d.contains("starbucks")
        || d.contains("mcdonald") || d.contains("pizza") || d.contains("grocery")
        || d.contains("supermarket") || d.contains("whole foods") || d.contains("trader joe")
        || d.contains("dinner") || d.contains("lunch") || d.contains("breakfast")
        || d.contains("food") || d.contains("meal") || d.contains("snack")
    {
        return "food".to_string();
    }

    // Entertainment / subscriptions
    if d.contains("netflix") || d.contains("spotify") || d.contains("amazon prime")
        || d.contains("hotstar") || d.contains("disney") || d.contains("hulu")
        || d.contains("youtube premium") || d.contains("apple tv") || d.contains("hbo")
        || d.contains("movie") || d.contains("cinema") || d.contains("theatre")
        || d.contains("concert") || d.contains("gaming") || d.contains("steam")
        || d.contains("playstation") || d.contains("xbox") || d.contains("nintendo")
        || d.contains("gym") || d.contains("fitness") || d.contains("club")
        || d.contains("subscription")
    {
        return "entertainment".to_string();
    }

    // Health
    if d.contains("hospital") || d.contains("clinic") || d.contains("pharmacy")
        || d.contains("medicine") || d.contains("doctor") || d.contains("dentist")
        || d.contains("health insurance") || d.contains("medical")
    {
        return "health".to_string();
    }

    // Shopping / misc
    "shopping".to_string()
}

// ── Transactions ──────────────────────────────────────────────────────────────

pub fn add_transaction(t: Transaction) -> Result<String, String> {
    let conn = open_db()?;
    let tags_json = serde_json::to_string(&t.tags).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO fin_transactions (id, amount, category, description, date, tags, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![t.id, t.amount, t.category, t.description, t.date, tags_json, t.created_at],
    )
    .map_err(|e| format!("Insert failed: {e}"))?;

    Ok(t.id)
}

pub fn get_transactions(
    start_date: &str,
    end_date: &str,
    category: Option<&str>,
) -> Vec<Transaction> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let rows: Vec<Transaction> = if let Some(cat) = category {
        let mut stmt = match conn.prepare(
            "SELECT id, amount, category, description, date, tags, created_at
             FROM fin_transactions
             WHERE date >= ?1 AND date <= ?2 AND category = ?3
             ORDER BY date DESC",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![start_date, end_date, cat], row_to_transaction)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .collect()
    } else {
        let mut stmt = match conn.prepare(
            "SELECT id, amount, category, description, date, tags, created_at
             FROM fin_transactions
             WHERE date >= ?1 AND date <= ?2
             ORDER BY date DESC",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![start_date, end_date], row_to_transaction)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .collect()
    };

    rows
}

fn row_to_transaction(row: &rusqlite::Row<'_>) -> rusqlite::Result<Transaction> {
    let tags_json: String = row.get(5)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    Ok(Transaction {
        id: row.get(0)?,
        amount: row.get(1)?,
        category: row.get(2)?,
        description: row.get(3)?,
        date: row.get(4)?,
        tags,
        created_at: row.get(6)?,
    })
}

pub fn delete_transaction(id: &str) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM fin_transactions WHERE id = ?1", params![id])
        .map_err(|e| format!("Delete failed: {e}"))?;
    Ok(())
}

/// Count all transactions in the DB.
fn transaction_count() -> usize {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return 0,
    };
    conn.query_row("SELECT COUNT(*) FROM fin_transactions", [], |r| r.get::<_, i64>(0))
        .unwrap_or(0) as usize
}

// ── Analytics ─────────────────────────────────────────────────────────────────

/// Build a monthly snapshot for a given "YYYY-MM".
pub fn get_snapshot(month: &str) -> FinancialSnapshot {
    let start = format!("{}-01", month);
    // End of month: use a simple upper bound
    let end = format!("{}-31", month);

    let txns = get_transactions(&start, &end, None);

    let mut income = 0f64;
    let mut expenses_by_cat: HashMap<String, f64> = HashMap::new();

    for t in &txns {
        if t.amount > 0.0 {
            income += t.amount;
        } else {
            *expenses_by_cat.entry(t.category.clone()).or_insert(0.0) += t.amount.abs();
        }
    }

    let total_expenses: f64 = expenses_by_cat.values().sum();
    let savings_rate = if income > 0.0 {
        ((income - total_expenses) / income * 100.0).max(0.0)
    } else {
        0.0
    };

    // Sort categories by spend descending
    let mut top_categories: Vec<(String, f64)> = expenses_by_cat.into_iter().collect();
    top_categories.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Compare against last month
    let vs_last_month = compute_vs_last_month(month, &top_categories);

    FinancialSnapshot {
        month: month.to_string(),
        income,
        expenses: total_expenses,
        savings_rate,
        top_categories,
        vs_last_month,
    }
}

fn prev_month(month: &str) -> String {
    // month = "YYYY-MM"
    let parts: Vec<&str> = month.splitn(2, '-').collect();
    if parts.len() != 2 {
        return String::new();
    }
    let year: i32 = parts[0].parse().unwrap_or(2024);
    let m: i32 = parts[1].parse().unwrap_or(1);
    if m == 1 {
        format!("{:04}-12", year - 1)
    } else {
        format!("{:04}-{:02}", year, m - 1)
    }
}

fn compute_vs_last_month(
    month: &str,
    current_cats: &[(String, f64)],
) -> HashMap<String, f64> {
    let prev = prev_month(month);
    if prev.is_empty() {
        return HashMap::new();
    }
    let prev_start = format!("{}-01", prev);
    let prev_end = format!("{}-31", prev);
    let prev_txns = get_transactions(&prev_start, &prev_end, None);

    let mut prev_cats: HashMap<String, f64> = HashMap::new();
    for t in &prev_txns {
        if t.amount < 0.0 {
            *prev_cats.entry(t.category.clone()).or_insert(0.0) += t.amount.abs();
        }
    }

    let mut changes = HashMap::new();
    for (cat, current_amount) in current_cats {
        let prev_amount = prev_cats.get(cat).copied().unwrap_or(0.0);
        let pct_change = if prev_amount > 0.0 {
            (current_amount - prev_amount) / prev_amount * 100.0
        } else if *current_amount > 0.0 {
            100.0 // new category this month
        } else {
            0.0
        };
        changes.insert(cat.clone(), pct_change);
    }
    changes
}

/// Return monthly totals for a category for the last N months.
/// Returns Vec of ("YYYY-MM", total_spent).
#[allow(dead_code)]
pub fn get_spending_trend(category: &str, months: usize) -> Vec<(String, f64)> {
    let now = chrono::Local::now();
    let mut result = Vec::new();

    for i in 0..months {
        let month = {
            let m = now.month0() as i32 - i as i32;
            let year = now.year() + (m.div_euclid(12) as i32);
            let month_num = ((m % 12 + 12) % 12) as u32 + 1;
            format!("{:04}-{:02}", year, month_num)
        };
        let start = format!("{}-01", month);
        let end = format!("{}-31", month);
        let txns = get_transactions(&start, &end, Some(category));
        let total: f64 = txns.iter().filter(|t| t.amount < 0.0).map(|t| t.amount.abs()).sum();
        result.push((month, total));
    }

    result.reverse(); // oldest first
    result
}

// ── LLM-powered insights ──────────────────────────────────────────────────────

/// Analyse spending patterns for the last N months and produce 3-5 structured insights.
pub async fn generate_insights(months_back: usize) -> Vec<FinancialInsight> {
    // Gather data synchronously before any await
    let now = chrono::Local::now();
    let mut monthly_snapshots: Vec<FinancialSnapshot> = Vec::new();
    for i in 0..months_back {
        let month = {
            let m = now.month0() as i32 - i as i32;
            let year = now.year() + (m.div_euclid(12) as i32);
            let month_num = ((m % 12 + 12) % 12) as u32 + 1;
            format!("{:04}-{:02}", year, month_num)
        };
        monthly_snapshots.push(get_snapshot(&month));
    }
    monthly_snapshots.reverse();

    if monthly_snapshots.iter().all(|s| s.income == 0.0 && s.expenses == 0.0) {
        return vec![FinancialInsight {
            insight_type: "opportunity".to_string(),
            title: "Start tracking your finances".to_string(),
            description: "Add your first transaction to unlock spending insights.".to_string(),
            action_items: vec!["Log your last month's income".to_string(), "Log your regular expenses".to_string()],
            urgency: "low".to_string(),
        }];
    }

    // Serialize snapshots as context for the LLM
    let snapshot_json = serde_json::to_string_pretty(&monthly_snapshots).unwrap_or_default();

    let prompt = format!(
        "You are a personal finance advisor analysing spending data. \
         Here are the last {} months of financial snapshots (income, expenses, by-category breakdown, month-over-month changes):\n\n\
         {}\n\n\
         Produce 3-5 specific, actionable financial insights as a JSON array with this schema:\n\
         [\n  {{\n    \"insight_type\": \"warning|opportunity|trend|achievement\",\n    \
         \"title\": \"short title\",\n    \"description\": \"one or two sentences\",\n    \
         \"action_items\": [\"concrete step 1\", \"concrete step 2\"],\n    \
         \"urgency\": \"low|medium|high\"\n  }}\n]\n\n\
         Return ONLY valid JSON. No markdown fences. No extra text.",
        months_back, snapshot_json
    );

    // Get provider config (no DB connection held at this point)
    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    let turn = match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None).await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[financial_brain] LLM error: {e}");
            return vec![];
        }
    };

    let raw = strip_json_fences(&turn.content);
    serde_json::from_str::<Vec<FinancialInsight>>(raw).unwrap_or_else(|e| {
        eprintln!("[financial_brain] Failed to parse insights JSON: {e}\nRaw: {}", crate::safe_slice(raw, 200));
        vec![]
    })
}

/// Give personalized investment suggestions based on monthly surplus and risk tolerance.
pub async fn investment_suggestions(monthly_surplus: f64, risk_tolerance: &str) -> String {
    let prompt = format!(
        "You are a personal finance advisor. The user has a monthly surplus of ${:.2} \
         after all expenses and savings goals. Their risk tolerance is '{}'.\n\n\
         Give 4-6 specific, actionable investment ideas tailored to their surplus and risk profile. \
         Include: asset class, specific instruments (ETFs, index funds, etc.), approximate allocation %, \
         and expected returns. Keep it concise and practical. Format as a readable markdown list.",
        monthly_surplus, risk_tolerance
    );

    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None).await {
        Ok(t) => t.content,
        Err(e) => format!("Could not generate investment suggestions: {e}"),
    }
}

/// Analyse the last 3 months of spending and suggest a realistic monthly budget.
pub async fn generate_budget_recommendation() -> String {
    // Collect 3 months of data before await
    let now = chrono::Local::now();
    let mut snapshots: Vec<FinancialSnapshot> = Vec::new();
    for i in 0..3 {
        let month = {
            let m = now.month0() as i32 - i as i32;
            let year = now.year() + (m.div_euclid(12) as i32);
            let month_num = ((m % 12 + 12) % 12) as u32 + 1;
            format!("{:04}-{:02}", year, month_num)
        };
        snapshots.push(get_snapshot(&month));
    }
    snapshots.reverse();

    let snapshot_json = serde_json::to_string_pretty(&snapshots).unwrap_or_default();

    let prompt = format!(
        "You are a personal finance advisor. Here are the last 3 months of spending data:\n\n\
         {}\n\n\
         Based on this data, suggest a realistic monthly budget by category. \
         Identify categories where the user is over-spending vs industry benchmarks \
         (50/30/20 rule or similar). Provide specific dollar amounts for each budget line. \
         Format as a clean markdown table with columns: Category | Avg Spent | Suggested Budget | Notes.",
        snapshot_json
    );

    let config = crate::config::load_config();
    let (provider, api_key, model) =
        crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Complex);

    let messages = vec![crate::providers::ConversationMessage::User(prompt)];
    match crate::providers::complete_turn(&provider, &api_key, &model, &messages, &[], None).await {
        Ok(t) => t.content,
        Err(e) => format!("Could not generate budget recommendation: {e}"),
    }
}

// ── Financial Goals ───────────────────────────────────────────────────────────

fn calc_monthly_required(target: f64, current: f64, deadline: &str) -> f64 {
    let today = chrono::Local::now().naive_local().date();
    let deadline_date = chrono::NaiveDate::parse_from_str(deadline, "%Y-%m-%d")
        .unwrap_or(today + chrono::Days::new(365));
    let days_left = (deadline_date - today).num_days().max(1);
    let months_left = (days_left as f64) / 30.4;
    let remaining = (target - current).max(0.0);
    if months_left <= 0.0 {
        remaining
    } else {
        remaining / months_left
    }
}

pub fn create_goal(
    name: &str,
    target: f64,
    deadline: &str,
    current: f64,
) -> Result<FinancialGoal, String> {
    let id = Uuid::new_v4().to_string();
    let monthly_required = calc_monthly_required(target, current, deadline);
    let status = if current >= target { "completed" } else { "on_track" };
    let now = chrono::Utc::now().timestamp();

    let conn = open_db()?;
    conn.execute(
        "INSERT INTO fin_goals (id, name, target_amount, current_amount, deadline, monthly_required, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, name, target, current, deadline, monthly_required, status, now],
    )
    .map_err(|e| format!("Insert goal failed: {e}"))?;

    Ok(FinancialGoal {
        id,
        name: name.to_string(),
        target_amount: target,
        current_amount: current,
        deadline: deadline.to_string(),
        monthly_required,
        status: status.to_string(),
    })
}

pub fn update_goal_progress(id: &str, current: f64) -> Result<(), String> {
    let conn = open_db()?;

    let (target, deadline): (f64, String) = conn
        .query_row(
            "SELECT target_amount, deadline FROM fin_goals WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Goal not found: {e}"))?;

    let monthly_required = calc_monthly_required(target, current, &deadline);
    let status = if current >= target { "completed" } else { "on_track" };

    conn.execute(
        "UPDATE fin_goals SET current_amount = ?1, monthly_required = ?2, status = ?3 WHERE id = ?4",
        params![current, monthly_required, status, id],
    )
    .map_err(|e| format!("Update goal failed: {e}"))?;

    Ok(())
}

pub fn get_goals() -> Vec<FinancialGoal> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, name, target_amount, current_amount, deadline, monthly_required, status
         FROM fin_goals ORDER BY created_at DESC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    stmt.query_map([], |row| {
        Ok(FinancialGoal {
            id: row.get(0)?,
            name: row.get(1)?,
            target_amount: row.get(2)?,
            current_amount: row.get(3)?,
            deadline: row.get(4)?,
            monthly_required: row.get(5)?,
            status: row.get(6)?,
        })
    })
    .ok()
    .into_iter()
    .flatten()
    .flatten()
    .collect()
}

// ── System prompt context injection ───────────────────────────────────────────

/// Returns a compact financial summary for injection into the system prompt.
/// Only returns a non-empty string if there are more than 5 transactions.
pub fn get_financial_context() -> String {
    if transaction_count() <= 5 {
        return String::new();
    }

    let now = chrono::Local::now();
    let month = format!("{:04}-{:02}", now.year(), now.month());
    let snapshot = get_snapshot(&month);
    let goals = get_goals();

    let mut lines = vec![
        format!("## Financial Overview ({})", month),
        format!(
            "- Income: ${:.2} | Expenses: ${:.2} | Savings rate: {:.1}%",
            snapshot.income, snapshot.expenses, snapshot.savings_rate
        ),
    ];

    if !snapshot.top_categories.is_empty() {
        let top: Vec<String> = snapshot
            .top_categories
            .iter()
            .take(4)
            .map(|(cat, amt)| {
                let change = snapshot.vs_last_month.get(cat).copied().unwrap_or(0.0);
                let arrow = if change > 10.0 { "↑" } else if change < -10.0 { "↓" } else { "→" };
                format!("{}: ${:.0} {}{:.0}%", cat, amt, arrow, change.abs())
            })
            .collect();
        lines.push(format!("- Top spending: {}", top.join(", ")));
    }

    if !goals.is_empty() {
        let goal_lines: Vec<String> = goals
            .iter()
            .take(3)
            .map(|g| {
                let pct = if g.target_amount > 0.0 {
                    g.current_amount / g.target_amount * 100.0
                } else {
                    0.0
                };
                format!("{}: {:.0}% (${:.0}/mo needed)", g.name, pct, g.monthly_required)
            })
            .collect();
        lines.push(format!("- Goals: {}", goal_lines.join(" | ")));
    }

    lines.join("\n")
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn strip_json_fences(s: &str) -> &str {
    let s = s.trim();
    if s.starts_with("```") {
        let after = s.trim_start_matches('`');
        let after = after.trim_start_matches("json").trim_start_matches('\n');
        if let Some(end) = after.rfind("```") {
            return after[..end].trim();
        }
        return after.trim();
    }
    s
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn finance_add_transaction(
    amount: f64,
    category: Option<String>,
    description: String,
    date: String,
    tags: Option<Vec<String>>,
) -> Result<String, String> {
    ensure_tables();
    let cat = category.unwrap_or_else(|| categorize_transaction(&description));
    let t = Transaction {
        id: Uuid::new_v4().to_string(),
        amount,
        category: cat,
        description,
        date,
        tags: tags.unwrap_or_default(),
        created_at: chrono::Utc::now().timestamp(),
    };
    add_transaction(t)
}

#[tauri::command]
pub async fn finance_get_transactions(
    start_date: String,
    end_date: String,
    category: Option<String>,
) -> Vec<Transaction> {
    ensure_tables();
    get_transactions(&start_date, &end_date, category.as_deref())
}

#[tauri::command]
pub async fn finance_delete_transaction(id: String) -> Result<(), String> {
    delete_transaction(&id)
}

#[tauri::command]
pub async fn finance_get_snapshot(month: String) -> FinancialSnapshot {
    ensure_tables();
    get_snapshot(&month)
}

#[tauri::command]
pub async fn finance_generate_insights(months_back: Option<usize>) -> Vec<FinancialInsight> {
    ensure_tables();
    generate_insights(months_back.unwrap_or(3)).await
}

#[tauri::command]
pub async fn finance_get_goals() -> Vec<FinancialGoal> {
    ensure_tables();
    get_goals()
}

#[tauri::command]
pub async fn finance_create_goal(
    name: String,
    target_amount: f64,
    deadline: String,
    current_amount: Option<f64>,
) -> Result<FinancialGoal, String> {
    ensure_tables();
    create_goal(&name, target_amount, &deadline, current_amount.unwrap_or(0.0))
}

#[tauri::command]
pub async fn finance_update_goal(id: String, current_amount: f64) -> Result<(), String> {
    update_goal_progress(&id, current_amount)
}

#[tauri::command]
pub async fn finance_investment_suggestions(
    monthly_surplus: f64,
    risk_tolerance: Option<String>,
) -> String {
    investment_suggestions(monthly_surplus, &risk_tolerance.unwrap_or_else(|| "moderate".to_string())).await
}

#[tauri::command]
pub async fn finance_budget_recommendation() -> String {
    ensure_tables();
    generate_budget_recommendation().await
}

#[tauri::command]
pub async fn finance_get_context() -> String {
    ensure_tables();
    get_financial_context()
}
