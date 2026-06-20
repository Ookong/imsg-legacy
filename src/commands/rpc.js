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
    // U9: OpenClaw 6.8 always spawns `imsg rpc --json` (per upstream
    // openclaw/imsg v0.11.0 contract). The flag is a "I will only emit
    // JSON" declaration — and imsg-legacy's RPC server already emits
    // strict JSONL on stdout (and, per U3, a JSON-RPC error envelope on
    // startup failure). Accepting the flag but ignoring its effect is
    // the correct compat move; refusing it (commander's default) makes
    // OpenClaw see `unknown option` and exit 1.
    .option('--json', 'Emit strict JSONL on stdout (default behavior; flag accepted for OpenClaw 6.8 compatibility)')
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
