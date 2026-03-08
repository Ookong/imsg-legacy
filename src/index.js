#!/usr/bin/env node

const { program } = require('commander');

// Register commands
require('./commands/chats')(program);
require('./commands/history')(program);
require('./commands/send')(program);
require('./commands/watch')(program);
require('./commands/rpc')(program);

// Version and help
program.version('1.0.0');
program.description('iMessage CLI tool for macOS 11+ (Big Sur)');

program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
