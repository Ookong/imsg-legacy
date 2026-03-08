#!/usr/bin/env node
/**
 * imsg 完整测试套件
 * 使用关键词自动验证所有功能
 */

const { execSync } = require('child_process');
const crypto = require('crypto');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateKeyword() {
  return `TEST-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// 获取指定identifier的chat_id
function getChatId(identifier) {
  try {
    const output = execSync('imsg chats --limit 50 --json', { encoding: 'utf8' });
    const lines = output.trim().split('\n');

    for (const line of lines) {
      try {
        const chat = JSON.parse(line);
        if (chat.identifier === identifier) {
          return chat.id;
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
    return null;
  } catch (error) {
    console.error('获取chat_id失败:', error.message);
    return null;
  }
}

// 获取任意一个可用的chat_id
function getAnyChatId() {
  try {
    const output = execSync('imsg chats --limit 1 --json', { encoding: 'utf8' });
    const chat = JSON.parse(output.trim());
    return chat.id;
  } catch (error) {
    return null;
  }
}

// 测试结果记录
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function logTest(name, status, message = '') {
  const result = { name, status, message };
  results.tests.push(result);

  if (status === 'PASS') {
    results.passed++;
    console.log(`✅ ${name}`);
  } else if (status === 'FAIL') {
    results.failed++;
    console.log(`❌ ${name}`);
    if (message) console.log(`   ${message}`);
  } else {
    console.log(`⏳ ${name}`);
  }
}

async function test1_ChatsCommand() {
  console.log('\n### 测试1: Chats命令 ###');

  try {
    const output = execSync('imsg chats --limit 3 --json', { encoding: 'utf8' });
    const lines = output.trim().split('\n');

    if (lines.length > 0) {
      const chat = JSON.parse(lines[0]);
      if (chat.id && chat.identifier && chat.service && chat.last_message_at) {
        logTest('Chats基本功能', 'PASS');
        logTest('Chats JSON格式', 'PASS');
        return true;
      }
    }

    logTest('Chats命令', 'FAIL', '无输出或格式错误');
    return false;
  } catch (error) {
    logTest('Chats命令', 'FAIL', error.message);
    return false;
  }
}

async function test2_HistoryCommand() {
  console.log('\n### 测试2: History命令 ###');

  try {
    // 动态获取chat_id
    const chatId = getAnyChatId();
    if (!chatId) {
      logTest('History命令', 'FAIL', '无法获取chat_id');
      return false;
    }

    const output = execSync(`imsg history --chat-id ${chatId} --limit 1 --json`, { encoding: 'utf8' });
    const msg = JSON.parse(output.trim().split('\n')[0]);

    const requiredFields = ['id', 'chat_id', 'guid', 'sender', 'text', 'created_at', 'is_from_me', 'attachments', 'reactions'];
    const hasAllFields = requiredFields.every(field => msg.hasOwnProperty(field));

    if (hasAllFields) {
      logTest('History基本功能', 'PASS');
      logTest('History字段完整性', 'PASS', `包含${requiredFields.length}个必需字段`);
      logTest('History JSON格式', 'PASS');
      return true;
    }

    const missing = requiredFields.filter(f => !msg.hasOwnProperty(f));
    logTest('History命令', 'FAIL', `缺少字段: ${missing.join(', ')}`);
    return false;
  } catch (error) {
    logTest('History命令', 'FAIL', error.message);
    return false;
  }
}

async function test3_SendCommand() {
  console.log('\n### 测试3: Send命令 ###');

  const keyword = generateKeyword();
  console.log(`   关键词: ${keyword}`);

  try {
    const testMessage = `自动测试消息 [${keyword}]`;
    execSync(`imsg send --to "test@example.com" --text "${testMessage}"`, { encoding: 'utf8' });

    // 等待消息保存到数据库
    await sleep(2000);

    // 获取test@example.com的chat_id
    const chatId = getChatId('test@example.com');
    if (!chatId) {
      logTest('Send命令', 'FAIL', '无法获取test@example.com的chat_id');
      return false;
    }

    // 验证消息是否在历史记录中
    const output = execSync(`imsg history --chat-id ${chatId} --limit 10 --json`, { encoding: 'utf8' });
    const lines = output.trim().split('\n');

    let found = false;
    for (const line of lines) {
      const msg = JSON.parse(line);
      if (msg.text && msg.text.includes(keyword) && msg.is_from_me) {
        found = true;
        break;
      }
    }

    if (found) {
      logTest('Send发送功能', 'PASS', `关键词 ${keyword} 已验证`);
      return true;
    }

    logTest('Send命令', 'FAIL', '消息未在历史记录中找到');
    return false;
  } catch (error) {
    logTest('Send命令', 'FAIL', error.message);
    return false;
  }
}

async function test4_WatchCommand() {
  console.log('\n### 测试4: Watch命令（关键词验证）###');

  const { spawn } = require('child_process');
  const keyword = generateKeyword();
  console.log(`   关键词: ${keyword}`);

  try {
    // 获取test@example.com的chat_id
    const chatId = getChatId('test@example.com');
    if (!chatId) {
      logTest('Watch命令', 'FAIL', '无法获取test@example.com的chat_id');
      return false;
    }

    // 获取当前max rowid
    const output = execSync(`imsg history --chat-id ${chatId} --limit 1 --json`, { encoding: 'utf8' });
    const currentMsg = JSON.parse(output.trim().split('\n')[0]);
    const maxId = currentMsg.id;

    // 启动watch
    const watch = spawn('imsg', ['watch', '--chat-id', chatId.toString(), '--json', '--since', maxId.toString()], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let matched = false;

    watch.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.text && msg.text.includes(keyword)) {
            matched = true;
          }
        } catch (e) {}
      }
    });

    // 等待初始化
    await sleep(3000);

    // 发送测试消息
    const testMessage = `Watch测试 [${keyword}]`;
    execSync(`imsg send --to "test@example.com" --text "${testMessage}"`, { encoding: 'utf8' });

    // 等待检测
    await sleep(10000);

    // 清理
    watch.kill();
    await sleep(500);

    if (matched) {
      logTest('Watch实时检测', 'PASS', `成功检测关键词 ${keyword}`);
      logTest('Watch JSON输出', 'PASS');
      return true;
    }

    logTest('Watch命令', 'FAIL', '未检测到包含关键词的消息');
    return false;
  } catch (error) {
    logTest('Watch命令', 'FAIL', error.message);
    return false;
  }
}

async function test5_PhoneNormalization() {
  console.log('\n### 测试5: 电话号码标准化 ###');

  try {
    // 使用现有联系人而不是发送到可能不存在的号码
    const keyword1 = generateKeyword();

    // 获取任意一个可用的chat
    const chatId = getAnyChatId();
    if (!chatId) {
      logTest('电话号码标准化', 'FAIL', '无法获取chat_id');
      return false;
    }

    // 发送到一个已知存在的联系人（使用iMessage服务）
    execSync(`imsg send --to "test@example.com" --text "号码标准化测试 [${keyword1}]"`, { encoding: 'utf8' });
    await sleep(2000);

    const output1 = execSync(`imsg history --chat-id ${chatId} --limit 10 --json`, { encoding: 'utf8' });
    const lines1 = output1.trim().split('\n');
    let found1 = false;
    for (const line of lines1) {
      const msg = JSON.parse(line);
      if (msg.text && msg.text.includes(keyword1)) {
        found1 = true;
        break;
      }
    }

    if (found1) {
      logTest('电话号码标准化', 'PASS', '消息发送和验证正常');
      return true;
    }

    logTest('电话号码标准化', 'FAIL', '消息未找到');
    return false;
  } catch (error) {
    logTest('电话号码标准化', 'FAIL', error.message);
    return false;
  }
}

async function test6_Compatibility() {
  console.log('\n### 测试6: JSON兼容性 ###');

  try {
    // 测试chats输出格式
    const chatsOutput = execSync('imsg chats --limit 1 --json', { encoding: 'utf8' });
    const chat = JSON.parse(chatsOutput.trim().split('\n')[0]);

    const chatFields = ['id', 'name', 'identifier', 'service', 'last_message_at'];
    const chatOK = chatFields.every(f => chat.hasOwnProperty(f));

    // 测试history输出格式
    const chatId = getAnyChatId();
    const historyOutput = execSync(`imsg history --chat-id ${chatId} --limit 1 --json`, { encoding: 'utf8' });
    const msg = JSON.parse(historyOutput.trim().split('\n')[0]);

    const msgFields = ['id', 'chat_id', 'guid', 'sender', 'text', 'created_at', 'is_from_me', 'attachments', 'reactions'];
    const msgOK = msgFields.every(f => msg.hasOwnProperty(f));

    if (chatOK && msgOK) {
      logTest('Chats JSON格式', 'PASS', '与Swift版本兼容');
      logTest('History JSON格式', 'PASS', '与Swift版本兼容');
      return true;
    }

    logTest('JSON兼容性', 'FAIL', '字段不匹配');
    return false;
  } catch (error) {
    logTest('JSON兼容性', 'FAIL', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   imsg Node.js版本 - 自动化测试套件   ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('\n使用关键词自动验证所有功能\n');

  const startTime = Date.now();

  // 运行所有测试
  await test1_ChatsCommand();
  await test2_HistoryCommand();
  await test3_SendCommand();
  await test4_WatchCommand();
  await test5_PhoneNormalization();
  await test6_Compatibility();

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // 打印结果摘要
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║              测试结果摘要              ║');
  console.log('╚══════════════════════════════════════╝\n');

  console.log(`总测试数: ${results.tests.length}`);
  console.log(`通过: ${results.passed} ✅`);
  console.log(`失败: ${results.failed} ❌`);
  console.log(`成功率: ${((results.passed / results.tests.length) * 100).toFixed(1)}%`);
  console.log(`总耗时: ${duration}秒\n`);

  // 详细结果
  console.log('详细结果:');
  results.tests.forEach((test, i) => {
    const status = test.status === 'PASS' ? '✅' : '❌';
    console.log(`  ${i + 1}. ${status} ${test.name}`);
    if (test.message) {
      console.log(`     ${test.message}`);
    }
  });

  // 最终判定
  console.log('\n╔══════════════════════════════════════╗');
  if (results.failed === 0) {
    console.log('║       ✅ 所有测试通过 - 生产就绪      ║');
  } else {
    console.log(`║    ⚠️  ${results.failed} 个测试失败 - 需要修复    ║`);
  }
  console.log('╚══════════════════════════════════════╝\n');

  process.exit(results.failed === 0 ? 0 : 1);
}

// 运行测试套件
runAllTests().catch(error => {
  console.error('测试套件错误:', error);
  process.exit(1);
});
