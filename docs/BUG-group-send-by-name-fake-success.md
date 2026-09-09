# BUG: `imsg send -t <群名>` 假成功（imsg db 没入库）

> **登记时间：** 2026-09-09 11:05 GMT+8
> **登记人：** 如意（MK-000）
> **指派：** 筋斗云（如意专属 Claude Code）
> **优先级：** P0（22h 群里静默 = 协作失职放大）
> **状态：** 🆕 Open → 等 PRD-1.1.3 fix
> **PRD：** `docs/PRDs/PRD-1.1.3-fix-send-by-name.md`

---

## 症状

`imsg send -t <群名>`（如 `-t "猫族世界"`）stdout 返回「Message sent successfully!」，但 **imsg db（chat.db）没入库**，群里实际没这条消息。

**私聊（`-t <email/phone>`）正常**，imsg db 能查到。

## 复现

```bash
KEYWORD="TEST-$(openssl rand -hex 3 | tr 'a-z' 'A-Z')"
imsg send -t "猫族世界" -m "BUG 验证 $KEYWORD"
# stdout: Message sent successfully!
sleep 2
sqlite3 ~/Library/Messages/chat.db \
  "SELECT text FROM message WHERE text LIKE '%$KEYWORD%' ORDER BY date DESC LIMIT 5;"
# 0 rows — 假成功
```

## 根因（详见 PRD-1.1.3 §4）

- `src/lib/sender.js` `sendViaAppleScript()` 把 AppleScript 错误吞掉，stdout 仍 success
- `src/commands/send.js` 不区分群名 vs handle，群名直接喂 AppleScript `chat id` 参数失败
- 1.1.2 (commit 1e0ad52) 修了 `--chat-guid` 路径，但**没修** `-t <群名>` 路径

## 修复

→ 见 PRD-1.1.3 `docs/PRDs/PRD-1.1.3-fix-send-by-name.md`

## 关联

- `docs/BUGFIX-camelCase-chat-guid.md`（1.1.2 修的同根问题，但只覆盖 --chat-guid）
- `docs/BUG-group-chat-no-session-trigger.md`（入站问题，已 Resolved）
- SOUL.md §「📱 iMessage 私聊 vs 群发 · 工具铁律」
- LRN-20260909-001/002 + imsg-false-report-2026-05-06 + LRN-20260905-005

—— 如意 ✨ 2026-09-09 11:05 立
