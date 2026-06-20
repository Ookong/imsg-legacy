# Changelog

## [1.1.0] - 2026-06-08

### 🔌 OpenClaw 2026.5.12 Compatibility

This release closes the contract gap between imsg-legacy (forked from upstream v0.5.0) and what OpenClaw 2026.5.12 needs to probe and drive an iMessage channel cleanly. The eight implementation units (status command, FDA-aware errors, JSON-RPC startup envelope, watch debounce, send response fields, group metadata, structured not_supported for bridge methods, docs + version) are listed below.

### Added

- **U1** — `imsg status --json` subcommand + `status` RPC method, both backed by a single `getStatusPayload()` in `src/lib/status.js`. Schema 100% aligned with upstream's `StatusPayload`: `version`, `basic_features`, `advanced_features`, `typing_indicators`, `read_receipts`, `sip`, `message`, `bridge_version`, `v2_ready`, `selectors`, `rpc_methods`
- **U3** — `imsg rpc` emits a JSON-RPC 2.0 error envelope on stdout when startup fails (db connect, etc.) — keeps stdout strictly JSONL per upstream v0.8.2 behavior
- **U4** — `watch.subscribe` accepts `debounce_ms` parameter (default 500ms, clamped to ≥ 50ms)
- **U5** — `send` RPC response includes `id`, `guid`, `chat_guid`, `service` (best-effort; empty strings when AppleScript cannot observe them — never `null` or absent)
- **U6** — `messages.history` and `watch.subscribe` push notifications include `chat_identifier`, `chat_guid`, `is_group`, `participants` on every message (per-call cache prevents N+1)
- **U7** — Bridge-only methods (`send.rich`, `send.attachment`, `tapback`, `message.edit`, `message.unsend`, `message.delete`, `message.notifyAnyways`, `handles.check`, `poll.send`, `messages.poll.send`, `message.send_status`, `typing`, `read`) respond with structured `not_supported` (`error.data.supported=false`); also absent from `status.rpc_methods` so a well-behaved client never calls them

### Changed

- **U2** — chat.db open errors now contain the literal phrases `Full Disk Access` and `chat.db`, matching OpenClaw client's `normalizeIMessageFullDiskAccessError` heuristic. Users now see actionable UI guidance instead of bare `imsg rpc exited (code 1)`. Widened detection to cover SQLITE_CANTOPEN, "unable to open", missing-dir, disk-I/O, and permission-denied error shapes
- **U8** — Documentation field-name fix: `created_at` is the authoritative timestamp field (legacy docs incorrectly referenced `date`); `program.version()` now reads from `package.json` so version stays single-sourced

### Documentation

- README: New `## OpenClaw Integration` section documenting the contract surface, capabilities, not-implemented bridge methods, and a troubleshooting checklist for OpenClaw launchd FDA / PATH issues
- CLAUDE.md: New `### OpenClaw 2026.5.12+ Contract Surface` block listing every upstream version's contract item this build honors

### Product Boundary (Explicit Non-Goals)

This release does **not** implement the IMCore private-API bridge (upstream v0.7.0+) — that path requires macOS 14+ and is Apple-restricted. imsg-legacy continues to serve the macOS 11+ AppleScript path. Bridge features (`send.rich`, `tapback`, `message.edit`/`unsend`/`delete`, typing/read indicators, polls, handle introspection, send-status polling) are deliberately out of scope; users needing them should run upstream `openclaw/imsg` on macOS 14+.

### Compatibility

- Full backward compatibility: only new fields added to existing responses; no field renames, removals, or type changes
- All 9 legacy required message fields preserved (test-suite.js still green)
- No new external dependencies

---

## [1.0.0] - 2026-03-08

### 🎉 Initial Release - Node.js Implementation

This is the **v1.0.0 release** of imsg, a complete Node.js reimplementation of the popular steipete/imsg (Swift) iMessage CLI tool.

### Why Node.js?

**Extended macOS Compatibility**
- Supports macOS 11 (Big Sur) and later
- Enables use on legacy Mac systems that cannot run macOS 14+
- Provides an alternative implementation for Node.js developers

**Full Feature Parity**
- 100% compatible output format with the original Swift version
- Works with existing OpenClaw integrations
- All core commands implemented: `chats`, `history`, `send`, `watch`, `rpc`

### Features

**Core Commands**
- `imsg chats` - List recent conversations with JSON/JSONL output
- `imsg history` - View message history with filters
- `imsg send` - Send iMessages with text and file attachments
- `imsg watch` - Real-time message monitoring
- `imsg rpc` - JSON-RPC server for programmatic access

**Technical Highlights**
- AppleScript-based message sending (works on macOS 11+)
- Dynamic database schema detection (compatible with macOS 10-14)
- E.164 phone number normalization
- File attachment support via Messages.app
- Efficient file watching with debouncing

**Compatibility**
- ✅ JSON output format matches steipete/imsg (Swift)
- ✅ OpenClaw imsg plugin compatible
- ✅ Drop-in replacement for workflows using the Swift version

### Requirements

- macOS 11 (Big Sur) or later
- Node.js 14.0.0 or later
- Messages.app configured and signed in to iMessage

### Installation

```bash
npm install -g imsg
```

### Quick Start

```bash
# List recent chats
imsg chats --limit 10

# Send a message
imsg send --to "+1234567890" --text "Hello from Node.js!"

# Watch for new messages
imsg watch --json
```

### Acknowledgments

This implementation is inspired by and compatible with the original [steipete/imsg](https://github.com/steipete/imsg) Swift implementation.
