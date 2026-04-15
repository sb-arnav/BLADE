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

pub mod github_deep;
pub mod slack_deep;
pub mod email_deep;
pub mod terminal_watch;
pub mod filesystem_watch;
pub mod calendar_tentacle;
pub mod heads;
