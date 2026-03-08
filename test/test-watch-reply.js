#!/usr/bin/env node
/**
 * 双向watch测试 - 发送消息并等待特定关键词的回复
 *
 * 测试流程：
 * 1. 生成随机关键词
 * 2. 启动watch监控
 * 3. 发送"请回复：关键词"的消息
 * 4. 等待接收包含关键词的回复
 * 5. 验证watch是否检测到回复
 */

const { spawn } = require('child_process');
const { execSync } = require('child_process');
const crypto = require('crypto');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateKeyword() {
  return `VERIFY-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function main() {
  console.log('=== 双向Watch测试（发送+回复验证）===\n');

  // Step 1: 生成关键词
  const keyword = generateKeyword();
  console.log(`1. 生成验证关键词: ${keyword}`);
  console.log(`   请在收到消息后回复包含 "${keyword}" 的内容`);

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

  let allMessages = [];
  let sentMessage = null;
  let replyMessage = null;

  watch.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        allMessages.push(msg);

        // 识别发送的消息（包含关键词）
        if (!sentMessage && msg.text && msg.text.includes(keyword) && msg.is_from_me) {
          sentMessage = msg;
          console.log(`   ✅ 检测到发送的消息 [ID:${msg.id}]`);
        }

        // 识别回复（包含关键词且不是自己发的）
        if (!replyMessage && msg.text && msg.text.includes(keyword) && !msg.is_from_me) {
          replyMessage = msg;
          console.log(`   ✅ 检测到回复消息 [ID:${msg.id}]`);
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
  });

  watch.stderr.on('data', (data) => {
    // 忽略stderr
  });

  // Step 4: 等待watch初始化
  console.log('   等待watch初始化（3秒）...');
  await sleep(3000);

  // Step 5: 发送请求回复的消息
  console.log('\n4. 发送请求回复的消息...');
  const testMessage = `请回复此消息，包含验证码：${keyword}`;
  console.log(`   消息内容: ${testMessage}`);

  try {
    execSync(`imsg send --to "test@example.com" --text "${testMessage}"`, { encoding: 'utf8' });
    console.log('   ✅ 消息已发送');
  } catch (error) {
    console.error('   ❌ 发送失败:', error.message);
    watch.kill();
    process.exit(1);
  }

  // Step 6: 等待回复
  console.log('\n5. 等待接收回复（最多60秒）...');
  console.log(`   请手动回复消息，内容需包含 "${keyword}"`);

  let waitedSeconds = 0;
  const checkInterval = setInterval(() => {
    waitedSeconds += 1;
    if (waitedSeconds % 5 === 0 && waitedSeconds <= 60) {
      console.log(`   等待中... ${waitedSeconds}秒`);

      if (sentMessage && !replyMessage) {
        console.log(`   ⏳ 已检测到发送的消息，等待回复...`);
      }
    }

    if (replyMessage) {
      console.log(`   ✅ 收到回复！用时: ${waitedSeconds}秒`);
      clearInterval(checkInterval);
    }
  }, 1000);

  // 等待最多60秒
  await sleep(60000);
  clearInterval(checkInterval);

  // Step 7: 验证结果
  console.log('\n=== 测试结果 ===');
  console.log(`检测到的消息总数: ${allMessages.length}`);
  console.log(`发送的消息: ${sentMessage ? '✅ 已检测到' : '❌ 未检测到'}`);
  console.log(`回复的消息: ${replyMessage ? '✅ 已检测到' : '❌ 未检测到'}`);

  if (sentMessage) {
    console.log('\n发送的消息详情:');
    console.log(`  ID: ${sentMessage.id}`);
    console.log(`  内容: ${sentMessage.text}`);
    console.log(`  时间: ${sentMessage.created_at}`);
  }

  if (replyMessage) {
    console.log('\n回复的消息详情:');
    console.log(`  ID: ${replyMessage.id}`);
    console.log(`  发送者: ${replyMessage.sender}`);
    console.log(`  内容: ${replyMessage.text}`);
    console.log(`  时间: ${replyMessage.created_at}`);
    console.log(`  包含关键词 "${keyword}": ✅`);
  }

  // 判定结果
  console.log('\n=== 最终判定 ===');

  if (sentMessage && replyMessage) {
    console.log('✅ 完美！双向测试通过');
    console.log('   - 成功检测到发送的消息');
    console.log('   - 成功检测到回复的消息');
    console.log('   - watch功能完全正常');
  } else if (sentMessage && !replyMessage) {
    console.log('⚠️  部分通过');
    console.log('   - 成功检测到发送的消息');
    console.log('   - 未收到回复（可能对方未回复）');
    console.log('   - watch发送检测功能正常');
  } else if (!sentMessage && replyMessage) {
    console.log('⚠️  部分通过');
    console.log('   - 成功检测到回复的消息');
    console.log('   - 未检测到发送的消息（可能太快）');
    console.log('   - watch接收检测功能正常');
  } else {
    console.log('❌ 测试失败');
    console.log('   - 既未检测到发送，也未检测到回复');
    console.log('   - watch功能可能存在问题');

    if (allMessages.length > 0) {
      console.log('\n检测到的其他消息:');
      allMessages.forEach((msg, i) => {
        console.log(`  ${i + 1}. [ID:${msg.id}] ${msg.is_from_me ? 'Me' : msg.sender}: ${msg.text.substring(0, 50)}`);
      });
    }
  }

  // Cleanup
  console.log('\n清理中...');
  watch.kill();
  await sleep(500);

  process.exit((sentMessage || replyMessage) ? 0 : 1);
}

main().catch(error => {
  console.error('测试错误:', error);
  process.exit(1);
});
