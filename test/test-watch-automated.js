#!/usr/bin/env node
/**
 * Automated watch test with better timing
 */

const { spawn } = require('child_process');
const { execSync } = require('child_process');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Automated Watch Test ===\n');

  // Step 1: Get current max ID
  console.log('1. Getting current max message ID...');
  const output = execSync('imsg history --chat-id 7 --limit 1 --json', { encoding: 'utf8' });
  const currentMsg = JSON.parse(output.trim().split('\n')[0]);
  const maxId = currentMsg.id;
  console.log(`   Current max ID: ${maxId}\n`);

  // Step 2: Start watch process
  console.log('2. Starting watch process...');
  const watch = spawn('imsg', ['watch', '--chat-id', '7', '--json', '--since', maxId.toString()], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let messagesReceived = [];
  let debugOutput = [];

  watch.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(line => line.trim());
    for (const line of lines) {
      if (!line.startsWith('[DEBUG]')) {
        try {
          const msg = JSON.parse(line);
          messagesReceived.push(msg);
          console.log(`   ✅ NEW MESSAGE: ${msg.text.substring(0, 50)}`);
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  });

  watch.stderr.on('data', (data) => {
    const text = data.toString();
    debugOutput.push(text);
    if (text.includes('[DEBUG]')) {
      console.log(`   [WATCH] ${text.trim()}`);
    }
  });

  // Wait for watch to be ready
  console.log('   Waiting for watch to initialize...');
  await sleep(3000);

  // Step 3: Send test message
  console.log('\n3. Sending test message...');
  try {
    execSync('imsg send --to "test@example.com" --text "自动化Watch测试"', { encoding: 'utf8' });
    console.log('   Message sent\n');
  } catch (error) {
    console.error('   Error sending message:', error.message);
  }

  // Step 4: Wait for detection
  console.log('4. Waiting for watch to detect message (8 seconds)...');
  await sleep(8000);

  // Step 5: Results
  console.log('\n=== Test Results ===');
  console.log(`Messages received: ${messagesReceived.length}`);
  if (messagesReceived.length > 0) {
    console.log('✅ SUCCESS: Watch detected new message(s)');
    messagesReceived.forEach((msg, i) => {
      console.log(`   ${i + 1}. ID=${msg.id}, Text="${msg.text}"`);
    });
  } else {
    console.log('❌ FAILED: No messages detected');
    console.log('\nDebug output:');
    debugOutput.forEach(line => {
      if (line.trim()) console.log(`  ${line.trim()}`);
    });
  }

  // Cleanup
  console.log('\nStopping watch...');
  watch.kill();
  await sleep(500);

  process.exit(messagesReceived.length > 0 ? 0 : 1);
}

main().catch(error => {
  console.error('Test error:', error);
  process.exit(1);
});
