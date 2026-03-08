const MessageStore = require('../lib/database');
const MessageWatcher = require('../lib/watcher');

/**
 * Watch command - Watch for new messages
 */
module.exports = function(program) {
  program
    .command('watch')
    .description('Watch for new messages')
    .option('-c, --chat-id <id>', 'Watch specific chat')
    .option('-j, --json', 'Output in JSON format (JSONL)')
    .option('-d, --debounce <ms>', 'Debounce interval in ms', '250')
    .option('-l, --limit <number>', 'Batch limit for polling', '100')
    .option('-s, --since <rowid>', 'Start from rowid')
    .action(async (options) => {
      try {
        const store = new MessageStore();
        await store.connect();
        const watcher = new MessageWatcher(store);

        await watcher.start({
          chatId: options.chatId ? parseInt(options.chatId) : null,
          debounceMs: parseInt(options.debounce),
          batchLimit: parseInt(options.limit),
          sinceRowID: options.since ? parseInt(options.since) : null
        });

        watcher.on('message', (message) => {
          if (options.json) {
            console.log(JSON.stringify(message));
          } else {
            const sender = message.is_from_me ? 'Me' : message.sender;
            const dateStr = new Date(message.created_at).toLocaleString();
            const attachmentInfo = message.attachments.length > 0 ? ` [${message.attachments.length} attachment(s)]` : '';
            console.log(`[NEW] [${dateStr}] ${sender}: ${message.text}${attachmentInfo}`);
          }
        });

        watcher.on('error', (error) => {
          console.error('Watcher error:', error.message);
        });

        // Keep running
        process.on('SIGINT', () => {
          console.log('\nStopping watcher...');
          watcher.stop();
          store.close();
          process.exit(0);
        });

      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });
};
