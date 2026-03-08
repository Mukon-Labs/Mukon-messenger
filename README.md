# Mukon Messenger

**Privacy-first, wallet-to-wallet encrypted messenger for Solana Mobile**

Built for the Solana Mobile Monolith Hackathon 2026

---

## 🚀 Live Demo

**Program ID (Devnet):** `54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy`

**Backend:** https://backend-rough-bird-7310.fly.dev

**APK Download:** [Google Drive link] *(see Submission section)*

**Status:** ✅ Fully functional MVP — E2E encrypted DMs, group chats, voice calls, on-chain key backup

---

## What is Mukon?

Mukon Messenger is a **truly private messaging app** where your wallet is your identity. No phone numbers, no email addresses, no centralized servers storing your data.

**Key Features:**
- **End-to-end encrypted DMs** (NaCl box asymmetric encryption)
- **Encrypted group chats** (NaCl secretbox with on-chain key backup)
- **Voice calls** (WebRTC audio through Socket.IO signaling)
- **On-chain encrypted key recovery** — Your group keys are backed up encrypted on-chain, so clearing app data doesn't lock you out (WhatsApp/Signal can't do this)
- **1-click session keys** — Sign once at login, all on-chain operations are automatic (no wallet popups)
- **Token-gated groups** — Require SPL token balance to join
- **Contact lists encrypted with Arcium MPC v0.8.0** (3 circuits live on devnet)
- **Local-first architecture** — Messages stored on device, works offline, backend is temporary relay
- **QR code contact sharing** — Share wallet address as QR, scan to add contacts
- **Wallet-based identity** — Your Solana wallet is your account, no phone number needed

**Why It Matters:**

WhatsApp/Telegram/Signal can delete your account and you lose everything. With Mukon:
- Your identity lives on-chain (Solana wallet)
- Your relationships live on-chain (contact lists)
- Your group memberships live on-chain (encrypted)
- Your group keys backed up on-chain (encrypted with your wallet key)
- **You can recover everything** just by connecting your wallet

This is **sovereign social networking** - you own your data, not us.

---

## Quick Start (For Judges/Reviewers)

### Prerequisites

- Android device (physical or emulator)
- Solana wallet app (Phantom, Solflare, etc.)
- ADB or wireless debugging enabled

### Option A: Use Our Backend (Recommended)

The easiest way to test - no backend setup required!

```bash
# 1. Clone repo
git clone https://github.com/yourusername/mukon-messenger
cd mukon-messenger/app

# 2. Install dependencies
npm install

# 3. Build and install APK
npm run build  # Creates mukon-debug.apk in app/ directory

# 4. Install on device
adb install mukon-debug.apk

# 5. Open app and connect your wallet
# Backend URL is pre-configured: https://backend-rough-bird-7310.fly.dev
```

**Note:** The backend is deployed on Fly.io with Postgres persistence. Messages are stored locally on your device (local-first architecture). On-chain data (profiles, contacts, groups, key backups) persists on Solana.

### Option B: Run Local Backend (Optional)

If you want to run everything locally:

```bash
# 1. Start backend
cd backend
npm install
npm start
# Backend runs on http://localhost:3001

# 2. Update backend URL in app/src/config.ts
# Change BACKEND_URL to your local IP for physical device
# Or use http://10.0.2.2:3001 for Android emulator

# 3. Rebuild app
cd ../app
npm run build:clean
adb install mukon-debug.apk
```

---

## Features

### 📱 Direct Messages (DMs)

- **E2E Encrypted** - NaCl box (Curve25519 + XSalsa20-Poly1305)
- **Contact Invitations** - Invite anyone by wallet address
- **Invite Before Register** - Send invitations to wallets that haven't registered yet
- **Contact Management** - Accept, reject, block, delete contacts
- **Real-time Delivery** - Socket.IO (WebSocket-first) with wallet signature authentication
- **Local-first Storage** - Messages persist on device (AsyncStorage), works offline
- **Push Notifications** - Local notifications via expo-notifications
- **QR Code Sharing** - Share wallet address as QR, scan to add contacts
- **Voice Calls** - WebRTC audio calls with Socket.IO signaling (call, ring, answer, decline)
- **Message Deletion** - Delete for self or delete for everyone (sender only)

### 👥 Group Chats

- **Encrypted Group Messaging** - NaCl secretbox (symmetric encryption)
- **Up to 30 Members** - Optimized for small, private groups
- **On-chain Key Backup** - **Unique feature!** Group keys stored encrypted on-chain
  - Keys encrypted with member's wallet-derived encryption key
  - Survive app data deletion / device change
  - Just connect wallet to recover all group access
- **On-chain Key Distribution** - Admin stores encrypted keys on-chain at invite time
  - Invitees recover keys from chain even if offline during invite
  - No dependency on WebSocket for key delivery
- **Key Rotation on Kick** - New group secret generated and distributed to remaining members
- **Session Keys (1-click UX)** - Sign once at login, all group operations are automatic
- **Any Member Can Invite** - Democratic group growth (admin can kick)
- **Token Gating** - Require SPL token balance to join (configurable)
- **Group Management** - Rename (admin), leave, kick members (admin)

### 🎨 Profile & Identity

- **Emoji Avatars** - 200+ curated emojis (faces, animals, objects, symbols)
- **Always-editable Username** - Update anytime
- **Domain Resolution** - Displays .sol/.skr domain names (SNS integration)
- **Custom Contact Names** - Rename contacts locally (saved to AsyncStorage)
- **Name Priority:** Custom name > Domain > On-chain name > Wallet address

### 💬 Rich Messaging

- **Message Reactions** - Quick react (❤️ 🔥 💯 😂 👍 👎) or full emoji picker
- **Reply to Messages** - Quoted text with context (Telegram-style)
- **Copy to Clipboard** - Copy message text
- **Message History** - Persistent across sessions
- **Duplicate Detection** - De-dupes by (encrypted+nonce+sender)

### 🔐 Privacy Features

- **Arcium MPC Integration (v0.8.0)** - Relationship status verified privately via multi-party computation
  - Status: 3 circuits live on devnet
  - Circuits: `is_mutual_contact` (30K gates), `count_accepted` (507M ACUs), `add_two_numbers` (473M ACUs)
  - Allows private relationship verification without revealing contact graph
- **Per-Relationship PDAs** - Each contact pair has its own on-chain account (82 bytes)
  - Canonical ordering: same PDA regardless of who initiates
  - Replaces monolithic contact list (WalletDescriptor) for better privacy + efficiency
- **No Metadata Leakage** - Relay servers only see encrypted blobs
- **Wallet-based Auth** - No passwords, no email, no phone number
- **On-chain Encrypted Storage** - Relationships stored on Solana, encrypted

---

## Architecture

### Layer 1: On-Chain (Solana Program)

**Program ID:** `54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy`

**Accounts:**
- `UserProfile` - Display name, avatar, encryption public key
- `Relationship` - Per-pair PDA for DM contacts (canonical ordering, status per side)
  - Seeds: `["relationship", min(a,b), max(a,b), version]` — 82 bytes
  - Status values: 0=Empty, 1=Invited, 2=Requested, 3=Accepted, 4=Rejected, 5=Blocked
- `Conversation` - Chat metadata (participants, created_at)
- `Group` - Group metadata, members list, token gate, encryption public key
- `GroupInvite` - Pending group invitations
- `GroupKeyShare` - Encrypted group key backup per member (for recovery)
- `SessionToken` - Session key delegation (1-click UX, no repeated wallet popups)
- `WalletDescriptor` - **LEGACY** — use `close_wallet_descriptor` to reclaim rent

**Instructions:**
```rust
// DM Instructions (9)
register()                  // Create profile
update_profile()            // Update name/avatar/encryption key
invite()                    // Create Relationship PDA + Conversation PDA
accept()                    // Set both statuses to Accepted
reject()                    // Set both statuses to Rejected
block()                     // Set both statuses to Blocked
unblock()                   // Blocked → Rejected (allows re-invite)
close_profile()             // Close profile (devnet only)
close_wallet_descriptor()   // Close legacy WalletDescriptor + recover rent

// Group Instructions (11)
create_group()                  // Create new group
update_group()                  // Rename group (admin only)
invite_to_group()               // Invite member (any member can invite)
accept_group_invite()           // Join group (checks token gate)
reject_group_invite()           // Decline invitation
leave_group()                   // Leave group
kick_member()                   // Kick member (admin only) + triggers key rotation
close_group()                   // Delete group (admin only)
store_group_key()               // Store encrypted key on-chain for recovery
store_group_key_for_member()    // Admin stores key for invitee (on-chain distribution)
close_group_key()               // Close key share + recover rent

// Session Instructions (2)
create_session()            // Register device keypair for auto-signing
revoke_session()            // Revoke session key
```

### Layer 2: Off-Chain Backend (Fly.io)

**Backend URL:** https://backend-rough-bird-7310.fly.dev

**Technology:** Node.js + Express + Socket.IO + Fly.io Postgres

**Role:** Temporary encrypted relay — NOT permanent storage. Messages buffered until client acknowledges, then deleted.

**Features:**
- Real-time message delivery (WebSocket-first, single machine for session affinity)
- Wallet signature authentication
- Postgres persistence (messages, read receipts, group avatars, pending key shares)
- Local-first architecture — clients store messages on device, backend is delivery buffer
- Group key distribution (WebSocket + on-chain fallback)
- Key rotation broadcast (`group_key_rotated` event)
- Message deletion support
- Read receipt tracking

**Socket.IO Events:**
```typescript
// Client → Server
authenticate           // Sign challenge with wallet
send_message          // Send encrypted DM
group_message         // Send encrypted group message
group_key_share       // Share group key with member
request_group_key     // Request group key if offline
mark_messages_read    // Update read receipt
delete_message        // Delete message for everyone
invitation_rejected   // Notify peer of rejection
call_offer            // Initiate WebRTC voice call
call_answer           // Accept incoming call
call_ice_candidate    // ICE candidate for WebRTC
call_end / call_decline / call_busy  // Call lifecycle

// Server → Client
new_message           // Receive DM
group_message         // Receive group message
group_key_shared      // Receive group key
messages_read         // Peer read your messages
message_deleted       // Message deleted by sender
invitation_rejected   // Your invitation was rejected
call_offer / call_answer / call_ice_candidate  // Call signaling relay
```

### Layer 3: Client (React Native)

**Technology:** React Native + Expo 51

**Key Components:**
- `MessengerContext.tsx` - Centralized socket, encryption, state management
- `WalletContext.tsx` - Solana Mobile Wallet Adapter integration
- `transactions.ts` - Manual transaction builders (Anchor-compatible)
- `encryption.ts` - NaCl encryption utilities
- `domains.ts` - .sol/.skr domain resolution (SNS)

**Screens:**
- `ContactsScreen` - Unified conversations (DMs + Groups) with filters
- `ChatScreen` - E2E encrypted messaging with reactions/replies
- `AddContactScreen` - Add contacts by address/QR code
- `GroupInfoScreen` - Group members, settings, management
- `ProfileScreen` - User profile with emoji avatar picker
- `SettingsScreen` - App settings

---

## Group Encryption Model (Key Innovation)

### The Problem with WhatsApp/Signal

If you clear app data or switch devices, you **lose access to all groups** unless you have:
1. A backup file (manual export)
2. iCloud/Google backup (centralized)
3. Recovery codes (hard to manage)

### Our Solution: On-Chain Encrypted Key Backup

When you join a group:

1. **Group Creation:**
   - Admin generates random 32-byte `group_secret`
   - Stored locally (AsyncStorage)
   - **Also encrypted with admin's wallet key and stored on-chain** (GroupKeyShare PDA)

2. **Inviting Members:**
   - Admin encrypts `group_secret` with invitee's public encryption key (NaCl box)
   - **Stored on-chain** via `store_group_key_for_member` (invitee can recover even if offline)
   - Also sent via Socket.IO for immediate delivery

3. **Accepting Invitation:**
   - Member fetches encrypted group key from on-chain GroupKeyShare PDA
   - Decrypts with admin's encryption pubkey + own secret key (NaCl box.open)
   - Stores locally (AsyncStorage)
   - **Also stores own encrypted backup on-chain** (GroupKeyShare PDA)

4. **Key Rotation (on Kick):**
   - Admin generates new `group_secret`
   - Distributes to remaining members (on-chain + socket)
   - Kicked member's old key can't decrypt new messages

5. **Sending Messages:**
   - Encrypt with `group_secret` (NaCl secretbox)
   - Backend broadcasts to group room
   - All members decrypt with same secret

6. **Recovery After Data Loss:**
   - Connect wallet → derive encryption keys from signature
   - Fetch GroupKeyShare PDA from on-chain
   - Decrypt group key with wallet-derived secret
   - **Instant access to all groups!**

**Why This is Powerful:**

- ✅ **Sovereign recovery** - You control the keys (wallet signature)
- ✅ **Censorship resistant** - On-chain storage can't be deleted
- ✅ **Zero trust** - We can't decrypt your keys (encrypted client-side)
- ✅ **No manual backups** - Automatic, transparent to user
- ✅ **Device independence** - Switch devices anytime

This is **impossible** in WhatsApp/Signal because they don't have blockchain. We do.

---

## Arcium MPC Integration

**Status:** ✅ Live on devnet (v0.8.0) — 3 computation definitions deployed

Arcium is a Multi-Party Computation (MPC) network on Solana that allows computation on **encrypted data** without revealing the data itself. We use it to verify contact relationships and count contacts privately — no one can see your social graph.

| Circuit | Cost | Status | Description |
|---------|------|--------|-------------|
| `is_mutual_contact` | ~30K gates | **LIVE** | Verify both sides of a relationship are Accepted |
| `count_accepted` | 507M ACUs | **LIVE** | Count accepted contacts privately |
| `add_two_numbers` | 473M ACUs | **LIVE** | Demo/testing circuit |

**Architecture note:** We originally built an `is_accepted_contact` circuit that compared encrypted 32-byte pubkeys, but it hit 1.17B ACUs (Arcium limit ~700-800M). We pivoted to per-relationship PDAs with `u8` status values — dropping cost from 1.17B to ~30K gates while improving the data model (O(1) lookup, 82 bytes per relationship vs 6.9KB for a 100-contact list).

---

## Light Protocol ZK Compression

**Status:** ✅ V2 Architecture Complete | ⚠️ Disabled on Devnet

Light Protocol enables compressed accounts on Solana — state stored as hashes in Merkle trees with ZK validity proofs, reducing storage costs by ~90%.

**What we built:**
- 5 compressed instructions (group key storage, group invites, accept/reject)
- light-sdk 0.17 V2 CPI integration with 6-account structure
- Client-side proof generation with @lightprotocol/stateless.js
- Targets: `GroupKeyShare` and `GroupInvite` accounts

**Why it's disabled:** Devnet Light System Program panics during `verify_proof`. This is a devnet indexer limitation, not a code issue. The architecture is production-ready — one feature flag (`USE_ZK_COMPRESSION`) away from deployment on mainnet.

---

## Tech Stack

**Blockchain:**
- Solana (devnet)
- Anchor Framework 0.32.1
- Light Protocol SDK 0.17 with V2 (ZK Compression - production-ready, devnet-disabled)
- Arcium v0.8.0 (MPC circuits — 3 live on devnet)

**Backend:**
- Node.js + Express
- Socket.IO (WebSocket-first transport)
- Fly.io (deployment + Postgres persistence)
- PostgreSQL (temporary message buffer, cleaned after delivery)

**Frontend:**
- React Native + Expo 51
- Solana Mobile Wallet Adapter
- TweetNaCl (E2E encryption)
- react-native-webrtc (voice calls)
- React Navigation
- React Native Paper (UI)
- AsyncStorage (local-first message storage)
- expo-notifications (push notifications)
- expo-camera + react-native-qrcode-svg (QR codes)

**Encryption:**
- **DMs:** NaCl box (Curve25519-XSalsa20-Poly1305)
- **Groups:** NaCl secretbox (XSalsa20-Poly1305)
- **On-chain:** Arcium MPC (encrypted computation)
- **Key Derivation:** ECDH from wallet signatures

---

## Testing

### Manual Testing Flow (Two Devices)

**Prerequisites:**
- 2 Android devices with Solana wallets
- Both connected to internet

**Test DMs:**
1. Device 1: Connect wallet → Register → Copy address
2. Device 2: Connect wallet → Register → Copy address
3. Device 1: Add contact (Device 2 address) → Send invitation
4. Device 2: See invitation → Accept
5. Both: Exchange messages → Verify encryption/decryption works

**Test Groups:**
1. Device 1: Create group → Invite Device 2
2. Device 2: Accept invitation → Receive group key
3. Both: Send messages in group → Verify all decrypt correctly
4. Device 1: Clear app data → Reconnect wallet
5. Device 1: Verify group appears and old messages decrypt (on-chain recovery!)

**Test Token Gating:**
1. Device 1: Create group with token requirement (e.g., 100 USDC)
2. Device 2 (without tokens): Try to join → Should fail
3. Device 2: Get tokens → Try again → Should succeed

### Automated Tests

```bash
cd mukon-messenger
anchor test

# Expected: 7/7 tests passing
# - register
# - update_profile
# - invite/accept/reject
# - create_group
# - invite_to_group/accept/reject
# - store_group_key/close_group_key
```

---

## Known Limitations (Devnet MVP)

**Current Issues:**
1. Domain resolution - Only tested on devnet (needs mainnet .sol domains)
2. Light Protocol ZK Compression - Disabled on devnet due to indexer limitations (V2 architecture complete and mainnet-ready)
3. Unread message badges - Need two-device testing

**Fixed (Previously Known):**
- ~~Backend persistence~~ - Now uses Fly.io Postgres
- ~~Wallet reconnect~~ - Session persistence with `reauthorize()` fallback
- ~~Socket instability~~ - WebSocket-first, 1 machine, encryption gate
- ~~Group key rotation~~ - Rotates on kick, distributes to remaining members
- ~~Message persistence~~ - Local-first AsyncStorage, backend is temporary buffer
- ~~Double wallet popups~~ - Session keys eliminate repeated signing

**Security Notes (Pre-Mainnet):**
- No account versioning - Breaking changes force re-registration
- No migration path - Need version field + lazy migration
- No audit - Professional audit required before mainnet
- Arcium MPC v0.8.0 circuits live on devnet

**Planned Improvements:**
- Multi-device support
- Message search
- Media messages (images, files)
- Periodic key rotation (currently only on kick)

---

## Development

### Project Structure

```
mukon-messenger/
├── programs/mukon-messenger/  # Anchor program (Arcium v0.8.0 + Light Protocol)
├── encrypted-ixs/             # Arcium MPC circuit definitions
├── app/                       # React Native + Expo 51 client
│   └── src/
│       ├── contexts/MessengerContext.tsx  # Core state/socket logic
│       ├── utils/transactions.ts         # Manual tx builders
│       └── screens/                      # UI screens
├── backend/                   # Socket.IO relay (Fly.io + Postgres)
├── build/                     # Compiled Arcium circuits
└── scripts/                   # Deployment helpers
```

### Build & Deploy

```bash
# Client
cd app && npm install && npm run build

# Program (requires Arcium CLI + Anchor)
arcium build && anchor build
arcium deploy --skip-init --cluster-offset 456 --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json --rpc-url https://api.devnet.solana.com
```

---

## Deployment

**Devnet (Current):**
- Program: `54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy`
- Backend: https://backend-rough-bird-7310.fly.dev
- Arcium MXE: `5EJeKvZL6dPFcNuVVUWctDzZLU16pJA4sucg3ysPXJdr`

---

## Solana Mobile Stack Integration

Mukon is built mobile-first using the Solana Mobile Stack:

- **Mobile Wallet Adapter (MWA)** — Connect Phantom/Solflare for auth + transaction signing
- **On-chain program (Anchor)** — User profiles, relationships, groups, session tokens all on Solana
- **Helius RPC** — Reliable devnet access via Helius free tier
- **React Native + Expo** — Native Android app with Solana Mobile Wallet Adapter
- **Session Keys** — One wallet popup at login, then all transactions auto-signed (no UX friction)

---

Built for the **Solana Mobile Monolith Hackathon 2026** | Solana Mobile + Arcium + NaCl + WebRTC

**Your wallet is your identity. Your data, your keys, your sovereignty.**
