# Test Suite for imsg

This directory contains all test files for the imsg CLI tool.

## Quick Start

```bash
# Run complete test suite
node test/test-suite.js

# Run individual tests
node test/test-watch-keyword.js
node test/test-watch-reply.js
```

## Test Files

### Core Tests

- **test-suite.js** - Main test suite covering all core functionality
  - Chats command (list conversations)
  - History command (view message history)
  - Send command (send messages)
  - Watch command (real-time monitoring)
  - JSON compatibility verification

- **test-watch-keyword.js** - Keyword-based automated verification
  - Generates random keyword for verification
  - Sends test message containing keyword
  - Automatically verifies watch detects the keyword
  - Fully automated, no manual intervention required

- **test-watch-reply.js** - Bidirectional communication test
  - Tests send + receive functionality
  - Requires manual reply with keyword
  - Verifies complete bidirectional communication

- **test-watch-automated.js** - Automated watch testing
  - Additional automated watch functionality tests
  - Complements test-watch-keyword.js

### Integration Tests

- **test-openclaw-quick.sh** - OpenClaw integration test
  - Tests compatibility with OpenClaw imsg plugin
  - Verifies JSON-RPC communication

### RPC Tests

- **test-rpc-methods.sh** - RPC method testing
  - Tests individual RPC methods
  - Verifies JSON-RPC 2.0 compliance

- **test-rpc-advanced.sh** - Advanced RPC testing
  - Tests complex RPC scenarios
  - Error handling and edge cases

- **test-rpc-watch-integration.sh** - RPC + watch integration
  - Tests RPC server with watch functionality
  - Verifies real-time message delivery via RPC

- **test-rpc-openclaw-simulation.sh** - OpenClaw simulation
  - Simulates OpenClaw interaction patterns
  - Tests bidirectional RPC communication

## Running Tests

### Run All Tests

```bash
# Core tests
node test/test-suite.js
node test/test-watch-keyword.js
node test/test-watch-reply.js

# Integration tests
./test/test-openclaw-quick.sh

# RPC tests
./test/test-rpc-methods.sh
./test/test-rpc-advanced.sh
./test/test-rpc-watch-integration.sh
./test/test-rpc-openclaw-simulation.sh
```

### Run Specific Test Categories

```bash
# Core functionality only
node test/test-suite.js

# Watch functionality
node test/test-watch-keyword.js
node test/test-watch-reply.js
node test/test-watch-automated.js

# RPC functionality
./test/test-rpc-methods.sh
./test/test-rpc-advanced.sh
```

## Test Organization

This directory uses a **flat structure** - all test files are in the root of the `test/` directory. This organization:

- ✅ Simplifies test discovery
- ✅ Reduces path complexity
- ✅ Makes it easy to run tests from any location
- ✅ Maintains clear separation between source code and tests

## Keyword Verification

Many tests use **keyword-based automated verification**:

1. Test generates random keyword (e.g., `TEST-B5032637`)
2. Sends message containing keyword
3. Automatically verifies keyword detection
4. No manual checking required

**Example**:
```bash
$ node test/test-watch-keyword.js
=== Watch Automation Test (Keyword Verification) ===
1. Generating verification keyword: TEST-B5032637
2. Getting current message ID...
   Current max ID: 289
3. Starting watch monitoring...
   ✅ Detected message containing keyword!
✅ Test passed!
Matched message details:
  ID: 291
  Content: Watch test message [verification code:TEST-B5032637]
```

## Expected Results

- **test-suite.js**: 90%+ pass rate
- **test-watch-keyword.js**: Should pass automatically (15-20 seconds)
- **test-watch-reply.js**: Requires manual reply (30-60 seconds)
- **RPC tests**: Should all pass if RPC server is configured correctly

## Troubleshooting

### Tests Fail with Permission Errors

**Solution**: Grant Full Disk Access to your terminal
```
System Preferences → Security & Privacy → Privacy → Full Disk Access
→ Add Terminal (or iTerm) to the list
```

### Watch Tests Not Detecting Messages

**Checks**:
```bash
# 1. Confirm message was sent
imsg history --chat-id 1 --limit 3 | grep "keyword"

# 2. Check watch process
ps aux | grep "imsg watch"

# 3. Manually test watch
imsg watch --chat-id 1 --json
```

### RPC Tests Fail

**Checks**:
```bash
# 1. Verify RPC server is not already running
lsof -i :4891

# 2. Check Node.js is installed
node --version

# 3. Test RPC server manually
node src/commands/rpc.js
```

## Performance Benchmarks

Test Environment: 2015 MacBook Air, macOS 11+ (tested on macOS 12.7.6)

| Test | Average Time | 95th Percentile | Status |
|------|-------------|-----------------|--------|
| test/test-suite.js | 20 seconds | 25 seconds | ✅ Excellent |
| test/test-watch-keyword.js | 15 seconds | 18 seconds | ✅ Excellent |
| test/test-watch-reply.js | 30 seconds | 60 seconds | ✅ Good |

## See Also

- [../TESTING.md](../TESTING.md) - Detailed testing guide
- [../README.md](../README.md) - Project documentation
