#!/bin/bash
# U9: imsg rpc must accept --json (inert) — OpenClaw 6.8 always passes it.
# Without this, commander rejects as 'unknown option' and exits 1,
# which OpenClaw surfaces as 'imsg rpc exited (code 1)'.

set -u
PASS=0
FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; echo "    $2"; FAIL=$((FAIL+1)); }

echo "=== U9: imsg rpc --json flag (OpenClaw 6.8 compat) ==="

# 1. Help text mentions --json
HELP=$(node src/index.js rpc --help 2>&1)
if echo "$HELP" | grep -q -- '--json'; then
  ok "--help lists --json"
else
  bad "--help missing --json" "got: $HELP"
fi

# 2. Bare `--json` no longer causes exit 1 + unknown option
STDERR_FILE=$(mktemp)
trap 'rm -f "$STDERR_FILE"' EXIT
echo '{"jsonrpc":"2.0","method":"status","id":1}' \
  | node src/index.js rpc --json 2>"$STDERR_FILE" >/dev/null
EXIT=$?
STDERR_CONTENT=$(cat "$STDERR_FILE")
if [ "$EXIT" -eq 0 ]; then
  ok "'rpc --json' exits 0 (was exit 1 before U9)"
else
  bad "exit code" "got $EXIT; stderr: $STDERR_CONTENT"
fi
if ! echo "$STDERR_CONTENT" | grep -q 'unknown option'; then
  ok "no 'unknown option' in stderr"
else
  bad "unknown option error" "$STDERR_CONTENT"
fi

# 3. --json combined with --db works (OpenClaw 6.8 passes both)
if [ -n "${HOME:-}" ]; then
  RESP=$(echo '{"jsonrpc":"2.0","method":"status","id":1}' \
    | node src/index.js rpc --json --db "$HOME/Library/Messages/chat.db" 2>/dev/null \
    | head -1)
  RESULT_VERSION=$(node -e '
    try {
      const o = JSON.parse(process.argv[1]);
      process.stdout.write(o.result?.version || "");
    } catch (e) {
      process.stderr.write("PARSE_FAIL: " + e.message);
    }
  ' "$RESP" 2>&1)
  if [ "$RESULT_VERSION" = "1.1.0" ]; then
    ok "rpc --json --db <path> → normal RPC response (version=1.1.0)"
  else
    bad "rpc --json --db response" "got: $RESP"
  fi
fi

# 4. Behavior unchanged when --json is omitted (regression guard)
if echo '{"jsonrpc":"2.0","method":"status","id":1}' \
    | node src/index.js rpc 2>/dev/null | head -1 \
    | node -e 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));if(o.result?.version!=="1.1.0")process.exit(1)' 2>/dev/null; then
  ok "rpc without --json still works (no regression)"
else
  bad "regression: rpc without --json" "broken"
fi

# 5. Mimic OpenClaw's exact spawn: spawn('imsg', ['rpc', '--json'])
SIM=$(node -e '
const {spawn} = require("child_process");
const c = spawn("/Users/Jay/.local/bin/imsg", ["rpc", "--json"], {stdio: ["pipe", "pipe", "pipe"]});
c.stdout.on("data", d => process.stdout.write("OUT:" + d.toString().trim()));
c.stderr.on("data", d => process.stderr.write("ERR:" + d.toString().trim()));
c.on("close", code => { console.log(`\nCLOSE code=${code}`); process.exit(0); });
setTimeout(() => {
  c.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"status",id:1}) + "\n");
}, 200);
setTimeout(() => { try { c.stdin.end(); } catch(e){} }, 1200);
' 2>&1)
if echo "$SIM" | grep -q "OUT:" && echo "$SIM" | grep -q "CLOSE code=0"; then
  ok "OpenClaw-style spawn 'imsg rpc --json' returns CLOSE code=0 (was code=1)"
else
  bad "OpenClaw spawn simulation" "got: $SIM"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]