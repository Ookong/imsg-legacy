# imsg

iMessage CLI tool for macOS 11+ (Big Sur)

A Node.js implementation compatible with [steipete/imsg](https://github.com/steipete/imsg), designed for legacy Mac systems that cannot run macOS 14+.

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
git clone https://github.com/your-username/imsg.git
cd imsg
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

Fully compatible with [steipete/imsg](https://github.com/steipete/imsg) and OpenClaw imsg plugin.

### Chats Output (JSONL)

```json
{"id":1,"name":"John Appleseed","identifier":"+15551234567","service":"iMessage","last_message_at":"2026-03-08T10:30:00.000Z"}
```

### Messages Output (JSONL)

```json
{"id":1234,"chat_id":1,"sender":"+15551234567","text":"Hello!","date":"2026-03-08T10:30:00.000Z","is_from_me":false,"service":"iMessage","attachments_count":0}
```

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

Based on [steipete/imsg](https://github.com/steipete/imsg), adapted for macOS 11+ and rewritten in Node.js for easier distribution on legacy systems.

## License

MIT
