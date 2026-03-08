const MessageStore = require('../lib/database');

/**
 * History command - View message history
 */
module.exports = function(program) {
  program
    .command('history')
    .description('View message history')
    .requiredOption('-c, --chat-id <id>', 'Chat ID')
    .option('-l, --limit <number>', 'Limit number of messages', '50')
    .option('-j, --json', 'Output in JSON format (JSONL)')
    .option('-p, --participants <list>', 'Filter by participants (comma-separated)')
    .option('-s, --since <rowid>', 'Start from rowid')
    .action(async (options) => {
      try {
        const store = new MessageStore();
        await store.connect();
        const messages = await store.getMessages(parseInt(options.chatId), parseInt(options.limit), {
          since: options.since ? parseInt(options.since) : null,
          participants: options.participants
        });

        if (options.json) {
          messages.forEach(msg => console.log(JSON.stringify(msg)));
        } else {
          console.log(`Messages in chat ${options.chatId}:`);
          messages.forEach(msg => {
            const sender = msg.is_from_me ? 'Me' : msg.sender;
            const dateStr = new Date(msg.created_at).toLocaleString();
            const attachmentInfo = msg.attachments && msg.attachments.length > 0 ? ` [${msg.attachments.length} attachment(s)]` : '';
            console.log(`  [${dateStr}] ${sender}: ${msg.text}${attachmentInfo}`);
          });
        }

        store.close();
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });
};
