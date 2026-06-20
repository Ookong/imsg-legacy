#!/bin/bash
# U3: imsg rpc must emit a JSON-RPC 2.0 error envelope on stdout when
# startup (db connect) fails — keeps stdout strictly JSONL per v0.8.2.

set -u
PASS=0
FAIL=0

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; echo "    $2"; FAIL=$((FAIL+1)); }

echo "=== U3: RPC Startup Failure Envelope ==="

# Force CANTOPEN by pointing at a nonexistent path.
OUT_FILE=$(mktemp)
ERR_FILE=$(mktemp)
trap 'rm -f "$OUT_FILE" "$ERR_FILE"' EXIT

node src/index.js rpc --db /tmp/nonexistent-imsg-test-$$.db >"$OUT_FILE" 2>"$ERR_FILE"
EXIT=$?

# 1. exit code must be 1
if [ "$EXIT" -eq 1 ]; then
  ok "exit code is 1 on startup failure"
else
  bad "exit code" "expected 1, got $EXIT"
fi

# 2. stdout's first line must parse as JSON
FIRST_LINE=$(head -1 "$OUT_FILE")
if [ -z "$FIRST_LINE" ]; then
  bad "stdout first line" "stdout is empty"
else
  if node -e "JSON.parse(process.argv[1])" "$FIRST_LINE" 2>/dev/null; then
    ok "stdout first line is valid JSON"
  else
    bad "stdout first line JSON" "got: $FIRST_LINE"
  fi
fi

# 3. envelope shape: jsonrpc=2.0, id=null, error.code/message/data
node -e '
const line = process.argv[1];
const obj = JSON.parse(line);
const assert = require("assert");
assert.strictEqual(obj.jsonrpc, "2.0", "jsonrpc field");
assert.strictEqual(obj.id, null, "id field must be null");
assert.ok(obj.error, "error field present");
assert.strictEqual(typeof obj.error.code, "number", "error.code is number");
assert.strictEqual(typeof obj.error.message, "string", "error.message is string");
assert.ok(obj.error.data, "error.data present");
assert.strictEqual(obj.error.data.phase, "startup", "data.phase");
assert.strictEqual(obj.error.data.stage, "db_connect", "data.stage");
' "$FIRST_LINE" 2>/tmp/u3-assert-err
if [ $? -eq 0 ]; then
  ok "envelope shape matches JSON-RPC 2.0 + phase/stage data"
else
  bad "envelope shape" "$(cat /tmp/u3-assert-err)"
fi

# 4. stderr still carries the human diagnostic with FDA keywords (U2)
ERR_CONTENT=$(cat "$ERR_FILE")
LOWER_ERR=$(echo "$ERR_CONTENT" | tr '[:upper:]' '[:lower:]')
if echo "$LOWER_ERR" | grep -q 'full disk access' && echo "$LOWER_ERR" | grep -q 'chat.db'; then
  ok "stderr still contains FDA keywords (U2 unchanged by U3)"
else
  bad "stderr FDA keywords" "stderr: $ERR_CONTENT"
fi

# 5. Happy path: when db is fine, no envelope leaks to stdout before normal RPC.
HAPPY_OUT=$(echo '{"jsonrpc":"2.0","method":"chats.list","id":1,"params":{"limit":1}}' \
  | node src/index.js rpc 2>/dev/null \
  | head -1)
HAPPY_OBJ_ID=$(node -e 'try{console.log(JSON.parse(process.argv[1]).id)}catch{console.log("PARSE_ERR")}' "$HAPPY_OUT")
if [ "$HAPPY_OBJ_ID" = "1" ]; then
  ok "happy path: no startup envelope; first stdout line is normal RPC response (id=1)"
elif [ "$HAPPY_OBJ_ID" = "null" ]; then
  bad "happy path leaked envelope" "got id=null on success path"
else
  bad "happy path response id" "got id=$HAPPY_OBJ_ID"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
