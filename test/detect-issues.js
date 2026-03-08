#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== 自动检测问题 ===\n');

let issuesFound = 0;
let issuesFixed = 0;

// 检查1: package.json配置
console.log('1. 检查package.json配置...');
const pkgPath = './package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (pkg.name !== 'imsg') {
  console.log('❌ 包名错误:', pkg.name);
  console.log('   应该是: imsg');
  issuesFound++;
} else {
  console.log('✅ 包名正确:', pkg.name);
}

if (pkg.bin && pkg.bin.imsg) {
  console.log('✅ bin配置正确');
} else {
  console.log('❌ bin配置缺失');
  console.log('   当前配置:', pkg.bin);
  issuesFound++;
}

// 检查版本
if (pkg.version) {
  console.log('✅ 版本号:', pkg.version);
} else {
  console.log('❌ 版本号缺失');
  issuesFound++;
}

// 检查2: 命令文件存在性
console.log('\n2. 检查命令文件...');
const commands = ['chats', 'history', 'send', 'watch'];
commands.forEach(cmd => {
  const file = `./src/commands/${cmd}.js`;
  if (fs.existsSync(file)) {
    console.log(`✅ ${cmd}.js 存在`);
  } else {
    console.log(`❌ ${cmd}.js 缺失`);
    issuesFound++;
  }
});

// 检查3: 库文件存在性
console.log('\n3. 检查库文件...');
const libs = ['database', 'sender', 'watcher', 'normalizer'];
libs.forEach(lib => {
  const file = `./src/lib/${lib}.js`;
  if (fs.existsSync(file)) {
    console.log(`✅ ${lib}.js 存在`);
  } else {
    console.log(`❌ ${lib}.js 缺失`);
    issuesFound++;
  }
});

// 检查4: 入口文件
console.log('\n4. 检查入口文件...');
if (fs.existsSync('./src/index.js')) {
  console.log('✅ src/index.js 存在');

  // 检查是否有shebang
  const indexContent = fs.readFileSync('./src/index.js', 'utf8');
  if (indexContent.startsWith('#!/usr/bin/env node')) {
    console.log('✅ Shebang行正确');
  } else {
    console.log('❌ Shebang行缺失');
    issuesFound++;
  }
} else {
  console.log('❌ src/index.js 缺失');
  issuesFound++;
}

// 检查5: 运行基本命令
console.log('\n5. 运行基本命令...');
try {
  const version = execSync('imsg --version', { encoding: 'utf8', stdio: 'pipe' }).trim();
  console.log('✅ imsg命令可用, 版本:', version);
} catch (e) {
  console.log('❌ imsg命令不可用');
  console.log('   错误:', e.message);
  issuesFound++;
}

try {
  execSync('imsg chats --limit 1', { stdio: 'pipe' });
  console.log('✅ chats命令正常');
} catch (e) {
  console.log('❌ chats命令失败');
  console.log('   错误:', e.message);
  issuesFound++;
}

try {
  execSync('imsg history --chat-id 1 --limit 1', { stdio: 'pipe' });
  console.log('✅ history命令正常');
} catch (e) {
  // chat-id 1可能不存在，但不一定是命令错误
  console.log('⚠️  history命令测试（chat-id 1可能不存在）');
}

// 检查6: 依赖安装
console.log('\n6. 检查依赖安装...');
const criticalDeps = ['better-sqlite3', 'chokidar', 'commander'];
criticalDeps.forEach(dep => {
  try {
    require.resolve(dep);
    console.log(`✅ ${dep} 已安装`);
  } catch (e) {
    console.log(`❌ ${dep} 未安装`);
    issuesFound++;
  }
});

// 检查7: 文档文件
console.log('\n7. 检查文档文件...');
const docs = ['README.md', 'CHANGELOG.md', 'LICENSE'];
docs.forEach(doc => {
  if (fs.existsSync(`./${doc}`)) {
    console.log(`✅ ${doc} 存在`);
  } else {
    console.log(`⚠️  ${doc} 缺失`);
  }
});

// 检查8: git状态（如果在git仓库中）
console.log('\n8. 检查git状态...');
try {
  const gitStatus = execSync('git status --porcelain', { encoding: 'utf8', stdio: 'pipe' });
  if (gitStatus.trim()) {
    console.log('⚠️  有未提交的更改');
  } else {
    console.log('✅ 工作目录干净');
  }
} catch (e) {
  console.log('⚠️  不是git仓库或git不可用');
}

// 检查9: 测试文件
console.log('\n9. 检查测试文件...');
const testFiles = ['test-suite.js', 'test-watch-keyword.js'];
testFiles.forEach(test => {
  if (fs.existsSync(`./${test}`)) {
    console.log(`✅ ${test} 存在`);
  } else {
    console.log(`⚠️  ${test} 缺失`);
  }
});

// 检查10: JSON输出格式
console.log('\n10. 检查JSON输出格式...');
try {
  const chatsOutput = execSync('imsg chats --limit 1 --json', { encoding: 'utf8', stdio: 'pipe' });
  const chat = JSON.parse(chatsOutput.trim());

  const requiredFields = ['id', 'name', 'identifier', 'service', 'last_message_at'];
  const missingFields = requiredFields.filter(field => !(field in chat));

  if (missingFields.length === 0) {
    console.log('✅ Chats JSON格式正确，包含所有必需字段');
  } else {
    console.log('❌ Chats JSON格式缺失字段:', missingFields.join(', '));
    issuesFound++;
  }
} catch (e) {
  console.log('❌ 无法验证Chats JSON格式');
  console.log('   错误:', e.message);
  issuesFound++;
}

// 总结
console.log('\n' + '='.repeat(50));
console.log('=== 检测完成 ===');
console.log('='.repeat(50));
console.log(`发现的问题: ${issuesFound}`);
console.log(`修复的问题: ${issuesFixed}`);

if (issuesFound === 0) {
  console.log('\n✅ 没有发现问题！项目状态良好。');
} else {
  console.log(`\n⚠️  发现 ${issuesFound} 个问题需要修复。`);
  console.log('\n建议的修复步骤:');
  console.log('1. 运行 npm install 确保所有依赖已安装');
  console.log('2. 运行 npm link 确保全局命令可用');
  console.log('3. 检查错误消息并修复相应问题');
  console.log('4. 重新运行此脚本验证修复');
}

process.exit(issuesFound > 0 ? 1 : 0);
