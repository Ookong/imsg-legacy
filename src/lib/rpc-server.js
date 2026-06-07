const readline = require('readline');
const MessageWatcher = require('./watcher');
const MessageSender = require('./sender');
const { getStatusPayload } = require('./status');

/**
 * Bridge-only methods upstream openclaw/imsg exposes via its IMCore
 * private-API bridge. imsg-legacy serves macOS 11+ via AppleScript and
 * cannot implement these. We return a structured "not supported"
 * response (data.supported=false) instead of METHOD_NOT_FOUND so the
 * OpenClaw client knows it's a deliberate decline, not a stale rpc_methods
 * list. The methods are also absent from `rpc_methods` (see status.js)
 * so a well-behaved client never calls them in the first place — this
 * is the belt-and-suspenders fallback.
 */
const BRIDGE_ONLY_METHODS = new Set([
  'send.rich',
  'send.attachment',
  'tapback',
  'message.edit',
  'message.unsend',
  'message.delete',
  'message.notifyAnyways',
  'handles.check',
  'poll.send',
  'messages.poll.send',
  'message.send_status',
  'typing',
  'read'
]);

/**
 * JSON-RPC 2.0 error codes
 */
const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
};

/**
 * RPCServer - JSON-RPC 2.0 server over stdin/stdout
 * Based on RPCServer.swift from the original imsg project
 */
class RPCServer {
  constructor(store) {
    this.store = store;
    this.subscriptions = new Map();
    this.nextSubscriptionId = 1;
    this.rl = null;
  }

  /**
   * Build a JSON-RPC 2.0 error envelope string for a startup-time failure.
   *
   * v0.8.2 of upstream imsg made stdout strictly JSONL even when the
   * server cannot start: OpenClaw's client reads the first line, and an
   * envelope here lets it surface a parsed error instead of a bare
   * "imsg rpc exited (code 1)". `id` is null per JSON-RPC 2.0 §5.1.
   */
  static buildStartupErrorEnvelope(error) {
    const msg = (error && error.message) || String(error);
    return JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: msg,
        data: { phase: 'startup', stage: 'db_connect' }
      }
    });
  }

  /**
   * Run the RPC server (main loop)
   */
  async run() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    this.rl.on('line', (line) => {
      this.handleLine(line).catch(error => {
        console.error('Error handling line:', error.message);
      });
    });

    this.rl.on('close', () => {
      this.cleanup();
    });

    // Keep the process alive
    return new Promise(() => {});
  }

  /**
   * Handle a single line of input
   */
  async handleLine(line) {
    if (!line.trim()) return;

    let request;
    try {
      request = JSON.parse(line);
    } catch (error) {
      this.sendError(null, {
        code: ERROR_CODES.PARSE_ERROR,
        message: 'Parse error',
        data: error.message
      });
      return;
    }

    // Validate JSON-RPC 2.0 request
    if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      this.sendError(request.id, {
        code: ERROR_CODES.INVALID_REQUEST,
        message: 'Invalid Request',
        data: 'Missing or invalid jsonrpc/version field'
      });
      return;
    }

    // Handle notification (no id field)
    if (request.id === undefined) {
      // Notifications are not used for requests in this implementation
      return;
    }

    try {
      await this.handleRequest(request.id, request.method, request.params || {});
    } catch (error) {
      this.sendError(request.id, {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal error',
        data: error.message
      });
    }
  }

  /**
   * Route request to appropriate handler
   */
  async handleRequest(id, method, params) {
    switch (method) {
      case 'chats.list':
        await this.handleChatsList(id, params);
        break;

      case 'messages.history':
        await this.handleMessagesHistory(id, params);
        break;

      case 'watch.subscribe':
        await this.handleWatchSubscribe(id, params);
        break;

      case 'watch.unsubscribe':
        await this.handleWatchUnsubscribe(id, params);
        break;

      case 'send':
        await this.handleSend(id, params);
        break;

      case 'status':
        await this.handleStatus(id, params);
        break;

      default:
        if (BRIDGE_ONLY_METHODS.has(method)) {
          this.sendNotSupported(id, method);
        } else {
          this.sendError(id, {
            code: ERROR_CODES.METHOD_NOT_FOUND,
            message: 'Method not found',
            data: method
          });
        }
    }
  }

  /**
   * Send a structured "method is known but unsupported on this build"
   * response for bridge-only methods. Different from METHOD_NOT_FOUND
   * (which means "I don't recognize this name"): the client can read
   * data.supported === false and learn that retrying is pointless.
   */
  sendNotSupported(id, method) {
    this.sendError(id, {
      code: ERROR_CODES.METHOD_NOT_FOUND,
      message: 'Method not supported on this build',
      data: {
        method,
        reason:
          'requires IMCore private-API bridge (macOS 14+); imsg-legacy ' +
          'serves the macOS 11+ AppleScript path',
        supported: false
      }
    });
  }

  /**
   * Handle chats.list method
   */
  async handleChatsList(id, params) {
    const limit = params.limit || 20;

    try {
      const chats = await this.store.listChats(limit);

      // Enrich with additional info
      const enrichedChats = [];
      for (const chat of chats) {
        const chatInfo = await this.store.getChatInfo(chat.id);
        const participants = await this.store.getParticipants(chat.id);

        if (chatInfo) {
          enrichedChats.push({
            id: chatInfo.id,
            identifier: chatInfo.identifier,
            guid: chatInfo.guid || '',
            name: chatInfo.name,
            service: chatInfo.service,
            last_message_at: chat.last_message_at ? chat.last_message_at.toISOString() : new Date().toISOString(),
            participants: participants
          });
        }
      }

      this.sendResponse(id, { chats: enrichedChats });
    } catch (error) {
      this.sendError(id, {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list chats',
        data: error.message
      });
    }
  }

  /**
   * U6: enrich messages with group/chat metadata by joining against
   * getChatInfo + getParticipants. Cache per-call to avoid N+1 when a
   * batch contains many messages from the same chat. The cache returned
   * can be re-used across messages by callers (e.g. watch's per-event
   * push) — see this._chatCache for the long-lived variant.
   */
  async enrichMessageWithChatMeta(msg, cache) {
    const chatId = msg.chat_id;
    if (chatId === null || chatId === undefined) {
      return { chat_identifier: '', chat_guid: '', is_group: false, participants: [] };
    }
    if (cache.has(chatId)) return cache.get(chatId);

    let chatInfo = null;
    let participants = [];
    try {
      chatInfo = await this.store.getChatInfo(chatId);
      participants = await this.store.getParticipants(chatId);
    } catch (_) {
      // Best-effort enrichment; never break the response on missing chat.
    }
    const chat_identifier = chatInfo ? chatInfo.identifier || '' : '';
    const chat_guid = chatInfo ? chatInfo.guid || '' : '';
    const is_group =
      (Array.isArray(participants) && participants.length > 1) ||
      // v0.5.0 #42 convention: group chats use ;+; prefix in identifier/guid
      /;\+;/.test(chat_identifier) ||
      /;\+;/.test(chat_guid);

    const meta = { chat_identifier, chat_guid, is_group, participants };
    cache.set(chatId, meta);
    return meta;
  }

  /**
   * Handle messages.history method
   */
  async handleMessagesHistory(id, params) {
    const { chat_id, limit = 50, attachments = false, participants, start, end } = params;

    if (!chat_id) {
      this.sendError(id, {
        code: ERROR_CODES.INVALID_PARAMS,
        message: 'Invalid params',
        data: 'chat_id is required'
      });
      return;
    }

    try {
      const options = {};
      if (participants) {
        options.participants = Array.isArray(participants) ? participants.join(',') : participants;
      }

      const messages = await this.store.getMessages(chat_id, limit, options);

      // U6: enrich with chat metadata so callers can route on
      // is_group / chat_guid without an extra chats.list roundtrip.
      const chatCache = new Map();
      const formattedMessages = [];
      for (const msg of messages) {
        const meta = await this.enrichMessageWithChatMeta(msg, chatCache);
        formattedMessages.push({
          id: msg.id,
          chat_id: msg.chat_id,
          chat_identifier: meta.chat_identifier,
          chat_guid: meta.chat_guid,
          is_group: meta.is_group,
          participants: meta.participants,
          guid: msg.guid || '',
          sender: msg.sender,
          text: msg.text || '',
          created_at: msg.created_at ? msg.created_at.toISOString() : new Date().toISOString(),
          is_from_me: msg.is_from_me,
          attachments: attachments ? msg.attachments || [] : [],
          reactions: msg.reactions || []
        });
      }

      this.sendResponse(id, { messages: formattedMessages });
    } catch (error) {
      this.sendError(id, {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get message history',
        data: error.message
      });
    }
  }

  /**
   * Handle watch.subscribe method
   */
  async handleWatchSubscribe(id, params) {
    const {
      chat_id = null,
      since_rowid,
      participants,
      attachments = false,
      include_reactions = false,
      debounce_ms
    } = params;

    // v0.6.0 contract: client may set debounce_ms; default 500ms (matches
    // upstream's watcher debounce). Clamp tiny values to 50ms so a
    // client-side bug can't turn this into a poll-storm.
    let resolvedDebounceMs = typeof debounce_ms === 'number' ? debounce_ms : 500;
    if (resolvedDebounceMs < 50) resolvedDebounceMs = 50;

    try {
      const watcher = new MessageWatcher(this.store);
      const subscriptionId = this.nextSubscriptionId++;
      // U6: per-subscription chat metadata cache. Long-lived for the
      // life of the subscription; if a chat is renamed mid-session,
      // the old name is displayed until the subscription restarts.
      // Accepted trade-off — see plan U6 Approach + Risks.
      const subChatCache = new Map();

      // Set up message handler
      watcher.on('message', async (message) => {
        const meta = await this.enrichMessageWithChatMeta(message, subChatCache);
        this.sendNotification('message', {
          subscription: subscriptionId,
          message: {
            id: message.id,
            chat_id: message.chat_id,
            chat_identifier: meta.chat_identifier,
            chat_guid: meta.chat_guid,
            is_group: meta.is_group,
            participants: meta.participants,
            guid: message.guid || '',
            sender: message.sender,
            text: message.text || '',
            created_at: message.created_at ? message.created_at.toISOString() : new Date().toISOString(),
            is_from_me: message.is_from_me,
            attachments: attachments ? message.attachments || [] : [],
            reactions: include_reactions ? message.reactions || [] : []
          }
        });
      });

      watcher.on('error', (error) => {
        this.sendNotification('error', {
          subscription: subscriptionId,
          error: error.message
        });
      });

      // Start watching
      const options = {
        chatId: chat_id,
        sinceRowID: since_rowid,
        debounceMs: resolvedDebounceMs
      };

      await watcher.start(options);

      // Store subscription
      this.subscriptions.set(subscriptionId, watcher);

      this.sendResponse(id, { subscription: subscriptionId });
    } catch (error) {
      this.sendError(id, {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to subscribe',
        data: error.message
      });
    }
  }

  /**
   * Handle watch.unsubscribe method
   */
  async handleWatchUnsubscribe(id, params) {
    const { subscription } = params;

    if (!subscription) {
      this.sendError(id, {
        code: ERROR_CODES.INVALID_PARAMS,
        message: 'Invalid params',
        data: 'subscription is required'
      });
      return;
    }

    const watcher = this.subscriptions.get(subscription);
    if (!watcher) {
      this.sendError(id, {
        code: ERROR_CODES.INVALID_PARAMS,
        message: 'Invalid params',
        data: `Subscription ${subscription} not found`
      });
      return;
    }

    try {
      watcher.stop();
      this.subscriptions.delete(subscription);
      this.sendResponse(id, { ok: true });
    } catch (error) {
      this.sendError(id, {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to unsubscribe',
        data: error.message
      });
    }
  }

  /**
   * Handle send method
   */
  async handleSend(id, params) {
    const { to, text, file, service = 'auto', region = 'US', chat_id, chat_identifier, chat_guid } = params;

    // Validate parameters
    if (!to && !chat_id && !chat_identifier && !chat_guid) {
      this.sendError(id, {
        code: ERROR_CODES.INVALID_PARAMS,
        message: 'Invalid params',
        data: 'Either to, chat_id, chat_identifier, or chat_guid is required'
      });
      return;
    }

    if (!text && !file) {
      this.sendError(id, {
        code: ERROR_CODES.INVALID_PARAMS,
        message: 'Invalid params',
        data: 'Either text or file is required'
      });
      return;
    }

    try {
      const sender = new MessageSender();

      const sent = await sender.send({
        recipient: to || '',
        text: text || '',
        attachmentPath: file || '',
        service,
        region,
        chatIdentifier: chat_identifier || '',
        chatGUID: chat_guid || ''
      });

      // U5: surface guid/chat_guid/service on the wire so OpenClaw can
      // ack the send and (when supported) drive message.send_status
      // polling. AppleScript path can't observe a stable message GUID,
      // so guid/id are empty strings rather than missing.
      this.sendResponse(id, {
        ok: true,
        id: sent && sent.id ? sent.id : '',
        guid: sent && sent.guid ? sent.guid : '',
        chat_guid: sent && sent.chat_guid ? sent.chat_guid : (chat_guid || ''),
        service: sent && sent.service ? sent.service : (service || '')
      });
    } catch (error) {
      this.sendError(id, {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to send message',
        data: error.message
      });
    }
  }

  /**
   * Handle status method - returns the same capability payload as
   * `imsg status --json` (single source of truth in src/lib/status.js).
   */
  async handleStatus(id, params) {
    try {
      this.sendResponse(id, getStatusPayload());
    } catch (error) {
      this.sendError(id, {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get status',
        data: error.message
      });
    }
  }

  /**
   * Send a successful response
   */
  sendResponse(id, result) {
    const response = {
      jsonrpc: '2.0',
      id: id,
      result: result
    };
    console.log(JSON.stringify(response));
  }

  /**
   * Send an error response
   */
  sendError(id, error) {
    const response = {
      jsonrpc: '2.0',
      id: id,
      error: {
        code: error.code,
        message: error.message
      }
    };

    if (error.data) {
      response.error.data = error.data;
    }

    console.log(JSON.stringify(response));
  }

  /**
   * Send a notification (no id, for watch events)
   */
  sendNotification(method, params) {
    const notification = {
      jsonrpc: '2.0',
      method: method,
      params: params
    };
    console.log(JSON.stringify(notification));
  }

  /**
   * Clean up resources
   */
  cleanup() {
    // Stop all watchers
    for (const [id, watcher] of this.subscriptions) {
      watcher.stop();
    }
    this.subscriptions.clear();

    // Close database
    if (this.store) {
      this.store.close();
    }
  }
}

module.exports = RPCServer;
