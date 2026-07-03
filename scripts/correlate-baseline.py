#!/usr/bin/env python3
"""
scripts/correlate-baseline.py

Goal: 把 imsg-legacy watch 抓的 jsonl 和 OpenClaw gateway 抓的 log 按 ROWID 关联，
       判定 plan 006 路径 (A / B / C / D)，输出 markdown 决策报告
       用于 plan 006 R3 + R4

Usage: ./scripts/correlate-baseline.py <imsg-jsonl> <openclaw-log> [<output-md>]

关联策略：
- 主键：ROWID (imsg-legacy `id` ↔ OpenClaw drop log `message_id`)
- 次键：chat_id + 时间窗（±5s）

路径分类：
- A: imsg-legacy emit OK + OpenClaw 看到但 drop → 根因在 OpenClaw
- B: imsg-legacy emit 数据有问题 (chat_id null 等) + OpenClaw 看不到 → 根因在 imsg-legacy
- C: 两端都有问题
- D: 两端都 OK 但仍不响应 → 根因在更上游（agent loop / LLM）
"""
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


def parse_iso(s):
    if not s:
        return None
    try:
        # 处理可能带或不带 'Z' 的 ISO 8601
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def load_imsg_events(path):
    """读 imsg-legacy watch jsonl，返回 list of events。"""
    events = []
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"  WARN: imsg line {line_no} parse error: {e}", file=sys.stderr)
                continue
            events.append({
                "id": obj.get("id"),
                "chat_id": obj.get("chat_id"),
                "sender": obj.get("sender"),
                "text": obj.get("text") or "",
                "is_from_me": obj.get("is_from_me", False),
                "created_at": obj.get("created_at"),
                "created_at_dt": parse_iso(obj.get("created_at")),
            })
    return events


def parse_openclaw_drop(msg):
    """从 OpenClaw dropped inbound message log line 提取 reason/chat_id/message_id。"""
    if "imessage: dropped inbound message" not in msg:
        return None
    m = re.search(r"reason=([^\s]+(?:[ ][^\s]+)*?)\s+chat_id=", msg)
    reason = None
    if m:
        reason_raw = m.group(1)
        try:
            parsed = json.loads(reason_raw)
            reason = parsed if isinstance(parsed, str) else reason_raw
        except json.JSONDecodeError:
            reason = reason_raw
    chat_id_m = re.search(r"chat_id=(\S+)", msg)
    msg_id_m = re.search(r"message_id=(\S+)", msg)
    group_m = re.search(r"group=(\S+)", msg)
    return {
        "reason": reason or "<unparsed>",
        "chat_id": chat_id_m.group(1) if chat_id_m else "<unknown>",
        "message_id": msg_id_m.group(1) if msg_id_m else "<unknown>",
        "group": group_m.group(1) if group_m else "<unknown>",
    }


def load_openclaw_drops(path):
    """读 OpenClaw log jsonl，提取 dropped inbound 事件。"""
    drops = []
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = obj.get("message", "")
            drop = parse_openclaw_drop(msg)
            if drop is not None:
                # message_id 在 OpenClaw log 里是 "1234" 字符串；imsg-legacy 是 int
                try:
                    drop["message_id_int"] = int(drop["message_id"])
                except ValueError:
                    drop["message_id_int"] = None
                drops.append(drop)
    return drops


def classify_path(imsg_event, openclaw_drop):
    """根据 imsg event 和对应 OpenClaw drop 决定路径。

    返回 (path, explanation):
    - A: imsg OK + OpenClaw drop (非 empty body / from me 等次要 reason)
    - B: imsg 数据有缺陷（chat_id null / sender null / 空 text 但非自发自）
    - C: 两端都有问题
    - D: 两端都 OK 但仍不响应
    """
    imsg_problems = []
    if imsg_event["chat_id"] is None:
        imsg_problems.append("chat_id is null")
    if imsg_event["sender"] is None:
        imsg_problems.append("sender is null")
    if not imsg_event["text"].strip() and not imsg_event["is_from_me"]:
        imsg_problems.append("text is empty (non-self)")
    if imsg_event["is_from_me"]:
        imsg_problems.append("is_from_me (OpenClaw drops self-sent)")

    if openclaw_drop is None:
        # imsg emit 了但 OpenClaw 没记录 drop → 可能正常处理了，或 OpenClaw 没看到
        if imsg_problems:
            # imsg 数据有问题；如果 OpenClaw 没 drop 日志，可能是"没收到"
            return ("B-or-C", f"imsg 问题: {'; '.join(imsg_problems)}; OpenClaw 未记录此消息（可能未收到）")
        return ("D?", "imsg OK; OpenClaw 未记录（可能已 dispatch / 未启用 debug 日志）")

    # OpenClaw drop 了
    reason = openclaw_drop["reason"]
    if imsg_problems:
        return ("C", f"imsg 问题: {'; '.join(imsg_problems)}; OpenClaw drop reason: {reason}")
    return ("A", f"imsg OK; OpenClaw drop reason: {reason}")


def main():
    if len(sys.argv) < 3 or len(sys.argv) > 4:
        print(f"Usage: {sys.argv[0]} <imsg-jsonl> <openclaw-log> [<output-md>]", file=sys.stderr)
        sys.exit(1)

    imsg_path = Path(sys.argv[1])
    openclaw_path = Path(sys.argv[2])
    out_path = Path(sys.argv[3]) if len(sys.argv) == 4 else None

    if not imsg_path.exists():
        print(f"ERROR: imsg jsonl not found: {imsg_path}", file=sys.stderr)
        sys.exit(2)
    if not openclaw_path.exists():
        print(f"ERROR: openclaw log not found: {openclaw_path}", file=sys.stderr)
        sys.exit(2)

    imsg_events = load_imsg_events(imsg_path)
    drops = load_openclaw_drops(openclaw_path)

    # 用 message_id 建索引
    drops_by_msgid = {d["message_id_int"]: d for d in drops if d["message_id_int"] is not None}

    path_counter = Counter()
    path_assignments = []  # [(imsg_event, drop, path, explanation)]
    unmatched_drops = []

    matched_msgids = set()
    for evt in imsg_events:
        drop = drops_by_msgid.get(evt["id"])
        if drop is not None:
            matched_msgids.add(evt["id"])
        path, expl = classify_path(evt, drop)
        path_counter[path] += 1
        path_assignments.append((evt, drop, path, expl))

    # 没匹配上的 drops（OpenClaw 记录了但 imsg-legacy 没 emit → 可能是 OpenClaw 自己的 anchorless recover 等）
    for d in drops:
        if d["message_id_int"] not in matched_msgids:
            unmatched_drops.append(d)

    # 决定主导路径
    if path_counter.get("B-or-C", 0) > 0 and path_counter.get("A", 0) == 0 and path_counter.get("C", 0) == 0:
        dominant = "B"
        dominant_rationale = "imsg-legacy emit 数据有缺陷（chat_id null / sender null / 空 text），OpenClaw 看不到对应消息"
    elif path_counter.get("A", 0) > 0 and path_counter.get("B", 0) == 0 and path_counter.get("B-or-C", 0) == 0:
        dominant = "A"
        dominant_rationale = "imsg-legacy emit OK，OpenClaw 收到但 drop 在某条 gate（session 路由 / agent 触发层）"
    elif path_counter.get("C", 0) > 0:
        dominant = "C"
        dominant_rationale = "imsg-legacy 数据缺陷 + OpenClaw drop 双重问题"
    elif path_counter.get("D?", 0) > 0 and path_counter.get("A", 0) == 0:
        dominant = "D"
        dominant_rationale = "两端都 OK 但仍不响应；可能 OpenClaw agent loop / LLM 调用层问题（超出 imsg-legacy 仓库职责）"
    elif not imsg_events and not drops:
        dominant = "INSUFFICIENT"
        dominant_rationale = "抓取窗口内两端都没有数据；延长抓取时长重试"
    elif not imsg_events:
        dominant = "INSUFFICIENT"
        dominant_rationale = "imsg-legacy 端没抓到事件；检查 chokidar watch / chat.db 读权限 / 抓取期间是否有消息"
    elif not drops:
        dominant = "INSUFFICIENT"
        dominant_rationale = "OpenClaw 端没抓到 imessage 日志；检查 OPENCLAW_LOG_LEVEL=debug / imessage channel 启用"
    else:
        dominant = "MIXED"
        dominant_rationale = "路径混杂；需逐事件分析"

    # 输出 markdown
    out = []
    out.append("# plan 006 baseline 关联分析报告")
    out.append("")
    out.append(f"- **生成时间:** {datetime.utcnow().isoformat()}Z")
    out.append(f"- **imsg-legacy 源:** `{imsg_path}`（{len(imsg_events)} 事件）")
    out.append(f"- **OpenClaw 源:** `{openclaw_path}`（{len(drops)} dropped events）")
    out.append(f"- **匹配的 dropped 事件:** {len(matched_msgids)}")
    out.append("")

    out.append("## 数据摘要")
    out.append("")
    out.append("| 来源 | 数量 |")
    out.append("|------|------|")
    out.append(f"| imsg-legacy watch 事件 | {len(imsg_events)} |")
    out.append(f"| OpenClaw dropped events | {len(drops)} |")
    out.append(f"| imsg-legacy 端 unique ROWID | {len({e['id'] for e in imsg_events})} |")
    out.append(f"| OpenClaw 端 unique message_id | {len({d['message_id_int'] for d in drops if d['message_id_int']})} |")
    if imsg_events:
        null_chat_id = sum(1 for e in imsg_events if e["chat_id"] is None)
        null_sender = sum(1 for e in imsg_events if e["sender"] is None)
        empty_text = sum(1 for e in imsg_events if not e["text"].strip() and not e["is_from_me"])
        unique_chats = len({e["chat_id"] for e in imsg_events if e["chat_id"] is not None})
        out.append(f"| imsg-legacy: `chat_id` null | {null_chat_id} / {len(imsg_events)} |")
        out.append(f"| imsg-legacy: `sender` null | {null_sender} / {len(imsg_events)} |")
        out.append(f"| imsg-legacy: empty text (非 self) | {empty_text} / {len(imsg_events)} |")
        out.append(f"| imsg-legacy: 独立 chat_id | {unique_chats} |")
    if drops:
        drop_reasons = Counter(d["reason"] for d in drops)
        out.append("")
        out.append("### OpenClaw drop reason 分布")
        out.append("")
        out.append("| reason | 次数 |")
        out.append("|--------|------|")
        for reason, count in drop_reasons.most_common():
            out.append(f"| `{reason}` | {count} |")
    out.append("")

    out.append("## 路径分类")
    out.append("")
    out.append(f"**主导路径:** `{dominant}`")
    out.append("")
    out.append(f"**理由:** {dominant_rationale}")
    out.append("")
    out.append("**路径计数:**")
    out.append("")
    out.append("| 路径 | 次数 | 含义 |")
    out.append("|------|------|------|")
    out.append(f"| A | {path_counter.get('A', 0)} | imsg-legacy emit OK + OpenClaw 看到但 drop |")
    out.append(f"| B (B-or-C 合并) | {path_counter.get('B-or-C', 0)} | imsg-legacy emit 数据有缺陷 + OpenClaw 未记录 |")
    out.append(f"| C | {path_counter.get('C', 0)} | 两端都有问题 |")
    out.append(f"| D | {path_counter.get('D?', 0)} | 两端都 OK 但 OpenClaw 未 drop 记录（可能 dispatch 成功 / 日志不全） |")
    out.append("")

    out.append("## 逐事件分析（前 20 条）")
    out.append("")
    if not path_assignments:
        out.append("（无 imsg-legacy 事件）")
    else:
        out.append("| ROWID | chat_id | sender | text 预览 | is_from_me | OpenClaw drop reason | 路径 |")
        out.append("|-------|---------|--------|----------|------------|---------------------|------|")
        for evt, drop, path, expl in path_assignments[:20]:
            chat_id_s = str(evt["chat_id"]) if evt["chat_id"] is not None else "**null**"
            sender_s = str(evt["sender"]) if evt["sender"] is not None else "**null**"
            text_preview = evt["text"][:30].replace("|", "\\|")
            me = "✅" if evt["is_from_me"] else ""
            drop_reason = drop["reason"] if drop else "—"
            out.append(f"| {evt['id']} | {chat_id_s} | {sender_s} | {text_preview!r} | {me} | {drop_reason} | {path} |")
        if len(path_assignments) > 20:
            out.append("")
            out.append(f"_（还有 {len(path_assignments) - 20} 条未列出）_")
    out.append("")

    if unmatched_drops:
        out.append("## 未匹配的 OpenClaw drops")
        out.append("")
        out.append("（OpenClaw 记录了但 imsg-legacy 没 emit 的 drops——可能是 anchorless recovery、timer-based backfill 等）")
        out.append("")
        out.append("| message_id | chat_id | group | reason |")
        out.append("|------------|---------|-------|--------|")
        for d in unmatched_drops[:10]:
            out.append(f"| {d['message_id']} | {d['chat_id']} | {d['group']} | {d['reason']} |")
        out.append("")

    out.append("## attributedBody parser 影响评估")
    out.append("")
    if imsg_events:
        # 抓 non-self 事件的空 text 比例
        non_self = [e for e in imsg_events if not e["is_from_me"]]
        if non_self:
            empty_non_self = sum(1 for e in non_self if not e["text"].strip())
            ratio = empty_non_self / len(non_self)
            out.append(f"- **非自发自事件空 text 比例:** {empty_non_self} / {len(non_self)} = {ratio:.1%}")
            if ratio > 0.2:
                out.append("- **结论:** attributedBody parser 可能在 macOS 12 上破坏正常 text；建议 revert `f1e7713`")
            elif ratio > 0:
                out.append("- **结论:** 部分事件 text 为空；但需进一步判断是 race / parser 破坏 / 其他原因")
            else:
                out.append("- **结论:** 所有非自发自事件都有正常 text；attributedBody parser 影响有限（不需要为了此点 revert `f1e7713`）")
        else:
            out.append("- **无 non-self 事件；无法判断。**")
    else:
        out.append("- **无 imsg-legacy 事件；无法判断。**")
    out.append("")

    out.append("## plan 007 方向建议")
    out.append("")
    if dominant == "A":
        out.append("- 根因在 OpenClaw session 路由 / agent 触发层")
        out.append("- plan 007 方向：分析 OpenClaw `resolveIMessageInboundDecision` + group session key 生成")
        out.append("- 可能需 OpenClaw 仓库端改动；imsg-legacy 不动（或仅配套调整）")
    elif dominant == "B":
        out.append("- 根因在 imsg-legacy 端（race / enrichment bug）")
        out.append("- plan 007 方向：实施 watcher race retry（plan 004 修正版，按 upstream `MessageWatcher.swift` 的 `unresolvedChatRetryLimit` 模式）")
        out.append("- imsg-legacy 端修复 + chat_id 重新查询")
    elif dominant == "C":
        out.append("- 两端都有问题")
        out.append("- plan 007 方向：先修 imsg-legacy 端 race，再分析 OpenClaw drop reason")
    elif dominant == "D":
        out.append("- 两端都 OK 但仍不响应")
        out.append("- plan 007 方向：调查 OpenClaw agent loop / LLM 调用层（超出 imsg-legacy 仓库职责）")
        out.append("- imsg-legacy 端无动作；需提 OpenClaw issue / 联系 IcePaw 排查")
    elif dominant == "INSUFFICIENT":
        out.append("- **数据不足以判定路径。**")
        out.append("- 建议：")
        out.append("  1. 延长抓取时长到 10 分钟")
        out.append("  2. 确认 OpenClaw `OPENCLAW_LOG_LEVEL=debug` 已设置")
        out.append("  3. 确认 IcePaw/猴哥在抓取窗口内实际发了消息")
        out.append("  4. 重跑 `./scripts/capture-imsg-watch-baseline.sh 600` + `./scripts/capture-openclaw-baseline.sh 600`")
    else:
        out.append("- 路径混杂；需逐事件分析（见上方『逐事件分析』表）")
    out.append("")

    md = "\n".join(out)
    if out_path:
        out_path.write_text(md, encoding="utf-8")
        print(f"Wrote decision report to {out_path}", file=sys.stderr)
    else:
        print(md)


if __name__ == "__main__":
    main()
