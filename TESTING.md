# Testing Guide for imsg

This guide covers testing procedures for the imsg CLI tool.

## Quick Start

### Run Complete Test Suite
```bash
node test/test-suite.js
```

**Test Coverage**:
- ✅ Chats command (list conversations)
- ✅ History command (view message history)
- ✅ Send command (send messages)
- ✅ Watch command (real-time monitoring)
- ✅ JSON compatibility (with Swift version)

**Expected Result**: 90%+ pass rate

## Individual Tests

### 1. Watch Functionality - Keyword Verification
```bash
node test/test-watch-keyword.js
```

**Test Process**:
1. Generates random keyword (e.g., `TEST-B5032637`)
2. Starts watch monitoring
3. Sends test message containing keyword
4. Automatically verifies watch detects the keyword

**Example Output**:
```
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

### 2. Bidirectional Communication Test
```bash
node test/test-watch-reply.js
```

**Test Process**:
1. Generates random keyword
2. Sends message requesting reply (containing keyword)
3. Manually reply to the message (must include keyword)
4. Verifies watch detects both sent and received messages

**Use Case**: Test complete bidirectional communication

### 3. Basic Functionality Tests
```bash
# Test chats
imsg chats --limit 5 --json | head -3

# Test history
imsg history --chat-id 1 --limit 3 --json

# Test send
imsg send --to "test@example.com" --text "Test message"
```

## Keyword Verification Principle

### Why Use Keywords?

**Problem**: Manual verification of watch functionality is cumbersome
- Need to remember what message was sent
- Need to find specific message in watch output
- Difficult to automate testing

**Solution**: Use random keywords
```javascript
const keyword = `TEST-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
// Example: TEST-B5032637
```

**Advantages**:
1. ✅ Uniqueness: Each test generates new keyword
2. ✅ Verifiable: Exact match, no confusion
3. ✅ Automated: No manual intervention required
4. ✅ Traceable: Test logs include keyword

### Verification Logic

```javascript
// Send message containing keyword
const message = `Test message [verification code:${keyword}]`;
imsg send --to "test@example.com" --text "${message}"

// Watch automatically verifies
watch.on('message', (msg) => {
  if (msg.text.includes(keyword)) {
    console.log('✅ Detected message containing keyword');
    // Test passed
  }
});
```

## Environment Setup

### Permissions (macOS)

Before testing, grant the following permissions:

**Full Disk Access**:
```
System Preferences → Security & Privacy → Privacy → Full Disk Access
→ Click lock icon to unlock → Click "+" → Add Terminal (or iTerm)
```

**Automation Permission**:
```
System Preferences → Security & Privacy → Privacy → Automation
→ Find "Messages" → Check Terminal (or your terminal app)
```

## Troubleshooting

### Issue 1: Watch Not Detecting Messages

**Symptoms**: Test fails, keyword not found

**Checks**:
```bash
# 1. Confirm message was sent
imsg history --chat-id 1 --limit 3 | grep "keyword"

# 2. Check watch process
ps aux | grep "imsg watch"

# 3. Manually test watch
imsg watch --chat-id 1 --json
# Send message from another terminal
```

**Possible Causes**:
- Insufficient database permissions
- Watch process not started
- Message not yet written to database

### Issue 2: Keyword Generation Duplicates

**Symptoms**: Multiple tests use same keyword

**Solution**: Increase random bytes
```javascript
crypto.randomBytes(6)  // Increase from 3 to 6 bytes
```

### Issue 3: Test Timeout

**Symptoms**: Test runs too long

**Solution**: Adjust timeout
```javascript
await sleep(20000);  // Increase to 20 seconds
```

## Performance Benchmarks

### Test Environment
- Hardware: 2015 MacBook Air
- System: macOS 11+ (tested on macOS 12.7.6)
- Network: WiFi

### Expected Performance

| Test | Average Time | 95th Percentile | Status |
|------|-------------|-----------------|--------|
| test/test-suite.js | 20 seconds | 25 seconds | ✅ Excellent |
| test/test-watch-keyword.js | 15 seconds | 18 seconds | ✅ Excellent |
| test/test-watch-reply.js | 30 seconds | 60 seconds | ✅ Good |

### Optimization Tips

**Accelerate Testing**:
1. Reduce `--limit` parameter (history queries)
2. Reduce `sleep` time (if network is fast)
3. Run independent tests in parallel

**Improve Accuracy**:
1. Increase `sleep` time (slow network)
2. Use longer keywords (avoid collisions)
3. Run multiple times and average

## Development Workflow

**Recommended Workflow**:
```bash
# 1. Develop new feature
vim src/lib/newfeature.js

# 2. Quick test
node test/test-watch-keyword.js

# 3. Complete test
node test/test-suite.js

# 4. Deploy to target device
# 5. Verify on target device
node test/test-suite.js
```

## Test Coverage

- ✅ All core functionality
- ✅ JSON format compatibility
- ✅ Real-time monitoring
- ✅ Error handling
- ✅ Phone number normalization
- ✅ Database schema compatibility

## Best Practices

1. Run full test suite after each code modification
2. Use keyword verification for critical functionality
3. Record test results for regression testing
4. Regularly verify on target devices
