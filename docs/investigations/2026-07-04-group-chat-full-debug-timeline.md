# iMessage 群聊调试全记录

> **日期：** 2026-07-04
> **参与：** 猴哥（iPad 远程指挥）、如意（MacBook Air, macOS 12, imsg-legacy）、IcePaw（MacBook Pro, 原生 imsg）
> **结果：** ✅ 入站修复 + 🐛 出站 bug 定位并修复

---

## 一、问题概述

如意（MK-000）在 iMessage 群聊中存在两个问题：

1. **入站失败**：群聊消息完全无法触发如意的 OpenClaw session
2. **出站失败**：如意无法向群聊发送消息（回复只停留在 session 内部）

而 IcePaw 在同一个群聊中收发完全正常——两台机器、两套 imsg 实现的差异是根因。

---

## 二、入站调试：从「完全收不到」到「正常触发」

### 2.1 初始状态（~23:30 - 00:30）

猴哥在三人群（Chatroom Dev, chat_id: 237, GUID: `iMessage;+;chat635246850300678011`）发消息测试：
- ✅ IcePaw 正常响应
- ❌ 如意完全无反应（OpenClaw session 不唤醒）

### 2.2 排查过程

#### 层 1：imsg-legacy watch emit（已排除）

plan 006 baseline capture 确认 imsg-legacy 的 watch 机制完全正常：
- 11 个事件全部完整（chat_id / sender / text / is_from_me 字段全对）
- 0 个 null / 0 个空 text / 0 个自发自
- imsg-legacy 端 100% 正常

#### 层 2：attributedBody 解析（已排除）

plan 003 曾假设群聊消息的 `text` 字段为 NULL，@mention 信息只在 `attributedBody` 中。
全库扫描确认 chat 237/238 所有消息 `m.text` 均非 NULL，此假设不成立。

#### 层 3：OpenClaw 配置（根因 ✅）

**问题：** OpenClaw iMessage channel 缺少 `groups` 配置项。

群聊路由有**两道 allowlist gate**：
1. **Sender allowlist**（`groupAllowFrom`）→ ✅ 已配
2. **Group registry**（`channels.imessage.groups`）→ ❌ 缺失/为空

虽然 `groupPolicy` 设为 `"open"`，但如果没有 `groups` 配置，群消息在 gate 2 被静默 drop。

### 2.3 关键配置变更

猴哥对 `~/.openclaw/openclaw.json` 做了以下修改：

#### 变更 1：添加 groups 配置

```json5
{
  "channels": {
    "imessage": {
      "groups": {
        "*": {
          "requireMention": false  // 群聊消息不需要 @提及 即可触发
        }
      }
    }
  }
}
```

**作用：** 允许所有群聊触发 OpenClaw session，不需要 @mention。

#### 变更 2：groupPolicy 确认为 "open"

```json5
{
  "channels": {
    "imessage": {
      "groupPolicy": "open",
      "groupAllowFrom": [
        "jieqiwang@gmail.com",
        "ying@brandct.com",
        "534505914@qq.com",
        "thawflow@outlook.com"
      ]
    }
  }
}
```

**分析 `{"*": {"requireMention": false}}` 的作用：**

| 配置项 | 值 | 作用 |
|--------|-----|------|
| `"*"` | 通配所有群 | 不需要逐个注册群 ID |
| `requireMention` | `false` | 群消息不需要 @如意 就触发 session |

**如果设为 `true`：** 群消息必须包含 @如意 才会触发（需要 attributedBody 解析支持）。
**设为 `false` 的好处：** 简化触发条件，避免 mention 解析问题。

#### 变更 3：Gateway 重启

config 变更后需要 gateway reload 才能生效：
```
2026-07-03T16:45:56Z  config change detected (channels.imessage.groups)
2026-07-03T16:47:31Z  http server listening (6 plugins: ..., imessage, ...)
```

### 2.4 入站修复验证

配置生效后（~00:39），猴哥在群里发消息 → 如意的 OpenClaw session 成功触发。
群聊消息开始正常进入如意 session，后续每条都能收到。

---

## 三、出站调试：从「回复消失」到「AppleScript 过渡」再到「bug 修复」

### 3.1 问题现象（00:49 - 01:00）

猴哥报告：发了好几条消息让如意回复，但群里看不到如意的任何回复。

如意的 webchat session 显示「已回复」，但 message tool 返回 `via=direct`——回复只停留在 OpenClaw 内部，没有通过 iMessage 蓝气泡投递到群聊。

### 3.2 排查过程

#### 发现 1：imsg send 不支持群聊

```bash
$ imsg send --chat-id 237 --text "测试"
error: required option '-t, --to <recipient>' not specified
```

`imsg send` 要求 `--to`（单聊收件人），不支持 `--chat-id` 直接发群聊。

#### 发现 2：AppleScript 可以发群聊

```bash
$ osascript -e 'tell application "Messages" to send "测试" to chat id "iMessage;+;chat635246850300678011"'
# ✅ 成功！群里收到了
```

连续发送 3 条不同内容的消息，全部验证成功。

### 3.3 AppleScript 过渡方案（01:00 - 01:13）

在找到根本修复前，使用 AppleScript 作为群聊出站通道：

```bash
osascript -e "tell application \"Messages\" to send \"消息内容\" to chat id \"iMessage;+;chat635246850300678011\""
```

### 3.4 深入排查：imsg-legacy 其实有群聊 send 代码！

#### 发现代码

`src/commands/send.js` 有 `--chat-guid` 和 `--chat-identifier` 选项：
```javascript
.option('--chat-guid <guid>', 'Target chat by GUID')
.option('--chat-identifier <id>', 'Target chat by identifier')
```

`src/lib/sender.js` 的 AppleScript 模板也支持群聊路径：
```applescript
if useChat is "1" then
  set targetChat to chat id chatId
  send theMessage to targetChat
```

#### 测试 CLI

```bash
$ imsg send --to "ookong@me.com" --text "群聊测试" --chat-guid "iMessage;+;chat635246850300678011"
Message sent successfully!
```

但消息发到了**单聊**（chat 7），不是群聊（chat 237）！

#### 定位 bug：commander.js camelCase 陷阱

```bash
$ node -e "
const { Command } = require('commander');
const program = new Command();
program.command('test')
  .option('--chat-guid <guid>')
  .action(opts => console.log(Object.keys(opts)));
program.parse(['node', 'test', '--chat-guid', 'foo']);
"
# 输出: ['chatGuid']  ← 注意是小写 d
```

**根因：** commander.js 把 `--chat-guid` 自动转为 camelCase `chatGuid`（小写 d），但代码访问的是 `options.chatGUID`（大写 D）→ **undefined**！

| 层级 | 代码 | 实际值 |
|------|------|--------|
| commander.js 解析 `--chat-guid` | `options.chatGuid` | ✅ `"iMessage;+;chat..."` |
| `send.js` 传参 | `chatGUID: options.chatGUID` | ❌ `undefined` |
| `sender.js` 接收 | `chatGUID = ''` | ❌ 空字符串 |
| `resolveChatTarget` | `guid = ''` | ❌ 空字符串 |
| `useChat` | `false` | ❌ 走单聊路径 |

### 3.5 Bug 修复

#### Fix 1: `send.js` — key 名对齐

```diff
- chatGUID: options.chatGUID || ''
+ chatGuid: options.chatGuid || ''
```

#### Fix 2: `sender.js` — 兼容两种命名

```diff
  const {
    ...
-   chatGUID = ''
+   chatGUID: chatGUIDRaw
  } = options;
+ const chatGUID = chatGUIDRaw || options.chatGuid || '';
```

同时把 `resolveChatTarget` 和返回值中的 `options.chatGUID` 改为 `options.chatGUID || options.chatGuid`。

#### 修复验证

```bash
$ imsg send --to "ookong@me.com" \
    --text "🎉 imsg-legacy 群聊 send 修复验证！" \
    --chat-guid "iMessage;+;chat635246850300678011"
# ✅ 消息成功出现在群聊 chat 237！
```

---

## 四、最终架构对比

### 如意（MacBook Air, macOS 12）

| 方向 | 机制 | 状态 |
|------|------|------|
| **入站** | OpenClaw imessage 插件 + `groups: {"*": {"requireMention": false}}` | ✅ 修复 |
| **出站（单聊）** | `imsg send --to <email>` | ✅ 正常 |
| **出站（群聊）** | `imsg send --to <email> --chat-guid <guid>` | ✅ 修复后正常 |
| **出站（备选）** | `osascript -e 'tell application "Messages" ...'` | ✅ 一直可用 |

### IcePaw（MacBook Pro, 原生 imsg）

| 方向 | 机制 | 状态 |
|------|------|------|
| **入站** | OpenClaw imessage 插件 | ✅ 一直正常 |
| **出站（群聊）** | `message` tool（OpenClaw 内置路由） | ✅ 一直正常 |

### 两台机器差异

| 项目 | 如意 | IcePaw |
|------|------|--------|
| macOS | 12 (Monterey) | 较新版本 |
| imsg | imsg-legacy (Node.js 移植版) | imsg (原生 Swift) |
| 路径 | `/Users/Jay/projects/imsg-legacy` | `/Users/Jay/projects/imsg` |
| OpenClaw 出站 | message tool 走 `via=direct`（不投递到 iMessage） | message tool 正常投递到 iMessage |
| 群聊 send | 需 `--chat-guid` 或 AppleScript | 原生支持 |

---

## 五、经验总结

### 5.1 commander.js camelCase 陷阱

**教训：** commander.js 的 `--kebab-case` 选项转为 `camelCase` 时，全大写缩写（如 GUID、URL、ID）会被转为小写末字母。

| CLI flag | commander camelCase | 常见错误假设 |
|----------|---------------------|-------------|
| `--chat-guid` | `chatGuid` | ❌ `chatGUID` |
| `--user-id` | `userId` | ❌ `userID` |
| `--api-url` | `apiUrl` | ❌ `apiURL` |

**最佳实践：** 永远不要在 commander 选项名中使用全大写缩写，或者在代码中同时兼容两种写法。

### 5.2 OpenClaw iMessage 群聊配置

必须同时配置：
1. `groupPolicy: "open"` 或 `"allowlist"`
2. `groupAllowFrom: [...]` — 允许哪些发送者
3. `groups: {"*": {"requireMention": false}}` — 允许哪些群触发 session

缺少第 3 项 → 群消息被静默 drop（无日志）。

### 5.3 调试方法论

本次调试的有效的排查路径：
1. **对比正常/异常环境**（IcePaw vs 如意）
2. **分层排除**（imsg CLI → OpenClaw 配置 → AppleScript 验证）
3. **实证驱动**（baseline capture + 关联分析 > 理论假设）
4. **最小化测试**（手动 AppleScript → CLI → 源码定位）

### 5.4 待办

- [ ] 将 `send.js` 和 `sender.js` 的修复 commit 到 imsg-legacy 仓库
- [ ] 考虑给 `imsg send` 添加 `--chat-id` 选项（用户友好，自动拼 GUID）
- [ ] 调查 OpenClaw 为什么如意这边 `message` tool 出站走 `via=direct` 而不是 iMessage（可能与 bluebubbles 插件有关，当前已禁用）
- [ ] IcePaw 建议的 `groupPolicy` 从 `"open"` 改为 `"allow"` 的安全性评估

---

## 六、时间线

| 时间 (GMT+8) | 事件 |
|-------------|------|
| ~23:30 | 猴哥开始在群聊测试，发现如意完全收不到 |
| 00:02 | 创建 `BUG-group-chat-no-session-trigger.md` |
| 00:30~00:45 | 筋斗云跑 plan 006 baseline capture + 关联分析 |
| 00:45 | 修改 OpenClaw 配置（`groups: {"*": {"requireMention": false}}`） |
| 00:47 | Gateway 重启，配置生效 |
| 00:39 | 如意开始收到群聊消息（入站修复） |
| 00:49 | 猴哥发现如意的回复没发到群里（出站问题） |
| 00:52 | IcePaw 帮忙排查，发现如意的 session 不在活跃列表 |
| 01:00 | 尝试 AppleScript 发群聊 → ✅ 成功 |
| 01:03-01:05 | 连续 3 条 AppleScript 测试全部成功 |
| 01:08 | 猴哥确认 AppleScript 过渡方案 |
| 01:10 | 确认根因是 imsg-legacy 移植缺失 |
| 01:13 | 猴哥提供 imsg-legacy 路径，准备明天对比 |
| 01:17 | 猴哥要求写调研文档（本文档） |
| 01:20 | 发现 imsg-legacy 其实有 `--chat-guid` 选项 |
| 01:23 | 定位 bug：commander.js camelCase `chatGuid` ≠ `chatGUID` |
| 01:24 | 修复并验证：`imsg send --chat-guid` 群聊发送成功 🎉 |

---

## 七、相关文件

| 文件 | 说明 |
|------|------|
| `docs/BUG-group-chat-no-session-trigger.md` | 原始 bug 报告（入站问题） |
| `docs/investigations/2026-07-04-group-chat-baseline.md` | plan 006 baseline 关联分析 |
| `docs/investigations/2026-07-04-group-chat-full-debug-timeline.md` | 本文档（全流程） |
| `src/commands/send.js` | CLI send 命令（已修复 camelCase） |
| `src/lib/sender.js` | 发送逻辑（已修复兼容两种命名） |
| `~/.openclaw/openclaw.json` | OpenClaw 配置（含 groups 配置） |
