#!/bin/bash
# U7: bridge methods return structured not_supported, unknown methods
# return METHOD_NOT_FOUND. Helps OpenClaw distinguish "stale list" from
# "deliberate decline".

set -u
PASS=0
FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; echo "    $2"; FAIL=$((FAIL+1)); }

echo "=== U7: bridge methods not_supported ==="

call_rpc() {
  local method="$1"
  local id="$2"
  echo "{\"jsonrpc\":\"2.0\",\"method\":\"$method\",\"id\":$id,\"params\":{}}" \
    | node src/index.js rpc 2>/dev/null | head -1
}

assert_not_supported() {
  local method="$1"
  local resp="$2"
  node -e '
    const r = JSON.parse(process.argv[1]);
    if (!r.error) { console.error("no error envelope"); process.exit(2); }
    if (!r.error.data) { console.error("no data"); process.exit(3); }
    if (r.error.data.supported !== false) {
      console.error("data.supported !== false: " + JSON.stringify(r.error.data));
      process.exit(4);
    }
    if (!r.error.data.method || !r.error.data.reason) {
      console.error("missing method/reason: " + JSON.stringify(r.error.data));
      process.exit(5);
    }
    if (!/Method not supported/.test(r.error.message)) {
      console.error("wrong message: " + r.error.message);
      process.exit(6);
    }
  ' "$resp" 2>/tmp/u7-assert
}

# 1. Every bridge method returns the structured not_supported shape
for method in send.rich send.attachment tapback message.edit message.unsend \
              message.delete message.notifyAnyways handles.check poll.send \
              messages.poll.send message.send_status typing read; do
  RESP=$(call_rpc "$method" 100)
  if assert_not_supported "$method" "$RESP"; then
    ok "bridge method '$method' → structured not_supported"
  else
    bad "bridge method '$method'" "$(cat /tmp/u7-assert); resp: $RESP"
  fi
done

# 2. Truly unknown methods still return METHOD_NOT_FOUND (not not_supported)
RESP=$(call_rpc "foo.bar.baz" 200)
node -e '
  const r = JSON.parse(process.argv[1]);
  if (r.error.message !== "Method not found") { process.exit(2); }
  if (r.error.data && r.error.data.supported === false) { process.exit(3); }
' "$RESP" 2>/tmp/u7-unknown
if [ $? -eq 0 ]; then
  ok "unknown method 'foo.bar.baz' → METHOD_NOT_FOUND (not the not_supported envelope)"
else
  bad "unknown method handling" "resp: $RESP"
fi

# 3. Supported methods still work normally (regression guard)
RESP=$(call_rpc "chats.list" 300)
node -e '
  const r = JSON.parse(process.argv[1]);
  if (!r.result || !Array.isArray(r.result.chats)) { process.exit(2); }
' "$RESP" 2>/dev/null
if [ $? -eq 0 ]; then
  ok "supported method chats.list still works"
else
  bad "chats.list regression" "resp: $RESP"
fi

# 4. error.code is still METHOD_NOT_FOUND (-32601) — semantic compat
RESP=$(call_rpc "tapback" 400)
CODE=$(node -e 'console.log(JSON.parse(process.argv[1]).error.code)' "$RESP")
if [ "$CODE" = "-32601" ]; then
  ok "not_supported keeps METHOD_NOT_FOUND code (-32601) for legacy clients"
else
  bad "code mismatch" "got $CODE, expected -32601"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
