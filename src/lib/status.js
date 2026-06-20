/**
 * U1: capability payload for `imsg status --json` and the `status` RPC method.
 *
 * Single source of truth — both the CLI command and the RPC handler call
 * getStatusPayload() so OpenClaw cannot observe a divergence between
 * `imsg status --json` (probe phase) and `{"method":"status"}` (post-spawn).
 *
 * Schema 100% aligned with upstream openclaw/imsg StatusPayload (Swift) field
 * names; values reflect what the macOS 11+ / AppleScript-only path can
 * honestly support. Unsupported / bridge-only capabilities report `false` /
 * `0` / `{}` so OpenClaw degrades gracefully instead of pretending features
 * are present.
 */

const path = require('path');

// Read version once at module load (cheap; package.json doesn't change at
// runtime). Kept here so the CLI / RPC paths and `program.version()` can
// all converge on a single declared version next time we touch index.js.
let cachedVersion = '0.0.0';
try {
  cachedVersion = require(path.join(__dirname, '..', '..', 'package.json')).version;
} catch (_) {
  // Fall back to 0.0.0 if package.json unreadable for any reason.
}

/**
 * Methods this build of imsg-legacy actually implements over RPC.
 * U7 sends structured `not_supported` for bridge methods deliberately
 * excluded from this list — OpenClaw treats methods absent from
 * `rpc_methods` as unavailable, the not_supported response is belt-and-
 * suspenders for the case where OpenClaw calls them anyway.
 */
const SUPPORTED_RPC_METHODS = Object.freeze([
  'chats.list',
  'messages.history',
  'watch.subscribe',
  'watch.unsubscribe',
  'send',
  'status'
]);

function getSupportedRpcMethods() {
  return [...SUPPORTED_RPC_METHODS];
}

/**
 * Build the StatusPayload object. Does NOT touch the database — status
 * must remain probeable even when chat.db is unreadable (FDA case),
 * so OpenClaw can still see capability info and produce a useful UI.
 */
function getStatusPayload() {
  return {
    version: cachedVersion,
    basic_features: true,           // chats / history / send / watch via AppleScript + read-only db
    advanced_features: false,       // requires IMCore private-API bridge (macOS 14+) — not portable
    typing_indicators: false,
    read_receipts: false,
    sip: 'unknown',                 // imsg-legacy does not probe System Integrity Protection state
    message: 'imsg-legacy on Node.js (AppleScript path, macOS 11+ / Big Sur and later)',
    bridge_version: 0,
    v2_ready: false,
    selectors: {},
    rpc_methods: getSupportedRpcMethods()
  };
}

module.exports = {
  getStatusPayload,
  getSupportedRpcMethods,
  SUPPORTED_RPC_METHODS
};
