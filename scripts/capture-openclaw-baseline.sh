#!/usr/bin/env bash
# scripts/capture-openclaw-baseline.sh
#
# Goal: 抓 OpenClaw gateway 日志（默认文件位置），过滤 imessage 相关行
#       用于 plan 006 R2 + R3 的 OpenClaw 端 baseline 实证
#
# 前置条件（用户须先做）：
#   1. OpenClaw gateway 正在运行（service 或 foreground 都可以）
#   2. 日志级别调到 debug：
#      - service:  在 launchctl 环境里设 OPENCLAW_LOG_LEVEL=debug 后 kickstart
#        或者：  openclaw config set logging.level debug  (会改配置文件)
#      - foreground: 停止 service，再 OPENCLAW_LOG_LEVEL=debug openclaw gateway run
#   3. 日志文件位置（默认）：/tmp/openclaw/openclaw-YYYY-MM-DD.log
#
# Usage: ./scripts/capture-openclaw-baseline.sh [DURATION_SECONDS]
#        DURATION_SECONDS 默认 300（5 分钟；plan 006 缩短抓取时长）
set -euo pipefail

DURATION=${1:-300}
OUT=/tmp/openclaw-gateway-baseline.log
RAW=/tmp/openclaw-gateway-baseline.raw.jsonl
TODAY=$(date '+%Y-%m-%d')
DEFAULT_LOG="/tmp/openclaw/openclaw-${TODAY}.log"

# 清空旧文件
: > "$OUT"
: > "$RAW"

if [ ! -f "$DEFAULT_LOG" ]; then
  echo "ERROR: OpenClaw 日志文件不存在: $DEFAULT_LOG" >&2
  echo "  1) 确认 OpenClaw gateway 正在运行" >&2
  echo "  2) 确认 debug 日志已开启（OPENCLAW_LOG_LEVEL=debug）" >&2
  echo "  3) 确认今天 $TODAY 有日志写入" >&2
  exit 1
fi

# 记下开始时的行号；capture 结束只保留 START_LINE+1 之后的内容
START_LINE=$(wc -l < "$DEFAULT_LOG" | tr -d ' ')

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Tailing $DEFAULT_LOG for ${DURATION}s"
echo "  start line:     $START_LINE"
echo "  filtered out:   $OUT  (imessage 相关)"
echo "  raw jsonl out:  $RAW  (全部新行)"
echo "  通知 IcePaw/猴哥在 group chat 发测试消息（如果需要）"
echo

# 后台 tail 跟踪日志文件新增内容
# tail -F 处理 rotation；-n +N 跳过前 N-1 行
tail -F -n +$((START_LINE + 1)) "$DEFAULT_LOG" > "$RAW" 2>/dev/null &
TAIL_PID=$!

# 清理 hook：被中断时也杀 tail
cleanup() {
  kill "$TAIL_PID" 2>/dev/null || true
  wait "$TAIL_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 阻塞 DURATION 秒
sleep "$DURATION"

cleanup
trap - EXIT INT TERM

# 用 Python 过滤 imessage 相关行到 OUT（保留 raw 作为完整 audit trail）
python3 <<PYEOF
import json

raw_path = "$RAW"
out_path = "$OUT"
imessage_lines = []
all_lines = 0
parse_errors = 0

with open(raw_path, "r", encoding="utf-8") as f:
    for line in f:
        line = line.rstrip("\n")
        if not line:
            continue
        all_lines += 1
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            parse_errors += 1
            # 保留非 JSON 行（罕见；可能是 stderr 漏到 file log）
            continue
        channel = obj.get("channel", "")
        msg = obj.get("message", "")
        level = obj.get("level", "")
        if channel == "imessage" or "imessage:" in msg or "iMessage" in msg:
            imessage_lines.append(line)

with open(out_path, "w", encoding="utf-8") as f:
    for line in imessage_lines:
        f.write(line + "\n")

print(f"  raw lines captured: {all_lines} (parse errors: {parse_errors})")
print(f"  imessage lines:     {len(imessage_lines)}")
PYEOF

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Capture complete"
echo "  后续： ./scripts/parse-openclaw-baseline.py $OUT > /tmp/openclaw-summary.md"
