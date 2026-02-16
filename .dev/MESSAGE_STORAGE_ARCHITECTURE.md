# Message Storage Architecture

## Current State (Hackathon MVP)

**Where messages live:**
- ❌ NOT on-chain (too expensive, bad UX)
- ❌ NOT on devices (no local storage implemented)
- ✅ On backend server (Fly.io) in-memory only

**Current flow:**
```
User A → Backend (stores in Map) → User B
              ↓
         (permanent storage)
         (wiped on redeploy)
```

**Problems:**
1. Messages wiped when backend redeploys
2. Server sees metadata (who talks to whom, when)
3. Storage costs grow with every message
4. Users must trust server
5. Single point of failure

---

## Why NOT On-Chain?

**Gas fees + UX disaster:**
```
User types "hey" → Sign transaction → Pay gas → Wait for confirmation
                     ↓
               Repeat 50x per day = Nobody uses your app
```

**Even with Solana's cheap fees (~$0.0001/tx):**
- Cost isn't the issue (only $0.005 for 50 messages/day)
- **Signing every message** = Terrible UX
- Users won't tolerate it

**On-chain should ONLY be for state (rare operations):**
- ✅ Profile updates
- ✅ Contact invitations
- ✅ Group creation
- ✅ Key backups
- ❌ **NOT messages** (too frequent)

---

## Signal Model: Server as Dumb Relay

**How Signal/WhatsApp actually work:**

```
User A Device              Server              User B Device
     |                       |                       |
     |--- Encrypted msg ---->|                       |
     |                       |                       |
     |                  [Queue temp]                 |
     |                  (30 days max)                |
     |                       |                       |
     |                       |<--- B comes online ---|
     |                       |                       |
     |                       |--- Deliver msg ------>|
     |                       |                       |
     |                  [DELETE msg]                 |
     |                       |                       |
  [Stores                                      [Stores
   locally]                                     locally]
```

**Server's only job:**
1. Receive encrypted blob from sender
2. Queue for offline recipient (temporary storage)
3. Deliver when recipient comes online
4. **DELETE immediately after delivery**
5. If not delivered in 30 days → DELETE

**Server NEVER:**
- Stores messages permanently
- Knows message content (encrypted)
- Keeps long-term metadata (who talks to whom)

**All history lives on user devices.**

---

## Storage Requirements Analysis

### Text Messages Only

**Average encrypted message:**
```json
{
  "encrypted": "base64_string",  // ~100 bytes
  "nonce": "base64",              // ~24 bytes
  "sender": "pubkey",             // ~44 bytes
  "timestamp": 1234567890,        // ~8 bytes
  "reactions": {},                // ~50 bytes
  "replyTo": "msgId"              // ~20 bytes
}
Total: ~250 bytes per message
```

**Storage math:**
- 100 messages = 25 KB
- 1,000 messages = 250 KB
- 10,000 messages = 2.5 MB
- **100,000 messages = 25 MB** (years of chat history)

**Verdict: Text is CHEAP** ✅

### With Photos/Media

**Average sizes:**
- Compressed photo (JPEG): 500 KB - 2 MB
- Video (30s, 720p): 5-20 MB
- Audio (1 min): 500 KB - 1 MB

**Storage math:**
- 100 photos = 50-200 MB
- 1,000 photos = 500 MB - 2 GB
- 100 videos = 500 MB - 2 GB

**This gets expensive fast!** ❌

### Solution: Don't Store Media on Device or Server

**Use decentralized/cloud storage:**

**Option 1: IPFS/Arweave (Decentralized, Permanent)**
```
User sends photo:
1. Compress photo (client-side)
2. Upload to IPFS → Get hash (QmXxxx...)
3. Send message with IPFS hash (~50 bytes)
4. Recipient downloads from IPFS when viewing
5. Device caches recent 50 photos (~100 MB)

Cost: ~$0.001-$0.01 per MB on Arweave (one-time, permanent)
Privacy: Public unless encrypted before upload
```

**Option 2: S3/CDN (Centralized, Temporary)**
```
1. Upload to S3 bucket (presigned URL)
2. Get temporary URL (expires in 90 days)
3. Send URL in message
4. Recipient downloads on-demand

Cost: ~$0.023/GB storage + $0.09/GB transfer
Privacy: Better (not public, expires)
```

**Option 3: WebRTC P2P (Best for Privacy!)**
```
If both users online:
1. Establish WebRTC peer connection
2. Send photo directly peer-to-peer
3. No server involved at all
4. Save to device only

Cost: FREE
Privacy: MAXIMUM (server never sees photo)
```

---

## Recommended Architecture

### Three-Tier Storage Model

```
┌─────────────────────────────────────────────────────┐
│              TIER 1: Device Storage                 │
│                    (Primary)                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  • AsyncStorage/SQLite for text messages           │
│  • Encrypted database (wallet-derived key)         │
│  • Unlimited history                                │
│  • ~25 MB for 100k messages                         │
│  • Cache recent 50 photos (~100 MB)                 │
│                                                     │
│  Pros: Fast, offline, private, you own it          │
│  Cons: Lost if device broken (need backup)         │
│                                                     │
└─────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────┐
│         TIER 2: Server Relay (Temporary)            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  • Queue for offline users (7-30 days max)          │
│  • Delete immediately after delivery                │
│  • No permanent storage                             │
│  • Max ~1 GB queue (rotating)                       │
│                                                     │
│  Purpose: Bridge for offline users only            │
│                                                     │
└─────────────────────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────┐
│    TIER 3: Encrypted Backup (Optional Recovery)    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  • On-chain encrypted backup (like group keys)      │
│  • Encrypted with wallet-derived key               │
│  • Solana/Arweave/IPFS                              │
│  • Recover after device loss                        │
│                                                     │
│  Purpose: Disaster recovery only                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Media Storage

```
┌─────────────────────────────────────────────────────┐
│              Photos/Videos/Files                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  PRIMARY: IPFS/Arweave                              │
│    • Upload encrypted before sending                │
│    • Send IPFS hash in message                      │
│    • Download on-demand when viewing                │
│    • Cost: ~$0.001/MB (permanent)                   │
│                                                     │
│  FALLBACK: WebRTC P2P (if both online)              │
│    • Direct peer-to-peer transfer                   │
│    • Server never sees media                        │
│    • Cost: FREE                                     │
│                                                     │
│  CACHE: Device (recent 50 items)                    │
│    • ~100 MB local cache                            │
│    • Auto-cleanup old media                         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Device Storage (2 hours)

**Install dependencies:**
```bash
npm install @react-native-async-storage/async-storage
# Or for better performance:
npm install react-native-quick-sqlite
```

**Add storage utilities:**
```typescript
// app/src/utils/storage.ts

import AsyncStorage from '@react-native-async-storage/async-storage';

// Save message
export async function saveMessage(conversationId: string, message: Message) {
  const key = `messages:${conversationId}`;
  const existing = await AsyncStorage.getItem(key);
  const messages = existing ? JSON.parse(existing) : [];
  messages.push(message);
  await AsyncStorage.setItem(key, JSON.stringify(messages));
}

// Load messages
export async function loadMessages(conversationId: string): Promise<Message[]> {
  const key = `messages:${conversationId}`;
  const data = await AsyncStorage.getItem(key);
  return data ? JSON.parse(data) : [];
}

// Delete conversation
export async function deleteConversation(conversationId: string) {
  const key = `messages:${conversationId}`;
  await AsyncStorage.removeItem(key);
}
```

**Update MessengerContext:**
```typescript
// On send
socket.emit('send_message', data);
await saveMessage(conversationId, data); // Save locally

// On receive
socket.on('new_message', async (message) => {
  await saveMessage(message.conversationId, message); // Save locally
  // Update UI state
});

// On mount
const messages = await loadMessages(conversationId);
setMessages(messages);
```

### Phase 2: Relay-Only Server (1 hour)

**Update backend:**
```javascript
// backend/src/index.js

// Replace permanent storage
// const messages = new Map(); // ❌ DELETE THIS

// Add temporary queue
const messageQueue = new Map(); // conversationId -> { messages, expiry }
const QUEUE_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days

socket.on('send_message', (data) => {
  // If recipient online, deliver immediately (don't store)
  const recipientSocket = onlineUsers.get(data.recipient);

  if (recipientSocket) {
    io.to(recipientSocket).emit('new_message', data);
    console.log('✅ Delivered immediately, not stored');
    return;
  }

  // Recipient offline, queue temporarily
  const conversationId = data.conversationId;

  if (!messageQueue.has(conversationId)) {
    messageQueue.set(conversationId, {
      messages: [],
      expiry: Date.now() + QUEUE_EXPIRY
    });
  }

  messageQueue.get(conversationId).messages.push(data);
  console.log('📬 Queued for offline user');
});

// When user comes online, deliver queued messages
socket.on('user_online', ({ pubkey }) => {
  // Find all queued messages for this user
  for (const [conversationId, queue] of messageQueue.entries()) {
    const userMessages = queue.messages.filter(msg =>
      msg.recipient === pubkey
    );

    userMessages.forEach(msg => {
      socket.emit('new_message', msg);
    });

    // Remove delivered messages from queue
    queue.messages = queue.messages.filter(msg =>
      msg.recipient !== pubkey
    );

    // If queue empty, delete
    if (queue.messages.length === 0) {
      messageQueue.delete(conversationId);
    }
  }
});

// Cleanup expired messages daily
setInterval(() => {
  for (const [id, queue] of messageQueue.entries()) {
    if (Date.now() > queue.expiry) {
      console.log(`🗑️ Deleted expired queue: ${id}`);
      messageQueue.delete(id);
    }
  }
}, 24 * 60 * 60 * 1000);
```

### Phase 3: IPFS Media Support (4 hours)

**Install IPFS client:**
```bash
npm install ipfs-http-client
```

**Add media upload:**
```typescript
// app/src/utils/media.ts

import { create } from 'ipfs-http-client';

const ipfs = create({ url: 'https://ipfs.infura.io:5001/api/v0' });

export async function uploadPhoto(photoUri: string): Promise<string> {
  // 1. Read photo from device
  const response = await fetch(photoUri);
  const blob = await response.blob();

  // 2. Compress (optional)
  const compressed = await compressImage(blob);

  // 3. Encrypt with random key
  const key = nacl.randomBytes(32);
  const encrypted = nacl.secretbox(compressed, nonce, key);

  // 4. Upload to IPFS
  const result = await ipfs.add(encrypted);
  const ipfsHash = result.path; // QmXxxx...

  // 5. Return hash + encryption key
  return JSON.stringify({ hash: ipfsHash, key: bs58.encode(key) });
}

export async function downloadPhoto(ipfsData: string): Promise<string> {
  const { hash, key } = JSON.parse(ipfsData);

  // 1. Download from IPFS
  const chunks = [];
  for await (const chunk of ipfs.cat(hash)) {
    chunks.push(chunk);
  }
  const encrypted = Buffer.concat(chunks);

  // 2. Decrypt
  const decrypted = nacl.secretbox.open(encrypted, nonce, bs58.decode(key));

  // 3. Save to cache
  const uri = await saveToCache(decrypted);
  return uri;
}
```

### Phase 4: On-Chain Backup (Optional, 6 hours)

**Similar to GroupKeyShare:**
```rust
// Add to program
#[account]
pub struct MessageBackup {
    pub owner: Pubkey,
    pub encrypted_messages: Vec<u8>,  // Compressed + encrypted
    pub last_backup: i64,
}

// Instruction to backup
pub fn backup_messages(
    ctx: Context<BackupMessages>,
    encrypted_data: Vec<u8>
) -> Result<()> {
    // Store encrypted message history on-chain
    // User pays rent (~0.01 SOL per 10KB)
    // Can recover by fetching PDA after device loss
}
```

---

## Storage Comparison

| Metric | Current | Signal Model | With IPFS Media |
|--------|---------|--------------|-----------------|
| **Device Storage** | 0 MB | 20-50 MB text + 100 MB cache | 20-50 MB text + 100 MB cache |
| **Server Storage** | Growing forever | Temp queue (~1 GB max) | Temp queue only |
| **Media Storage** | N/A | Device only | IPFS (permanent, $0.001/MB) |
| **Privacy** | Low (server sees all) | High (server is relay) | Maximum (encrypted + decentralized) |
| **Multi-device** | Yes (server storage) | Via encrypted backup | Via on-chain backup |
| **Cost to run** | Growing | Fixed (~$10/mo) | Fixed (~$10/mo) |
| **Censorship** | Single point of failure | Single point of failure | Resistant (IPFS + on-chain) |

---

## Migration Timeline

**For Hackathon (Now):**
- ✅ Keep current architecture (it works)
- ✅ Document as "MVP limitation"

**Post-Hackathon Week 1:**
- [ ] Add AsyncStorage device storage (2 hours)
- [ ] Convert server to temp relay (1 hour)
- [ ] Test with 2 devices (1 hour)

**Post-Hackathon Week 2:**
- [ ] Add IPFS media support (4 hours)
- [ ] Add on-chain backup option (6 hours)

**Post-Hackathon Week 3:**
- [ ] Add WebRTC P2P (optional, 8 hours)
- [ ] Polish UX (loading states, sync indicators)

**Total effort: ~22 hours over 3 weekends**

---

## Benefits of This Architecture

**Privacy:**
- ✅ Server can't read messages (E2E encrypted)
- ✅ Server doesn't store messages long-term (relay only)
- ✅ Media on IPFS (encrypted before upload)
- ✅ On-chain backup (encrypted with wallet key)

**Sovereignty:**
- ✅ Your data lives on YOUR device
- ✅ Censorship resistant (IPFS + Solana)
- ✅ Can recover everything with just your wallet
- ✅ No company can delete your account

**Cost:**
- ✅ Server costs fixed (~$10/mo for relay)
- ✅ Media storage cheap (~$0.001/MB one-time)
- ✅ Users pay nothing (except optional on-chain backup)

**UX:**
- ✅ No gas fees for messaging
- ✅ Offline access to history
- ✅ Fast (local storage)
- ✅ Multi-device via encrypted backup

---

## Competitive Comparison

| Feature | Mukon (Proposed) | Signal | WhatsApp | Telegram |
|---------|------------------|--------|----------|----------|
| **E2E Encryption** | ✅ (NaCl) | ✅ | ✅ | ❌ (only secret chats) |
| **Device Storage** | ✅ | ✅ | ✅ | ❌ (cloud) |
| **Decentralized Media** | ✅ (IPFS) | ❌ | ❌ | ❌ |
| **Wallet Identity** | ✅ (Solana) | ❌ (phone) | ❌ (phone) | ❌ (phone) |
| **Account Recovery** | ✅ (on-chain backup) | ❌ | ❌ (iCloud) | ✅ (cloud) |
| **Censorship Resistant** | ✅ | ❌ | ❌ | ❌ |
| **Open Source** | ✅ | ✅ | ❌ | ❌ |

**Mukon's unique advantage:** Blockchain + privacy = sovereign messaging

---

## Final Recommendation

**Implement Signal model post-hackathon:**

1. **Device-first storage** (primary)
2. **Server as relay only** (temporary queue)
3. **IPFS for media** (decentralized)
4. **On-chain backup** (recovery, like group keys)

This gives you:
- Maximum privacy (server is dumb relay)
- Sovereign data (you control it)
- Censorship resistance (blockchain + IPFS)
- WhatsApp-level UX (no gas fees, fast, reliable)

**Differentiator from Signal:** Wallet-based identity + on-chain recovery = truly unstoppable messaging.

---

**Status:** Documented for post-hackathon implementation
**Priority:** High (core product differentiator)
**Effort:** ~22 hours over 3 weekends
**Impact:** Massive (true privacy + sovereignty)
