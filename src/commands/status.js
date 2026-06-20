const { getStatusPayload } = require('../lib/status');

/**
 * U1: `imsg status --json` — capability probe target for OpenClaw 2026.5.12.
 *
 * OpenClaw's probe spawns `imsg status --json` early to discover what the
 * binary can do (version, rpc_methods, advanced_features, etc.) and caches
 * the result. Must exit 0 even when chat.db is unreachable — capability
 * info should be probeable independently of db access.
 */
module.exports = function (program) {
  program
    .command('status')
    .description('Print capability / version JSON payload (probe target for OpenClaw)')
    .option('--json', 'Output JSON (default)', true)
    .option('--human', 'Output human-readable form instead of JSON')
    .action((options) => {
      try {
        const payload = getStatusPayload();

        if (options.human) {
          for (const [k, v] of Object.entries(payload)) {
            console.log(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
          }
        } else {
          console.log(JSON.stringify(payload));
        }
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });
};
