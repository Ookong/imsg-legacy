#!/bin/bash

# OpenClaw 快速测试脚本
# 用于验证 imsg 与 OpenClaw 的集成

echo "╔════════════════════════════════════════════════════════════╗"
echo "║          OpenClaw 集成测试 - imsg v1.0.0                  ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 测试计数器
TOTAL=0
PASSED=0
FAILED=0

# 测试函数
test_rpc() {
  local name="$1"
  local request="$2"
  local expected="$3"

  ((TOTAL++))
  echo -n "测试 $TOTAL: $name... "

  RESPONSE=$(echo "$request" | imsg rpc 2>/dev/null)

  if echo "$RESPONSE" | grep -q "$expected"; then
    echo -e "${GREEN}✅ PASS${NC}"
    ((PASSED++))
    return 0
  else
    echo -e "${RED}❌ FAIL${NC}"
    echo "   期望包含: $expected"
    echo "   实际响应: $RESPONSE"
    ((FAILED++))
    return 1
  fi
}

echo -e "${BLUE}═══ RPC 方法测试 ═══${NC}"
echo ""

# 测试 1: 列出对话
test_rpc \
  "列出对话" \
  '{"jsonrpc":"2.0","method":"chats.list","params":{},"id":1}' \
  '"result"'

# 测试 2: 获取消息历史
test_rpc \
  "获取消息历史" \
  '{"jsonrpc":"2.0","method":"messages.history","params":{"chat_id":7,"limit":3},"id":2}' \
  '"messages"'

# 测试 3: 发送消息
test_rpc \
  "发送消息" \
  '{"jsonrpc":"2.0","method":"send","params":{"to":"test@example.com","text":"OpenClaw 测试 ✓"},"id":3}' \
  '"ok":true'

# 测试 4: Watch 订阅
test_rpc \
  "Watch 订阅" \
  '{"jsonrpc":"2.0","method":"watch.subscribe","params":{"chat_id":7},"id":4}' \
  '"subscription"'

# 测试 5: 错误处理
test_rpc \
  "错误处理（无效方法）" \
  '{"jsonrpc":"2.0","method":"invalid.method","params":{},"id":5}' \
  '"error"'

echo ""
echo -e "${BLUE}═══ 命令行测试 ═══${NC}"
echo ""

# 测试 6: chats 命令
((TOTAL++))
echo -n "测试 $TOTAL: imsg chats 命令... "
if imsg chats > /dev/null 2>&1; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAILED++))
fi

# 测试 7: history 命令（日期修复验证）
((TOTAL++))
echo -n "测试 $TOTAL: imsg history 命令（日期显示修复）... "
if imsg history -c 7 -l 1 > /dev/null 2>&1; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAILED++))
fi

# 测试 8: send 命令
((TOTAL++))
echo -n "测试 $TOTAL: imsg send 命令... "
if imsg send -t test@example.com -m "命令行测试 ✓" > /dev/null 2>&1; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAILED++))
fi

echo ""
echo -e "${BLUE}═══ 数据格式验证 ═══${NC}"
echo ""

# 测试 9: 验证消息对象包含必需字段
((TOTAL++))
echo -n "测试 $TOTAL: 消息对象字段完整性... "
RESPONSE=$(echo '{"jsonrpc":"2.0","method":"messages.history","params":{"chat_id":7,"limit":1},"id":9}' | imsg rpc)
if echo "$RESPONSE" | grep -q '"id"' && \
   echo "$RESPONSE" | grep -q '"chat_id"' && \
   echo "$RESPONSE" | grep -q '"sender"' && \
   echo "$RESPONSE" | grep -q '"text"' && \
   echo "$RESPONSE" | grep -q '"created_at"' && \
   echo "$RESPONSE" | grep -q '"is_from_me"'; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAILED++))
fi

# 测试 10: 验证日期格式
((TOTAL++))
echo -n "测试 $TOTAL: ISO 8601 日期格式... "
if echo "$RESPONSE" | grep -q '"created_at":"20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]'; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((FAILED++))
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                        测试结果                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo -e "总测试数: $TOTAL"
echo -e "${GREEN}通过: $PASSED${NC}"
echo -e "${RED}失败: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║                   🎉 所有测试通过！                        ║${NC}"
  echo -e "${GREEN}║                                                                ║${NC}"
  echo -e "${GREEN}║          imsg 已准备好在 OpenClaw 中使用！                  ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "📝 使用示例："
  echo ""
  echo "  # 命令行"
  echo "  imsg chats                              # 列出对话"
  echo "  imsg history -c 7 -l 10                 # 查看历史"
  echo "  imsg send -t user@example.com -m 'Hi'   # 发送消息"
  echo "  imsg watch --json                       # 监控新消息"
  echo ""
  echo "  # RPC 方式"
  echo '  echo '"'"'{"jsonrpc":"2.0","method":"chats.list","params":{},"id":1}'"'"' | imsg rpc'
  echo '  echo '"'"'{"jsonrpc":"2.0","method":"messages.history","params":{"chat_id":7,"limit":10},"id":2}'"'"' | imsg rpc'
  echo '  echo '"'"'{"jsonrpc":"2.0","method":"send","params":{"to":"user@example.com","text":"Hi"},"id":3}'"'"' | imsg rpc'
  echo ""
  exit 0
else
  echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║                   ⚠️  部分测试失败                          ║${NC}"
  echo -e "${RED}║                   请检查错误信息                            ║${NC}"
  echo -e "${RED}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "💡 提示："
  echo "  1. 确认 imsg 版本: imsg --version"
  echo "  2. 重新安装: cd /Users/kaia/Downloads/imsg-legacy && npm install -g imsg-1.0.0.tgz"
  echo "  3. 查看详细测试: /Users/kaia/Downloads/imsg-legacy/OPENCLAW_TEST_GUIDE.md"
  echo ""
  exit 1
fi
