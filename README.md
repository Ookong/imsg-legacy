# imsg

iMessage CLI tool for macOS 11+ (Big Sur)

A Node.js implementation compatible with [openclaw/imsg](https://github.com/openclaw/imsg) (formerly steipete/imsg), designed for legacy Mac systems that cannot run macOS 14+.

## Compatibility

This implementation maintains **full compatibility** with the original imsg (Swift version):

- ✅ Command name: `imsg` (consistent with original)
- ✅ JSON output format: Fully compatible
- ✅ All core features: chats, history, send, watch
- ✅ OpenClaw imsg plugin compatible

## Features

- **Send iMessages**: Text messages and attachments via AppleScript
- **List chats**: View recent conversations with JSON output
- **View history**: Read message history with filters
- **Watch messages**: Real-time monitoring of new messages
- **Database compatibility**: Adapts to different macOS database schemas

## Requirements

- macOS 11 (Big Sur) or later
- Node.js 14.0.0 or later
- Messages.app configured with iMessage
- Full Disk Access permission (for database access)
- Automation permission (for sending messages)

## Installation

### From Source

```bash
git clone https://github.com/ookong/imsg-legacy.git
cd imsg-legacy
npm install
npm link
```

**Important**: After installation, the command name is `imsg` (not `imsg-legacy`).

## Permissions (macOS)

### 1. Full Disk Access
System Preferences → Security & Privacy → Privacy → Full Disk Access
- Click the lock icon to unlock
- Click "+" and add Terminal (or iTerm)

### 2. Automation Permission
System Preferences → Security & Privacy → Privacy → Automation
- Find "Messages" in the list
- Check the box next to Terminal (or your terminal app)

## Usage

### List Chats

```bash
# List 10 recent conversations
imsg chats --limit 10

# Output in JSON format (JSONL)
imsg chats --limit 5 --json
```

### View History

```bash
# View last 20 messages in chat 1
imsg history --chat-id 1 --limit 20

# JSON output
imsg history --chat-id 1 --limit 10 --json

# Filter by participants
imsg history --chat-id 1 --participants "+15551234567,test@example.com"

# Start from specific rowid
imsg history --chat-id 1 --since 1000
```

### Send Messages

```bash
# Text message
imsg send --to "+15551234567" --text "Hello from macOS 11!"

# Email
imsg send --to "user@example.com" --text "Test message"

# With attachment
imsg send --to "+15551234567" --file ~/Desktop/photo.jpg

# SMS (requires iPhone with Text Message Forwarding)
imsg send --to "+15551234567" --text "SMS" --service sms

# Phone number normalization (default US region)
imsg send --to "5551234567" --text "Normalized to E.164"

# Target specific chat
imsg send --to "any" --text "Hello" --chat-identifier "iMessage;-;+15551234567"
```

### Watch New Messages

```bash
# Watch all chats
imsg watch

# Watch specific chat
imsg watch --chat-id 1

# JSON output
imsg watch --chat-id 1 --json

# Custom debounce interval
imsg watch --debounce 500

# Start from specific rowid
imsg watch --since 1000
```

## JSON Output Format

Fully compatible with [openclaw/imsg](https://github.com/openclaw/imsg) and OpenClaw imsg plugin.

### Chats Output (JSONL)

```json
{"id":1,"name":"John Appleseed","identifier":"+15551234567","service":"iMessage","last_message_at":"2026-03-08T10:30:00.000Z"}
```

### Messages Output (JSONL)

```json
{"id":1234,"chat_id":1,"chat_identifier":"+15551234567","chat_guid":"iMessage;-;+15551234567","is_group":false,"participants":["+15551234567"],"guid":"...","sender":"+15551234567","text":"Hello!","created_at":"2026-03-08T10:30:00.000Z","is_from_me":false,"attachments":[],"reactions":[]}
```

> Field name note: the message timestamp field is **`created_at`** (ISO 8601). Earlier README examples used `date` — that was always a documentation mismatch; the code has emitted `created_at` since v1.0.0.

## OpenClaw Integration

This build aligns with the **OpenClaw 2026.5.12+ probe contract** (upstream openclaw/imsg v0.6.0+ surface area, AppleScript path only):

- `imsg status --json` returns the `StatusPayload` shape (version, basic/advanced features, `rpc_methods`, etc.) so OpenClaw can discover capabilities without spawning the RPC server
- `imsg rpc` emits a JSON-RPC 2.0 error envelope on stdout when startup fails (v0.8.2 behavior) — OpenClaw parses it instead of seeing a bare `exited (code 1)`
- chat.db open failures throw an error containing the literal phrases `Full Disk Access` and `chat.db`, which OpenClaw's `normalizeIMessageFullDiskAccessError` matches to surface a friendly UI hint
- `watch.subscribe` accepts a `debounce_ms` parameter (default 500ms, clamped to ≥ 50ms)
- `send` RPC responses include `id`, `guid`, `chat_guid`, `service` (best-effort; empty strings when AppleScript can't observe them)
- `messages.history` / `watch.subscribe` push messages now carry `chat_identifier`, `chat_guid`, `is_group`, `participants`

### Capabilities Reported via `status --json`

```bash
imsg status --json | jq .
```

Sample output:

```json
{
  "version": "1.1.0",
  "basic_features": true,
  "advanced_features": false,
  "typing_indicators": false,
  "read_receipts": false,
  "sip": "unknown",
  "message": "imsg-legacy on Node.js (AppleScript path, macOS 11+ / Big Sur and later)",
  "bridge_version": 0,
  "v2_ready": false,
  "selectors": {},
  "rpc_methods": ["chats.list", "messages.history", "watch.subscribe", "watch.unsubscribe", "send", "status"]
}
```

### Not Implemented (Bridge-Only, macOS 14+)

The following upstream RPC methods require the IMCore private-API bridge and are **not implemented** on the macOS 11+ AppleScript path. They are absent from `rpc_methods` and respond with a structured `not_supported` error (`error.data.supported === false`) if called anyway:

`send.rich`, `send.attachment`, `tapback`, `message.edit`, `message.unsend`, `message.delete`, `message.notifyAnyways`, `handles.check`, `poll.send`, `messages.poll.send`, `message.send_status`, `typing`, `read`

Users needing these features should run the upstream `openclaw/imsg` on macOS 14 or later.

### Troubleshooting OpenClaw Spawning

If OpenClaw reports `imsg rpc not ready` despite this build being installed:

1. **PATH** — OpenClaw's launchd-managed gateway does not inherit `~/.local/bin`. Set `channels.imessage.cliPath` in `~/.openclaw/openclaw.json` to the absolute path of `imsg` (typically `/Users/<you>/.local/bin/imsg`)
2. **Full Disk Access** — See the dedicated section below — **[OpenClaw Launch Chain & Full Disk Access](#openclaw-launch-chain--full-disk-access)** — for why you likely need `/bin/sh` FDA and how to verify it.
3. **Re-kickstart** after configuration changes: `launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway`

### OpenClaw Launch Chain & Full Disk Access

> **TL;DR — if OpenClaw's `imsg rpc` can read `chat.db` from your shell but not when spawned by the gateway, the most common cause is that `/bin/sh` (or `/bin/bash`, whichever OpenClaw's launchd wrapper currently uses) is missing Full Disk Access. Grant it in System Settings → Privacy & Security → Full Disk Access.**

OpenClaw's macOS gateway runs under `launchd` (LaunchAgent `ai.openclaw.gateway`). Its program arguments are:

```xml
<string>/Users/Jay/.openclaw/service-env/ai.openclaw.gateway-env-wrapper.sh</string>
<string>/Users/Jay/.openclaw/service-env/ai.openclaw.gateway.env</string>
<string>/usr/local/bin/node</string>
<string>/Users/Jay/.local/lib/node_modules/openclaw/dist/index.js</string>
<string>gateway</string>
<string>--port</string>
<string>18789</string>
```

So the actual exec chain is:

```
launchd
  → /Users/Jay/.openclaw/service-env/ai.openclaw.gateway-env-wrapper.sh   (interpreter: /bin/sh)
  → /usr/local/bin/node
  → spawn(/Users/Jay/.local/bin/imsg, ['rpc', '--json'])
  → /Users/Jay/.local/bin/imsg → /usr/local/bin/node → read ~/Library/Messages/chat.db
```

#### Why `/bin/sh` specifically needs FDA

macOS TCC (Transparency, Consent, and Control) checks the **responsible process** when a process opens files in protected directories like `~/Library/Messages`. The responsible process is the first non-platform binary that `launchd` exec'd into. With OpenClaw's wrapper chain, that's the wrapper script — but its *interpreter* is what TCC records, and the interpreter is `/bin/sh` (or `/bin/bash` if you patched the shebang).

The two are **separate TCC entries**:
- `/bin/bash` — only useful if the wrapper's `#!/bin/bash`
- `/bin/sh` — only useful if the wrapper's `#!/bin/sh`

OpenClaw periodically regenerates `service-env/*.env` and the wrapper script on upgrade. If the regenerated wrapper's shebang is `#!/bin/sh` and your TCC entry is only on `/bin/bash`, the gateway will lose FDA silently — no error from the launchd side, but every read of `chat.db` returns `EPERM`.

#### What to grant

OpenClaw's stock wrapper uses `#!/bin/sh`. Grant Full Disk Access to **`/bin/sh`**. This is the persistent, upgrade-proof fix.

If you have previously patched the wrapper to `#!/bin/bash` and want to keep that working, you must grant FDA to `/bin/bash` instead — but note that OpenClaw upgrades may rewrite the wrapper and you'll be back to `#!/bin/sh`, at which point the `/bin/bash` grant stops helping.

**Grant both `/bin/sh` and `/bin/bash` if you want to be safe across upgrades** — they're independent entries.

#### Step-by-step

1. Open **System Settings → Privacy & Security → Full Disk Access**.
2. Click `+` to add an entry.
3. Press `⌘⇧G` to enter a path manually.
4. Type `/bin/sh` (or `/bin/bash` or both). macOS Finder will not let you navigate to `/bin` via the standard file picker — `⌘⇧G` is the only path.
5. Enable the checkbox next to the new entry.
6. Quit and re-launch **any** apps that previously had FDA and you want to keep working (sometimes the Settings app needs this to apply).
7. Re-kickstart the gateway: `launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway`

#### Verify FDA is actually applied

The Settings UI checkbox can lie — the TCC database is the source of truth. Check it directly:

```bash
sqlite3 /Library/Application\ Support/com.apple/TCC/TCC.db \
  "SELECT client, auth_value FROM access
   WHERE service='kTCCServiceSystemPolicyAllFiles'
   AND (client='/bin/sh' OR client='/bin/bash');"
```

`auth_value = 2` means granted. Anything else (1 = denied, 4 = unknown) means TCC doesn't consider it authorized.

Then verify the actual launch chain can read `chat.db` end-to-end. The following launches a synthetic child process through the same `launchd → wrapper → node` chain OpenClaw uses, and tries to read the database:

```bash
cat > /tmp/fda-verify.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.fda-verify</string>
  <key>ProgramArguments</key><array>
    <string>/Users/Jay/.openclaw/service-env/ai.openclaw.gateway-env-wrapper.sh</string>
    <string>/Users/Jay/.openclaw/service-env/ai.openclaw.gateway.env</string>
    <string>/usr/local/bin/node</string>
    <string>-e</string>
    <string>try{const r=require('fs').readFileSync('/Users/Jay/Library/Messages/chat.db');console.log('OK len='+r.length)}catch(e){console.log('FAIL:'+e.code+':'+e.message)}</string>
  </array>
  <key>StandardOutPath</key><string>/tmp/fda-verify.out</string>
  <key>StandardErrorPath</key><string>/tmp/fda-verify.err</string>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOF
launchctl load -w /tmp/fda-verify.plist
sleep 2
cat /tmp/fda-verify.out
launchctl unload /tmp/fda-verify.plist
rm -f /tmp/fda-verify.plist /tmp/fda-verify.out /tmp/fda-verify.err
```

Expected output: `OK len=<some bytes>`. If you see `FAIL:EPERM:...` the responsible process on the chain is not FDA-authorized — grant whichever binary the wrapper's shebang points to (`/bin/sh` by default).

#### What this looks like from the OpenClaw side

imsg-legacy emits an error message containing the literal phrases `Full Disk Access` and `chat.db` when the database open fails (since v1.1.0). OpenClaw's client matches those substrings and surfaces the friendly UI hint:

```
imsg cannot access ~/Library/Messages/chat.db.
Grant Full Disk Access to the Gateway/launcher process and restart Gateway.
```

If you see this in the OpenClaw UI, jump to "Step-by-step" above.

## Testing

### Automated Test Suite

This project uses **keyword-based automated verification** to ensure all functionality works correctly.

```bash
# Run complete test suite
node test/test-suite.js
```

**Expected result**: 90%+ tests passing

### Individual Tests

```bash
# Watch functionality - keyword verification
node test/test-watch-keyword.js

# Bidirectional communication test - send + reply
node test/test-watch-reply.js
```

### Testing Principle

Each test generates a random keyword (e.g., `TEST-B5032637`), sends a message containing that keyword, then automatically verifies that watch detects the keyword. This achieves fully automated functionality verification.

**Example**:
```bash
$ node test/test-watch-keyword.js
=== Watch Automation Test (Keyword Verification) ===
1. Generating verification keyword: TEST-B5032637
...
✅ Test passed!
Matched message details:
  ID: 291
  Content: Watch test message [verification code:TEST-B5032637]
```

For detailed testing guide, see [TESTING.md](TESTING.md)

## Troubleshooting

### "unable to open database file"
- Grant Full Disk Access to your terminal
- Ensure Messages.app is signed in
- Check that `~/Library/Messages/chat.db` exists

### "Not authorized"
- Grant Automation permission to your terminal
- Restart terminal after granting permission
- Ensure Messages.app is running

### AppleScript Errors
- Ensure Messages.app is running
- Check Automation permissions
- Verify recipient format (phone/email)
- Try launching Messages.app before sending

### Native Module Build Errors

If `sqlite3` fails to build:

```bash
# Rebuild native modules
npm rebuild sqlite3

# Or try clearing npm cache
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

## Technical Details

**Core Implementation**:
- **Database**: Read-only SQLite access via `sqlite3`
- **Sending**: AppleScript via `/usr/bin/osascript`
- **Watching**: File monitoring via `chokidar`
- **Normalization**: E.164 phone format via `libphonenumber-js`

**Database Schema Compatibility**:
- Dynamically detects available columns
- Gracefully handles missing columns across macOS versions
- Supports different Messages database schemas (macOS 10-14)

## Comparison with Original imsg

| Feature | Original imsg (Swift) | New imsg (Node.js) |
|---------|---------------------|-------------------|
| List chats | ✅ | ✅ |
| View history | ✅ | ✅ |
| Send text | ✅ | ✅ |
| Send attachments | ✅ | ✅ |
| Watch messages | ✅ | ✅ |
| JSON output | ✅ | ✅ **Fully compatible** |
| Command name | `imsg` | `imsg` **Consistent** |
| macOS 11+ | ✅ | ✅ **Key advantage** |
| Easy installation | Moderate | Simple **Key advantage** |
| OpenClaw compatible | ✅ | ✅ **Compatibility guaranteed** |

### Compatibility Guarantees

- ✅ **Command name**: `imsg` (consistent with original)
- ✅ **JSON output format**: Fully compatible with original imsg and OpenClaw imsg plugin
- ✅ **Command-line arguments**: Maintains consistent interface
- ✅ **All core features**: chats, history, send, watch

## Acknowledgments

Based on [openclaw/imsg](https://github.com/openclaw/imsg), adapted for macOS 11+ and rewritten in Node.js for easier distribution on legacy systems.

## License

MIT
