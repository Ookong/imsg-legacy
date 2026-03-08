#!/usr/bin/env node
/**
 * 自动化watch测试 - 使用关键词验证
 *
 * 测试流程：
 * 1. 生成随机关键词作为"验证码"
 * 2. 启动watch监控
 * 3. 发送包含关键词的测试消息
 * 4. 验证watch是否检测到包含该关键词的消息
 * 5. 自动判定测试结果
 */

const { spawn } = require('child_process');
const { execSync } = require('child_process');
const crypto = require('crypto');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 生成随机关键词
function generateKeyword() {
  return `TEST-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function main() {
  console.log('=== Watch自动化测试（关键词验证）===\n');

  // Step 1: 生成关键词
  const keyword = generateKeyword();
  console.log(`1. 生成验证关键词: ${keyword}`);

  // Step 2: 获取当前max rowid
  console.log('\n2. 获取当前消息ID...');
  const output = execSync('imsg history --chat-id 7 --limit 1 --json', { encoding: 'utf8' });
  const currentMsg = JSON.parse(output.trim().split('\n')[0]);
  const maxId = currentMsg.id;
  console.log(`   当前最大ID: ${maxId}`);

  // Step 3: 启动watch
  console.log('\n3. 启动watch监控...');
  const watch = spawn('imsg', ['watch', '--chat-id', '7', '--json', '--since', maxId.toString()], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let detectedMessages = [];
  let matchedMessage = null;

  watch.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        detectedMessages.push(msg);

        // 检查是否包含关键词
        if (msg.text && msg.text.includes(keyword)) {
          matchedMessage = msg;
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
  });

  watch.stderr.on('data', (data) => {
    // 忽略stderr输出
  });

  // Step 4: 等待watch初始化
  console.log('   等待watch初始化（3秒）...');
  await sleep(3000);

  // Step 5: 发送包含关键词的测试消息
  console.log('\n4. 发送包含关键词的测试消息...');
  const testMessage = `Watch测试消息 [验证码:${keyword}]`;
  console.log(`   消息内容: ${testMessage}`);

  try {
    execSync(`imsg send --to "test@example.com" --text "${testMessage}"`, { encoding: 'utf8' });
    console.log('   ✅ 消息已发送');
  } catch (error) {
    console.error('   ❌ 发送失败:', error.message);
    watch.kill();
    process.exit(1);
  }

  // Step 6: 等待检测
  console.log('\n5. 等待watch检测消息（10秒）...');
  const checkInterval = setInterval(() => {
    if (matchedMessage) {
      console.log('   ✅ 检测到包含关键词的消息！');
      clearInterval(checkInterval);
    }
  }, 1000);

  await sleep(10000);
  clearInterval(checkInterval);

  // Step 7: 验证结果
  console.log('\n=== 测试结果 ===');
  console.log(`检测到的消息数: ${detectedMessages.length}`);
  console.log(`包含关键词 "${keyword}": ${matchedMessage ? '✅ 是' : '❌ 否'}`);

  if (matchedMessage) {
    console.log('\n✅ 测试通过！');
    console.log('\n匹配的消息详情:');
    console.log(`  ID: ${matchedMessage.id}`);
    console.log(`  发送者: ${matchedMessage.sender}`);
    console.log(`  内容: ${matchedMessage.text}`);
    console.log(`  时间: ${matchedMessage.created_at}`);
    console.log(`  关键词: ${keyword}`);
  } else {
    console.log('\n❌ 测试失败！');
    console.log(`\n未检测到包含关键词 "${keyword}" 的消息`);

    if (detectedMessages.length > 0) {
      console.log('\n检测到的消息:');
      detectedMessages.forEach((msg, i) => {
        console.log(`  ${i + 1}. [ID:${msg.id}] ${msg.text.substring(0, 50)}`);
      });
    } else {
      console.log('\n⚠️  没有检测到任何新消息');
      console.log('   可能的原因:');
      console.log('   - watch进程未正常启动');
      console.log('   - 数据库文件变化未被检测到');
      console.log('   - 消息尚未写入数据库');
    }
  }

  // Cleanup
  console.log('\n清理中...');
  watch.kill();
  await sleep(500);

  process.exit(matchedMessage ? 0 : 1);
}

main().catch(error => {
  console.error('测试错误:', error);
  process.exit(1);
});
