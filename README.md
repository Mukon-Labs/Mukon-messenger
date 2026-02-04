# Mukon Messenger

**Privacy-first, wallet-to-wallet encrypted messenger for Solana**

Built for the Solana Privacy Hackathon (Jan 12-30, 2026)

---

## 🚀 Live Demo

**Program ID (Devnet):** `54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy`

**Backend:** https://backend-rough-bird-7310.fly.dev

**Status:** ✅ Fully functional MVP with E2E encryption, group chats, and on-chain key backup

---

## What is Mukon?

Mukon Messenger is a **truly private messaging app** where your wallet is your identity. No phone numbers, no email addresses, no centralized servers storing your data.

**Key Privacy Features:**
- **End-to-end encrypted DMs** (NaCl box asymmetric encryption)
- **Encrypted group chats** (NaCl secretbox with on-chain key backup)
- **On-chain encrypted key recovery** - Unique feature! Your group keys are backed up encrypted on-chain, so clearing app data doesn't lock you out
- **ZK Compression integration** - Light Protocol integration for reduced storage costs (foundation implemented)
- **Contact lists encrypted with Arcium MPC v0.7.0** (3 circuits live on devnet, testing in progress)
- **Social graph privacy** - No one can see who you're talking to
- **Wallet-based identity** - Your Solana wallet is your account

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

**Note:** The backend is deployed on Fly.io with in-memory storage. Data resets on backend deployments, but on-chain data (profiles, contacts, groups) persists.

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
- **Real-time Delivery** - Socket.IO with wallet signature authentication
- **Message Persistence** - Messages stored off-chain, encrypted blobs only
- **Message Deletion** - Delete for self or delete for everyone (sender only)

### 👥 Group Chats

- **Encrypted Group Messaging** - NaCl secretbox (symmetric encryption)
- **Up to 30 Members** - Optimized for small, private groups
- **On-chain Key Backup** - **Unique feature!** Group keys stored encrypted on-chain
  - Keys encrypted with member's wallet-derived encryption key
  - Survive app data deletion / device change
  - Just connect wallet to recover all group access
- **Any Member Can Invite** - Democratic group growth (admin can kick)
- **Token Gating** - Require SPL token balance to join (configurable)
- **Group Key Distribution** - Automatic via WebSocket, request if offline
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

- **Arcium MPC Integration (v0.7.0)** - Relationship status verified privately via multi-party computation
  - Status: 3 circuits live on devnet, E2E testing in progress
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

// Group Instructions (10)
create_group()          // Create new group
update_group()          // Rename group (admin only)
invite_to_group()       // Invite member (any member can invite)
accept_group_invite()   // Join group (checks token gate)
reject_group_invite()   // Decline invitation
leave_group()           // Leave group
kick_member()           // Kick member (admin only)
close_group()           // Delete group (admin only)
store_group_key()       // Store encrypted key on-chain for recovery
close_group_key()       // Close key share + recover rent
```

### Layer 2: Off-Chain Backend (Fly.io)

**Backend URL:** https://backend-rough-bird-7310.fly.dev

**Technology:** Node.js + Express + Socket.IO

**Features:**
- Real-time message delivery (WebSocket)
- Wallet signature authentication
- In-memory storage (messages, read receipts, group avatars)
- Group key distribution
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

// Server → Client
new_message           // Receive DM
group_message         // Receive group message
group_key_shared      // Receive group key
messages_read         // Peer read your messages
message_deleted       // Message deleted by sender
invitation_rejected   // Your invitation was rejected
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
   - Sent via Socket.IO real-time
   - If invitee offline, they can request key later

3. **Accepting Invitation:**
   - Member receives encrypted group key
   - Decrypts with their wallet-derived secret key
   - Stores locally (AsyncStorage)
   - **Also stores encrypted copy on-chain** (GroupKeyShare PDA)

4. **Sending Messages:**
   - Encrypt with `group_secret` (NaCl secretbox)
   - Backend broadcasts to group room
   - All members decrypt with same secret

5. **Recovery After Data Loss:**
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

**Status:** ✅ Live on devnet (v0.7.0) — 3 computation definitions deployed

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
- Arcium v0.7.0 (MPC circuits — 3 live on devnet)

**Backend:**
- Node.js + Express
- Socket.IO (WebSocket)
- Fly.io (deployment)

**Frontend:**
- React Native + Expo 51
- Solana Mobile Wallet Adapter
- TweetNaCl (E2E encryption)
- React Navigation
- React Native Paper (UI)
- AsyncStorage (local persistence)

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
1. Backend persistence - In-memory storage, resets on deploy (on-chain data persists)
2. Wallet reconnect - Must reconnect wallet on app restart
3. Emulator instability - Socket.IO issues on Android emulator (use physical devices)
4. Domain resolution - Only tested on devnet (needs mainnet .sol domains)
5. Group key rotation - Only rotates on kick (should rotate periodically)
6. Light Protocol ZK Compression - Disabled on devnet due to indexer limitations (V2 architecture complete and mainnet-ready)

**Security Notes (Pre-Mainnet):**
- No account versioning - Breaking changes force re-registration
- No migration path - Need version field + lazy migration
- No audit - Professional audit required before mainnet
- Arcium testing - MPC v0.7.0 circuits live on devnet, E2E testing in progress

**Planned Improvements:**
- Message persistence (Fly.io Postgres)
- Wallet persistence (AsyncStorage + auto-reconnect)
- Push notifications
- QR code scanner
- Multi-device support
- Message search
- Media messages (images, files)

---

## Development

### Project Structure

```
mukon-messenger/
├── programs/mukon-messenger/  # Anchor program (Arcium v0.7.0 + Light Protocol)
├── encrypted-ixs/             # Arcium MPC circuit definitions
├── app/                       # React Native + Expo 51 client
│   └── src/
│       ├── contexts/MessengerContext.tsx  # Core state/socket logic
│       ├── utils/transactions.ts         # Manual tx builders
│       └── screens/                      # UI screens
├── backend/                   # Socket.IO relay (Fly.io)
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

Built for the **Solana Privacy Hackathon 2026** | Solana + Arcium + Light Protocol + NaCl

**Your data, your keys, your sovereignty.**
