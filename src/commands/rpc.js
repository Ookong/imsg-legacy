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
        // v0.8.2 behavior: imsg rpc stdout must stay strict JSONL even on
        // startup failure, so OpenClaw's stdin reader sees a structured
        // JSON-RPC 2.0 error envelope (id: null) instead of "imsg rpc
        // exited (code 1)" with no detail. Stderr still carries the
        // human-readable diagnostic — which (after U2) contains the FDA
        // keywords OpenClaw's normalizer matches on.
        process.stdout.write(RPCServer.buildStartupErrorEnvelope(error) + '\n');
        console.error('Error:', error.message);
        process.exit(1);
      }
    });
};
