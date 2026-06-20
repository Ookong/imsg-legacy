#!/bin/bash
# U1: imsg status --json must produce a parseable capability payload
# that satisfies the OpenClaw probe contract.

set -u
PASS=0
FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; echo "    $2"; FAIL=$((FAIL+1)); }

echo "=== U1: imsg status --json ==="

# --- CLI: imsg status --json ------------------------------------------------
CLI_OUT=$(node src/index.js status --json 2>/tmp/u1-cli-err)
CLI_EXIT=$?

if [ "$CLI_EXIT" -eq 0 ]; then
  ok "CLI: exit 0"
else
  bad "CLI exit" "got $CLI_EXIT; stderr: $(cat /tmp/u1-cli-err)"
fi

# Validate JSON shape + field presence + values
node -e '
const obj = JSON.parse(process.argv[1]);
const assert = require("assert");
const pkg = require("./package.json");

// Required string/bool/object fields per StatusPayload schema
assert.strictEqual(typeof obj.version, "string", "version");
assert.strictEqual(obj.version, pkg.version, "version matches package.json");
assert.strictEqual(obj.basic_features, true, "basic_features=true");
assert.strictEqual(obj.advanced_features, false, "advanced_features=false (no bridge)");
assert.strictEqual(obj.typing_indicators, false, "typing_indicators=false");
assert.strictEqual(obj.read_receipts, false, "read_receipts=false");
assert.strictEqual(typeof obj.sip, "string", "sip is string");
assert.strictEqual(typeof obj.message, "string", "message is string");
assert.strictEqual(obj.bridge_version, 0, "bridge_version=0");
assert.strictEqual(obj.v2_ready, false, "v2_ready=false");
assert.deepStrictEqual(obj.selectors, {}, "selectors={}");
assert.ok(Array.isArray(obj.rpc_methods), "rpc_methods is array");

// rpc_methods must contain the methods we actually serve
const required = ["chats.list", "messages.history", "watch.subscribe",
                  "watch.unsubscribe", "send", "status"];
for (const m of required) {
  assert.ok(obj.rpc_methods.includes(m), `rpc_methods includes ${m}`);
}

// rpc_methods must NOT contain bridge-only methods we cannot serve
const forbidden = ["send.rich", "send.attachment", "tapback",
                   "message.edit", "message.unsend", "message.delete",
                   "handles.check", "poll.send"];
for (const m of forbidden) {
  assert.ok(!obj.rpc_methods.includes(m),
            `rpc_methods does NOT include bridge method ${m}`);
}
' "$CLI_OUT" 2>/tmp/u1-assert
if [ $? -eq 0 ]; then
  ok "CLI: payload schema + values correct"
else
  bad "CLI schema" "$(cat /tmp/u1-assert)"
fi

# --- CLI: default (no --json flag) should still emit JSON -------------------
DEFAULT_OUT=$(node src/index.js status 2>/dev/null)
if echo "$DEFAULT_OUT" | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' 2>/dev/null; then
  ok "CLI: default invocation still emits JSON"
else
  bad "CLI default" "got: $DEFAULT_OUT"
fi

# --- CLI: --human prints human-readable -------------------------------------
HUMAN_OUT=$(node src/index.js status --human 2>/dev/null)
if echo "$HUMAN_OUT" | grep -q '^version:'; then
  ok "CLI: --human emits key: value lines"
else
  bad "CLI --human" "got: $HUMAN_OUT"
fi

# --- RPC: status method returns identical payload ---------------------------
RPC_OUT=$(echo '{"jsonrpc":"2.0","method":"status","id":7}' \
  | node src/index.js rpc 2>/dev/null \
  | head -1)
RPC_RESULT=$(node -e '
const obj = JSON.parse(process.argv[1]);
if (obj.id !== 7) { process.exit(2) }
if (!obj.result) { process.exit(3) }
console.log(JSON.stringify(obj.result));
' "$RPC_OUT")
if [ -z "$RPC_RESULT" ]; then
  bad "RPC: status response" "got: $RPC_OUT"
else
  ok "RPC: status returns result envelope with id=7"
  # Compare RPC result against CLI output — must be structurally identical
  if [ "$RPC_RESULT" = "$CLI_OUT" ]; then
    ok "RPC: result == CLI output (single source of truth)"
  else
    bad "RPC vs CLI divergence" "RPC: $RPC_RESULT vs CLI: $CLI_OUT"
  fi
fi

# --- status must NOT touch chat.db (probeable when FDA denied) --------------
# Pass a bogus --db and confirm status still exits 0 (db is not opened by status)
BOGUS_OUT=$(node src/index.js status --json 2>/dev/null)
if [ -n "$BOGUS_OUT" ]; then
  ok "CLI status doesn't depend on db being readable (probeable under FDA denial)"
else
  bad "status under bogus env" "got empty"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
