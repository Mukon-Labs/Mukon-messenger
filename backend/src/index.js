const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PublicKey } = require('@solana/web3.js');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default; // bs58 v6 uses default export
const db = require('./db');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(cors());
app.use(express.json());

// In-memory fallback storage (used when DATABASE_URL is not set)
const memMessages = new Map(); // conversationId -> Message[]
const memGroupMessages = new Map(); // groupId -> Message[]
const memReadReceipts = new Map(); // conversationId -> Map<readerPubkey, latestTimestamp>
const memGroupReadReceipts = new Map(); // groupId -> Map<readerPubkey, latestTimestamp>
const memGroupAvatars = new Map(); // groupId -> emoji string
const memPendingKeyShares = new Map(); // groupId -> Map<recipientPubkey, { encryptedKey, nonce, senderPubkey, storedAt }>

// Always in-memory (ephemeral connection state)
const onlineUsers = new Map(); // pubkey -> socket.id
const groupRooms = new Map(); // groupId -> Set<socket.id>

// ========== STORAGE ABSTRACTION ==========
// Each function checks db.isEnabled() and falls back to in-memory Maps

const store = {
  async saveMessage(conversationId, msg) {
    if (db.isEnabled()) {
      await db.saveMessage(conversationId, msg);
    } else {
      if (!memMessages.has(conversationId)) memMessages.set(conversationId, []);
      memMessages.get(conversationId).push(msg);
    }
  },

  async getMessages(conversationId) {
    if (db.isEnabled()) {
      return await db.getMessages(conversationId);
    }
    return memMessages.get(conversationId) || [];
  },

  async deleteMessage(conversationId, messageId) {
    if (db.isEnabled()) {
      await db.deleteMessage(conversationId, messageId);
    } else {
      const msgs = memMessages.get(conversationId) || [];
      memMessages.set(conversationId, msgs.filter(m => m.id !== messageId));
    }
  },

  async updateReactions(conversationId, messageId, reactions) {
    if (db.isEnabled()) {
      await db.updateReactions(conversationId, messageId, reactions);
    }
    // In-memory: reactions are mutated directly on the message object
  },

  async saveGroupMessage(groupId, msg) {
    if (db.isEnabled()) {
      await db.saveGroupMessage(groupId, msg);
    } else {
      if (!memGroupMessages.has(groupId)) memGroupMessages.set(groupId, []);
      memGroupMessages.get(groupId).push(msg);
    }
  },

  async getGroupMessages(groupId) {
    if (db.isEnabled()) {
      return await db.getGroupMessages(groupId);
    }
    return memGroupMessages.get(groupId) || [];
  },

  async deleteGroupMessage(groupId, messageId) {
    if (db.isEnabled()) {
      await db.deleteGroupMessage(groupId, messageId);
    } else {
      const msgs = memGroupMessages.get(groupId) || [];
      memGroupMessages.set(groupId, msgs.filter(m => m.id !== messageId));
    }
  },

  async updateGroupReactions(groupId, messageId, reactions) {
    if (db.isEnabled()) {
      await db.updateGroupReactions(groupId, messageId, reactions);
    }
  },

  async setReadReceipt(conversationId, readerPubkey, latestTimestamp) {
    if (db.isEnabled()) {
      await db.setReadReceipt(conversationId, readerPubkey, latestTimestamp);
    } else {
      if (!memReadReceipts.has(conversationId)) memReadReceipts.set(conversationId, new Map());
      const existing = memReadReceipts.get(conversationId).get(readerPubkey) || 0;
      if (latestTimestamp > existing) {
        memReadReceipts.get(conversationId).set(readerPubkey, latestTimestamp);
      }
    }
  },

  async getReadReceipts(conversationId) {
    if (db.isEnabled()) {
      return await db.getReadReceipts(conversationId);
    }
    const receipts = memReadReceipts.get(conversationId) || new Map();
    return Array.from(receipts.entries()).map(([pubkey, timestamp]) => ({ pubkey, timestamp }));
  },

  async setGroupReadReceipt(groupId, readerPubkey, latestTimestamp) {
    if (db.isEnabled()) {
      await db.setGroupReadReceipt(groupId, readerPubkey, latestTimestamp);
    } else {
      if (!memGroupReadReceipts.has(groupId)) memGroupReadReceipts.set(groupId, new Map());
      const existing = memGroupReadReceipts.get(groupId).get(readerPubkey) || 0;
      if (latestTimestamp > existing) {
        memGroupReadReceipts.get(groupId).set(readerPubkey, latestTimestamp);
      }
    }
  },

  async getGroupReadReceipts(groupId) {
    if (db.isEnabled()) {
      return await db.getGroupReadReceipts(groupId);
    }
    const receipts = memGroupReadReceipts.get(groupId) || new Map();
    return Array.from(receipts.entries()).map(([pubkey, timestamp]) => ({ pubkey, timestamp }));
  },

  async setGroupAvatar(groupId, avatar) {
    if (db.isEnabled()) {
      await db.setGroupAvatar(groupId, avatar);
    } else {
      memGroupAvatars.set(groupId, avatar);
    }
  },

  async getGroupAvatar(groupId) {
    if (db.isEnabled()) {
      return await db.getGroupAvatar(groupId);
    }
    return memGroupAvatars.get(groupId) || null;
  },

  async savePendingKeyShare(groupId, recipientPubkey, data) {
    if (db.isEnabled()) {
      await db.savePendingKeyShare(groupId, recipientPubkey, data);
    } else {
      if (!memPendingKeyShares.has(groupId)) memPendingKeyShares.set(groupId, new Map());
      memPendingKeyShares.get(groupId).set(recipientPubkey, data);
    }
  },

  async getPendingKeyShare(groupId, recipientPubkey) {
    if (db.isEnabled()) {
      return await db.getPendingKeyShare(groupId, recipientPubkey);
    }
    return memPendingKeyShares.get(groupId)?.get(recipientPubkey) || null;
  },

  async getPendingKeyShareCount(groupId) {
    if (db.isEnabled()) {
      return await db.getPendingKeyShareCount(groupId);
    }
    return memPendingKeyShares.get(groupId)?.size || 0;
  },

  async deleteMessages(conversationId, messageIds) {
    for (const id of messageIds) {
      await this.deleteMessage(conversationId, id);
    }
  },

  async deleteGroupMessages(groupId, messageIds) {
    for (const id of messageIds) {
      await this.deleteGroupMessage(groupId, id);
    }
  },

  async deleteGroupData(groupId) {
    if (db.isEnabled()) {
      await db.deleteGroupData(groupId);
    } else {
      memGroupMessages.delete(groupId);
      memPendingKeyShares.delete(groupId);
      memGroupAvatars.delete(groupId);
      memGroupReadReceipts.delete(groupId);
    }
  },
};

// Verify wallet signature
function verifySignature(publicKey, message, signature) {
  try {
    const pubkey = new PublicKey(publicKey);
    const messageBytes = Buffer.from(message, 'utf8');
    const signatureBytes = bs58.decode(signature);

    return nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      pubkey.toBytes()
    );
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}

// Generate conversation ID from two pubkeys (sorted)
function getConversationId(pubkey1, pubkey2) {
  const sorted = [pubkey1, pubkey2].sort();
  return `${sorted[0]}_${sorted[1]}`;
}

// REST endpoints
app.get('/health', async (req, res) => {
  const dbHealth = await db.checkHealth();
  res.json({ status: 'ok', timestamp: Date.now(), database: dbHealth });
});

app.post('/messages', async (req, res) => {
  try {
    const { conversationId, encrypted, nonce, sender, signature } = req.body;

    // Verify signature
    const message = `Send message to ${conversationId}`;
    if (!verifySignature(sender, message, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const messageData = {
      id: Date.now().toString(),
      sender,
      encrypted,
      nonce,
      timestamp: Date.now()
    };

    await store.saveMessage(conversationId, messageData);

    // Broadcast to conversation participants
    io.to(conversationId).emit('new_message', messageData);

    res.json({ success: true, messageId: messageData.id });
  } catch (error) {
    console.error('Error posting message:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/messages/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { sender, signature } = req.query;

    // Accept encryption signature as proof of wallet ownership
    const encryptionMessage = 'Sign this message to derive your encryption keys for Mukon Messenger';
    if (!verifySignature(sender, encryptionMessage, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const conversationMessages = await store.getMessages(conversationId);
    const readTimestamps = await store.getReadReceipts(conversationId);

    res.json({
      messages: conversationMessages,
      readTimestamps
    });

    // If acknowledge=true, delete delivered messages from backend (local-first)
    if (req.query.acknowledge === 'true' && conversationMessages.length > 0) {
      try {
        const ids = conversationMessages.map(m => m.id);
        await store.deleteMessages(conversationId, ids);
        console.log(`🗑️ Acknowledged & deleted ${ids.length} messages for ${conversationId.slice(0, 8)}...`);
      } catch (err) {
        console.error('Failed to delete acknowledged messages:', err);
      }
    }
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: error.message });
  }
});

// Group messages endpoint
app.get('/group-messages/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { sender, signature } = req.query;

    // Accept encryption signature as proof of wallet ownership
    const encryptionMessage = 'Sign this message to derive your encryption keys for Mukon Messenger';
    if (!verifySignature(sender, encryptionMessage, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const msgs = await store.getGroupMessages(groupId);
    const readTimestamps = await store.getGroupReadReceipts(groupId);

    res.json({
      messages: msgs,
      readTimestamps
    });

    // If acknowledge=true, delete delivered messages from backend (local-first)
    if (req.query.acknowledge === 'true' && msgs.length > 0) {
      try {
        const ids = msgs.map(m => m.id);
        await store.deleteGroupMessages(groupId, ids);
        console.log(`🗑️ Acknowledged & deleted ${ids.length} group messages for ${groupId.slice(0, 8)}...`);
      } catch (err) {
        console.error('Failed to delete acknowledged group messages:', err);
      }
    }
  } catch (error) {
    console.error('Error fetching group messages:', error);
    res.status(500).json({ error: error.message });
  }
});

// WebSocket connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('authenticate', ({ publicKey, signature }) => {
    // Accept encryption signature as proof of wallet ownership
    // (Client sends cached encryption signature to avoid popup spam)
    const encryptionMessage = 'Sign this message to derive your encryption keys for Mukon Messenger';
    if (verifySignature(publicKey, encryptionMessage, signature)) {
      onlineUsers.set(publicKey, socket.id);
      socket.publicKey = publicKey;
      socket.emit('authenticated', { success: true });
      console.log('User authenticated:', publicKey);
    } else {
      socket.emit('authenticated', { success: false, error: 'Invalid signature' });
    }
  });

  socket.on('join_conversation', ({ conversationId }) => {
    socket.join(conversationId);
    const room = io.sockets.adapter.rooms.get(conversationId);
    const roomSize = room ? room.size : 0;
    console.log(`${socket.publicKey || socket.id} joined conversation: ${conversationId} (now ${roomSize} clients in room)`);
  });

  socket.on('leave_conversation', ({ conversationId }) => {
    socket.leave(conversationId);
    console.log(`${socket.publicKey} left conversation: ${conversationId}`);
  });

  socket.on('send_message', async ({ conversationId, content, encrypted, nonce, sender, timestamp, type, replyTo }) => {
    if (!socket.publicKey && type !== 'system') {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    const messageData = {
      id: Date.now().toString() + Math.random(),
      conversationId, // Include conversationId so client knows where to add it
      sender: sender || socket.publicKey,
      timestamp: timestamp || Date.now(),
      type: type || 'message', // 'message' or 'system'
      replyTo: replyTo || null // Reply reference (message ID being replied to)
    };

    // Handle encrypted messages, plain text messages, or system messages
    if (type === 'system') {
      messageData.content = content;
      console.log(`📢 System message sent in ${conversationId.slice(0, 8)}...: ${content}`);
    } else if (encrypted && nonce) {
      messageData.encrypted = encrypted;
      messageData.nonce = nonce;
      console.log(`📨 Encrypted message sent in ${conversationId.slice(0, 8)}...`);
    } else if (content) {
      messageData.content = content;
      console.log(`📝 Plain text message sent in ${conversationId.slice(0, 8)}...: ${content}`);
    } else {
      socket.emit('error', { message: 'Message must have either content or encrypted data' });
      return;
    }

    // Store message
    try {
      await store.saveMessage(conversationId, messageData);
    } catch (err) {
      console.error('Failed to persist message:', err);
    }

    // Emit ack back to sender only
    socket.emit('message_ack', {
      messageId: messageData.id,
      conversationId,
      timestamp: messageData.timestamp,
    });

    // Broadcast to conversation (including sender for confirmation)
    const room = io.sockets.adapter.rooms.get(conversationId);
    const roomSize = room ? room.size : 0;
    console.log(`Broadcasting message to room ${conversationId} (${roomSize} clients)`);
    io.to(conversationId).emit('new_message', messageData);
  });

  socket.on('delete_message', async ({ conversationId, messageId, deleteForBoth }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    if (deleteForBoth) {
      try {
        await store.deleteMessage(conversationId, messageId);
      } catch (err) {
        console.error('Failed to delete message:', err);
      }

      // Broadcast deletion to everyone in room
      io.to(conversationId).emit('message_deleted', { conversationId, messageId });
      console.log(`Message ${messageId} deleted for everyone in ${conversationId}`);
    }
    // If deleteForBoth is false, client handles local deletion only
  });

  socket.on('add_reaction', async ({ conversationId, messageId, emoji, userId }) => {
    console.log(`📨 add_reaction received:`, { conversationId: conversationId.slice(0, 8) + '...', messageId, emoji, userId: userId.slice(0, 8) + '...' });

    if (!socket.publicKey) {
      console.error('❌ Not authenticated');
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    try {
      if (db.isEnabled()) {
        // DB mode: fetch message reactions, mutate, save back
        const msgs = await store.getMessages(conversationId);
        const message = msgs.find(m => m.id === messageId);
        if (message) {
          const reactions = message.reactions || {};
          applyReactionToggle(reactions, emoji, userId);
          await store.updateReactions(conversationId, messageId, reactions);

          io.to(conversationId).emit('reaction_updated', { conversationId, messageId, reactions });
          console.log(`✅ Reaction ${emoji} toggled on message ${messageId}`);
        } else {
          console.error(`❌ Message ${messageId} not found`);
        }
      } else {
        // In-memory mode: mutate directly
        const msgs = memMessages.get(conversationId) || [];
        const message = msgs.find(m => m.id === messageId);
        if (message) {
          if (!message.reactions) message.reactions = {};
          applyReactionToggle(message.reactions, emoji, userId);

          io.to(conversationId).emit('reaction_updated', { conversationId, messageId, reactions: message.reactions });
          console.log(`✅ Reaction ${emoji} toggled on message ${messageId}`);
        } else {
          console.error(`❌ Message ${messageId} not found`);
        }
      }
    } catch (err) {
      console.error('Failed to update reaction:', err);
    }
  });

  socket.on('typing', ({ conversationId }) => {
    socket.to(conversationId).emit('user_typing', {
      publicKey: socket.publicKey
    });
  });

  socket.on('messages_read', async ({ conversationId, readerPubkey, latestTimestamp }) => {
    try {
      await store.setReadReceipt(conversationId, readerPubkey, latestTimestamp);
      console.log(`💾 Persisted read receipt: ${conversationId.slice(0, 8)}... by ${readerPubkey.slice(0, 8)}... at ${latestTimestamp}`);
    } catch (err) {
      console.error('Failed to persist read receipt:', err);
    }

    // Forward to all others in the conversation room
    socket.to(conversationId).emit('messages_read', {
      conversationId,
      readerPubkey,
      latestTimestamp,
    });
  });

  // Local-first: client acknowledges messages saved locally, backend can delete its copies
  socket.on('messages_delivered', async ({ conversationId, messageIds }) => {
    if (!socket.publicKey || !conversationId || !messageIds?.length) return;
    try {
      await store.deleteMessages(conversationId, messageIds);
      console.log(`🗑️ Delivered & deleted ${messageIds.length} messages for ${conversationId.slice(0, 8)}...`);
    } catch (err) {
      console.error('Failed to delete delivered messages:', err);
    }
  });

  socket.on('group_messages_delivered', async ({ groupId, messageIds }) => {
    if (!socket.publicKey || !groupId || !messageIds?.length) return;
    try {
      await store.deleteGroupMessages(groupId, messageIds);
      console.log(`🗑️ Delivered & deleted ${messageIds.length} group messages for ${groupId.slice(0, 8)}...`);
    } catch (err) {
      console.error('Failed to delete delivered group messages:', err);
    }
  });

  socket.on('group_messages_read', async ({ groupId, readerPubkey, latestTimestamp }) => {
    try {
      await store.setGroupReadReceipt(groupId, readerPubkey, latestTimestamp);
      console.log(`💾 Persisted group read receipt: ${groupId.slice(0, 8)}... by ${readerPubkey.slice(0, 8)}... at ${latestTimestamp}`);
    } catch (err) {
      console.error('Failed to persist group read receipt:', err);
    }

    socket.to(`group_${groupId}`).emit('group_messages_read', {
      groupId,
      readerPubkey,
      latestTimestamp,
    });
  });

  // ========== GROUP EVENT HANDLERS ==========

  // Fix 2f: Separate event for viewing a group (joining the room)
  socket.on('join_group_room', ({ groupId }) => {
    socket.join(`group_${groupId}`);

    if (!groupRooms.has(groupId)) {
      groupRooms.set(groupId, new Set());
    }
    groupRooms.get(groupId).add(socket.id);

    const room = io.sockets.adapter.rooms.get(`group_${groupId}`);
    const roomSize = room ? room.size : 0;
    console.log(`${socket.publicKey || socket.id} joined group room: ${groupId.slice(0, 8)}... (now ${roomSize} clients in room)`);
  });

  // Membership notification (when someone accepts invite)
  socket.on('join_group', ({ groupId, memberPubkey }) => {
    console.log(`${memberPubkey} joined group as member: ${groupId.slice(0, 8)}...`);

    // Broadcast member joined event
    io.to(`group_${groupId}`).emit('group_member_joined', { groupId, memberPubkey });
  });

  socket.on('leave_group_room', ({ groupId }) => {
    socket.leave(`group_${groupId}`);

    if (groupRooms.has(groupId)) {
      groupRooms.get(groupId).delete(socket.id);
    }

    console.log(`${socket.publicKey} left group room: ${groupId.slice(0, 8)}...`);
  });

  socket.on('leave_group', ({ groupId, memberPubkey }) => {
    socket.leave(`group_${groupId}`);

    if (groupRooms.has(groupId)) {
      groupRooms.get(groupId).delete(socket.id);
    }

    console.log(`${memberPubkey} left group: ${groupId.slice(0, 8)}...`);

    // Broadcast member left event
    io.to(`group_${groupId}`).emit('group_member_left', { groupId, memberPubkey });
  });

  socket.on('kick_member', ({ groupId, memberPubkey }) => {
    console.log(`${memberPubkey} kicked from group: ${groupId.slice(0, 8)}...`);

    // Broadcast member kicked event
    io.to(`group_${groupId}`).emit('group_member_kicked', { groupId, memberPubkey });
  });

  socket.on('send_group_message', async ({ groupId, encrypted, nonce, sender, timestamp }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    const messageData = {
      id: Date.now().toString() + Math.random(),
      groupId,
      sender: sender || socket.publicKey,
      encrypted,
      nonce,
      timestamp: timestamp || Date.now(),
    };

    // Store message
    try {
      await store.saveGroupMessage(groupId, messageData);
    } catch (err) {
      console.error('Failed to persist group message:', err);
    }

    // Emit ack back to sender only
    socket.emit('group_message_ack', {
      messageId: messageData.id,
      groupId,
      timestamp: messageData.timestamp,
    });

    // Broadcast to group
    const room = io.sockets.adapter.rooms.get(`group_${groupId}`);
    const roomSize = room ? room.size : 0;
    console.log(`📨 Group message sent to ${groupId.slice(0, 8)}... (${roomSize} clients)`);
    io.to(`group_${groupId}`).emit('group_message', messageData);
  });

  socket.on('share_group_key', async ({ groupId, recipientPubkey, encryptedKey, nonce }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    console.log(`🔑 Sharing group key for ${groupId.slice(0, 8)}... to ${recipientPubkey.slice(0, 8)}...`);

    // ALWAYS store for later retrieval (in case socket delivery fails or they reconnect)
    try {
      await store.savePendingKeyShare(groupId, recipientPubkey, {
        encryptedKey,
        nonce,
        senderPubkey: socket.publicKey,
        storedAt: Date.now()
      });
      const count = await store.getPendingKeyShareCount(groupId);
      console.log(`📦 Stored pending key share for ${recipientPubkey.slice(0, 8)}... (total pending for group: ${count})`);
    } catch (err) {
      console.error('Failed to persist key share:', err);
    }

    // Also try to deliver immediately if online
    const recipientSocketId = onlineUsers.get(recipientPubkey);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('group_key_shared', {
        groupId,
        senderPubkey: socket.publicKey,
        encryptedKey,
        nonce,
      });
      console.log('✅ Also delivered immediately via socket');
    }
  });

  socket.on('request_group_key', async ({ groupId }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    console.log(`🔍 Key request from ${socket.publicKey.slice(0, 8)}... for group ${groupId.slice(0, 8)}...`);
    const count = await store.getPendingKeyShareCount(groupId);
    console.log(`   Pending shares for this group: ${count}`);

    const pending = await store.getPendingKeyShare(groupId, socket.publicKey);
    if (pending) {
      socket.emit('group_key_shared', {
        groupId,
        senderPubkey: pending.senderPubkey,
        encryptedKey: pending.encryptedKey,
        nonce: pending.nonce,
      });
      // Don't delete - keep it in case they need to request again
      console.log(`🔑 Delivered pending key share for ${groupId.slice(0, 8)}... to ${socket.publicKey.slice(0, 8)}...`);
    } else {
      // No pending share — ask other online group members to share their key
      console.log(`⚠️ No pending key share found, broadcasting key request to group room ${groupId.slice(0, 8)}...`);
      const room = io.sockets.adapter.rooms.get(`group_${groupId}`);
      console.log(`   Room has ${room?.size || 0} members`);
      socket.to(`group_${groupId}`).emit('group_key_needed', {
        groupId,
        requesterPubkey: socket.publicKey,
      });
    }
  });

  // Group key rotation: admin broadcasts new encrypted keys after kick/leave
  socket.on('group_key_rotated', async ({ groupId, keyShares }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    console.log(`🔄 Key rotation for group ${groupId.slice(0, 8)}... by ${socket.publicKey.slice(0, 8)}... (${keyShares.length} shares)`);

    // keyShares: Array<{ recipientPubkey, encryptedKey, nonce }>
    for (const share of keyShares) {
      // Store for offline members
      try {
        await store.savePendingKeyShare(groupId, share.recipientPubkey, {
          encryptedKey: share.encryptedKey,
          nonce: share.nonce,
          senderPubkey: socket.publicKey,
          storedAt: Date.now()
        });
      } catch (err) {
        console.error('Failed to persist rotated key share:', err);
      }

      // Deliver immediately if online
      const recipientSocketId = onlineUsers.get(share.recipientPubkey);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('group_key_shared', {
          groupId,
          senderPubkey: socket.publicKey,
          encryptedKey: share.encryptedKey,
          nonce: share.nonce,
          rotated: true,
        });
      }
    }
  });

  // Group avatar handlers (Fix 4)
  socket.on('set_group_avatar', async ({ groupId, avatar }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    try {
      await store.setGroupAvatar(groupId, avatar);
    } catch (err) {
      console.error('Failed to persist group avatar:', err);
    }
    console.log(`🎨 Group avatar set for ${groupId.slice(0, 8)}... to ${avatar}`);

    // Broadcast to all group members
    socket.to(`group_${groupId}`).emit('group_avatar_updated', { groupId, avatar });
  });

  socket.on('get_group_avatar', async ({ groupId }, callback) => {
    try {
      const avatar = await store.getGroupAvatar(groupId);
      if (callback) callback(avatar);
    } catch (err) {
      console.error('Failed to fetch group avatar:', err);
      if (callback) callback(null);
    }
  });

  socket.on('add_group_reaction', async ({ groupId, messageId, emoji, userId }) => {
    console.log(`📨 add_group_reaction received:`, { groupId: groupId.slice(0, 8) + '...', messageId, emoji });

    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    try {
      if (db.isEnabled()) {
        const msgs = await store.getGroupMessages(groupId);
        const message = msgs.find(m => m.id === messageId);
        if (message) {
          const reactions = message.reactions || {};
          applyReactionToggle(reactions, emoji, userId);
          await store.updateGroupReactions(groupId, messageId, reactions);

          io.to(`group_${groupId}`).emit('group_reaction_updated', { groupId, messageId, reactions });
        }
      } else {
        const msgs = memGroupMessages.get(groupId) || [];
        const message = msgs.find(m => m.id === messageId);
        if (message) {
          if (!message.reactions) message.reactions = {};
          applyReactionToggle(message.reactions, emoji, userId);

          io.to(`group_${groupId}`).emit('group_reaction_updated', { groupId, messageId, reactions: message.reactions });
        }
      }
    } catch (err) {
      console.error('Failed to update group reaction:', err);
    }
  });

  socket.on('delete_group_message', async ({ groupId, messageId, deleteForBoth }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    if (deleteForBoth) {
      try {
        await store.deleteGroupMessage(groupId, messageId);
      } catch (err) {
        console.error('Failed to delete group message:', err);
      }

      io.to(`group_${groupId}`).emit('group_message_deleted', { groupId, messageId });
      console.log(`Message ${messageId} deleted for everyone in group ${groupId.slice(0, 8)}...`);
    }
  });

  // Fix 2g: Handle group deletion
  socket.on('group_deleted', async ({ groupId }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    console.log(`🗑️  Group ${groupId.slice(0, 8)}... deleted by creator`);

    // Clean up all group data
    try {
      await store.deleteGroupData(groupId);
    } catch (err) {
      console.error('Failed to delete group data:', err);
    }
    groupRooms.delete(groupId);

    // Notify all members
    io.to(`group_${groupId}`).emit('group_deleted', { groupId });

    console.log(`✅ All data deleted for group ${groupId.slice(0, 8)}...`);
  });

  // Handle invitation rejection notification
  socket.on('invitation_rejected', ({ rejectorPubkey, peerPubkey }) => {
    console.log(`🚫 Invitation rejected: ${rejectorPubkey.slice(0, 8)}... rejected ${peerPubkey.slice(0, 8)}...`);

    // Notify the peer that invitation was rejected
    const peerSocketId = onlineUsers.get(peerPubkey);
    if (peerSocketId) {
      io.to(peerSocketId).emit('invitation_rejected', {
        rejectorPubkey,
        peerPubkey,
      });
      console.log(`✅ Notified ${peerPubkey.slice(0, 8)}... of rejection`);
    } else {
      console.log(`⚠️  Peer ${peerPubkey.slice(0, 8)}... is offline`);
    }
  });

  socket.on('disconnect', () => {
    if (socket.publicKey) {
      onlineUsers.delete(socket.publicKey);
      console.log('User disconnected:', socket.publicKey);
    }
  });
});

// ========== HELPERS ==========

// Toggle reaction: remove if already reacted, else remove from other emojis and add
function applyReactionToggle(reactions, emoji, userId) {
  const alreadyReacted = reactions[emoji]?.includes(userId);

  if (alreadyReacted) {
    const index = reactions[emoji].indexOf(userId);
    reactions[emoji].splice(index, 1);
    if (reactions[emoji].length === 0) delete reactions[emoji];
  } else {
    // Remove from all other reactions first
    for (const [existingEmoji, users] of Object.entries(reactions)) {
      const index = users.indexOf(userId);
      if (index > -1) {
        users.splice(index, 1);
        if (users.length === 0) delete reactions[existingEmoji];
      }
    }
    if (!reactions[emoji]) reactions[emoji] = [];
    reactions[emoji].push(userId);
  }
}

// ========== STARTUP ==========

const PORT = process.env.PORT || 3001;

async function start() {
  try {
    const dbReady = await db.initDatabase();
    if (dbReady) {
      console.log('✅ Database connected and initialized');
    }
  } catch (err) {
    console.error('⚠️  Database initialization failed, falling back to in-memory:', err.message);
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Mukon Messenger backend running on port ${PORT}`);
    console.log(`Storage: ${db.isEnabled() ? 'PostgreSQL' : 'in-memory (no DATABASE_URL)'}`);
    console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT} (accessible from Android emulator at ws://10.0.2.2:${PORT})`);
    console.log(`HTTP endpoint: http://0.0.0.0:${PORT}`);
  });
}

start();
