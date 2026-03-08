const MessageStore = require('../lib/database');

/**
 * Chats command - List recent conversations
 */
module.exports = function(program) {
  program
    .command('chats')
    .description('List recent conversations')
    .option('-l, --limit <number>', 'Limit number of chats', '20')
    .option('-j, --json', 'Output in JSON format (JSONL)')
    .action(async (options) => {
      try {
        const store = new MessageStore();
        await store.connect();
        const chats = await store.listChats(parseInt(options.limit));

        if (options.json) {
          chats.forEach(chat => console.log(JSON.stringify(chat)));
        } else {
          console.log('Recent conversations:');
          chats.forEach(chat => {
            const serviceName = chat.service === 'iMessage' ? 'iMessage' : chat.service;
            console.log(`  [${chat.id}] ${chat.name} (${chat.identifier}) - ${serviceName}`);
          });
        }

        store.close();
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });
};
