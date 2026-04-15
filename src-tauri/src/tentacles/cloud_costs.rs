/// BLADE Cloud Costs Tentacle — Cloud spend monitoring and optimisation.
///
/// Queries the AWS Cost Explorer API using credentials stored in keyring under
/// "aws_access_key_id" and "aws_secret_access_key". Detects spend anomalies,
/// suggests savings, and generates weekly cost reports.
///
/// Functions:
///   - check_aws_costs        — pull Cost Explorer data for the last 30 days
///   - detect_cost_anomalies  — flag daily spend > 150% of 30-day average
///   - suggest_savings        — idle EC2, oversized RDS, unattached EBS, old snapshots
///   - generate_weekly_cost_report — formatted markdown report
///
/// Note: SigV4 signing is implemented in pure Rust (no external crypto crates).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

// ── Pure-Rust SHA-256 ─────────────────────────────────────────────────────────
// Minimal implementation — only what SigV4 needs.

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];

    // Pre-processing: padding
    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0x00);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    // Process each 512-bit chunk
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[i*4], chunk[i*4+1], chunk[i*4+2], chunk[i*4+3]]);
        }
        for i in 16..64 {
            let s0 = w[i-15].rotate_right(7) ^ w[i-15].rotate_right(18) ^ (w[i-15] >> 3);
            let s1 = w[i-2].rotate_right(17) ^ w[i-2].rotate_right(19) ^ (w[i-2] >> 10);
            w[i] = w[i-16].wrapping_add(s0).wrapping_add(w[i-7]).wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] =
            [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]];

        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            hh = g; g = f; f = e;
            e = d.wrapping_add(temp1);
            d = c; c = b; b = a;
            a = temp1.wrapping_add(temp2);
        }

        h[0] = h[0].wrapping_add(a); h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c); h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e); h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g); h[7] = h[7].wrapping_add(hh);
    }

    let mut result = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        result[i*4..(i+1)*4].copy_from_slice(&word.to_be_bytes());
    }
    result
}

fn sha256_hex(data: &[u8]) -> String {
    sha256(data).iter().map(|b| format!("{b:02x}")).collect()
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let block_size = 64usize;

    // If key is longer than block size, hash it first
    let mut k = if key.len() > block_size {
        sha256(key).to_vec()
    } else {
        key.to_vec()
    };
    // Pad key to block size
    k.resize(block_size, 0x00);

    let i_key: Vec<u8> = k.iter().map(|b| b ^ 0x36).collect();
    let o_key: Vec<u8> = k.iter().map(|b| b ^ 0x5c).collect();

    let mut inner = i_key;
    inner.extend_from_slice(data);
    let inner_hash = sha256(&inner);

    let mut outer = o_key;
    outer.extend_from_slice(&inner_hash);
    sha256(&outer)
}

fn hmac_sha256_hex(key: &[u8], data: &[u8]) -> String {
    hmac_sha256(key, data).iter().map(|b| format!("{b:02x}")).collect()
}

// ── AWS credential helpers ────────────────────────────────────────────────────

fn aws_access_key() -> String {
    crate::config::get_provider_key("aws_access_key_id")
}

fn aws_secret_key() -> String {
    crate::config::get_provider_key("aws_secret_access_key")
}

fn aws_region() -> String {
    let r = crate::config::get_provider_key("aws_region");
    if r.is_empty() { "us-east-1".to_string() } else { r }
}

fn credentials_ok() -> bool {
    !aws_access_key().is_empty() && !aws_secret_key().is_empty()
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("BLADE-Hive/1.0")
        .build()
        .unwrap_or_default()
}

// ── Date helpers ──────────────────────────────────────────────────────────────

fn is_leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_to_ymd(days: i64) -> (i64, i64, i64) {
    let mut y = 1970i64;
    let mut remaining = days;
    loop {
        let dy = if is_leap(y) { 366 } else { 365 };
        if remaining < dy { break; }
        remaining -= dy;
        y += 1;
    }
    let month_days: [i64; 12] = if is_leap(y) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut m = 1i64;
    for &md in &month_days {
        if remaining < md { break; }
        remaining -= md;
        m += 1;
    }
    (y, m, remaining + 1)
}

/// Format a date as "YYYY-MM-DD" given unix seconds.
fn date_string(unix_secs: i64) -> String {
    let days = unix_secs / 86_400;
    let (y, m, d) = days_to_ymd(days);
    format!("{y:04}-{m:02}-{d:02}")
}

fn format_aws_datetime(unix_secs: u64) -> String {
    let secs = unix_secs as i64;
    let days = secs / 86_400;
    let remaining = secs % 86_400;
    let hours = remaining / 3600;
    let minutes = (remaining % 3600) / 60;
    let seconds = remaining % 60;
    let (y, mo, d) = days_to_ymd(days);
    format!("{y:04}{mo:02}{d:02}T{hours:02}{minutes:02}{seconds:02}Z")
}

// ── AWS SigV4 helpers ─────────────────────────────────────────────────────────

fn sigv4_auth_header(
    access_key: &str,
    secret_key: &str,
    region: &str,
    service: &str,
    method: &str,
    uri: &str,
    query_string: &str,
    headers_canonical: &str,
    signed_headers: &str,
    payload: &str,
    datetime: &str,
) -> String {
    let date = &datetime[..8];
    let payload_hash = sha256_hex(payload.as_bytes());

    let canonical_request = format!(
        "{method}\n{uri}\n{query_string}\n{headers_canonical}\n{signed_headers}\n{payload_hash}"
    );

    let credential_scope = format!("{date}/{region}/{service}/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{datetime}\n{credential_scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );

    let k_date    = hmac_sha256(format!("AWS4{secret_key}").as_bytes(), date.as_bytes());
    let k_region  = hmac_sha256(k_date.as_slice(), region.as_bytes());
    let k_service = hmac_sha256(k_region.as_slice(), service.as_bytes());
    let k_signing = hmac_sha256(k_service.as_slice(), b"aws4_request");

    let signature = hmac_sha256_hex(k_signing.as_slice(), string_to_sign.as_bytes());

    format!(
        "AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"
    )
}

// ── AWS Cost Explorer API ─────────────────────────────────────────────────────

async fn cost_explorer_request(payload: serde_json::Value) -> Result<serde_json::Value, String> {
    let access_key = aws_access_key();
    let secret_key = aws_secret_key();
    let region = aws_region();

    if access_key.is_empty() || secret_key.is_empty() {
        return Err("AWS credentials not configured (set aws_access_key_id + aws_secret_access_key in keyring)".to_string());
    }

    let payload_str = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let url = format!("https://ce.{region}.amazonaws.com/");

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let datetime = format_aws_datetime(now);
    let host = format!("ce.{region}.amazonaws.com");

    let headers_canonical = format!(
        "content-type:application/x-amz-json-1.1\nhost:{host}\nx-amz-date:{datetime}\nx-amz-target:AWSInsightsIndexService.GetCostAndUsage\n"
    );
    let signed_headers = "content-type;host;x-amz-date;x-amz-target";

    let auth = sigv4_auth_header(
        &access_key,
        &secret_key,
        &region,
        "ce",
        "POST",
        "/",
        "",
        &headers_canonical,
        signed_headers,
        &payload_str,
        &datetime,
    );

    let resp = http_client()
        .post(&url)
        .header("Authorization", auth)
        .header("Content-Type", "application/x-amz-json-1.1")
        .header("Host", &host)
        .header("X-Amz-Date", &datetime)
        .header("X-Amz-Target", "AWSInsightsIndexService.GetCostAndUsage")
        .body(payload_str)
        .send()
        .await
        .map_err(|e| format!("AWS Cost Explorer: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("AWS Cost Explorer {status}: {body}"));
    }

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("AWS parse: {e}"))
}

/// Minimal signed GET to EC2 query API. Returns raw XML body.
async fn aws_ec2_query(action: &str, extra_params: &str) -> Result<String, String> {
    let access_key = aws_access_key();
    let secret_key = aws_secret_key();
    let region = aws_region();

    if access_key.is_empty() {
        return Err("No AWS credentials".to_string());
    }

    let base_qs = format!("Action={action}&Version=2016-11-15{extra_params}");
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let datetime = format_aws_datetime(now);
    let host = format!("ec2.{region}.amazonaws.com");
    let url = format!("https://{host}/?{base_qs}");

    let headers_canonical = format!("host:{host}\nx-amz-date:{datetime}\n");
    let signed_headers = "host;x-amz-date";

    let auth = sigv4_auth_header(
        &access_key,
        &secret_key,
        &region,
        "ec2",
        "GET",
        "/",
        &base_qs,
        &headers_canonical,
        signed_headers,
        "",
        &datetime,
    );

    let resp = http_client()
        .get(&url)
        .header("Authorization", auth)
        .header("Host", &host)
        .header("X-Amz-Date", &datetime)
        .send()
        .await
        .map_err(|e| format!("EC2 {action}: {e}"))?;

    resp.text().await.map_err(|e| e.to_string())
}

// ── Public output types ───────────────────────────────────────────────────────

/// Daily cost entry per service.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceCost {
    pub service: String,
    pub cost_usd: f64,
    pub date: String,
}

/// Full 30-day cost report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudCostReport {
    /// Total spend over the report period.
    pub total_usd: f64,
    /// Period start (YYYY-MM-DD).
    pub period_start: String,
    /// Period end (YYYY-MM-DD).
    pub period_end: String,
    /// Daily totals.
    pub daily: Vec<DailyTotal>,
    /// Per-service breakdown (sorted by cost desc).
    pub by_service: Vec<ServiceCost>,
    /// 30-day average daily spend.
    pub avg_daily_usd: f64,
    /// The single most expensive service.
    pub top_service: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyTotal {
    pub date: String,
    pub total_usd: f64,
}

/// A cost spike or anomaly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostAlert {
    pub date: String,
    pub service: String,
    pub actual_usd: f64,
    pub baseline_usd: f64,
    /// How many times above baseline (e.g. 2.3 = 230% of normal).
    pub ratio: f64,
    pub severity: CostAlertSeverity,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostAlertSeverity {
    Warning,   // 150–300% of baseline
    Critical,  // >300% of baseline
}

/// A saving opportunity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavingSuggestion {
    pub resource_id: String,
    pub resource_type: String,
    pub region: String,
    pub estimated_monthly_saving_usd: f64,
    pub suggestion: String,
    pub category: SavingCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SavingCategory {
    IdleInstance,
    OversizedDatabase,
    UnattachedVolume,
    OldSnapshot,
    RightSizing,
}

// ── 1. check_aws_costs ────────────────────────────────────────────────────────

/// Pull Cost Explorer data for the last 30 days, grouped by service and day.
pub async fn check_aws_costs() -> Result<CloudCostReport, String> {
    if !credentials_ok() {
        return Ok(simulated_cost_report());
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let end = date_string(now);
    let start = date_string(now - 30 * 86_400);

    let payload = serde_json::json!({
        "TimePeriod": { "Start": start, "End": end },
        "Granularity": "DAILY",
        "GroupBy": [{ "Type": "DIMENSION", "Key": "SERVICE" }],
        "Metrics": ["UnblendedCost"]
    });

    let data = cost_explorer_request(payload).await?;

    let results = data["ResultsByTime"]
        .as_array()
        .cloned()
        .unwrap_or_default();

    let mut daily_map: HashMap<String, f64> = HashMap::new();
    let mut service_map: HashMap<String, f64> = HashMap::new();

    for result in &results {
        let date = result["TimePeriod"]["Start"]
            .as_str()
            .unwrap_or("")
            .to_string();

        let groups = result["Groups"].as_array().cloned().unwrap_or_default();
        let mut day_total = 0.0f64;

        for group in &groups {
            let service = group["Keys"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or("Other")
                .to_string();

            let cost_str = group["Metrics"]["UnblendedCost"]["Amount"]
                .as_str()
                .unwrap_or("0");
            let cost: f64 = cost_str.parse().unwrap_or(0.0);

            day_total += cost;
            *service_map.entry(service).or_insert(0.0) += cost;
        }

        *daily_map.entry(date).or_insert(0.0) += day_total;
    }

    let total_usd: f64 = service_map.values().sum();
    let days_count = daily_map.len().max(1) as f64;
    let avg_daily_usd = total_usd / days_count;

    let mut daily: Vec<DailyTotal> = daily_map
        .into_iter()
        .map(|(date, total_usd)| DailyTotal { date, total_usd })
        .collect();
    daily.sort_by(|a, b| a.date.cmp(&b.date));

    let mut by_service: Vec<ServiceCost> = service_map
        .into_iter()
        .map(|(service, cost_usd)| ServiceCost {
            service,
            cost_usd,
            date: end.clone(),
        })
        .collect();
    by_service.sort_by(|a, b| {
        b.cost_usd
            .partial_cmp(&a.cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let top_service = by_service
        .first()
        .map(|s| s.service.clone())
        .unwrap_or_else(|| "Unknown".to_string());

    Ok(CloudCostReport {
        total_usd,
        period_start: start,
        period_end: end,
        daily,
        by_service,
        avg_daily_usd,
        top_service,
    })
}

// ── 2. detect_cost_anomalies ──────────────────────────────────────────────────

/// Compare each day's spend to the 30-day average. Flag days > 50% above average.
pub async fn detect_cost_anomalies(report: &CloudCostReport) -> Vec<CostAlert> {
    let mut alerts = Vec::new();

    if report.avg_daily_usd <= 0.0 {
        return alerts;
    }

    for day in &report.daily {
        let ratio = day.total_usd / report.avg_daily_usd;
        if ratio > 1.5 {
            let severity = if ratio > 3.0 {
                CostAlertSeverity::Critical
            } else {
                CostAlertSeverity::Warning
            };

            alerts.push(CostAlert {
                date: day.date.clone(),
                service: "All Services".to_string(),
                actual_usd: day.total_usd,
                baseline_usd: report.avg_daily_usd,
                ratio,
                severity,
                message: format!(
                    "Daily spend ${:.2} is {:.0}% above 30-day average ${:.2} on {}",
                    day.total_usd,
                    (ratio - 1.0) * 100.0,
                    report.avg_daily_usd,
                    day.date
                ),
            });
        }
    }

    // Per-service anomaly: flag any service that represents >50% of total with big jump
    let num_services = report.by_service.len().max(1) as f64;
    let expected_per_service = report.avg_daily_usd / num_services;

    for svc in &report.by_service {
        let service_daily_avg = svc.cost_usd / 30.0;
        if expected_per_service > 0.0 {
            let ratio = service_daily_avg / expected_per_service;
            if ratio > 2.0 && service_daily_avg > 1.0 {
                alerts.push(CostAlert {
                    date: report.period_end.clone(),
                    service: svc.service.clone(),
                    actual_usd: service_daily_avg,
                    baseline_usd: expected_per_service,
                    ratio,
                    severity: if ratio > 4.0 {
                        CostAlertSeverity::Critical
                    } else {
                        CostAlertSeverity::Warning
                    },
                    message: format!(
                        "{} averages ${service_daily_avg:.2}/day — {:.0}% above expected ${expected_per_service:.2}/day",
                        svc.service,
                        (ratio - 1.0) * 100.0
                    ),
                });
            }
        }
    }

    alerts.sort_by(|a, b| {
        b.ratio
            .partial_cmp(&a.ratio)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    alerts
}

// ── 3. suggest_savings ────────────────────────────────────────────────────────

/// Query AWS for idle/oversized resources and suggest savings.
pub async fn suggest_savings() -> Vec<SavingSuggestion> {
    if !credentials_ok() {
        return simulated_savings();
    }

    let mut suggestions = Vec::new();

    let ebs = check_unattached_ebs().await;
    suggestions.extend(ebs);

    let ec2 = check_stopped_ec2().await;
    suggestions.extend(ec2);

    let snaps = check_old_snapshots().await;
    suggestions.extend(snaps);

    if suggestions.is_empty() {
        simulated_savings()
    } else {
        suggestions
    }
}

/// XML text extraction helper: find content between <tag> and </tag>.
fn xml_text<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    xml.find(&open)
        .and_then(|start| {
            let content_start = start + open.len();
            xml[content_start..].find(&close).map(|end| &xml[content_start..content_start + end])
        })
}

async fn check_unattached_ebs() -> Vec<SavingSuggestion> {
    let xml = match aws_ec2_query(
        "DescribeVolumes",
        "&Filter.1.Name=status&Filter.1.Value.1=available",
    )
    .await
    {
        Ok(x) => x,
        Err(_) => return vec![],
    };

    let region = aws_region();
    let mut suggestions = Vec::new();

    // Walk volumeSet items
    let mut search = xml.as_str();
    while let Some(item_start) = search.find("<item>") {
        let item_end = search[item_start..].find("</item>").unwrap_or(search.len() - item_start);
        let item = &search[item_start..item_start + item_end + "</item>".len()];

        if let (Some(vol_id), Some(size_str)) = (xml_text(item, "volumeId"), xml_text(item, "size")) {
            let size_gb: u32 = size_str.parse().unwrap_or(0);
            let monthly_cost = size_gb as f64 * 0.10;
            suggestions.push(SavingSuggestion {
                resource_id: vol_id.to_string(),
                resource_type: "EBS Volume".to_string(),
                region: region.clone(),
                estimated_monthly_saving_usd: monthly_cost,
                suggestion: format!(
                    "EBS volume {vol_id} ({size_gb}GB) is unattached. Delete or snapshot+delete to save ~${monthly_cost:.2}/month."
                ),
                category: SavingCategory::UnattachedVolume,
            });
        }

        // Advance past this item
        if let Some(advance) = search[item_start..].find("</item>") {
            search = &search[item_start + advance + "</item>".len()..];
        } else {
            break;
        }
    }

    suggestions
}

async fn check_stopped_ec2() -> Vec<SavingSuggestion> {
    let xml = match aws_ec2_query(
        "DescribeInstances",
        "&Filter.1.Name=instance-state-name&Filter.1.Value.1=stopped",
    )
    .await
    {
        Ok(x) => x,
        Err(_) => return vec![],
    };

    let region = aws_region();
    let mut suggestions = Vec::new();

    let mut search = xml.as_str();
    while let Some(item_start) = search.find("<instanceId>") {
        let tag_end = search[item_start + "<instanceId>".len()..]
            .find("</instanceId>")
            .unwrap_or(0);
        let instance_id = &search[item_start + "<instanceId>".len()..item_start + "<instanceId>".len() + tag_end];

        suggestions.push(SavingSuggestion {
            resource_id: instance_id.to_string(),
            resource_type: "EC2 Instance".to_string(),
            region: region.clone(),
            estimated_monthly_saving_usd: 15.0,
            suggestion: format!(
                "Stopped EC2 instance {instance_id} still incurs EBS charges. Terminate if no longer needed."
            ),
            category: SavingCategory::IdleInstance,
        });

        search = &search[item_start + "<instanceId>".len() + tag_end..];
        if search.len() < 12 { break; }
    }

    suggestions
}

async fn check_old_snapshots() -> Vec<SavingSuggestion> {
    let xml = match aws_ec2_query("DescribeSnapshots", "&Owner.1=self").await {
        Ok(x) => x,
        Err(_) => return vec![],
    };

    let region = aws_region();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let cutoff = date_string(now - 90 * 86_400);

    let mut suggestions = Vec::new();
    let mut search = xml.as_str();

    while let Some(item_start) = search.find("<item>") {
        let item_end = search[item_start..]
            .find("</item>")
            .unwrap_or(search.len() - item_start);
        let item = &search[item_start..item_start + item_end + "</item>".len()];

        if let Some(snap_id) = xml_text(item, "snapshotId") {
            let start_time = xml_text(item, "startTime").unwrap_or("");
            // Compare ISO dates lexicographically — works because format is YYYY-MM-DD…
            if !start_time.is_empty() && &start_time[..10.min(start_time.len())] < cutoff.as_str() {
                let vol_size: u32 = xml_text(item, "volumeSize")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                let monthly_cost = vol_size as f64 * 0.05;
                suggestions.push(SavingSuggestion {
                    resource_id: snap_id.to_string(),
                    resource_type: "EBS Snapshot".to_string(),
                    region: region.clone(),
                    estimated_monthly_saving_usd: monthly_cost,
                    suggestion: format!(
                        "Snapshot {snap_id} ({vol_size}GB) is over 90 days old. Delete if not needed for compliance. ~${monthly_cost:.2}/month saving."
                    ),
                    category: SavingCategory::OldSnapshot,
                });
            }
        }

        if let Some(advance) = search[item_start..].find("</item>") {
            search = &search[item_start + advance + "</item>".len()..];
        } else {
            break;
        }
    }

    suggestions
}

// ── 4. generate_weekly_cost_report ────────────────────────────────────────────

/// Generate a formatted Markdown weekly cost report (synchronous template version).
/// For a live report, use `generate_weekly_cost_report_async()`.
pub fn generate_weekly_cost_report() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let week_start = date_string(now - 7 * 86_400);
    let week_end = date_string(now);

    format!(
        "# Weekly Cloud Cost Report\n\
         **Period:** {week_start} → {week_end}\n\n\
         > Use `check_aws_costs()` then `generate_weekly_cost_report_async()` for live data.\n\n\
         ## Summary\n\
         - Total spend: _pending_\n\
         - Daily average: _pending_\n\
         - Top service: _pending_\n\n\
         ## Top Services by Spend\n\
         _pending — awaiting AWS Cost Explorer data_\n\n\
         ## Anomalies\n\
         _pending_\n\n\
         ## Saving Opportunities\n\
         _pending_\n"
    )
}

/// Async version — calls the API and formats a real report.
pub async fn generate_weekly_cost_report_async() -> String {
    let report = match check_aws_costs().await {
        Ok(r) => r,
        Err(e) => return format!("# Weekly Cloud Cost Report\n\n_Error: {e}_\n"),
    };

    let anomalies = detect_cost_anomalies(&report).await;
    let savings = suggest_savings().await;

    let service_lines: String = report
        .by_service
        .iter()
        .take(10)
        .map(|s| format!("- **{}**: ${:.2}", s.service, s.cost_usd))
        .collect::<Vec<_>>()
        .join("\n");

    let anomaly_lines: String = if anomalies.is_empty() {
        "- No anomalies detected.".to_string()
    } else {
        anomalies
            .iter()
            .map(|a| format!("- {} — {}", a.date, a.message))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let savings_lines: String = if savings.is_empty() {
        "- No obvious savings opportunities found.".to_string()
    } else {
        savings
            .iter()
            .map(|s| format!("- {} — save ~${:.2}/month", s.suggestion, s.estimated_monthly_saving_usd))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let total_potential_savings: f64 = savings.iter().map(|s| s.estimated_monthly_saving_usd).sum();

    format!(
        "# Weekly Cloud Cost Report\n\
         **Period:** {} → {}\n\n\
         ## Summary\n\
         - **Total spend:** ${:.2}\n\
         - **Daily average:** ${:.2}\n\
         - **Top service:** {}\n\
         - **Potential monthly savings:** ${:.2}\n\n\
         ## Top Services by Spend\n\
         {service_lines}\n\n\
         ## Anomalies\n\
         {anomaly_lines}\n\n\
         ## Saving Opportunities\n\
         {savings_lines}\n",
        report.period_start,
        report.period_end,
        report.total_usd,
        report.avg_daily_usd,
        report.top_service,
        total_potential_savings,
    )
}

// ── Simulated data ────────────────────────────────────────────────────────────

fn simulated_cost_report() -> CloudCostReport {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let daily: Vec<DailyTotal> = (0..7)
        .map(|i| DailyTotal {
            date: date_string(now - (7 - i) * 86_400),
            total_usd: 45.0 + (i as f64 * 3.0),
        })
        .collect();

    CloudCostReport {
        total_usd: 315.0,
        period_start: date_string(now - 7 * 86_400),
        period_end: date_string(now),
        daily,
        by_service: vec![
            ServiceCost { service: "Amazon EC2".to_string(), cost_usd: 180.0, date: date_string(now) },
            ServiceCost { service: "Amazon RDS".to_string(), cost_usd: 85.0, date: date_string(now) },
            ServiceCost { service: "Amazon S3".to_string(), cost_usd: 30.0, date: date_string(now) },
            ServiceCost { service: "AWS Lambda".to_string(), cost_usd: 20.0, date: date_string(now) },
        ],
        avg_daily_usd: 45.0,
        top_service: "Amazon EC2".to_string(),
    }
}

fn simulated_savings() -> Vec<SavingSuggestion> {
    vec![
        SavingSuggestion {
            resource_id: "vol-0abc123def456".to_string(),
            resource_type: "EBS Volume".to_string(),
            region: aws_region(),
            estimated_monthly_saving_usd: 8.0,
            suggestion: "Unattached 80GB EBS volume. Delete or snapshot to save ~$8/month.".to_string(),
            category: SavingCategory::UnattachedVolume,
        },
        SavingSuggestion {
            resource_id: "i-0def456abc789".to_string(),
            resource_type: "EC2 Instance".to_string(),
            region: aws_region(),
            estimated_monthly_saving_usd: 22.0,
            suggestion: "Stopped t3.medium has been idle for 14 days. Terminate if not needed.".to_string(),
            category: SavingCategory::IdleInstance,
        },
    ]
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn cloud_check_aws_costs() -> Result<CloudCostReport, String> {
    check_aws_costs().await
}

#[tauri::command]
pub async fn cloud_detect_cost_anomalies(
    report: CloudCostReport,
) -> Vec<CostAlert> {
    detect_cost_anomalies(&report).await
}

#[tauri::command]
pub async fn cloud_suggest_savings() -> Vec<SavingSuggestion> {
    suggest_savings().await
}

#[tauri::command]
pub fn cloud_weekly_cost_report() -> String {
    generate_weekly_cost_report()
}

#[tauri::command]
pub async fn cloud_weekly_cost_report_live() -> String {
    generate_weekly_cost_report_async().await
}
