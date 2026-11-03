# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 — 2026-10-26

First public release.

### Added

- `send_email` tool: send plain-text mail on request, with optional recipients.
- Attachment support: multiple files per message, MIME `multipart/mixed`,
  RFC 2231 UTF-8 filenames, per-file size and per-message count limits.
- Automatic reminders while `ask_user_question` waits for an answer
  (`notifyOnQuestion`) and while a permission approval is pending
  (`notifyOnApproval`), implemented as a prepended waterfall listener so the
  GUI answerer still receives the request.
- Optional turn-end summary (`notifyOnTurnEnd`), skipping delegated
  sub-agent turns.
- SMTP over implicit TLS (465), STARTTLS (587), or plaintext for local sinks;
  `AUTH LOGIN` / `AUTH PLAIN`.
- Password lookup from a file (re-read on every send) or an environment
  variable; secrets never live in the Cordis patch.
- Diagnosis mode writing to `$DSH_HOME/notify-email/debug.log`.
- Plugin-manager locale metadata (`locale/en.json`, `locale/zh.json`) and an
  SVG icon.
- Zero runtime dependencies; Node built-ins only.
- Test suite with a local fake SMTP server (10 checks) and GitHub Actions CI.
