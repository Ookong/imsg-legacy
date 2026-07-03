#!/usr/bin/env bash
# scripts/capture-imsg-watch-baseline.sh
#
# Goal: 抓 imsg watch --json 输出 5 分钟，存到 /tmp/imsg-watch-baseline.jsonl
#       用于 plan 006 的 imsg-legacy 端 baseline 实证
#
# Usage: ./scripts/capture-imsg-watch-baseline.sh [DURATION_SECONDS]
#        DURATION_SECONDS 默认 300（5 分钟；plan 006 缩短抓取时长以加快调试周期）
set -euo pipefail

DURATION=${1:-300}
OUT=/tmp/imsg-watch-baseline.jsonl
ERR=/tmp/imsg-watch-baseline.err

# 每次运行前清空旧文件，避免历史数据污染
: > "$OUT"
: > "$ERR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting imsg watch for ${DURATION}s"
echo "  stdout → $OUT"
echo "  stderr → $ERR"
echo "  通知 IcePaw/猴哥在 group chat 发测试消息（如果需要）"
echo

# timeout(1) 在 macOS 上自带（/usr/bin/timeout 由 coreutils 提供；macOS 12+ 自带 gtimeout 替代）
# 优先用 gtimeout，回退到 perl 实现的 timeout
if command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout"
elif command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout"
else
  # Perl fallback: 子进程到时间后发送 SIGTERM
  TIMEOUT_CMD=""
fi

if [ -n "$TIMEOUT_CMD" ]; then
  "$TIMEOUT_CMD" "$DURATION" imsg watch --json --db ~/Library/Messages/chat.db > "$OUT" 2> "$ERR" || true
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] WARNING: no timeout/gtimeout available; using perl fallback"
  perl -e "alarm $DURATION; exec @ARGV" imsg watch --json --db ~/Library/Messages/chat.db > "$OUT" 2> "$ERR" || true
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Watch complete"
echo "  events captured: $(wc -l < "$OUT" | tr -d ' ')"
echo "  stderr lines:    $(wc -l < "$ERR" | tr -d ' ')"
if [ -s "$ERR" ]; then
  echo
  echo "stderr (last 20 lines):"
  tail -20 "$ERR"
fi
