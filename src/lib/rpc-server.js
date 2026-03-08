const readline = require('readline');
const MessageWatcher = require('./watcher');
const MessageSender = require('./sender');

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

      default:
        this.sendError(id, {
          code: ERROR_CODES.METHOD_NOT_FOUND,
          message: 'Method not found',
          data: method
        });
    }
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

      // Format messages according to spec
      const formattedMessages = messages.map(msg => ({
        id: msg.id,
        chat_id: msg.chat_id,
        guid: msg.guid || '',
        sender: msg.sender,
        text: msg.text || '',
        created_at: msg.created_at ? msg.created_at.toISOString() : new Date().toISOString(),
        is_from_me: msg.is_from_me,
        attachments: attachments ? msg.attachments || [] : [],
        reactions: msg.reactions || []
      }));

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
    const { chat_id = null, since_rowid, participants, attachments = false, include_reactions = false } = params;

    try {
      const watcher = new MessageWatcher(this.store);
      const subscriptionId = this.nextSubscriptionId++;

      // Set up message handler
      watcher.on('message', (message) => {
        this.sendNotification('message', {
          subscription: subscriptionId,
          message: {
            id: message.id,
            chat_id: message.chat_id,
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
        sinceRowID: since_rowid
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

      await sender.send({
        recipient: to || '',
        text: text || '',
        attachmentPath: file || '',
        service,
        region,
        chatIdentifier: chat_identifier || '',
        chatGUID: chat_guid || ''
      });

      this.sendResponse(id, { ok: true });
    } catch (error) {
      this.sendError(id, {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to send message',
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
