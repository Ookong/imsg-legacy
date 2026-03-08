const chokidar = require('chokidar');
const EventEmitter = require('events');

/**
 * MessageWatcher - Watch for new messages via file system monitoring
 * Based on MessageWatcher.swift from the original imsg project
 */
class MessageWatcher extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.cursor = 0;
    this.watcher = null;
  }

  /**
   * Start watching for new messages (async)
   */
  async start(options = {}) {
    const {
      chatId = null,
      debounceMs = 250,
      batchLimit = 100
    } = options;

    // Initialize cursor
    this.cursor = options.sinceRowID || 0;
    if (this.cursor === 0) {
      try {
        this.cursor = await this.store.getMaxRowID();
      } catch (err) {
        this.emit('error', err);
        return;
      }
    }

    // Watch database files
    // Based on MessageWatcher.swift lines 84-89
    const dbPath = this.store.dbPath;
    const watchPaths = [
      dbPath,
      dbPath + '-wal',
      dbPath + '-shm'
    ];

    this.watcher = chokidar.watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,
      usePolling: true,  // Use polling instead of native file events
      interval: 500,      // Check every 500ms
      binaryInterval: 1000,
      awaitWriteFinish: {
        stabilityThreshold: debounceMs,
        pollInterval: 100
      }
    });

    this.watcher.on('change', (path) => {
      this.schedulePoll(chatId, batchLimit, debounceMs);
    });

    this.watcher.on('error', error => {
      this.emit('error', error);
    });
  }

  /**
   * Schedule a poll with debouncing
   */
  schedulePoll(chatId, batchLimit, debounceMs) {
    if (this.pending) return;

    this.pending = true;
    setTimeout(() => {
      this.pending = false;
      this.poll(chatId, batchLimit);
    }, debounceMs);
  }

  /**
   * Poll for new messages
   */
  poll(chatId, batchLimit) {
    this.store.getMessages(chatId || null, batchLimit, {
      since: this.cursor
    }).then(messages => {
      for (const message of messages) {
        if (message.id > this.cursor) {
          this.cursor = message.id;
        }
        this.emit('message', message);
      }
    }).catch(error => {
      this.emit('error', error);
    });
  }

  /**
   * Stop watching
   */
  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

module.exports = MessageWatcher;
