# Contributing to imsg

Thank you for your interest in contributing to imsg!

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `npm install`
3. Link for development: `npm link`

## Testing

Before submitting a pull request, please test your changes:

```bash
# Run the test suite
node test/test-suite.js

# Test individual commands
imsg chats --limit 5
imsg history --chat-id 1 --limit 10
imsg watch --chat-id 1 --json
```

## Code Style

- Use ES6+ features (async/await, arrow functions)
- Follow existing code formatting
- Add comments for complex logic
- Ensure JSON output remains compatible with steipete/imsg

## Submitting Changes

1. Fork the repository
2. Create a feature branch
3. Make your changes with clear commit messages
4. Test thoroughly
5. Submit a pull request with description of changes

## Compatibility Requirements

- Must maintain JSON output compatibility with steipete/imsg
- Must support macOS 11+ (Big Sur)
- Must not break existing OpenClaw integration

## Project Structure

- `src/index.js` - Main CLI entry point
- `src/commands/` - Command implementations (chats, history, send, watch, rpc)
- `src/lib/` - Library modules (database, sender, watcher, normalizer, rpc-server)

## Testing Guidelines

The project uses automated keyword-based testing. When adding new features:

1. Add automated tests using the keyword verification pattern
2. Test with different macOS versions if possible
3. Verify JSON output format matches steipete/imsg
4. Test error handling (permissions, database access, etc.)

## Questions?

Feel free to open an issue for discussion before submitting large changes.
