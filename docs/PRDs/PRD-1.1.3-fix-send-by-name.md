# PRD-1.1.3 · Fix `imsg send -t <群名>` 群发假成功 bug

> **版本：** 1.1.3 计划
> **登记时间：** 2026-09-09 11:05 GMT+8
> **登记人：** 如意（MK-000）
> **指派：** 筋斗云（如意专属 Claude Code，v2.1.167）
> **优先级：** P0（22h 群里静默 = 协作失职）
> **状态：** 🆕 Pending → 筋斗云实施中
> **联动 SOUL.md：** `~/.openclaw/workspace/SOUL.md` § 「📱 iMessage 私聊 vs 群发 · 工具铁律」
> **联动 LRN：** `punk-records/learnings/pending/LRN-20260909-001-imsg-send-group-fake-success.md`

---

## 1. 背景

9/9 09:42 猴哥 iMessage 问「猫族世界讨论你怎么缺席了」→ 查根因发现：9/8 12:00 → 9/9 09:28 = 22h chat 238「猫族世界」群 0 条我（Me）的消息。

`git log` 查 learning-homework 仓确认所有 commit 都做了（7e6d46e + 75f1d56 + 223762c 真实存在），但 chat 238 群里查不到。

SESSION-STATE 误记「已发 msg_id 1788917435641_2n0m」= 误记来源。

**根因：`imsg send -t <群名>` stdout 「Message sent successfully!」，但 imsg db（chat.db）实际没入库。**

猴哥 10:24 明示：「imsg 是咱们自己开发的（OpenClaw fork 维护 imsg-legacy），其他的 mac 分身都是用最新的 imsg 插件」。11:03 明示：「你和筋斗云一起开发的，写好 PRD，安排筋斗云来 fix」。

---

## 2. 症状（用户视角）

### 2.1 主症状

```bash
$ imsg send -t "猫族世界" -m "test from ruyi 942"
Message sent successfully!     # ← stdout 说成功

$ imsg history --chat-id 238 --limit 3 --json
# ← 群 chat 238 里没有「test from ruyi 942」这条消息
```

**私聊正常：**
```bash
$ imsg send -t "jieqiwang@gmail.com" -m "test"
Message sent successfully!

$ imsg history --chat-id 6 --limit 3 --json
# ← 私聊 chat 6 里有这条（9/9 实测多次真到）
```

### 2.2 已修但仍未覆盖的同根 bug

- ✅ `--chat-guid` 路径 — 1.1.2 (commit 1e0ad52, 2026-07-04) 已修 camelCase chatGUID → chatGuid
- ❌ `-t <群名>` 路径 — 1.1.2 **未修**（用户用中文群名 / 任意 displayName 走这条）
- ❌ `--chat-identifier <id>` 路径 — 1.1.2 **未验证**（待 1.1.3 覆盖）

---

## 3. 复现步骤

### 3.1 完整复现（必做）

```bash
# Step 1: 准备 — 找一个 iMessage 群（如「猫族世界」chat 238）
imsg chats --limit 20 --json | jq 'select(.name == "猫族世界")'

# Step 2: 发群（假成功触发）
KEYWORD="TEST-$(openssl rand -hex 3 | tr 'a-z' 'A-Z')"   # e.g. TEST-A1B2C3
imsg send -t "猫族世界" -m "PRD-1.1.3 验证 $KEYWORD"
# stdout: Message sent successfully!

# Step 3: 等 2 秒（消息入 imsg db 需要时间）
sleep 2

# Step 4: 验证 imsg db 是否真到
imsg history --chat-id 238 --limit 3 --json | grep -q "$KEYWORD" && echo "✅ 真到" || echo "❌ 假成功"

# Step 5: 直查 sqlite 二次确认
sqlite3 ~/Library/Messages/chat.db \
  "SELECT text, datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') FROM message m WHERE m.text LIKE '%$KEYWORD%' ORDER BY m.date DESC LIMIT 5;"
```

**预期：** Step 4 报「❌ 假成功」+ Step 5 0 行（重复多次必现）

### 3.2 私聊对照（必做）

```bash
KEYWORD="DM-$(openssl rand -hex 3 | tr 'a-z' 'A-Z')"
imsg send -t "jieqiwang@gmail.com" -m "私聊对照 $KEYWORD"
sleep 2
sqlite3 ~/Library/Messages/chat.db \
  "SELECT text FROM message WHERE text LIKE '%$KEYWORD%' ORDER BY date DESC LIMIT 1;"
```

**预期：** 1 行（私聊真到）

---

## 4. 根因分析（代码定位）

### 4.1 sender.js 的 sendViaAppleScript() 失败模式

`src/lib/sender.js` 第 145-160 行：

```javascript
sendViaAppleScript(options, chatTarget, useChat) {
  // ...
  return new Promise((resolve, reject) => {
    try {
      execFileSync('/usr/bin/osascript', ['-l', 'AppleScript', '-', ...args], {
        input: script
      });
      // ❌ 即使 AppleScript 抛错，execFileSync 已经 throw 进 catch，
      //    但 sendViaAppleScript 之外没有把这个错误冒泡给 send.js 的 try/catch
      // ❌ 实际上 sender.js 的 catch 在内部 resolve(undefined)，错误被吞了
      resolve({
        success: true,
        // ...
      });
    } catch (error) {
      reject(new Error(`AppleScript failed: ${error.message}`));
    }
  });
}
```

**关键问题：**

1. `execFileSync` 同步执行 AppleScript
2. AppleScript 内部：`tell application "Messages" to chat id "猫族世界"` —— AppleScript 不识别中文群名（只认 `chat id "iMessage;+;chat24930803106700483"` 这种 id）
3. `set targetChat to chat id "猫族世界"` → AppleScript 抛 `不能获得 chat id "猫族世界"` 错误
4. `execFileSync` throw 进 sender.js 的 catch
5. **但 catch 之前 resolve 已经调用** → 错误吞掉 + stdout 仍打「Message sent successfully!」

### 4.2 send.js 不区分路径

`src/commands/send.js` 第 19-32 行：

```javascript
.action(async (options) => {
  try {
    const sender = new MessageSender();
    await sender.send({
      recipient: options.to,
      // ...
      chatIdentifier: options.chatIdentifier || '',
      chatGuid: options.chatGuid || ''
    });
    console.log('Message sent successfully!');   // ← 无条件打 success
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
});
```

**问题：**

- `options.to` 永远被当 recipient 处理（不区分私聊/群）
- 没有「先 resolve 群名 → 拿真 chat-id → 走 chat-id 路径」的中间步骤
- 群名直接喂给 AppleScript 的 `chat id` 参数 → 失败但 stdout 仍 success

---

## 5. 期望行为（修复目标）

### 5.1 必须满足

1. **`imsg send -t <群名>` 真到 imsg db**（与私聊一致：stdout success = 实际入库）
2. **真到必须在发送前可验证**（测试用例必须用 `imsg history` + `sqlite3 chat.db` 二次确认）
3. **失败必须 stderr 报错 + 非 0 exit code**（不能 stdout success + 静默失败）

### 5.2 设计要求

1. **保持向后兼容**：现有 `imsg send --to "phone/email" -m "..."` 私聊路径不变
2. **保持 OpenClaw contract**：JSON 输出格式 + U5 字段（guid/chat_guid/service/id）不变
3. **保持 AppleScript 路径**：不允许用 IMCore private-API（产品边界）
4. **支持三种输入：** `-t <群名>` / `--chat-identifier <id>` / `--chat-guid <guid>`

### 5.3 推荐实现路径（筋斗云自决）

**核心修复：sender.send 入口增加「群名 resolve → 真 chat-id」步骤**

```javascript
async send(options) {
  // ... (existing code) ...
  
  // 🆕 1.1.3: 如果 recipient 是群名而非 handle，先 resolve 成真 chat-id
  if (useChat === false && !this.looksLikeHandle(options.recipient)) {
    // 这是个群名（不是 phone/email）
    const resolvedChat = await this.resolveChatByName(options.recipient);
    if (resolvedChat) {
      options.chatIdentifier = resolvedChat.identifier;
      // 重走 resolveChatTarget
      chatTarget = resolvedChat.identifier;
      useChat = true;
    } else {
      // 群名找不到 → 明确报错，不要假成功
      throw new Error(`Group chat not found: ${options.recipient}`);
    }
  }
  
  // ... (rest unchanged) ...
}
```

**群名 resolve 方式（推荐）：**

```javascript
/**
 * Resolve group chat by display name
 * 通过 imsg chats 列表查 displayName 匹配的群
 */
async resolveChatByName(name) {
  const { execFileSync } = require('child_process');
  try {
    // 调用 imsg chats --json 拿所有群
    const output = execFileSync('/usr/local/bin/imsg', ['chats', '--limit', '50', '--json'], {
      encoding: 'utf8'
    });
    const lines = output.trim().split('\n');
    for (const line of lines) {
      try {
        const chat = JSON.parse(line);
        if ((chat.name || '').trim() === name.trim()) {
          return {
            identifier: chat.identifier,
            id: chat.id,
            service: chat.service
          };
        }
      } catch (e) { /* ignore */ }
    }
    return null;
  } catch (e) {
    return null;
  }
}
```

**sendViaAppleScript 失败模式修正：**

```javascript
sendViaAppleScript(options, chatTarget, useChat) {
  // ... (existing setup) ...
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    try {
      const result = execFileSync('/usr/bin/osascript', ['-l', 'AppleScript', '-', ...args], {
        input: script,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      stdout = result;
      resolve({ success: true, /* U5 fields */ });
    } catch (error) {
      stderr = error.stderr || error.message;
      // 🆕 1.1.3: 把 AppleScript 错误完整冒泡，不吞
      reject(new Error(`AppleScript failed (useChat=${useChat}, chatTarget=${chatTarget}): ${stderr}`));
    }
  });
}
```

### 5.4 测试要求

`test/test-suite.js` 增加新测试 `test_GroupSendByName`：

```javascript
async function test_GroupSendByName() {
  console.log('\n### 测试: 群名 send 真到 imsg db ###');
  
  // Step 1: 找一个群
  const groupChat = getAnyGroupChat();   // 🆕 需要新加
  if (!groupChat) {
    logTest('群名 send', 'SKIP', '无可用群');
    return false;
  }
  
  // Step 2: 用群名发
  const keyword = generateKeyword();
  try {
    execSync(`imsg send --to "${groupChat.name}" --text "${keyword}"`, { encoding: 'utf8' });
  } catch (e) {
    logTest('群名 send', 'FAIL', `imsg send 报错: ${e.message}`);
    return false;
  }
  
  // Step 3: 等消息入 imsg db
  await sleep(3000);
  
  // Step 4: 二次验证
  const output = execSync(`imsg history --chat-id ${groupChat.id} --limit 3 --json`, { encoding: 'utf8' });
  const found = output.includes(keyword);
  
  if (found) {
    logTest('群名 send', 'PASS', `群 ${groupChat.name} 收到关键词 ${keyword}`);
    return true;
  } else {
    logTest('群名 send', 'FAIL', `群 ${groupChat.name} 没收到关键词 ${keyword}`);
    return false;
  }
}
```

---

## 6. 验收标准（筋斗云完成 → 通知如意 review）

### 6.1 功能验收

- [ ] PRD §3.1 复现步骤现在报「✅ 真到」+ sqlite 能查到
- [ ] PRD §3.2 私聊对照仍报成功（不退化）
- [ ] `node test/test-suite.js` 100% 通过（test_GroupSendByName + 现有 7 个测试）
- [ ] `--chat-identifier <id>` 路径仍可用（不退化）
- [ ] `--chat-guid <guid>` 路径仍可用（不退化）
- [ ] AppleScript 失败时 stderr 报错 + exit code ≠ 0（不假成功）

### 6.2 兼容性验收

- [ ] JSON 输出格式不变（OpenClaw contract U5/U6/U7 不动）
- [ ] 私聊路径（`-t <email/phone>`）不变
- [ ] macOS 11+ 仍可运行
- [ ] `node_modules/` 无新增依赖

### 6.3 工程验收

- [ ] CHANGELOG.md 加 1.1.3 条目
- [ ] version bump（package.json: 1.1.2 → 1.1.3）
- [ ] commit message 含 `[如意+筋斗云] fix(send): -t <群名> 路径 resolveChatByName`
- [ ] docs/BUG-group-send-by-name-fake-success.md 状态 → ✅ Resolved

---

## 7. 不在本次修复范围（产品边界）

- IMCore private-API bridge（需要 macOS 14+，产品边界明确排除）
- 群名 resolve 模糊匹配（如「猫族」→ 匹配「猫族世界」+「猫族世界（旧）」）—— 1.1.3 严格相等匹配
- iMessage 历史批量清理 / chat.db 迁移
- 上游 `imsg` Swift 版同步（猴哥说 macOS 14+ 用户走 OpenClaw runtime plugin）

---

## 8. 关联文件

| 文件 | 修改 |
|------|------|
| `src/lib/sender.js` | 加 `resolveChatByName()` + sendViaAppleScript 失败模式修正 |
| `src/commands/send.js` | 入口加「群名 → resolveChatByName」分支 |
| `test/test-suite.js` | 加 `test_GroupSendByName` + `getAnyGroupChat()` |
| `package.json` | version: 1.1.2 → 1.1.3 |
| `CHANGELOG.md` | 加 1.1.3 条目 |
| `docs/BUG-group-send-by-name-fake-success.md` | 新建 + 状态更新到 ✅ Resolved |

---

## 9. 联动教训（来自 SOUL.md + LRN）

- **SOUL.md** 「📱 iMessage 私聊 vs 群发 · 工具铁律」§ 2 「已知 bug · imsg-legacy 群发假成功」
- **LRN-20260909-001-imsg-send-group-fake-success.md** —— root cause 描述
- **LRN-20260909-002-22h-group-silent-double-failure.md** —— 失职链
- **punk-records/learnings/errors/imsg-false-report-2026-05-06.md** —— 5/6 同根事故
- **LRN-20260905-005-fake-success-retry-succeeded-but-no-delivery.md** —— 9/5 retry 假成功
- **3 连事故（5/6 → 9/5 → 9/9）= stdout success ≠ imsg db 真到 + 静默失败 + 谎报「已发」**

---

## 10. 给筋斗云的指令（一句话）

> **修复 imsg-legacy 1.1.3：`imsg send -t <群名>` 走 resolveChatByName → 拿真 chat-id → 走 chat-id 路径；AppleScript 失败 stderr 报错 + exit code ≠ 0；CHANGELOG + version bump + test 验证；不动私聊路径。**

—— 如意 ✨ 2026-09-09 11:05 立
