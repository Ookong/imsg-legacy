const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

/**
 * MessageStore - Access Messages database on macOS
 * Based on MessageStore.swift from the original imsg project
 */
class MessageStore {
  static appleEpochOffset = 978307200; // 2001-01-01 00:00:00 UTC

  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(os.homedir(), 'Library/Messages/chat.db');
    this.db = null;
  }

  /**
   * Open database connection
   */
  async connect() {
    try {
      this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 5000');
      await this.detectSchema();
    } catch (error) {
      throw new Error(`Failed to open database: ${error.message}`);
    }
  }

  /**
   * Detect database schema features (for compatibility across macOS versions)
   * Based on MessageStore.swift lines 45-56
   */
  async detectSchema() {
    const messageColumns = this.getTableColumns('message');
    const attachmentColumns = this.getTableColumns('attachment');

    this.hasAttributedBody = messageColumns.includes('attributedbody');
    this.hasReactionColumns = messageColumns.includes('associated_message_guid') &&
                             messageColumns.includes('associated_message_type');
    this.hasThreadOriginatorGUID = messageColumns.includes('thread_originator_guid');
    this.hasDestinationCallerID = messageColumns.includes('destination_caller_id');
    this.hasAudioMessage = messageColumns.includes('is_audio_message');
    this.hasAttachmentUserInfo = attachmentColumns.includes('user_info');
    this.hasBalloonBundleID = messageColumns.includes('balloon_bundle_id');
  }

  /**
   * Get column names for a table
   */
  getTableColumns(tableName) {
    const sql = `PRAGMA table_info(${tableName})`;
    const rows = this.db.prepare(sql).all();
    return rows.map(row => row.name.toLowerCase());
  }

  /**
   * List recent chats
   * Based on MessageStore.swift listChats()
   */
  async listChats(limit = 20) {
    const sql = `
      SELECT c.ROWID, IFNULL(c.display_name, c.chat_identifier) AS name,
             c.chat_identifier, c.service_name, MAX(m.date) AS last_date
      FROM chat c
      JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
      JOIN message m ON m.ROWID = cmj.message_id
      GROUP BY c.ROWID
      ORDER BY last_date DESC
      LIMIT ?
    `;

    const rows = this.db.prepare(sql).all(limit);
    return rows.map(row => ({
      id: row.ROWID,
      name: row.name,
      identifier: row.chat_identifier,
      service: row.service_name,
      last_message_at: this.appleDateToDate(row.last_date)
    }));
  }

  /**
   * Get messages for a chat
   * Based on MessageStore+Messages.swift
   */
  async getMessages(chatId, limit = 50, options = {}) {
    const { since, participants } = options;
    const conditions = [];
    const params = [];

    if (chatId !== null) {
      conditions.push('cmj.chat_id = ?');
      params.push(chatId);
    }

    if (since) {
      conditions.push('m.ROWID > ?');
      params.push(since);
    }

    if (participants) {
      const participantList = participants.split(',');
      conditions.push(`h.id IN (${participantList.map(() => '?').join(',')})`);
      params.push(...participantList);
    }

    // Use appropriate body column based on schema
    const bodyColumn = this.hasAttributedBody ? 'm.attributedBody' : 'NULL';

    // Build GUID-related fields based on schema detection
    const guidField = "IFNULL(m.guid, '')";
    const replyToField = this.hasReactionColumns ? "IFNULL(m.associated_message_guid, '')" : "''";

    const sql = `
      SELECT m.ROWID, cmj.chat_id, m.handle_id, h.id,
             ${guidField} AS guid,
             ${replyToField} AS reply_to_guid,
             IFNULL(m.text, '') AS text,
             m.date, m.is_from_me,
             ${bodyColumn} AS body,
             (SELECT COUNT(*) FROM message_attachment_join maj WHERE maj.message_id = m.ROWID) as attachments_count
      FROM message m
      LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
      LEFT JOIN handle h ON m.handle_id = h.ROWID
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.date DESC
      LIMIT ?
    `;

    params.push(limit);

    const rows = this.db.prepare(sql).all(...params);
    return rows.map(row => this.parseMessage(row));
  }

  /**
   * Parse message row
   * Compatible with Swift imsg MessagePayload format
   */
  parseMessage(row) {
    return {
      id: row.ROWID,
      chat_id: row.chat_id,
      guid: row.guid || '',
      reply_to_guid: row.reply_to_guid || '',
      thread_originator_guid: '',
      sender: row.id,
      text: this.parseAttributedBody(row.body, row.text),
      created_at: this.appleDateToDate(row.date),
      is_from_me: Boolean(row.is_from_me),
      attachments: [],
      reactions: [],
      destination_caller_id: ''
    };
  }

  /**
   * Convert Apple date timestamp to JavaScript Date
   * Based on MessageStore+Helpers.swift lines 68-77
   */
  appleDateToDate(appleDate) {
    if (!appleDate) return new Date();
    const seconds = appleDate / 1000000000 + MessageStore.appleEpochOffset;
    return new Date(seconds * 1000);
  }

  /**
   * Parse attributedBody (simplified implementation)
   * Based on TypedStreamParser.swift
   * For now, just return the fallback text
   */
  parseAttributedBody(body, fallback) {
    if (!body || !this.hasAttributedBody) return fallback;
    // TODO: Implement full NSAttributedString parsing if needed
    return fallback;
  }

  /**
   * Get maximum ROWID from message table
   */
  async getMaxRowID() {
    const sql = 'SELECT MAX(ROWID) as max_id FROM message';
    const row = this.db.prepare(sql).get();
    return row.max_id || 0;
  }

  /**
   * Get chat info
   * Based on MessageStore.swift chatInfo()
   */
  async getChatInfo(chatID) {
    const sql = `
      SELECT c.ROWID, IFNULL(c.chat_identifier, '') AS identifier,
             IFNULL(c.guid, '') AS guid,
             IFNULL(c.display_name, c.chat_identifier) AS name,
             IFNULL(c.service_name, '') AS service
      FROM chat c
      WHERE c.ROWID = ?
      LIMIT 1
    `;

    const row = this.db.prepare(sql).get(chatID);
    if (!row) return null;

    return {
      id: row.ROWID,
      identifier: row.identifier,
      guid: row.guid,
      name: row.name,
      service: row.service
    };
  }

  /**
   * Get participants for a chat
   * Based on MessageStore.swift participants()
   */
  async getParticipants(chatID) {
    const sql = `
      SELECT h.id
      FROM chat_handle_join chj
      JOIN handle h ON h.ROWID = chj.handle_id
      WHERE chj.chat_id = ?
      ORDER BY h.id ASC
    `;

    const rows = this.db.prepare(sql).all(chatID);
    const seen = new Set();
    const results = [];
    for (const row of rows) {
      const handle = row.id;
      if (handle && !seen.has(handle)) {
        seen.add(handle);
        results.push(handle);
      }
    }
    return results;
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = MessageStore;
