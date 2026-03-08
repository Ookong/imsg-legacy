# Changelog

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
