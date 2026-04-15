/// TENTACLES — Platform-specific live agents that make up BLADE's Hive mesh.
///
/// Each tentacle is a self-contained module that connects to one external
/// platform, monitors it, and reports upward to the Hive's Head models.
/// Tentacles are thin: they do data collection and classification, then
/// delegate reasoning to the Hive's LLM layer.
///
/// Current tentacles:
///   - github_deep       : PR review, issue triage, release management, dependabot,
///                         community health analytics
///   - slack_deep        : BLADE acting as the user in Slack — reply drafting,
///                         channel summaries, waiting-response detection, thread nudges,
///                         channel importance learning
///   - email_deep        : Full inbox triage, context-aware reply drafting,
///                         auto-unsubscribe via CDP, invoice extraction → financial_brain
///   - terminal_watch    : PowerShell history analysis, command suggestions, loop detection
///   - filesystem_watch  : Downloads categorisation, duplicate detection, stale files
///   - calendar_tentacle : Schedule, meeting prep, focus blocking, post-meeting summaries
///   - discord_deep      : Community management — mention replies, moderation, channel
///                         summaries, personalised welcome messages
///   - linear_jira       : Project management — Git→ticket sync, blocker detection,
///                         sprint reports, auto-create tickets from messages
///   - log_monitor       : Production log intelligence — tail, anomaly detection,
///                         error correlation chains, Sentry-style grouping with FTS
///   - cloud_costs       : AWS Cost Explorer — spend anomalies, savings suggestions,
///                         weekly cost reports, idle resource detection

pub mod github_deep;
pub mod slack_deep;
pub mod email_deep;
pub mod terminal_watch;
pub mod filesystem_watch;
pub mod calendar_tentacle;
pub mod heads;
pub mod discord_deep;
pub mod linear_jira;
pub mod log_monitor;
pub mod cloud_costs;
