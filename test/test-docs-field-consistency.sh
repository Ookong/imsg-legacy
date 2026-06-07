#!/bin/bash
# U8: docs / version consistency.
# - imsg --version reports the package.json version
# - README + CLAUDE.md messages output examples use 'created_at' (not 'date')
# - status --json version field matches package.json

set -u
PASS=0
FAIL=0
ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1"; echo "    $2"; FAIL=$((FAIL+1)); }

echo "=== U8: docs + version consistency ==="

PKG_VERSION=$(node -e 'console.log(require("./package.json").version)')

# 1. imsg --version matches package.json
CLI_VERSION=$(node src/index.js --version 2>/dev/null | tr -d '[:space:]')
if [ "$CLI_VERSION" = "$PKG_VERSION" ]; then
  ok "imsg --version ($CLI_VERSION) == package.json ($PKG_VERSION)"
else
  bad "version mismatch" "CLI=$CLI_VERSION vs package.json=$PKG_VERSION"
fi

# 2. status --json version field matches
STATUS_VERSION=$(node src/index.js status --json 2>/dev/null \
  | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).version)')
if [ "$STATUS_VERSION" = "$PKG_VERSION" ]; then
  ok "status --json version field == package.json ($PKG_VERSION)"
else
  bad "status version mismatch" "status=$STATUS_VERSION vs pkg=$PKG_VERSION"
fi

# 3. README's "Messages Output" example uses created_at, not date
# Read up to 10 lines after the "Messages Output" heading (skips past the heading line itself)
README_BLOCK=$(grep -A 10 '^### Messages Output' README.md | tail -n +2)
if echo "$README_BLOCK" | grep -q '"created_at"'; then
  ok "README messages example uses created_at"
else
  bad "README missing created_at" "block: $README_BLOCK"
fi
# The JSON sample line (starts with `{"`) must not contain "date":
if echo "$README_BLOCK" | grep '^{' | grep -q '"date"'; then
  bad "README messages example still uses date in the JSON sample" "block: $README_BLOCK"
else
  ok "README messages example does NOT use date in the JSON sample"
fi

# 4. CLAUDE.md same check
CLAUDE_BLOCK=$(grep -A 5 '^\*\*Messages output' CLAUDE.md)
if echo "$CLAUDE_BLOCK" | grep -q '"created_at"'; then
  ok "CLAUDE.md messages example uses created_at"
else
  bad "CLAUDE.md missing created_at" "block: $CLAUDE_BLOCK"
fi

# 5. CHANGELOG has 1.1.0 entry
if grep -q '^## \[1\.1\.0\]' CHANGELOG.md; then
  ok "CHANGELOG.md has [1.1.0] entry"
else
  bad "CHANGELOG missing 1.1.0" "first heading: $(grep -m1 '^## ' CHANGELOG.md)"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
