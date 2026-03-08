#!/bin/bash

echo "=== RPC Watch Subscription Test ==="
echo ""

# Create a temporary directory for the test
TEST_DIR=$(mktemp -d)
PIPE_IN="$TEST_DIR/pipe.in"
PIPE_OUT="$TEST_DIR/pipe.out"

# Create named pipes
mkfifo "$PIPE_IN"
mkfifo "$PIPE_OUT"

echo "Test directory: $TEST_DIR"
echo ""

# Start RPC server in background
cat "$PIPE_IN" | imsg rpc > "$PIPE_OUT" &
RPC_PID=$!
echo "RPC server started with PID: $RPC_PID"

# Helper function to send RPC request and get response
rpc_call() {
  local request="$1"
  echo "$request" > "$PIPE_IN"
  sleep 0.5
  head -n 1 "$PIPE_OUT" 2>/dev/null || echo "No response"
}

# Test 1: Subscribe to watch
echo "1. Subscribing to watch..."
response=$(rpc_call '{"jsonrpc":"2.0","method":"watch.subscribe","params":{"chat_id":7,"since":372},"id":1}')
echo "Response: $response"
echo ""

# Check if subscription was successful
if echo "$response" | grep -q '"subscription"'; then
  echo "✓ Subscription successful"

  # Test 2: Send a message to trigger watch
  echo ""
  echo "2. Sending a message to trigger watch event..."
  imsg send -t test@example.com -m "RPC watch test message 👁️" > /dev/null 2>&1
  sleep 2

  # Read watch events (might be multiple lines)
  echo "Watch events received:"
  timeout 3 cat "$PIPE_OUT" 2>/dev/null || true
  echo ""

  # Test 3: Unsubscribe
  echo "3. Unsubscribing..."
  response=$(rpc_call '{"jsonrpc":"2.0","method":"watch.unsubscribe","params":{},"id":2}')
  echo "Response: $response"
else
  echo "✗ Subscription failed"
fi

echo ""

# Cleanup
kill $RPC_PID 2>/dev/null || true
rm -rf "$TEST_DIR"

echo "=== Test completed ==="
