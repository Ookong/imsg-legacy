const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const PhoneNumberNormalizer = require('./normalizer');

/**
 * MessageSender - Send iMessages via AppleScript
 * Based on MessageSender.swift from the original imsg project
 *
 * v1.1.3 (PRD-1.1.3): Added resolveChatByName() for group name → chat-id resolution
 * and fixed sendViaAppleScript() to surface errors instead of swallowing them.
 */
class MessageSender {
  constructor() {
    this.normalizer = new PhoneNumberNormalizer();
  }

  /**
   * Send a message
   */
  async send(options) {
    const {
      recipient,
      text = '',
      attachmentPath = '',
      service = 'imessage',
      region = 'US',
      chatIdentifier = '',
      chatGUID: chatGUIDRaw
    } = options;
    const chatGUID = chatGUIDRaw || options.chatGuid || '';

    let resolved = {
      recipient,
      text,
      attachmentPath,
      service,
      chatIdentifier,
      chatGUID
    };

    // Resolve chat target
    let chatTarget = this.resolveChatTarget(resolved);
    let useChat = chatTarget.length > 0;

    // v1.1.3 (PRD-1.1.3): If recipient is a group display name (not a handle/chat-id),
    // resolve it to the real chat identifier via imsg chats --json, then route through
    // the chat-id path. Without this, AppleScript fails because chat id "猫族世界"
    // is not a valid chat identifier — AppleScript needs `iMessage;+;chatXXX` form.
    if (!useChat && resolved.recipient && !this.looksLikeHandle(resolved.recipient)) {
      const resolvedChat = await this.resolveChatByName(resolved.recipient);
      if (resolvedChat && resolvedChat.chat_guid) {
        resolved.chatGUID = resolvedChat.chat_guid;
        chatTarget = resolvedChat.chat_guid;
        useChat = true;
      } else {
        // v1.1.3: Surface clear error, do not silently fake success
        throw new Error(`Group chat not found: ${resolved.recipient}`);
      }
    }

    if (!useChat) {
      // Normalize recipient
      if (!resolved.region) resolved.region = region;
      resolved.recipient = this.normalizer.normalize(resolved.recipient, resolved.region);
      if (resolved.service === 'auto') resolved.service = 'imessage';
    }

    // Stage attachment if provided
    if (resolved.attachmentPath) {
      resolved.attachmentPath = await this.stageAttachment(resolved.attachmentPath);
    }

    // Send via AppleScript
    return this.sendViaAppleScript(resolved, chatTarget, useChat);
  }

  /**
   * Resolve chat target from options
   * Based on MessageSender.swift resolveChatTarget()
   */
  resolveChatTarget(options) {
    const guid = (options.chatGUID || options.chatGuid || '').trim();
    const identifier = (options.chatIdentifier || '').trim();

    if (identifier && this.looksLikeHandle(identifier)) {
      if (!options.recipient) {
        options.recipient = identifier;
      }
      return '';
    }

    if (guid) return guid;
    if (identifier) return identifier;
    return '';
  }

  /**
   * v1.1.3 (PRD-1.1.3): Resolve a group chat display name to its real chat identifier.
   * Reads `imsg chats --limit 50 --json` (JSONL output) and matches by name (strict equality).
   *
   * @param {string} name - Group display name (e.g. "猫族世界")
   * @returns {Promise<{identifier: string, id: number, service: string} | null>}
   */
  async resolveChatByName(name) {
    if (!name || typeof name !== 'string') return null;
    const target = name.trim();
    if (!target) return null;

    const { execFileSync } = require('child_process');
    let output;
    try {
      output = execFileSync('imsg', ['chats', '--limit', '100', '--json'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      return null;
    }

    // v1.1.3: Collect all matches and pick the most recently active one.
    // Multiple chats can share a display name (e.g. an active 群 vs. a leftover old 群).
    // Without this guard, imsg could deliver to the wrong (often abandoned) thread.
    const matches = [];
    const lines = String(output).trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let chat;
      try {
        chat = JSON.parse(line);
      } catch (e) {
        continue;
      }
      const chatName = (chat.name || '').trim();
      if (chatName === target) {
        matches.push({
          identifier: chat.identifier || '',
          id: chat.id,
          service: chat.service || 'iMessage',
          last_message_at: chat.last_message_at || ''
        });
      }
    }
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];

    // Sort by last_message_at desc; pick the freshest
    matches.sort((a, b) => {
      const ta = Date.parse(a.last_message_at) || 0;
      const tb = Date.parse(b.last_message_at) || 0;
      return tb - ta;
    });
    const winner = matches[0];
    // v1.1.3: AppleScript chat id must be in `iMessage;+;<chat-identifier>` form
    // (or `SMS;+;...` for SMS groups). chat.identifier from imsg chats --json is
    // the bare identifier; AppleScript rejects "chat id "chat24930803106700483"".
    const svc = (winner.service || 'iMessage').toLowerCase();
    const prefix = svc.startsWith('sms') ? 'SMS;+;' : 'iMessage;+;';
    const fullGuid = winner.identifier ? `${prefix}${winner.identifier}` : '';
    return Object.assign({}, winner, { chat_guid: fullGuid, identifier: winner.identifier });
  }

  /**
   * Check if value looks like a handle (phone/email)
   * Based on MessageSender.swift looksLikeHandle()
   */
  looksLikeHandle(value) {
    const trimmed = (value || '').trim();
    if (!trimmed) return false;

    const lower = trimmed.toLowerCase();
    if (lower.startsWith('imessage:') || lower.startsWith('sms:') || lower.startsWith('auto:')) {
      return true;
    }

    if (trimmed.includes('@')) return true;

    const allowed = /^[\+0-9 ()-]+$/;
    return allowed.test(trimmed);
  }

  /**
   * Stage attachment for sending (copy to Messages attachments directory)
   * Based on MessageSender.swift stageAttachment()
   */
  async stageAttachment(filePath) {
    const expandedPath = filePath.replace(/^~/, os.homedir());
    const sourcePath = path.resolve(expandedPath);

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Attachment not found at ${sourcePath}`);
    }

    const attachmentsDir = path.join(os.homedir(), 'Library/Messages/Attachments/imsg');
    const uniqueDir = path.join(attachmentsDir, crypto.randomUUID());
    fs.mkdirSync(uniqueDir, { recursive: true });

    const destination = path.join(uniqueDir, path.basename(sourcePath));
    fs.copyFileSync(sourcePath, destination);

    return destination;
  }

  /**
   * Send message via AppleScript.
   *
   * U5: return shape now includes the fields OpenClaw expects on the
   * `send` RPC response (guid, chat_guid, service, id). AppleScript's
   * Messages dictionary doesn't expose the GUID of the just-sent
   * message in a stable cross-version way, so guid/id are best-effort
   * empty strings rather than null — keeping the fields present makes
   * downstream consumers' destructuring safe.
   *
   * v1.1.3 (PRD-1.1.3): Errors from osascript are now surfaced via reject()
   * instead of being swallowed by an earlier resolve(). Before this fix,
   `imsg send -t <群名>` would log "Message sent successfully!" even though
   AppleScript had thrown "不能获得 chat id '猫族世界'" — a classic false-success.
   */
  sendViaAppleScript(options, chatTarget, useChat) {
    const script = this.getAppleScript();
    const args = [
      options.recipient,
      options.text,
      options.service,
      options.attachmentPath,
      options.attachmentPath ? '1' : '0',
      chatTarget,
      useChat ? '1' : '0'
    ];

    return new Promise((resolve, reject) => {
      try {
        const stdout = execFileSync('/usr/bin/osascript', ['-l', 'AppleScript', '-', ...args], {
          input: script,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // Resolved service name OpenClaw reflects in UI (e.g. "iMessage" vs "SMS").
        const serviceOut =
          options.service === 'sms'
            ? 'SMS'
            : options.service === 'imessage'
            ? 'iMessage'
            : options.service || '';

        resolve({
          success: true,
          id: '',
          guid: '',
          chat_guid: useChat ? chatTarget : (options.chatGUID || options.chatGuid || ''),
          service: serviceOut,
          _stdout: stdout || ''
        });
      } catch (error) {
        // v1.1.3: Surface full stderr to caller — no more swallowed errors
        const stderr = (error && error.stderr) ? String(error.stderr).trim() : (error && error.message) || String(error);
        reject(new Error(`AppleScript failed (useChat=${useChat ? '1' : '0'}, chatTarget='${chatTarget}'): ${stderr}`));
      }
    });
  }

  /**
   * Get AppleScript template
   * Based on MessageSender.swift appleScript()
   */
  getAppleScript() {
    return `
      on run argv
        set theRecipient to item 1 of argv
        set theMessage to item 2 of argv
        set theService to item 3 of argv
        set theFilePath to item 4 of argv
        set useAttachment to item 5 of argv
        set chatId to item 6 of argv
        set useChat to item 7 of argv

        tell application "Messages"
          if useChat is "1" then
            set targetChat to chat id chatId
            if theMessage is not "" then
              send theMessage to targetChat
            end if
            if useAttachment is "1" then
              set theFile to POSIX file theFilePath as alias
              send theFile to targetChat
            end if
          else
            if theService is "sms" then
              set targetService to first service whose service type is SMS
            else
              set targetService to first service whose service type is iMessage
            end if

            set targetBuddy to buddy theRecipient of targetService
            if theMessage is not "" then
              send theMessage to targetBuddy
            end if
            if useAttachment is "1" then
              set theFile to POSIX file theFilePath as alias
              send theFile to targetBuddy
            end if
          end if
      end tell
    end run
    `;
  }
}

module.exports = MessageSender;
