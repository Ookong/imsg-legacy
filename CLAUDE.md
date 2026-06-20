# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **imsg**, an iMessage CLI tool for macOS 11+ (Big Sur). It uses AppleScript to control Messages.app, providing compatibility with legacy Mac systems that cannot run macOS 14+. This is a Node.js implementation compatible with [steipete/imsg](https://github.com/steipete/imsg).

### Key Architecture

- **Language**: Node.js (requires 14.0.0 or later)
- **Core Mechanism**: Uses AppleScript to interface with Messages.app
- **Compatibility**: Output format compatible with steipete/imsg
- **Integration**: OpenClaw support for bidirectional messaging

### Project Structure

The repository contains the following files:

- `src/index.js` - Main CLI entry point
- `src/commands/` - Command implementations (chats, history, send, watch, rpc)
  - `chats.js` - Lists recent conversations with JSON output
  - `history.js` - Views message history with filters
  - `send.js` - Sends iMessages with attachments
  - `watch.js` - Monitors new messages in real-time
  - `rpc.js` - RPC server for OpenClaw integration
- `src/lib/` - Library modules
  - `database.js` - SQLite database access with schema compatibility
  - `sender.js` - AppleScript-based message sending
  - `watcher.js` - File monitoring for new messages
  - `normalizer.js` - E.164 phone number normalization
  - `rpc-server.js` - JSON-RPC 2.0 server implementation
- `install.sh` - Installation script
- `test-suite.js` - Comprehensive automated test suite

### Development Commands

```bash
# Install dependencies
npm install

# Link for development
npm link

# List recent conversations
imsg chats [--limit N] [--json]

# Send a message
imsg send --to "+1234567890" --text "Hello"

# View message history
imsg history --chat-id 1 --limit 20

# Watch for new messages
imsg watch [--chat-id N] [--json]

# Run test suite
node test/test-suite.js
```

### Output Formats

All tools output JSON/JSONL by default for compatibility with steipete/imsg:

**Chats output (JSONL):**
```json
{"id":1,"name":"Contact Name","identifier":"+1234567890","service":"iMessage","last_message_at":"2026-03-08T10:30:00.000Z"}
```

**Messages output (JSONL):**
```json
{"id":1234,"chat_id":1,"chat_identifier":"+1234567890","chat_guid":"iMessage;-;+1234567890","is_group":false,"participants":["+1234567890"],"guid":"...","sender":"+1234567890","text":"Hello!","created_at":"2026-03-08T10:30:00.000Z","is_from_me":false,"attachments":[],"reactions":[]}
```

> The timestamp field is `created_at` (ISO 8601). Earlier docs referenced `date` — that was a documentation error; the code has always emitted `created_at`.

**Watcher events (JSON):**
```json
{"event":"new_message","from":"+1234567890","content":"...","timestamp":"..."}
```

### System Requirements

- macOS 11 (Big Sur) or later
- Node.js 14.0.0 or later
- Messages.app configured with iMessage
- Full Disk Access permission (for database access)
- Automation permission (for sending messages)

### Key Implementation Details

**Database Compatibility**: The code dynamically detects available columns in the Messages database, supporting different macOS versions (10-14). See `src/lib/database.js` for schema detection logic.

**Phone Number Normalization**: Uses `libphonenumber-js` to convert phone numbers to E.164 format. Default region is US.

**AppleScript Integration**: All message sending goes through `/usr/bin/osascript` with proper error handling and permission checks.

**File Monitoring**: Uses `chokidar` to watch the Messages database for changes, with debouncing to reduce CPU usage.

### Testing Infrastructure

The project includes comprehensive automated testing:
- `test-suite.js` - Main test runner with keyword-based verification
- `test-watch-keyword.js` - Watch functionality testing
- `test-watch-reply.js` - Bidirectional communication testing
- `test-rpc-*.sh` - RPC server integration tests

All tests use random keyword generation for automated verification, eliminating manual checking.

### Compatibility with steipete/imsg

This implementation maintains **full compatibility** with the original Swift version:
- ✅ Command name: `imsg` (consistent with original)
- ✅ JSON output format: Fully compatible
- ✅ All core features: chats, history, send, watch
- ✅ OpenClaw imsg plugin compatible

### Upstream Lineage

imsg-legacy 1.0.0 is an **incomplete Node.js port of `openclaw/imsg` v0.5.0** (released 2026-02-16; imsg-legacy 1.0.0 released 2026-03-08, 20 days later).

Evidence the fork base is **v0.5.0** (not v0.4.0):
- `src/lib/database.js` `detectSchema()` probes for `thread_originator_guid` and `destination_caller_id` columns — these were **introduced in v0.5.0**, do not exist in v0.4.0
- `parseMessage()` returns `thread_originator_guid` and `destination_caller_id` fields on every message — fields exist in v0.5.0 `OutputModels.swift` but not in v0.4.0
- However, values are always empty strings (`''`); `getMessages()` does not SELECT these columns — **schema copied, implementation not ported**

Evidence the port is **incomplete** (functions in v0.5.0 but NOT in imsg-legacy 1.0.0):
- `imsg react` command — tapback reactions via UI automation
- `imsg typing` command + RPC typing method
- `is_reaction` / `reaction_type` / `reaction_emoji` / `is_reaction_add` / `reacted_to_guid` fields in message payloads
- `--reactions` flag on `imsg watch`
- `include_reactions` parameter on RPC `watch.subscribe` (exposed in interface but never populated — placeholder for future implementation)

The 1.1.0 release added `chat_identifier` / `chat_guid` / `is_group` / `participants` fields (from v0.6.0) and the `status --json` capability probe (v0.6.0+) but did not backport the v0.5.0 reaction/typing features.

### OpenClaw 2026.5.12+ Contract Surface (v0.6.0–v0.9.0)

imsg-legacy follows the upstream OpenClaw contract for AppleScript-only deployments. Implemented:

- `imsg status --json` → `StatusPayload` (version, `rpc_methods`, `advanced_features=false`, etc.) — capability probe
- `imsg rpc` startup failures emit a JSON-RPC 2.0 error envelope on stdout (v0.8.2)
- chat.db open failures throw messages containing `Full Disk Access` + `chat.db` for OpenClaw's FDA normalizer
- `watch.subscribe` accepts `debounce_ms` (default 500ms, min 50ms) (v0.6.0)
- `send` response includes `id` / `guid` / `chat_guid` / `service` (best-effort) (v0.6.0 / v0.10.0)
- Messages in `messages.history` and `watch.subscribe` push notifications carry `chat_identifier` / `chat_guid` / `is_group` / `participants` (v0.6.0)
- Bridge methods (`send.rich`, `tapback`, `message.edit`/`unsend`/`delete`, `typing`, `read`, `handles.check`, `poll.send`, etc.) respond with structured `not_supported` (`error.data.supported=false`); they are also absent from `rpc_methods`

**Not implemented (product boundary, by design):** IMCore private-API bridge — requires macOS 14+ and is Apple-restricted. imsg-legacy serves the macOS 11+ AppleScript path; users needing bridge features should run upstream openclaw/imsg on macOS 14+.
