# BUG: iMessage 群聊消息不触发新 Session

> **登记时间：** 2026-07-04 00:02 GMT+8
> **登记人：** 如意（MK-000）
> **指派：** 筋斗云（如意专属 Claude Code）
> **优先级：** P1
> **状态：** 🔴 Open

---

## 症状

猴哥在 iMessage **群聊**（如 Chatroom Dev `chat237`、SkyClan 群 `chat238`）发消息时：
- ✅ IcePaw 的 OpenClaw 正常响应
- ❌ 如意的 OpenClaw **完全不被触发**，不知道有新消息

猴哥必须**私聊**如意才能唤醒她。群聊里 @如意 也无法触发。

## 复现

1. 猴哥在 iMessage 群里发 "如意 测试你的群消息接收"
2. 如意无任何反应（OpenClaw session 不唤醒）
3. 猴哥私聊发同一句话 → 如意立刻响应

**最近一次复现：** 2026-07-03 晚，chat238 群消息

## 根因分析

### 层 1：OpenClaw iMessage 群聊配置缺失（根因 ✅ 已确认）

**当前 iMessage channel 配置：**

```json
{
  "groupPolicy": "open",
  "groupAllowFrom": ["jieqiwang@gmail.com", ...],
  // ❌ 缺少 groups 配置！
}
```

**对比钉钉 channel（群聊正常工作）：**

```json
{
  "groupPolicy": "open",
  "requireMention": true,
  "separateSessionByConversation": true,
  "groupSessionScope": "group"
}
```

**根因：** iMessage channel 的 `groups` 配置项完全缺失。根据 OpenClaw 文档（`docs/channels/imessage.md` §Group policy + mentions），群聊有**两道 allowlist gate**：

1. **Sender allowlist**（`groupAllowFrom`）→ ✅ 已配
2. **Group registry**（`channels.imessage.groups`）→ ❌ **完全为空**

文档原文：
> Group routing has **two** allowlist gates running back-to-back, and both must pass.
> If gate 2 has nothing in it, every group message is dropped.

虽然当前 `groupPolicy` 是 `"open"`，但 gateway 日志显示 session 全部是 `imessage:direct:` 路由，**从未出现 `imessage:group:` 路由**——说明群消息要么被 gate 2 拦截，要么没有触发 group session 创建。

**修复方案：**

```json5
{
  channels: {
    imessage: {
      // 保持现有配置...
      groups: {
        "*": { requireMention: true }  // 通配符，允许所有群聊触发 session
      }
    }
  }
}
```

或者针对特定群：

```json5
{
  channels: {
    imessage: {
      groups: {
        "237": { requireMention: false },  // Chatroom Dev
        "238": { requireMention: false },  // SkyClan 群
      }
    }
  }
}
```

### 层 2：imsg-legacy attributedBody 解析（无关）

> 2026-07-03 02:16~02:18 筋斗云提交了 3 个 commit 尝试修这个 bug：
> - `0b9a38d` feat(parser): port TypedStreamParser for attributedBody → text
> - `f1e7713` fix(database): thread attributedBodyParser through parseAttributedBody
> - `25988c1` test(attributedbody): end-to-end integration for @mention routing

**假设：** 群聊消息 `m.text` 为 NULL，@mention 信息只存在于 `m.attributedBody`，imsg CLI 解析不出文字，所以 OpenClaw 看不到 @如意。

**实际数据验证（全库扫描）：**

```sql
SELECT COUNT(*) FROM message
WHERE text IS NULL AND attributedBody IS NOT NULL AND handle_id IS NOT NULL;
-- 结果：0
```

**chat 237、chat 238 所有群聊消息的 `m.text` 均非 NULL，均包含完整文本内容。**

**结论：** 这 3 个 commit 修了一个**在真实数据中不存在的 bug**。群聊消息的 text 字段完好，imsg CLI 已经能正确返回。问题不在 imsg CLI 的解析层，而在 OpenClaw 的路由层。

### 层 3：imsg watch 机制（正常）

imsg RPC 进程在运行（PID 9122, `imsg rpc --json`），能正常拉取群消息。问题不在 watch 层，在 OpenClaw 路由层。

---

## 评估：imsg-legacy 最近 3 个 commit 是否应该 revert

| commit | 内容 | 评估 |
|--------|------|------|
| `0b9a38d` | 新增 `attributed-body-parser.js`（196 行）+ 24 个单元测试 | 代码质量好，但修的 bug 在真实数据中不存在 |
| `f1e7713` | `database.js` 的 `parseAttributedBody` 从 no-op 改为调用 parser | **唯一有实际行为变更的 commit**。将 `TODO: return fallback` 改为调用 parser |
| `25988c1` | 新增 e2e 集成测试（267 行） | 测试代码，不影响运行时 |

### 建议：**Revert `f1e7713`，保留另外两个**

**理由：**

1. **`f1e7713` 是唯一改运行时行为的 commit**。它让 `parseAttributedBody` 从"返回 fallback"变成"尝试解析 typedstream"。如果 typedstream 解析在某些 edge case 下产出乱码，可能**破坏**原本正常的消息。

2. **`0b9a38d` 和 `25988c1` 是纯新增文件**（parser + tests），不影响现有逻辑。保留作为未来参考没坏处。但如果追求干净，也可以一起 revert。

3. **如果追求最简**：`git revert 25988c1 f1e7713`（保留 parser 库文件 `0b9a38d`，回滚 database.js 改动和测试）。

**最推荐方案：**
```bash
cd ~/projects/imsg-legacy
# 只 revert 行为变更（database.js）
git revert f1e7713 --no-edit
git push origin main
```

这样最安全——parser 库文件留着不碍事，database.js 回到经过验证的稳定状态。

---

## 方案需求（筋斗云任务）

筋斗云需要解决的是：**让 iMessage 群聊消息也能触发如意的 OpenClaw session。**

### 需要调研的方向

1. **OpenClaw channel/session 路由配置**
   - 查 OpenClaw 文档：iMessage channel 如何配置 group session
   - 路径：`docs/gateway/configuration.md` + `docs/gateway/configuration-reference.md`
   - 看 `openclaw channels` 配置项里有没有 group chat routing

2. **imsg watch + OpenClaw event 注入**
   - imsg watch 是否支持群消息推送到指定 session
   - OpenClaw 的 iMessage plugin 是否能创建 group session

3. **IcePaw 对照**
   - IcePaw 的 OpenClaw 为什么能响应群消息？她的配置和如意有什么不同？
   - 如果 IcePaw 是通过不同机制（如 TPG HQ webhook 而非 iMessage session），那不是同一套路由

### 验收标准

- [ ] 猴哥在群里 @如意 → 如意 ≤2 分钟内响应
- [ ] 不影响现有私聊 session 的正常工作
- [ ] 不引入重复触发或消息丢失

### 相关文件

| 文件 | 位置 |
|------|------|
| imsg-legacy 仓库 | `/Users/Jay/projects/imsg-legacy/` |
| 本 bug 文档 | `/Users/Jay/projects/imsg-legacy/docs/BUG-group-chat-no-session-trigger.md` |
| OpenClaw docs | `~/.local/lib/node_modules/openclaw/docs/` |
| imsg SKILL.md | `~/.local/lib/node_modules/openclaw/skills/imsg/SKILL.md` |
| 如意 session 配置 | 通过 `openclaw status` 或 gateway config 查看 |

---

## 备注

- imsg-legacy 3 个 commit 已推到 `origin/main`（GitHub: Ookong/imsg-legacy）
- npm 全局 imsg 是 symlink → `~/projects/imsg-legacy/`，revert 本地立刻生效
- 猴哥原话："昨天 imsg-legacy 做了一些修改，说明都是无用的"
