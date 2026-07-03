#!/usr/bin/env python3
"""
scripts/parse-imsg-watch-baseline.py

Goal: 解析 imsg watch 抓取的 jsonl，统计关键指标，输出 markdown 表格
       用于 plan 006 R1 + R3 的 imsg-legacy 端路径分类

Usage: ./scripts/parse-imsg-watch-baseline.py /tmp/imsg-watch-baseline.jsonl
       (输出 markdown 到 stdout；可重定向到文件)
"""
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <imsg-watch-baseline.jsonl>", file=sys.stderr)
        sys.exit(1)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        sys.exit(2)

    total = 0
    parse_errors = 0
    null_chat_id = 0
    null_sender = 0
    empty_text = 0
    is_from_me_count = 0
    unique_chat_ids = set()
    samples = defaultdict(list)  # chat_id -> first 2 sample events
    text_lens = []
    time_first = None
    time_last = None

    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            total += 1
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                parse_errors += 1
                if parse_errors <= 3:
                    print(f"  WARN: line {line_no} parse error: {e}", file=sys.stderr)
                continue

            chat_id = obj.get("chat_id")
            sender = obj.get("sender")
            text = obj.get("text") or ""
            is_from_me = obj.get("is_from_me", False)
            created_at = obj.get("created_at")
            row_id = obj.get("id")

            if chat_id is None:
                null_chat_id += 1
            else:
                unique_chat_ids.add(chat_id)
            if sender is None:
                null_sender += 1
            if not text.strip():
                empty_text += 1
            if is_from_me:
                is_from_me_count += 1

            text_lens.append(len(text))
            if created_at:
                if time_first is None or created_at < time_first:
                    time_first = created_at
                if time_last is None or created_at > time_last:
                    time_last = created_at

            # 收集每 chat_id 前 2 个样本
            if chat_id is not None and len(samples[chat_id]) < 2:
                samples[chat_id].append(
                    {
                        "row_id": row_id,
                        "sender": sender,
                        "is_from_me": is_from_me,
                        "text_preview": text[:80],
                        "created_at": created_at,
                    }
                )

    # 输出 markdown
    print("# imsg-legacy watch baseline summary")
    print()
    print(f"- **源文件:** `{path}`")
    print(f"- **总事件数:** {total}")
    print(f"- **解析错误:** {parse_errors}")
    print(f"- **时间窗:** {time_first or 'N/A'} → {time_last or 'N/A'}")
    print()
    print("## 关键指标")
    print()
    print("| 指标 | 数值 | 备注 |")
    print("|------|------|------|")
    print(f"| `chat_id` 为 null 的事件 | {null_chat_id} / {total} | **plan 004 race 假设的探针** |")
    print(f"| `sender` 为 null 的事件 | {null_sender} / {total} | OpenClaw 端会被 drop |")
    print(f"| `text` 为空的非自发自事件 | {empty_text} / {total} | attributedBody 解析可能破坏 |")
    print(f"| `is_from_me=true` 事件 | {is_from_me_count} / {total} | OpenClaw 端会 drop |")
    print(f"| 独立 `chat_id` 数 | {len(unique_chat_ids)} | 应该 ≥ 1（group）+ 可能的 DM |")
    if text_lens:
        avg_text = sum(text_lens) / len(text_lens)
        print(f"| 平均 text 长度 | {avg_text:.1f} chars | |")
    print()
    print("## 各 chat_id 事件样本（前 2 条）")
    print()
    if not samples:
        print("（无 chat_id 已填的事件）")
    else:
        for chat_id in sorted(samples.keys(), key=str):
            evts = samples[chat_id]
            print(f"### chat_id={chat_id} ({len(evts)} sample)")
            print()
            for evt in evts:
                me = " (me)" if evt["is_from_me"] else ""
                print(
                    f"- row_id={evt['row_id']}{me} sender={evt['sender']!r} "
                    f"at {evt['created_at']}: {evt['text_preview']!r}"
                )
            print()


if __name__ == "__main__":
    main()
