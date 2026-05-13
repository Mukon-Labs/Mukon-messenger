const { Pool } = require('pg');

let pool = null;

function isEnabled() {
  return !!process.env.DATABASE_URL;
}

function getPool() {
  if (!pool && isEnabled()) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
  }
  return pool;
}

async function initDatabase() {
  if (!isEnabled()) {
    console.log('DATABASE_URL not set — using in-memory storage');
    return false;
  }

  const p = getPool();
  const client = await p.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        encrypted TEXT,
        nonce TEXT,
        content TEXT,
        timestamp BIGINT NOT NULL,
        type TEXT DEFAULT 'message',
        reply_to TEXT,
        reactions JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS group_messages (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        encrypted TEXT NOT NULL,
        nonce TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        reactions JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS read_receipts (
        conversation_id TEXT NOT NULL,
        reader_pubkey TEXT NOT NULL,
        latest_timestamp BIGINT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (conversation_id, reader_pubkey)
      );

      CREATE TABLE IF NOT EXISTS group_read_receipts (
        group_id TEXT NOT NULL,
        reader_pubkey TEXT NOT NULL,
        latest_timestamp BIGINT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (group_id, reader_pubkey)
      );

      CREATE TABLE IF NOT EXISTS group_avatars (
        group_id TEXT PRIMARY KEY,
        avatar TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS pending_key_shares (
        group_id TEXT NOT NULL,
        recipient_pubkey TEXT NOT NULL,
        encrypted_key TEXT NOT NULL,
        nonce TEXT NOT NULL,
        sender_pubkey TEXT NOT NULL,
        stored_at BIGINT NOT NULL,
        PRIMARY KEY (group_id, recipient_pubkey)
      );

      CREATE TABLE IF NOT EXISTS fcm_tokens (
        user_pubkey TEXT PRIMARY KEY,
        token TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_group_messages_group ON group_messages(group_id);
      CREATE INDEX IF NOT EXISTS idx_group_messages_timestamp ON group_messages(timestamp);
    `);
    console.log('Database tables initialized');
    return true;
  } finally {
    client.release();
  }
}

async function checkHealth() {
  if (!isEnabled()) return { status: 'disabled' };
  try {
    const p = getPool();
    const result = await p.query('SELECT 1');
    return { status: 'connected' };
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

// ========== MESSAGES ==========

async function saveMessage(conversationId, msg) {
  const p = getPool();
  await p.query(
    `INSERT INTO messages (id, conversation_id, sender, encrypted, nonce, content, timestamp, type, reply_to, reactions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING`,
    [msg.id, conversationId, msg.sender, msg.encrypted || null, msg.nonce || null,
     msg.content || null, msg.timestamp, msg.type || 'message', msg.replyTo || null,
     JSON.stringify(msg.reactions || {})]
  );
}

async function getMessages(conversationId) {
  const p = getPool();
  const result = await p.query(
    `SELECT id, conversation_id, sender, encrypted, nonce, content, timestamp, type, reply_to, reactions
     FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC`,
    [conversationId]
  );
  return result.rows.map(rowToMessage);
}

async function deleteMessage(conversationId, messageId) {
  const p = getPool();
  await p.query('DELETE FROM messages WHERE id = $1 AND conversation_id = $2', [messageId, conversationId]);
}

async function updateReactions(conversationId, messageId, reactions) {
  const p = getPool();
  await p.query(
    'UPDATE messages SET reactions = $1 WHERE id = $2 AND conversation_id = $3',
    [JSON.stringify(reactions), messageId, conversationId]
  );
}

function rowToMessage(row) {
  const msg = {
    id: row.id,
    sender: row.sender,
    timestamp: parseInt(row.timestamp),
    type: row.type || 'message',
  };
  if (row.conversation_id) msg.conversationId = row.conversation_id;
  if (row.encrypted) msg.encrypted = row.encrypted;
  if (row.nonce) msg.nonce = row.nonce;
  if (row.content) msg.content = row.content;
  if (row.reply_to) msg.replyTo = row.reply_to;
  if (row.reactions && Object.keys(row.reactions).length > 0) msg.reactions = row.reactions;
  return msg;
}

// ========== GROUP MESSAGES ==========

async function saveGroupMessage(groupId, msg) {
  const p = getPool();
  await p.query(
    `INSERT INTO group_messages (id, group_id, sender, encrypted, nonce, timestamp, reactions)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING`,
    [msg.id, groupId, msg.sender, msg.encrypted, msg.nonce, msg.timestamp,
     JSON.stringify(msg.reactions || {})]
  );
}

async function getGroupMessages(groupId) {
  const p = getPool();
  const result = await p.query(
    `SELECT id, group_id, sender, encrypted, nonce, timestamp, reactions
     FROM group_messages WHERE group_id = $1 ORDER BY timestamp ASC`,
    [groupId]
  );
  return result.rows.map(row => {
    const msg = {
      id: row.id,
      groupId: row.group_id,
      sender: row.sender,
      encrypted: row.encrypted,
      nonce: row.nonce,
      timestamp: parseInt(row.timestamp),
    };
    if (row.reactions && Object.keys(row.reactions).length > 0) msg.reactions = row.reactions;
    return msg;
  });
}

async function deleteGroupMessage(groupId, messageId) {
  const p = getPool();
  await p.query('DELETE FROM group_messages WHERE id = $1 AND group_id = $2', [messageId, groupId]);
}

async function updateGroupReactions(groupId, messageId, reactions) {
  const p = getPool();
  await p.query(
    'UPDATE group_messages SET reactions = $1 WHERE id = $2 AND group_id = $3',
    [JSON.stringify(reactions), messageId, groupId]
  );
}

// ========== READ RECEIPTS ==========

async function setReadReceipt(conversationId, readerPubkey, latestTimestamp) {
  const p = getPool();
  await p.query(
    `INSERT INTO read_receipts (conversation_id, reader_pubkey, latest_timestamp, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (conversation_id, reader_pubkey)
     DO UPDATE SET latest_timestamp = GREATEST(read_receipts.latest_timestamp, $3), updated_at = NOW()`,
    [conversationId, readerPubkey, latestTimestamp]
  );
}

async function getReadReceipts(conversationId) {
  const p = getPool();
  const result = await p.query(
    'SELECT reader_pubkey, latest_timestamp FROM read_receipts WHERE conversation_id = $1',
    [conversationId]
  );
  return result.rows.map(row => ({ pubkey: row.reader_pubkey, timestamp: parseInt(row.latest_timestamp) }));
}

// ========== GROUP READ RECEIPTS ==========

async function setGroupReadReceipt(groupId, readerPubkey, latestTimestamp) {
  const p = getPool();
  await p.query(
    `INSERT INTO group_read_receipts (group_id, reader_pubkey, latest_timestamp, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (group_id, reader_pubkey)
     DO UPDATE SET latest_timestamp = GREATEST(group_read_receipts.latest_timestamp, $3), updated_at = NOW()`,
    [groupId, readerPubkey, latestTimestamp]
  );
}

async function getGroupReadReceipts(groupId) {
  const p = getPool();
  const result = await p.query(
    'SELECT reader_pubkey, latest_timestamp FROM group_read_receipts WHERE group_id = $1',
    [groupId]
  );
  return result.rows.map(row => ({ pubkey: row.reader_pubkey, timestamp: parseInt(row.latest_timestamp) }));
}

// ========== GROUP AVATARS ==========

async function setGroupAvatar(groupId, avatar) {
  const p = getPool();
  await p.query(
    `INSERT INTO group_avatars (group_id, avatar, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (group_id)
     DO UPDATE SET avatar = $2, updated_at = NOW()`,
    [groupId, avatar]
  );
}

async function getGroupAvatar(groupId) {
  const p = getPool();
  const result = await p.query('SELECT avatar FROM group_avatars WHERE group_id = $1', [groupId]);
  return result.rows.length > 0 ? result.rows[0].avatar : null;
}

async function deleteGroupAvatar(groupId) {
  const p = getPool();
  await p.query('DELETE FROM group_avatars WHERE group_id = $1', [groupId]);
}

// ========== PENDING KEY SHARES ==========

async function savePendingKeyShare(groupId, recipientPubkey, data) {
  const p = getPool();
  await p.query(
    `INSERT INTO pending_key_shares (group_id, recipient_pubkey, encrypted_key, nonce, sender_pubkey, stored_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (group_id, recipient_pubkey)
     DO UPDATE SET encrypted_key = $3, nonce = $4, sender_pubkey = $5, stored_at = $6`,
    [groupId, recipientPubkey, data.encryptedKey, data.nonce, data.senderPubkey, data.storedAt]
  );
}

async function getPendingKeyShare(groupId, recipientPubkey) {
  const p = getPool();
  const result = await p.query(
    'SELECT encrypted_key, nonce, sender_pubkey, stored_at FROM pending_key_shares WHERE group_id = $1 AND recipient_pubkey = $2',
    [groupId, recipientPubkey]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    encryptedKey: row.encrypted_key,
    nonce: row.nonce,
    senderPubkey: row.sender_pubkey,
    storedAt: parseInt(row.stored_at),
  };
}

async function getPendingKeyShareCount(groupId) {
  const p = getPool();
  const result = await p.query(
    'SELECT COUNT(*) as count FROM pending_key_shares WHERE group_id = $1',
    [groupId]
  );
  return parseInt(result.rows[0].count);
}

async function deletePendingKeyShares(groupId) {
  const p = getPool();
  await p.query('DELETE FROM pending_key_shares WHERE group_id = $1', [groupId]);
}

// ========== FCM TOKENS ==========

async function saveFcmToken(userPubkey, token) {
  if (!isEnabled()) return;
  const p = getPool();
  await p.query(
    `INSERT INTO fcm_tokens (user_pubkey, token, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (user_pubkey)
     DO UPDATE SET token = $2, updated_at = NOW()`,
    [userPubkey, token]
  );
}

async function getFcmToken(userPubkey) {
  if (!isEnabled()) return null;
  const p = getPool();
  const result = await p.query('SELECT token FROM fcm_tokens WHERE user_pubkey = $1', [userPubkey]);
  return result.rows.length > 0 ? result.rows[0].token : null;
}

// ========== GROUP CLEANUP (for group_deleted) ==========

async function deleteGroupData(groupId) {
  const p = getPool();
  await Promise.all([
    p.query('DELETE FROM group_messages WHERE group_id = $1', [groupId]),
    p.query('DELETE FROM pending_key_shares WHERE group_id = $1', [groupId]),
    p.query('DELETE FROM group_avatars WHERE group_id = $1', [groupId]),
    p.query('DELETE FROM group_read_receipts WHERE group_id = $1', [groupId]),
  ]);
}

module.exports = {
  isEnabled,
  initDatabase,
  checkHealth,
  // Messages
  saveMessage,
  getMessages,
  deleteMessage,
  updateReactions,
  // Group messages
  saveGroupMessage,
  getGroupMessages,
  deleteGroupMessage,
  updateGroupReactions,
  // Read receipts
  setReadReceipt,
  getReadReceipts,
  // Group read receipts
  setGroupReadReceipt,
  getGroupReadReceipts,
  // Group avatars
  setGroupAvatar,
  getGroupAvatar,
  deleteGroupAvatar,
  // Pending key shares
  savePendingKeyShare,
  getPendingKeyShare,
  getPendingKeyShareCount,
  deletePendingKeyShares,
  // Group cleanup
  deleteGroupData,
  // FCM tokens
  saveFcmToken,
  getFcmToken,
};
