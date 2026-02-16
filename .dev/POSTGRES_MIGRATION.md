# Postgres Migration Plan - Mukon Messenger Backend

## Problem Statement

Currently, the backend stores all data in in-memory JavaScript Maps. On every deployment (restart), all data is wiped:
- messages
- groupMessages
- readReceipts
- groupReadReceipts
- groupAvatars
- pendingKeyShares

This is a significant issue for production - users lose all their messages on deploy.

---

## Database Schema

### 1. conversations (messages table)

```sql
CREATE TABLE messages (
  id VARCHAR(255) PRIMARY KEY,
  conversation_id VARCHAR(255) NOT NULL,
  sender VARCHAR(255) NOT NULL,
  encrypted TEXT,
  nonce VARCHAR(255),
  content TEXT,
  timestamp BIGINT NOT NULL,
  type VARCHAR(50) DEFAULT 'message',
  reply_to VARCHAR(255),
  reactions JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);
```

### 2. group_messages

```sql
CREATE TABLE group_messages (
  id VARCHAR(255) PRIMARY KEY,
  group_id VARCHAR(255) NOT NULL,
  sender VARCHAR(255) NOT NULL,
  encrypted TEXT,
  nonce VARCHAR(255),
  timestamp BIGINT NOT NULL,
  reactions JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_group_messages_group ON group_messages(group_id);
CREATE INDEX idx_group_messages_timestamp ON group_messages(timestamp);
```

### 3. read_receipts

```sql
CREATE TABLE read_receipts (
  conversation_id VARCHAR(255) NOT NULL,
  reader_pubkey VARCHAR(255) NOT NULL,
  latest_timestamp BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, reader_pubkey)
);
```

### 4. group_read_receipts

```sql
CREATE TABLE group_read_receipts (
  group_id VARCHAR(255) NOT NULL,
  reader_pubkey VARCHAR(255) NOT NULL,
  latest_timestamp BIGINT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, reader_pubkey)
);
```

### 5. group_avatars

```sql
CREATE TABLE group_avatars (
  group_id VARCHAR(255) PRIMARY KEY,
  avatar VARCHAR(10) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 6. pending_key_shares

```sql
CREATE TABLE pending_key_shares (
  group_id VARCHAR(255) NOT NULL,
  recipient_pubkey VARCHAR(255) NOT NULL,
  encrypted_key TEXT NOT NULL,
  nonce VARCHAR(255) NOT NULL,
  sender_pubkey VARCHAR(255) NOT NULL,
  stored_at BIGINT NOT NULL,
  PRIMARY KEY (group_id, recipient_pubkey)
);

CREATE INDEX idx_pending_key_shares_group ON pending_key_shares(group_id);
```

---

## Connection Setup

### Environment Variable
```env
DATABASE_URL=postgresql://user:password@host:5432/mukon_messenger
```

### Connection Pool (pg)
```javascript
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection on startup
pool.query('SELECT NOW()')
  .then(() => console.log('PostgreSQL connected'))
  .catch(err => console.error('PostgreSQL connection error:', err));
```

### Graceful Shutdown
```javascript
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing database pool...');
  await pool.end();
  process.exit(0);
});
```

---

## Code Changes Required

### 1. Replace `messages` Map

**Before:**
```javascript
const messages = new Map();
messages.get(conversationId).push(messageData);
```

**After:**
```javascript
// Store message
await pool.query(
  `INSERT INTO messages (id, conversation_id, sender, encrypted, nonce, content, timestamp, type, reply_to, reactions)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
  [id, conversationId, sender, encrypted, nonce, content, timestamp, type, replyTo, JSON.stringify(reactions || {})]
);
```

### 2. Replace `groupMessages` Map

Use `group_messages` table with similar pattern.

### 3. Replace `readReceipts` Map

```javascript
// Upsert pattern
await pool.query(
  `INSERT INTO read_receipts (conversation_id, reader_pubkey, latest_timestamp, updated_at)
   VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
   ON CONFLICT (conversation_id, reader_pubkey) 
   DO UPDATE SET latest_timestamp = GREATEST(read_receipts.latest_timestamp, EXCLUDED.latest_timestamp)`,
  [conversationId, readerPubkey, latestTimestamp]
);
```

### 4. Replace `groupReadReceipts` Map

Same pattern with `group_read_receipts` table.

### 5. Replace `groupAvatars` Map

```javascript
await pool.query(
  `INSERT INTO group_avatars (group_id, avatar, updated_at)
   VALUES ($1, $2, CURRENT_TIMESTAMP)
   ON CONFLICT (group_id) DO UPDATE SET avatar = EXCLUDED.avatar`,
  [groupId, avatar]
);
```

### 6. Replace `pendingKeyShares` Map

```javascript
// Store
await pool.query(
  `INSERT INTO pending_key_shares (group_id, recipient_pubkey, encrypted_key, nonce, sender_pubkey, stored_at)
   VALUES ($1, $2, $3, $4, $5, $6)
   ON CONFLICT (group_id, recipient_pubkey) DO UPDATE SET 
     encrypted_key = EXCLUDED.encrypted_key,
     nonce = EXCLUDED.nonce,
     sender_pubkey = EXCLUDED.sender_pubkey,
     stored_at = EXCLUDED.stored_at`,
  [groupId, recipientPubkey, encryptedKey, nonce, senderPubkey, Date.now()]
);

// Retrieve
const result = await pool.query(
  'SELECT * FROM pending_key_shares WHERE group_id = $1 AND recipient_pubkey = $2',
  [groupId, recipientPubkey]
);
```

### 7. GET Endpoints Changes

**Messages retrieval:**
```javascript
const result = await pool.query(
  'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
  [conversationId]
);
const messages = result.rows;
```

**Read receipts retrieval:**
```javascript
const result = await pool.query(
  'SELECT reader_pubkey, latest_timestamp FROM read_receipts WHERE conversation_id = $1',
  [conversationId]
);
```

---

## Fallback Handling

### Option A: Dual-Write (Recommended for gradual migration)

1. Keep in-memory Maps as fallback
2. On read: Try DB first, fallback to Map
3. On write: Write to both DB and Map

```javascript
async function getMessages(conversationId) {
  try {
    const result = await pool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC',
      [conversationId]
    );
    return result.rows;
  } catch (err) {
    console.error('DB error, falling back to memory:', err);
    return messages.get(conversationId) || [];
  }
}
```

### Option B: Startup Data Load

1. Load all existing data from DB into Maps on startup
2. Writes go to both DB and Maps
3. After loading, Maps become cache only

### Option C: Fail-Safe Mode

1. Check for `DATABASE_URL` environment variable
2. If not set, use in-memory Maps (development mode)
3. If set, use PostgreSQL with error handling

```javascript
const useDatabase = !!process.env.DATABASE_URL;

if (useDatabase) {
  // Use PostgreSQL
} else {
  // Use in-memory Maps with warning
  console.warn('WARNING: No DATABASE_URL set. Using in-memory storage. Data will be lost on restart!');
}
```

---

## Testing Strategy

### 1. Unit Tests
- Test each database function independently
- Mock the pool for fast unit tests

### 2. Integration Tests
- Use a test database (or Docker container)
- Test full message flow: send → retrieve → delete
- Test read receipts persistence

### 3. Migration Tests
- Create a staging environment with real PostgreSQL
- Test deployment pipeline doesn't lose data
- Verify data integrity after restart

### 4. Load Testing
- Verify performance with large message histories
- Test connection pool limits under load

### Test Script Example
```javascript
// test/db-migration.test.js
const assert = require('assert');

async function testMessagePersistence() {
  const conversationId = 'test_conv_123';
  
  // Send message
  await sendMessage(conversationId, 'Hello');
  
  // Simulate restart (clear memory)
  clearMemoryMaps();
  
  // Retrieve messages
  const messages = await getMessages(conversationId);
  
  assert(messages.length === 1);
  assert(messages[0].content === 'Hello');
  console.log('✅ Message persistence test passed');
}
```

---

## Migration Checklist

- [ ] Set up PostgreSQL database
- [ ] Add `pg` dependency: `npm install pg`
- [ ] Set `DATABASE_URL` environment variable
- [ ] Create database tables (schema above)
- [ ] Implement database helper module
- [ ] Update `/messages` POST endpoint
- [ ] Update `/messages/:conversationId` GET endpoint
- [ ] Update `/group-messages/:groupId` GET endpoint
- [ ] Update WebSocket handlers for messages
- [ ] Update read receipt handlers
- [ ] Update group avatar handlers
- [ ] Update pending key share handlers
- [ ] Add fallback handling (dual-write or fail-safe)
- [ ] Test in staging environment
- [ ] Deploy to production

---

## Dependencies

```bash
npm install pg
# Development
npm install --save-dev jest
```

---

## Notes

1. **onlineUsers** Map - Not persisted (socket state, should rebuild on reconnect)
2. **groupRooms** Map - Not persisted (Socket.IO room state, handled by Socket.IO)
3. Consider adding **message pagination** for large conversations
4. Consider **message expiration** cleanup job for old messages
5. Use **SSL** for production database connections
