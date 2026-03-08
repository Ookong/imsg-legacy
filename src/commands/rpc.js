const MessageStore = require('../lib/database');
const RPCServer = require('../lib/rpc-server');

/**
 * RPC command - Run JSON-RPC over stdin/stdout
 * This is the main entry point for OpenClaw integration
 */
module.exports = function(program) {
  program
    .command('rpc')
    .description('Run JSON-RPC server over stdin/stdout (for OpenClaw integration)')
    .option('-d, --db <path>', 'Path to Messages database')
    .action(async (options) => {
      try {
        const store = new MessageStore(options.db);
        await store.connect();

        const server = new RPCServer(store);

        // Handle shutdown gracefully
        process.on('SIGINT', () => {
          store.close();
          process.exit(0);
        });

        process.on('SIGTERM', () => {
          store.close();
          process.exit(0);
        });

        // Run the server (blocks until stdin closes)
        await server.run();

        store.close();
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });
};
