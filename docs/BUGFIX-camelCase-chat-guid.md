# BUGFIX: commander.js camelCase 导致群聊 send 参数丢失

> **发现时间：** 2026-07-04 01:20 GMT+8
> **修复时间：** 2026-07-04 01:24 GMT+8
> **发现者：** 如意（MK-000）
> **严重性：** P1（群聊 send 完全不可用）
> **状态：** ✅ Fixed

---

## 症状

`imsg send --chat-guid` 命令虽然接受 `--chat-guid` 参数，但消息始终发到**单聊**而非群聊。

```bash
$ imsg send --to "ookong@me.com" --text "群聊测试" --chat-guid "iMessage;+;chat635246850300678011"
Message sent successfully!
# ❌ 消息发到了单聊 chat 7，不是群聊 chat 237
```

---

## 根因

**commander.js 的 `--kebab-case` → `camelCase` 自动转换规则：**

| CLI flag | commander 转换结果 | 代码中错误访问 |
|----------|-------------------|---------------|
| `--chat-guid` | `options.chatGuid`（小写 d） | `options.chatGUID`（大写 D）|

commander.js 把 `--chat-guid` 的最后一段 `guid` 全部小写化为 `chatGuid`，而不是保留全大写缩写 `chatGUID`。

**影响链：**

```
commander 解析: options.chatGuid = "iMessage;+;chat635246850300678011"  ✅
send.js 传参:   chatGUID: options.chatGUID → undefined                  ❌
sender.js 接收: chatGUID = '' (default)                                  ❌
resolveChatTarget: guid = '' → return ''                                 ❌
useChat = false → 走单聊路径                                              ❌
```

---

## 修复

### Fix 1: `src/commands/send.js`

```diff
- chatGUID: options.chatGUID || ''
+ chatGuid: options.chatGuid || ''
```

### Fix 2: `src/lib/sender.js`

兼容两种命名方式（防御性编程）：

```diff
  const {
    ...
-   chatGUID = ''
+   chatGUID: chatGUIDRaw
  } = options;
+ const chatGUID = chatGUIDRaw || options.chatGuid || '';
```

`resolveChatTarget()` 和返回值中同步修复：

```diff
- const guid = (options.chatGUID || '').trim();
+ const guid = (options.chatGUID || options.chatGuid || '').trim();
```

```diff
- chat_guid: useChat ? chatTarget : (options.chatGUID || ''),
+ chat_guid: useChat ? chatTarget : (options.chatGUID || options.chatGuid || ''),
```

---

## 验证

```bash
$ imsg send --to "ookong@me.com" \
    --text "🎉 imsg-legacy 群聊 send 修复验证！" \
    --chat-guid "iMessage;+;chat635246850300678011"
Message sent successfully!
# ✅ 消息正确出现在群聊 chat 237
```

---

## 教训

### commander.js camelCase 规则

commander.js 把 `--kebab-case` flag 转为 camelCase 时，**不做缩写保留**：

| CLI flag | camelCase | ❌ 常见错误假设 |
|----------|-----------|----------------|
| `--chat-guid` | `chatGuid` | `chatGUID` |
| `--user-id` | `userId` | `userID` |
| `--api-url` | `apiUrl` | `apiURL` |
| `--api-key` | `apiKey` | `apiKey`（这个碰巧对）|

### 最佳实践

1. **永远不要在 commander option 名中使用全大写缩写结尾**——commander 不认
2. **或者**在代码中同时兼容两种写法：`options.chatGUID || options.chatGuid`
3. **测试时**用 `node -e` 快速验证 commander 的 camelCase 转换结果

### 调试方法论

本次 debug 有效的排查路径：

1. 发现 CLI `--chat-guid` 不生效 → 消息走单聊
2. 用 `node -e` 直接调 sender.send()（绕过 commander）→ ✅ 群聊正常
3. 对比得出：问题在 commander → sender 的参数传递
4. 打印 `Object.keys(options)` → 发现是 `chatGuid` 不是 `chatGUID`

---

## 相关文件

| 文件 | 修改 |
|------|------|
| `src/commands/send.js` | `chatGUID` → `chatGuid` |
| `src/lib/sender.js` | 兼容 `chatGUID` 和 `chatGuid` 两种命名 |

## 完整调试记录

详见：`docs/investigations/2026-07-04-group-chat-full-debug-timeline.md`
