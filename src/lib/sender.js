const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const PhoneNumberNormalizer = require('./normalizer');

/**
 * MessageSender - Send iMessages via AppleScript
 * Based on MessageSender.swift from the original imsg project
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
      chatGUID = ''
    } = options;

    let resolved = {
      recipient,
      text,
      attachmentPath,
      service,
      chatIdentifier,
      chatGUID
    };

    // Resolve chat target
    const chatTarget = this.resolveChatTarget(resolved);
    const useChat = chatTarget.length > 0;

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
    const guid = (options.chatGUID || '').trim();
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
   * Check if value looks like a handle (phone/email)
   * Based on MessageSender.swift looksLikeHandle()
   */
  looksLikeHandle(value) {
    const trimmed = value.trim();
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
   * Send message via AppleScript
   * Based on MessageSender.swift sendViaAppleScript()
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
        execFileSync('/usr/bin/osascript', ['-l', 'AppleScript', '-', ...args], {
          input: script
        });
        resolve({ success: true });
      } catch (error) {
        reject(new Error(`AppleScript failed: ${error.message}`));
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
