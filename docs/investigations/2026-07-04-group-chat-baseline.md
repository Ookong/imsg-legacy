# plan 006 baseline 关联分析报告

> **生成时间:** 2026-07-04 00:55 GMT+8
> **生成方式:** 第一轮 imsg-legacy 5min capture + 整个今日 OpenClaw JSONL log 全文搜索
> **路径分类:** **A**（imsg-legacy emit OK，OpenClaw 完全没看到对应事件）

---

## TL;DR

| 项 | 结论 |
|---|------|
| **imsg-legacy watch emit** | ✅ 完全正常，11 个事件全部完整（0 null / 0 空 text / 0 自发自） |
| **OpenClaw 接收对应消息** | ❌ **0 个**（log 全文搜 ROWID 5038-5048 / `chat_id=237` / `imessage:group:237` 全部 0 引用） |
| **plan 004 race 假设** | ❌ **被实证否定**（11 个事件 chat_id 全部填好，无 null） |
| **plan 003 attributedBody parser 影响** | ❌ **被实证否定**（0 / 11 非自发自事件 text 为空，parser 没破坏） |
| **plan 005 "加 groups 配置" 修复** | ❌ **配置已应用但仍不工作**（`channels.imessage.groups = {"*": {"requireMention": false}}` 已存在，但 chat 237 仍 0 痕迹） |
| **plan 007 方向** | **OpenClaw 端**——分析 imessage monitor 为什么没读到 chat 237 消息；可能需要 debug 日志重启或读 OpenClaw chat.db watcher 代码 |

---

## 数据摘要

### imsg-legacy watch capture（5 分钟，16:48-16:53 UTC）

```
$ ./scripts/parse-imsg-watch-baseline.py /tmp/imsg-watch-baseline.jsonl
```

| 指标 | 数值 | 备注 |
|------|------|------|
| 总事件数 | 11 | — |
| `chat_id` 为 null | 0 / 11 | **plan 004 race 探针**：0 触发 |
| `sender` 为 null | 0 / 11 | OpenClaw 端会被 drop |
| `text` 为空的非自发自事件 | 0 / 11 | **plan 003 parser 影响**：0 触发 |
| `is_from_me=true` | 0 / 11 | OpenClaw 会 drop self-sent |
| 独立 `chat_id` | 2 | 12（IcePaw DM）+ 237（猴哥群）|

### 11 个事件详情

| # | ROWID | chat_id | sender | text 预览 |
|---|-------|---------|--------|----------|
| 1 | 5038 | **237** | jieqiwang@gmail.com（猴哥）| "回复下，如意" |
| 2 | 5039 | **237** | jieqiwang@gmail.com | "发了好几条了" |
| 3 | 5040 | **237** | jieqiwang@gmail.com | "icepaw，你跟如意的话" |
| 4 | 5041 | **237** | 534505914@qq.com（IcePaw）| "🗂️ Sessions: search 如意, limit 5, ..." |
| 5 | 5042 | **237** | 534505914@qq.com | "🗂️ Sessions: agent imsg-legacy, ..." |
| 6 | 5043 | **237** | 534505914@qq.com | "🗂️ Sessions: label imsg-legacy, ..." |
| 7 | 5044 | **237** | 534505914@qq.com | "🗂️ Sessions: limit 15, include last ..." |
| 8 | 5045 | **237** | 534505914@qq.com | "✉️ Message" |
| 9 | 5046 | **237** | 534505914@qq.com | "爸，我查了一下——这个群里只看到我和你..." |
| 10 | 5047 | **237** | 534505914@qq.com | "✉️ Message" |
| 11 | 5048 | **12** | 534505914@qq.com | "如意！你在吗？Dad 在群里测试 imsg..." |

**重要观察**：
- ROWID 5041-5047 是 IcePaw 的 OpenClaw agent 在 chat 237 群里的工具调用输出（`Sessions: search` 是 active-memory 工具的标签，`✉️ Message` 是 send 工具的标签）
- **IcePaw 的 OpenClaw 在 chat 237 工作正常**（她在群里帮如意查 session 数据并发回结果）
- **如意的 OpenClaw 在 chat 237 完全静默**

### OpenClaw log 同一时间窗

| 来源 | 数量 |
|------|------|
| OpenClaw log 中所有 imessage 行（capture 窗口） | 1 |
| → 其中 `dropped inbound` | 1（ROWID 5050, `from me` — capture 跑完后用户自发自）|
| OpenClaw log 中 imessage:group:237 引用 | **0** |
| OpenClaw log 中 chat_id=237 引用 | **0** |
| OpenClaw log 中 ROWID 5038-5048 引用 | **0/0/0/0/0/0/0/0/0/0/0**（11 个 ROWID 全部 0 引用）|

### 过去 1 小时 OpenClaw log 中所有 imessage session 引用

| session kind | 数量 | 说明 |
|--------------|------|------|
| `direct:534505914@qq.com` | 20 | IcePaw DM（chat 12）— 工作正常 |
| `direct:534505914@qq.com:active-memory:*` | 9 | IcePaw DM 的 active-memory 工具调用 |
| `group:23` | 1 | 一个**其他群**（注意是 23 不是 237）的 session 引用 |
| `group:237` | **0** | **chat 237 在 log 中 0 引用** |

---

## 路径分类

### 主导路径：**A**

**理由：** imsg-legacy 端 11 个事件 emit 完全正常（chat_id / sender / text / is_from_me 字段全对），但 OpenClaw log 中这 11 个 ROWID 全部 0 引用。OpenClaw 的 imessage monitor **完全没收到** chat 237 的消息，也没看到 chat 12 的群相关消息。

### 路径计数（基于 correlation 脚本自动分类）

| 路径 | 次数 | 含义 | 实证 |
|------|------|------|------|
| A | 11 | imsg-legacy emit OK + OpenClaw 看不到 | ✅ 所有 11 个事件都是 |
| B (B-or-C) | 0 | imsg-legacy 数据有缺陷 | ❌ 0 触发 |
| C | 0 | 两端都有问题 | ❌ 0 触发 |
| D? | 0 | 两端都 OK | n/a（已归 A）|

> 注意：correlation 脚本默认会把"imsg emit OK + OpenClaw 无 drop 记录"归为 D（"可能 dispatch 成功 / 日志不全"）。但**全文 log 搜索确认 OpenClaw 连这些消息的 message_id 都没出现过**，所以不是日志不全，而是确实没收到。重新归类为 A。

### 为什么不是 D（agent loop 问题）

如果 OpenClaw agent loop 真的处理了这些消息，应该在 log 中留下：
- inbound 事件（即使是 INFO 级也应至少记录 `inbound message` 一次）
- session 创建 / dispatch 事件
- agent 处理日志（即使最后 LLM 报错）

**但以上全部 0 引用**。这说明 imessage monitor 在 chain 更早的位置就把这些消息 drop 了，或者根本没读到。

---

## 关键发现 & 假设

### 1. plan 005 的 "groups 配置" 修复路径已被实证无效

`channels.imessage.groups = {"*": {"requireMention": false}}` 已经在用户的 `~/.openclaw/openclaw.json` 里（之前我以为是 plan 005 推荐但没应用，结果早就应用了）。今日 log 显示：

```
2026-07-03T16:45:56.551Z  config change detected; evaluating reload (meta.lastTouchedAt, channels.imessage.groups)
2026-07-03T16:45:59.602Z  config change requires channel reload (imessage) — deferring until 2 operation(s), 1 reply(ies), 1 embedded run(s) complete
2026-07-03T16:47:31.033Z  http server listening (6 plugins: ..., imessage, ...)
```

Gateway 重启了，config reload 了，但 **chat 237 仍然 0 引用**。所以"加 groups 配置"不是 fix。

### 2. OpenClaw 的 drop 日志是 verbose 级别，INFO log 看不到

`monitor-DzbMKxJs.js:1392-1670` 关键 drop 路径用 `params.logVerbose?.(...)`：
- `imessage: skipping group message (no mention)` — line 1657
- `imessage: dropping group message from chat_id=X — not in allowlist` — line 950
- `imessage: skipping group message (X) not in allowlist` — line 1472

而且 `IMESSAGE_DIAGNOSTIC_DROP_REASONS` 集合（line 2249-2253）只包含 5 个 self-noise reason：

```js
const IMESSAGE_DIAGNOSTIC_DROP_REASONS = new Set([
  "agent echo in self-chat",
  "echo",
  "from me",
  "reflected assistant content",
  "self-chat echo"
]);
```

**群消息相关的 drop（not in groupAllowFrom / no mention / group without chat_id）默认根本不写文件 log**。所以今天 log 里看不到这些行，不一定是"没 drop"，更可能是"drop 了但没记录"。

### 3. plan 004 的 race 假设被实证否定

11 个事件中 0 个 `chat_id` 为 null。imsg-legacy 的 watcher 在 macOS 12.7.6 上读 chat.db 时，LEFT JOIN `chat_message_join` 稳定返回 chat_id。即使在 chokidar 触发后立即 poll 也没有 race 触发。

### 4. plan 003 的 attributedBody parser 影响被实证否定

11 个非自发自事件 0 个 text 为空。parser 在 macOS 12.7.6 上没破坏正常 text（fallback 到 `m.text` 走通）。

### 5. IcePaw 的 OpenClaw 是 chat 237 的活跃成员

ROWID 5041-5047 是 IcePaw agent 在 chat 237 群里的工具调用输出。这意味着：
- IcePaw 的 OpenClaw 看到了 chat 237 的猴哥消息
- IcePaw 帮如意查询了 session 数据
- **两人的 OpenClaw 在 chat 237 的行为完全不同**：IcePaw 有响应，如意静默

可能原因：
- 不同的 OpenClaw 实例（不同 config / 不同 `channels.imessage` 段）
- 不同的 imsg CLI（IcePaw 跑 openclaw/imsg Swift 版，如意跑 imsg-legacy Node 版）
- 不同的 account / sender identity

### 6. 需要第二轮 capture 确认 drop reason

第一轮 capture 不足以判定 drop reason。下一步需要：
1. 重启 OpenClaw gateway + `OPENCLAW_LOG_LEVEL=debug`（让 logVerbose 进文件 log）
2. 跑 5 分钟第二轮 capture
3. 预期：能看见 `imessage: skipping group message (no mention)` 或 `not in groupAllowFrom` 或 `group without chat_id` 等 verbose 行

---

## attributedBody parser 影响评估

- **非自发自事件空 text 比例:** 0 / 11 = 0.0%
- **结论:** 所有非自发自事件都有正常 text
- **revert f1e7713 决定:** **不需要**（实证无破坏）

---

## plan 007 方向建议

### 推荐方向：**OpenClaw 端 debug 日志 capture + imessage monitor 代码分析**

不是 imsg-legacy 端的 fix（imsg-legacy 端 100% 正常）。需要：

1. **第二轮 capture**（重启 gateway + debug 日志）
   ```bash
   # 1. 临时改 logging level
   openclaw config set logging.level debug
   # 2. 重启 gateway
   openclaw gateway restart
   # 3. 跑 5 分钟 capture
   ./scripts/capture-imsg-watch-baseline.sh 300
   ./scripts/capture-openclaw-baseline.sh 300
   # 4. 让 IcePaw/猴哥在 chat 237 发消息
   # 5. 跑关联分析
   ./scripts/correlate-baseline.py /tmp/imsg-watch-baseline.jsonl /tmp/openclaw-gateway-baseline.log
   ```

2. **读 OpenClaw `monitorIMessageProvider` 代码** 找 imessage monitor 如何订阅 chat.db 变更
   - 路径：`/Users/Jay/.local/lib/node_modules/openclaw/dist/monitor-DzbMKxJs.js`
   - 关键函数：`monitorIMessageProvider`、`getMessages` / `pollDatabase`（可能有自己的 chokidar）
   - 对比 imsg-legacy `src/lib/watcher.js`：两者订阅 chat.db 变更的方式是否相同？
   - 关键问题：**imsg-legacy watch emit 的事件如何到达 OpenClaw？** 是通过：
     - (a) OpenClaw 自己的 imessage monitor 读 chat.db（独立读，不依赖 imsg-legacy），还是
     - (b) imsg-legacy 的 `imsg rpc` server push 给 OpenClaw（依赖 imsg-legacy）

3. **验证 imsg-legacy watch 是否被 OpenClaw 使用**
   - 检查 OpenClaw config: `channels.imessage.cliPath`（已确认是 `/Users/Jay/.local/bin/imsg`）
   - 检查 `channels.imessage.dbPath`（未设置，应该用默认 `~/Library/Messages/chat.db`）
   - 看 `watch.subscribe` RPC 方法是否被 OpenClaw 调用过（log 搜 `watch.subscribe` / `rpc`）

4. **如果根因是 OpenClaw 不用 imsg-legacy 的 watch**
   - plan 007 可能是：建议 IcePaw 用 imsg-legacy 跑同样的 watch，验证 imsg-legacy 的 emit 能被 IcePaw OpenClaw 看到
   - 或者：在 imsg-legacy 加独立 db watcher 给 OpenClaw 调用

---

## Scope 重新评估

**plan 006 实际完成度**：
- U1 imsg-legacy capture ✅
- U2 OpenClaw capture ✅（第一轮）
- U3 关联分析 ✅
- U4 决策报告 ✅（本文档）
- R5 决定：**不需要** revert f1e7713

**plan 007 范围重新定义**（基于本报告）：
- 原来以为是"修 imsg-legacy watcher race"或"修 OpenClaw session 路由"
- 实际是 **"OpenClaw 端 chat 237 消息为什么没被 imessage monitor 读到"**
- 这是个 OpenClaw 端问题，可能不需要 imsg-legacy 改动

---

## 待办（plan 007 输入）

- [ ] 重启 OpenClaw gateway + `OPENCLAW_LOG_LEVEL=debug` 跑第二轮 capture
- [ ] 比对 IcePaw 的 OpenClaw config（`~/.openclaw/openclaw.json`）和如意的 —— 看 channels.imessage 段是否完全一致
- [ ] 检查 OpenClaw 是否在用 imsg-legacy 的 `imsg rpc watch.subscribe`（log 搜 `watch.subscribe` 调用）
- [ ] 如果 OpenClaw 不用 imsg-legacy watch：检查它自己的 chat.db 订阅为什么漏了 chat 237
- [ ] 决定 plan 007 是改 imsg-legacy 端（加独立 db watcher）还是 OpenClaw 端（修 imessage monitor chat_id 过滤）
