#!/usr/bin/env python3
"""
scripts/parse-openclaw-baseline.py

Goal: 解析 OpenClaw gateway 日志的 imessage 相关行，分类 drop reason
       用于 plan 006 R2 + R3 的 OpenClaw 端路径分类

Usage: ./scripts/parse-openclaw-baseline.py /tmp/openclaw-gateway-baseline.log
       (输出 markdown 到 stdout；可重定向到文件)

参考的 drop reason 列表（来自 OpenClaw monitor-DzbMKxJs.js:1307-1670）：
- "missing sender"
- "agent echo in self-chat"
- "from me"
- "group without chat_id"
- "groupPolicy disabled"
- "groupPolicy allowlist (empty groupAllowFrom)"
- "not in groupAllowFrom"
- "group id not in allowlist"
- "dmPolicy disabled"
- "dmPolicy blocked"
- "reaction notifications disabled"
- "reaction target not sent by agent"
- "empty body"
- "self-chat echo"
- "echo"
- "reflected assistant content"
- "control command (unauthorized)"
- "no mention"
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path


# 已知的 drop reason 列表（OpenClaw monitor-DzbMKxJs.js 中出现的字符串）
KNOWN_DROP_REASONS = {
    "missing sender",
    "agent echo in self-chat",
    "from me",
    "group without chat_id",
    "groupPolicy disabled",
    "groupPolicy allowlist (empty groupAllowFrom)",
    "not in groupAllowFrom",
    "group id not in allowlist",
    "dmPolicy disabled",
    "dmPolicy blocked",
    "reaction notifications disabled",
    "reaction target not sent by agent",
    "empty body",
    "self-chat echo",
    "echo",
    "reflected assistant content",
    "control command (unauthorized)",
    "no mention",
}


def parse_drop_line(obj):
    """从 OpenClaw log JSONL 提取 dropped inbound 事件的 reason + chat_id 等元数据。

    OpenClaw 模板 (monitor-DzbMKxJs.js:2263):
      imessage: dropped inbound message account=... reason=<JSON.stringify(reason)>
                chat_id=... group=... message_id=... guid=present|missing
                created_at=...
    """
    msg = obj.get("message", "")
    if "imessage: dropped inbound message" not in msg:
        return None
    # 用正则拆 key=value 对
    m = re.search(r"reason=([^\s]+(?:[ ][^\s]+)*?)\s+chat_id=", msg)
    reason = None
    if m:
        reason_raw = m.group(1)
        # reason 可能是 JSON-stringified 字符串 (如 "group without chat_id")，去外壳引号
        try:
            parsed = json.loads(reason_raw)
            if isinstance(parsed, str):
                reason = parsed
            else:
                reason = reason_raw
        except json.JSONDecodeError:
            reason = reason_raw
    # 提取其他字段
    chat_id_m = re.search(r"chat_id=(\S+)", msg)
    group_m = re.search(r"group=(\S+)", msg)
    msg_id_m = re.search(r"message_id=(\S+)", msg)
    guid_m = re.search(r"guid=(\S+)", msg)
    created_m = re.search(r"created_at=(\S+)", msg)
    return {
        "reason": reason or "<unparsed>",
        "chat_id": chat_id_m.group(1) if chat_id_m else "<unknown>",
        "group": group_m.group(1) if group_m else "<unknown>",
        "message_id": msg_id_m.group(1) if msg_id_m else "<unknown>",
        "guid": guid_m.group(1) if guid_m else "<unknown>",
        "created_at": created_m.group(1) if created_m else "<unknown>",
    }


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <openclaw-gateway-baseline.log>", file=sys.stderr)
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        sys.exit(2)

    total_imessage = 0
    parse_errors = 0
    drop_count = 0
    drop_by_reason = Counter()
    drop_samples = defaultdict(list)
    non_drop_imessage = []
    unknown_reasons = Counter()

    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            total_imessage += 1
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                parse_errors += 1
                continue

            drop = parse_drop_line(obj)
            if drop is not None:
                drop_count += 1
                reason = drop["reason"]
                drop_by_reason[reason] += 1
                if len(drop_samples[reason]) < 2:
                    drop_samples[reason].append(drop)
                if reason not in KNOWN_DROP_REASONS and reason != "<unparsed>":
                    unknown_reasons[reason] += 1
            else:
                # 非 drop 行的 imessage log（startup / inbound / dispatch / recover / 等）
                if len(non_drop_imessage) < 5:
                    non_drop_imessage.append(obj.get("message", "<no message>")[:200])

    print("# OpenClaw gateway baseline summary")
    print()
    print(f"- **源文件:** `{path}`")
    print(f"- **imessage 相关行:** {total_imessage}")
    print(f"- **JSON 解析错误:** {parse_errors}")
    print()

    print("## drop reason 分类")
    print()
    if drop_count == 0:
        print("（无 drop 事件。可能原因：抓取窗口内无消息 / OpenClaw 没启用 imessage channel / 日志级别不是 debug）")
    else:
        print(f"**drop 总数:** {drop_count}")
        print()
        print("| reason | 次数 | 已知？ |")
        print("|--------|------|--------|")
        for reason, count in sorted(drop_by_reason.items(), key=lambda x: -x[1]):
            known = "✅" if reason in KNOWN_DROP_REASONS else "⚠️ 未知"
            print(f"| `{reason}` | {count} | {known} |")
        if unknown_reasons:
            print()
            print("**⚠️ 出现未知 reason，需要人工对照 OpenClaw 源码判定语义。**")

    print()
    print("## 典型 drop 样本（前 2 条/每 reason）")
    print()
    for reason, samples in drop_samples.items():
        print(f"### `{reason}`")
        print()
        for s in samples:
            print(
                f"- chat_id={s['chat_id']} group={s['group']} "
                f"message_id={s['message_id']} guid={s['guid']} at {s['created_at']}"
            )
        print()

    if non_drop_imessage:
        print("## 其他 imessage 日志样本（前 5 条）")
        print()
        for m in non_drop_imessage:
            print(f"- {m!r}")
        print()

    if drop_count == 0 and total_imessage < 5:
        print()
        print("> **抓取窗口内几乎没有 imessage 日志。** 建议：")
        print("> 1. 确认 OpenClaw 日志级别为 debug（`OPENCLAW_LOG_LEVEL=debug`）")
        print("> 2. 确认抓取期间 IcePaw/猴哥在 group chat 实际发了消息")
        print("> 3. 延长抓取时长（10 分钟）后重试")
        print()


if __name__ == "__main__":
    main()
