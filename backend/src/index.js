const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PublicKey } = require('@solana/web3.js');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default; // bs58 v6 uses default export

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json());

// In-memory storage (replace with Redis/DB in production)
const messages = new Map(); // conversationId -> Message[]
const onlineUsers = new Map(); // pubkey -> socket.id
// Group storage
const groupMessages = new Map(); // groupId -> Message[]
const groupRooms = new Map(); // groupId -> Set<socket.id>
const pendingKeyShares = new Map(); // groupId -> Map<recipientPubkey, { encryptedKey, nonce, senderPubkey }>
const groupAvatars = new Map(); // groupId -> emoji string (Fix 4)
// Read receipt persistence (Fix: persist read status across sessions)
const readReceipts = new Map(); // conversationId -> Map<readerPubkey, latestTimestamp>
const groupReadReceipts = new Map(); // groupId -> Map<readerPubkey, latestTimestamp>

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
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.post('/messages', async (req, res) => {
  try {
    const { conversationId, encrypted, nonce, sender, signature } = req.body;

    // Verify signature
    const message = `Send message to ${conversationId}`;
    if (!verifySignature(sender, message, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Store message
    if (!messages.has(conversationId)) {
      messages.set(conversationId, []);
    }

    const messageData = {
      id: Date.now().toString(),
      sender,
      encrypted,
      nonce,
      timestamp: Date.now()
    };

    messages.get(conversationId).push(messageData);

    // Broadcast to conversation participants
    io.to(conversationId).emit('new_message', messageData);

    res.json({ success: true, messageId: messageData.id });
  } catch (error) {
    console.error('Error posting message:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/messages/:conversationId', (req, res) => {
  const { conversationId } = req.params;
  const { sender, signature } = req.query;

  // Accept encryption signature as proof of wallet ownership
  const encryptionMessage = 'Sign this message to derive your encryption keys for Mukon Messenger';
  if (!verifySignature(sender, encryptionMessage, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const conversationMessages = messages.get(conversationId) || [];

  // Get persisted read receipts for this conversation (Fix: persistent read ticks)
  const receipts = readReceipts.get(conversationId) || new Map();
  const readTimestamps = Array.from(receipts.entries()).map(([pubkey, timestamp]) => ({
    pubkey,
    timestamp
  }));

  res.json({
    messages: conversationMessages,
    readTimestamps
  });
});

// Group messages endpoint
app.get('/group-messages/:groupId', (req, res) => {
  const { groupId } = req.params;
  const { sender, signature } = req.query;

  // Accept encryption signature as proof of wallet ownership
  const encryptionMessage = 'Sign this message to derive your encryption keys for Mukon Messenger';
  if (!verifySignature(sender, encryptionMessage, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const msgs = groupMessages.get(groupId) || [];

  // Get persisted read receipts for this group (Fix: persistent read ticks)
  const receipts = groupReadReceipts.get(groupId) || new Map();
  const readTimestamps = Array.from(receipts.entries()).map(([pubkey, timestamp]) => ({
    pubkey,
    timestamp
  }));

  res.json({
    messages: msgs,
    readTimestamps
  });
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

  socket.on('send_message', ({ conversationId, content, encrypted, nonce, sender, timestamp, type, replyTo }) => {
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
    if (!messages.has(conversationId)) {
      messages.set(conversationId, []);
    }
    messages.get(conversationId).push(messageData);

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

  socket.on('delete_message', ({ conversationId, messageId, deleteForBoth }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    if (deleteForBoth) {
      // Delete from backend storage (delete for everyone)
      const msgs = messages.get(conversationId) || [];
      const filtered = msgs.filter(m => m.id !== messageId);
      messages.set(conversationId, filtered);

      // Broadcast deletion to everyone in room
      io.to(conversationId).emit('message_deleted', { conversationId, messageId });
      console.log(`Message ${messageId} deleted for everyone in ${conversationId}`);
    }
    // If deleteForBoth is false, client handles local deletion only
  });

  socket.on('add_reaction', ({ conversationId, messageId, emoji, userId }) => {
    console.log(`📨 add_reaction received:`, { conversationId: conversationId.slice(0, 8) + '...', messageId, emoji, userId: userId.slice(0, 8) + '...' });

    if (!socket.publicKey) {
      console.error('❌ Not authenticated');
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    // Find the message and add reaction
    const msgs = messages.get(conversationId) || [];
    console.log(`Found ${msgs.length} messages in conversation`);
    const message = msgs.find(m => m.id === messageId);

    if (message) {
      console.log(`✅ Found message ${messageId}`);
      if (!message.reactions) {
        message.reactions = {};
      }

      // Check if user already reacted with this emoji
      const alreadyReacted = message.reactions[emoji]?.includes(userId);

      if (alreadyReacted) {
        // REMOVE the reaction (toggle off)
        const index = message.reactions[emoji].indexOf(userId);
        message.reactions[emoji].splice(index, 1);
        console.log(`🗑️  User removed reaction ${emoji}`);

        // Clean up empty reaction arrays
        if (message.reactions[emoji].length === 0) {
          delete message.reactions[emoji];
        }
      } else {
        // REMOVE user from all other reactions (only one reaction per user)
        for (const [existingEmoji, users] of Object.entries(message.reactions)) {
          const index = users.indexOf(userId);
          if (index > -1) {
            users.splice(index, 1);
            console.log(`🗑️  Removed user from ${existingEmoji}`);
            // Clean up empty reaction arrays
            if (users.length === 0) {
              delete message.reactions[existingEmoji];
            }
          }
        }

        // Add user to new reaction
        if (!message.reactions[emoji]) {
          message.reactions[emoji] = [];
        }
        message.reactions[emoji].push(userId);
        console.log(`✅ User now reacting with ${emoji}`);
      }

      // Broadcast updated reactions to everyone in conversation
      const room = io.sockets.adapter.rooms.get(conversationId);
      const roomSize = room ? room.size : 0;
      console.log(`Broadcasting reaction to ${roomSize} clients in room`);

      io.to(conversationId).emit('reaction_updated', {
        conversationId,
        messageId,
        reactions: message.reactions
      });

      console.log(`✅ Reaction ${emoji} added to message ${messageId} by ${userId.slice(0, 8)}... Final reactions:`, message.reactions);
    } else {
      console.error(`❌ Message ${messageId} not found in conversation ${conversationId.slice(0, 8)}...`);
    }
  });

  socket.on('typing', ({ conversationId }) => {
    socket.to(conversationId).emit('user_typing', {
      publicKey: socket.publicKey
    });
  });

  socket.on('messages_read', ({ conversationId, readerPubkey, latestTimestamp }) => {
    // Persist read receipt (Fix: persistent read ticks across sessions)
    if (!readReceipts.has(conversationId)) {
      readReceipts.set(conversationId, new Map());
    }
    const existing = readReceipts.get(conversationId).get(readerPubkey) || 0;
    if (latestTimestamp > existing) {
      readReceipts.get(conversationId).set(readerPubkey, latestTimestamp);
      console.log(`💾 Persisted read receipt: ${conversationId.slice(0, 8)}... by ${readerPubkey.slice(0, 8)}... at ${latestTimestamp}`);
    }

    // Forward to all others in the conversation room
    socket.to(conversationId).emit('messages_read', {
      conversationId,
      readerPubkey,
      latestTimestamp,
    });
  });

  socket.on('group_messages_read', ({ groupId, readerPubkey, latestTimestamp }) => {
    // Persist read receipt (Fix: persistent read ticks across sessions)
    if (!groupReadReceipts.has(groupId)) {
      groupReadReceipts.set(groupId, new Map());
    }
    const existing = groupReadReceipts.get(groupId).get(readerPubkey) || 0;
    if (latestTimestamp > existing) {
      groupReadReceipts.get(groupId).set(readerPubkey, latestTimestamp);
      console.log(`💾 Persisted group read receipt: ${groupId.slice(0, 8)}... by ${readerPubkey.slice(0, 8)}... at ${latestTimestamp}`);
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

  socket.on('send_group_message', ({ groupId, encrypted, nonce, sender, timestamp }) => {
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
    if (!groupMessages.has(groupId)) {
      groupMessages.set(groupId, []);
    }
    groupMessages.get(groupId).push(messageData);

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

  socket.on('share_group_key', ({ groupId, recipientPubkey, encryptedKey, nonce }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    console.log(`🔑 Sharing group key for ${groupId.slice(0, 8)}... to ${recipientPubkey.slice(0, 8)}...`);

    // Find recipient's socket
    const recipientSocketId = onlineUsers.get(recipientPubkey);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('group_key_shared', {
        groupId,
        senderPubkey: socket.publicKey,
        encryptedKey,
        nonce,
      });
      console.log('✅ Group key shared via socket');
    } else {
      // Store for later retrieval
      if (!pendingKeyShares.has(groupId)) {
        pendingKeyShares.set(groupId, new Map());
      }
      pendingKeyShares.get(groupId).set(recipientPubkey, {
        encryptedKey,
        nonce,
        senderPubkey: socket.publicKey
      });
      console.log('📦 Stored pending key share for offline user');
    }
  });

  socket.on('request_group_key', ({ groupId }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    const pending = pendingKeyShares.get(groupId)?.get(socket.publicKey);
    if (pending) {
      socket.emit('group_key_shared', {
        groupId,
        senderPubkey: pending.senderPubkey,
        encryptedKey: pending.encryptedKey,
        nonce: pending.nonce,
      });
      pendingKeyShares.get(groupId).delete(socket.publicKey);
      console.log(`🔑 Delivered pending key share for ${groupId.slice(0, 8)}... to ${socket.publicKey.slice(0, 8)}...`);
    } else {
      // No pending share — ask other online group members to share their key
      console.log(`⚠️ No pending key share, broadcasting key request to group room ${groupId.slice(0, 8)}...`);
      socket.to(`group_${groupId}`).emit('group_key_needed', {
        groupId,
        requesterPubkey: socket.publicKey,
      });
    }
  });

  // Group avatar handlers (Fix 4)
  socket.on('set_group_avatar', ({ groupId, avatar }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    groupAvatars.set(groupId, avatar);
    console.log(`🎨 Group avatar set for ${groupId.slice(0, 8)}... to ${avatar}`);

    // Broadcast to all group members
    socket.to(`group_${groupId}`).emit('group_avatar_updated', { groupId, avatar });
  });

  socket.on('get_group_avatar', ({ groupId }, callback) => {
    const avatar = groupAvatars.get(groupId) || null;
    if (callback) callback(avatar);
  });

  socket.on('add_group_reaction', ({ groupId, messageId, emoji, userId }) => {
    console.log(`📨 add_group_reaction received:`, { groupId: groupId.slice(0, 8) + '...', messageId, emoji });

    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    const msgs = groupMessages.get(groupId) || [];
    const message = msgs.find(m => m.id === messageId);

    if (message) {
      if (!message.reactions) {
        message.reactions = {};
      }

      // Toggle logic (same as DMs)
      const alreadyReacted = message.reactions[emoji]?.includes(userId);

      if (alreadyReacted) {
        const index = message.reactions[emoji].indexOf(userId);
        message.reactions[emoji].splice(index, 1);
        if (message.reactions[emoji].length === 0) {
          delete message.reactions[emoji];
        }
      } else {
        // Remove from other reactions
        for (const [existingEmoji, users] of Object.entries(message.reactions)) {
          const index = users.indexOf(userId);
          if (index > -1) {
            users.splice(index, 1);
            if (users.length === 0) {
              delete message.reactions[existingEmoji];
            }
          }
        }

        // Add new reaction
        if (!message.reactions[emoji]) {
          message.reactions[emoji] = [];
        }
        message.reactions[emoji].push(userId);
      }

      // Broadcast
      io.to(`group_${groupId}`).emit('group_reaction_updated', {
        groupId,
        messageId,
        reactions: message.reactions,
      });
    }
  });

  socket.on('delete_group_message', ({ groupId, messageId, deleteForBoth }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    if (deleteForBoth) {
      const msgs = groupMessages.get(groupId) || [];
      const filtered = msgs.filter(m => m.id !== messageId);
      groupMessages.set(groupId, filtered);

      io.to(`group_${groupId}`).emit('group_message_deleted', { groupId, messageId });
      console.log(`Message ${messageId} deleted for everyone in group ${groupId.slice(0, 8)}...`);
    }
  });

  // Fix 2g: Handle group deletion
  socket.on('group_deleted', ({ groupId }) => {
    if (!socket.publicKey) {
      socket.emit('error', { message: 'Not authenticated' });
      return;
    }

    console.log(`🗑️  Group ${groupId.slice(0, 8)}... deleted by creator`);

    // Clean up all group data
    groupMessages.delete(groupId);
    groupRooms.delete(groupId);
    pendingKeyShares.delete(groupId);
    groupAvatars.delete(groupId);
    groupReadReceipts.delete(groupId);

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

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Mukon Messenger backend running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://0.0.0.0:${PORT} (accessible from Android emulator at ws://10.0.2.2:${PORT})`);
  console.log(`HTTP endpoint: http://0.0.0.0:${PORT}`);
});
