# Mukon Messenger - Claude Code Development Brief

## Project Overview

Private, wallet-to-wallet encrypted messenger for Solana Privacy Hackathon (Jan 12-30, 2026).

**Goal:** Win multiple bounties ($48K+ potential) with privacy-first messenger + Arcium encrypted on-chain state.

**Key Features:**
- E2E encrypted DMs (NaCl box)
- Group chat with symmetric encryption (NaCl secretbox)
- Encrypted contact lists + group membership (Arcium MPC)
- Emoji avatars, reactions, replies
- .sol/.skr domain resolution
- Token-gated groups

---

## Development Guidelines

**IMPORTANT - Dev Servers & Builds:**
- NEVER run dev servers (npx expo start, npm run dev) - user runs these
- NEVER run builds (npx expo run:android) - user builds and installs via ADB
- User needs device logs directly (not visible to Claude)

**Backend URL:**
- Configured in `app/src/config.ts`
- Both dev and prod: https://backend-rough-bird-7310.fly.dev (deployed on Fly.io)

---

## ⚠️ DEVNET ONLY: Program Redeployment Strategy

**For hackathon development**, we use `close_profile` to allow re-registration after breaking changes:

```typescript
await messenger.closeProfile(); // Close old account
await messenger.register('Name', '🦅'); // Re-register with new schema
```

**WHY:** Account structures change during dev (e.g., added `avatar_type` field). Solana accounts can't be re-initialized.

### 🚨 BEFORE MAINNET - Proper Upgrade Strategy Required

**Current Problem:** No version field, no migration logic, breaking changes force re-registration.

**Required for Production:**
1. Add `version: u8` to all account structs
2. Multi-version client deserializers
3. Lazy migration (auto-upgrade on write)
4. Test migration path on devnet
5. Remove/restrict `close_profile`

**References:**
- https://book.anchor-lang.com/anchor_references/account_types.html
- https://github.com/metaplex-foundation/metaplex-program-library

---

## Program Deployment Workflow

### 1. Build (Arcium + Anchor)
```bash
# Build Arcium circuits (encrypted-ixs/)
arcium build

# Build Anchor program (includes Arcium macros)
# Note: arcium-client stack offset warning (~721K) is expected, not our code
anchor build
```

### 2. Deploy
```bash
# Full deploy (program + MXE init) — first time only
arcium deploy --cluster-offset 456 --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url https://api.devnet.solana.com

# Upgrade program only (after code changes)
arcium deploy --skip-init --cluster-offset 456 --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url https://api.devnet.solana.com
```

### 3. Init Comp Defs (one-time per circuit)
```bash
npx ts-node --transpile-only scripts/init-comp-defs.ts
```

### 4. Extract Discriminators
```bash
node scripts/update-discriminators.js
```

This script:
- Reads IDL from `target/idl/mukon_messenger.json`
- Extracts 8-byte instruction discriminators
- Auto-updates `app/src/utils/transactions.ts`

### 5. Rebuild Client
```bash
cd app
npm run build  # or npm run build:clean if needed
```

### 6. Test on Device
```bash
adb install -r app-debug.apk
```

**What are discriminators?** 8-byte instruction identifiers (first 8 bytes of `sha256("global:instruction_name")`). Must match between client and program.

---

## Current Status (as of 2026-02-23)

**Deployed:**
- Solana program: `54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy` (devnet)
- Backend: Fly.io (https://backend-rough-bird-7310.fly.dev) - Consistent URL for dev and prod
- Database: Fly.io Postgres (`mukon-db`, SIN region, scales to 0 when idle)
- Arcium MXE: `5EJeKvZL6dPFcNuVVUWctDzZLU16pJA4sucg3ysPXJdr` (cluster offset 456)

**Recent Work (Feb 23 - Backend Persistence):**
- ✅ **Fly.io Postgres**: Messages, read receipts, group avatars, pending key shares now persist across deploys
  - `backend/src/db.js` — connection pool, schema init, CRUD functions
  - `backend/src/index.js` — `store` abstraction with in-memory fallback when `DATABASE_URL` not set
  - 6 tables: messages, group_messages, read_receipts, group_read_receipts, group_avatars, pending_key_shares
  - `onlineUsers` and `groupRooms` remain in-memory (ephemeral connection state)
  - `/health` endpoint reports database connectivity status

**Previous Work (Feb 4 - Architecture Pivot):**
- ✅ **Per-Relationship PDAs**: Replaced WalletDescriptor (Vec<Peer>) with individual Relationship PDAs
  - Seeds: `["relationship", min(a,b), max(a,b), version]` — canonical ordering
  - 82 bytes per relationship (vs 6,904 bytes for 100-peer WalletDescriptor)
  - O(1) lookup via PDA derivation
  - Status per side: 0=Empty, 1=Invited, 2=Requested, 3=Accepted, 4=Rejected, 5=Blocked
- ✅ **Arcium v0.7.0**: Upgraded from v0.6.2, deployed 3 live comp defs
  - `is_mutual_contact` (~30K gates) — replaces `is_accepted_contact` (was 1.17B ACUs, over limit)
  - `count_accepted` (507M ACUs)
  - `add_two_numbers` (473M ACUs)
- ✅ **Client updated**: loadContacts uses getProgramAccounts with memcmp filters
  - All 5 DM instruction builders updated for Relationship PDA model
  - Added `close_wallet_descriptor` for legacy account cleanup
- ✅ **UNTESTED**: Needs full E2E testing on device before push

**Previous Work (Feb 3):**
- ✅ **Light Protocol V2**: Complete production-ready implementation (disabled on devnet)
- ✅ **Arcium v0.7.0 enable**: `default-features = false` on arcium-client for SBF

**Previous Work (Feb 1):**
- ✅ Build system, invite cancellation, real-time sync, Fly.io backend

**Working Features:**

**DMs:**
- ✅ Wallet connection (Solana Mobile Wallet Adapter)
- ✅ User registration with encryption public key
- ✅ Contact invitations (invite before target registers)
- ✅ E2E encrypted messaging (NaCl box)
- ✅ Contact blocking/unblocking
- ✅ Symmetric contact deletion
- ✅ Message deletion (delete for self or everyone)

**Messaging:**
- ✅ Message reactions (❤️ 🔥 💯 😂 👍 👎)
- ✅ Reply to messages
- ✅ Copy message to clipboard
- ✅ Real-time delivery (Socket.IO)
- ✅ Message persistence (Fly.io Postgres)
- ✅ Duplicate detection

**Profile & Contacts:**
- ✅ Emoji avatars (200+ curated emojis)
- ✅ Avatar display in chat, header, drawer, contacts
- ✅ DM always-show avatar with first-letter fallback
- ✅ Always-editable username
- ✅ .sol/.skr domain resolution (SNS)
- ✅ Custom contact names (local AsyncStorage)
- ✅ Name priority: Custom > Domain > On-chain > Pubkey

**Groups:**
- ✅ Create groups (up to 30 members)
- ✅ Group invitations (any member can invite)
- ✅ Token gating (SPL token balance verification)
- ✅ Group management (admin kicks, members leave)
- ✅ Group encryption (NaCl secretbox)
- ✅ Unified conversations (DMs + Groups)
- ✅ Group key distribution (request if offline)
- ✅ Group rename (admin only, on-chain via updateGroup)
- ✅ Group emoji avatars (local AsyncStorage, shown in info/header/list)
- ✅ **On-chain encrypted key backup** - Hybrid storage (AsyncStorage + on-chain) allows key recovery after clearing app data. KEY DIFFERENTIATOR vs WhatsApp/Signal.

**UI/UX:**
- ✅ Telegram-style drawer navigation
- ✅ Settings screen
- ✅ Three-tier build system (build / clean / prebuild)
- ✅ SVG crypto wallpaper (wallet, key, shield, chain, coin, hex, Solana swoosh)
- ✅ react-native-svg installed (requires native rebuild via build:prebuild)

**Known Issues (For Hackathon):**
1. 🟡 **Light Protocol ZK Compression** - V2 architecture complete but disabled on devnet due to infrastructure
   - Devnet Light System Program panics during verify_proof
   - This is a devnet indexer limitation, not a code issue
   - Architecture production-ready for mainnet deployment
   - `USE_ZK_COMPRESSION = false` in MessengerContext
2. 🐛 **Unread message badges not incrementing** - Needs two-device testing with physical devices
3. 🐛 **Read ticks not showing** - Backend emits `messages_read` but needs two-device testing
4. 🐛 **Emulator socket instability** - Android emulator has persistent "xhr post error" socket issues. Use physical devices for testing.
5. 🔧 **Double wallet signature on group creation** - Two transactions: (1) create+invite, (2) store key. Can combine into one.

**Known Issues (Lower Priority):**
6. **Wallet persistence** - Closing app requires full reconnect
7. ~~**Backend persistence**~~ - FIXED: Now using Fly.io Postgres. Data survives deploys.
8. **Domain resolution** - Needs mainnet testing with real .sol/.skr domains
9. **Group key rotation** - Only rotates on kick (security debt)
10. **All Alert.alert popups still white** - Need to replace 87 Alert.alert calls with DarkAlert component (9 files)

**Next Steps (Feb 4):**
1. 🔥 **TEST ARCHITECTURE PIVOT** — E2E test on device
   - DM invite/accept/reject/block/unblock with Relationship PDAs
   - Group creation still works (unchanged)
   - loadContacts via getProgramAccounts returns contacts
   - Old WalletDescriptor users can close and re-register
2. 🔜 **Post-Testing**
   - Push to remote once tested
   - Fix any bugs found during testing
   - Demo video recording

**Detailed fix history:** See CHANGELOG.md

---

## What We're Building

A 1:1 encrypted messenger where:
1. Wallet address = identity (no phone number)
2. Contact list encrypted on-chain (Arcium)
3. Messages E2E encrypted (NaCl/TweetNaCl)
4. Message content stored off-chain
5. Only metadata/pointers on-chain

---

## Technical Architecture

### Current (MVP)
```
CLIENT (React Native)
  ├── Solana Mobile Wallet Adapter (MWA)
  ├── E2E encryption (NaCl box - asymmetric for DMs)
  ├── Group encryption (NaCl secretbox - symmetric)
  ├── MessengerContext (centralized socket/state)
  └── Chat UI

SOLANA PROGRAM (Anchor + Arcium v0.7.0)
  Program ID: 54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy

  Accounts:
  ├── UserProfile (name, avatar, encryption pubkey)
  ├── Relationship (per-pair PDA: user_a, user_b, status_a, status_b, created_at)
  ├── Conversation (participants, created_at)
  ├── Group (members, token gate, encryption pubkey)
  ├── GroupInvite (pending invitations)
  ├── GroupKeyShare (encrypted group key backup per member)
  └── WalletDescriptor (LEGACY — close_wallet_descriptor to reclaim rent)

  Instructions:
  ├── register() - Create profile (no wallet descriptor)
  ├── invite/accept/reject() - Contact management via Relationship PDA
  ├── block/unblock() - Harassment prevention via Relationship PDA
  ├── close_wallet_descriptor() - Reclaim rent from legacy accounts
  ├── create_group() - Create group
  ├── invite_to_group() - Any member can invite
  ├── accept_group_invite() - Join group (checks token gate)
  ├── leave_group/kick_member() - Group management
  ├── store_group_key() - Store encrypted group key on-chain for recovery
  ├── close_group_key() - Close key share account and recover rent
  └── update_profile/update_group/close_profile()

MESSAGE BACKEND (WebSocket + Postgres)
  ├── Socket.IO for real-time delivery
  ├── Fly.io Postgres (messages, receipts, avatars, key shares)
  ├── In-memory fallback when DATABASE_URL not set (local dev)
  ├── Encrypted message blobs
  ├── Wallet signature authentication
  ├── Message deletion support
  └── Group key distribution
```

### Target (With Full Arcium)
```
LAYER 3: CLIENT (E2E)
  ├── NaCl box encryption (message content)
  ├── Arcium MPC queries (encrypted contact list access)
  └── Zero-knowledge relationship proofs

LAYER 2: OFF-CHAIN (Relay)
  ├── Encrypted message blob (can't read)
  ├── Destination: [ENCRYPTED or anonymous ID]
  └── Timestamp (ordering only)
  → Relay can't see sender/recipient or correlate conversations

LAYER 1: ON-CHAIN (Arcium MPC)
  ├── Contact lists (encrypted)
  ├── Conversation existence (encrypted)
  ├── Message pointers (encrypted)
  ├── User profiles (encrypted)
  └── Social graph (encrypted)
  → Even developers can't see who talks to whom
  → MPC proves relationships without revealing data
```

**Privacy Goals:**
- 🔒 Message content encrypted (NaCl E2E)
- 🔒 Contact lists encrypted (Arcium MPC)
- 🔒 Social graph encrypted (Arcium MPC)
- 🔒 Conversation metadata encrypted (Arcium MPC)
- 🔒 Message routing anonymized
- 🔒 Relay nodes can't correlate conversations
- 🔒 On-chain observers can't map social networks

---

## Directory Structure

```
mukon-messenger/
├── programs/mukon-messenger/
│   ├── src/lib.rs          # Anchor program (Arcium v0.7.0 + Light Protocol)
│   └── Cargo.toml
├── encrypted-ixs/           # Arcium MPC circuit definitions
│   └── src/lib.rs
├── app/                     # React Native client
│   ├── src/
│   │   ├── contexts/
│   │   │   ├── MessengerContext.tsx  # Centralized state/socket
│   │   │   └── WalletContext.tsx
│   │   ├── screens/
│   │   ├── components/
│   │   ├── utils/
│   │   │   ├── transactions.ts  # Manual tx builders
│   │   │   ├── encryption.ts
│   │   │   └── domains.ts
│   │   └── config.ts        # Backend URL config
│   └── package.json
├── backend/                 # WebSocket relay + Postgres persistence
│   └── src/
│       ├── index.js         # Express + Socket.IO server
│       └── db.js            # Postgres connection, schema, CRUD
├── scripts/
│   ├── update-discriminators.js
│   └── init-comp-defs.ts    # Initialize Arcium comp defs
├── build/                   # Compiled Arcium circuits (.arcis)
├── .dev/                    # Development docs
│   ├── CLAUDE.md            # This file
│   ├── CHANGELOG.md
│   ├── ARCIUM_INTEGRATION.md
│   └── LIGHT_PROTOCOL_INTEGRATION.md
└── README.md
```

---

## 🚀 GROUP CHAT ARCHITECTURE

### Core Settings
- **Group ID:** Pure random 32 bytes (maximum privacy)
- **Max Members:** 30 for MVP
- **Admin Model:** Creator = only admin (MVP)
- **Visibility:** Members see each other (encrypted from outsiders via Arcium)
- **Key Rotation:** Only on kicks (security debt for MVP)
- **Invitations:** Any member can invite (not just admin)

### Token Gating
- Simple fungible token balance check on accept
- User passes token account, program verifies `amount >= min_balance`
- NFT gating is post-MVP

### Solana Program Instructions

```
DM Instructions (9):
├── register(display_name, avatar_data, encryption_pubkey)
├── update_profile(display_name, avatar_data, encryption_pubkey)
├── invite(hash) — creates Relationship PDA + Conversation PDA
├── accept() — sets both statuses to Accepted
├── reject() — sets both statuses to Rejected
├── block() — sets both statuses to Blocked
├── unblock() — sets Blocked → Rejected (allows re-invite)
├── close_profile()
└── close_wallet_descriptor() — legacy cleanup

Group Instructions (8):
├── create_group(group_id, name, encryption_pubkey, token_gate?)
├── update_group(group_id, name?, token_gate?)
├── invite_to_group(group_id, invitee) — any member can invite
├── accept_group_invite(group_id) — checks token gate
├── reject_group_invite(group_id)
├── leave_group(group_id)
├── kick_member(group_id, member) — creator only
└── close_group(group_id) — creator only
```

### Account Structures

```rust
#[account]
pub struct UserProfile {
    pub owner: Pubkey,
    pub display_name: String,        // Max 32 chars
    pub avatar_type: AvatarType,     // Emoji or NFT
    pub avatar_data: String,         // Emoji char or NFT mint
    pub encryption_public_key: [u8; 32],
}

/// Per-relationship PDA — replaces WalletDescriptor.peers
/// Seeds: ["relationship", min(a,b), max(a,b), version]
#[account]
pub struct Relationship {
    pub user_a: Pubkey,     // min(pubkey_a, pubkey_b)
    pub user_b: Pubkey,     // max(pubkey_a, pubkey_b)
    pub status_a: u8,       // 0=Empty 1=Invited 2=Requested 3=Accepted 4=Rejected 5=Blocked
    pub status_b: u8,
    pub created_at: i64,
}
// 82 bytes (8 disc + 32 + 32 + 1 + 1 + 8)

#[account]
pub struct Group {
    pub group_id: [u8; 32],
    pub creator: Pubkey,
    pub name: String,
    pub created_at: i64,
    pub members: Vec<Pubkey>,        // Max 30
    pub encryption_pubkey: [u8; 32],
    pub token_gate: Option<TokenGate>,
}

#[account]
pub struct GroupInvite {
    pub group_id: [u8; 32],
    pub inviter: Pubkey,
    pub invitee: Pubkey,
    pub status: GroupInviteStatus,
    pub created_at: i64,
}

// LEGACY — kept for deserialization of existing on-chain accounts
#[account]
pub struct WalletDescriptor {
    pub owner: Pubkey,
    pub peers: Vec<Peer>,    // Use close_wallet_descriptor to reclaim rent
}
```

### Group Encryption Model

Messages NOT stored on-chain. Shared secret encryption:

1. **Create Group:** Creator generates random 32-byte `group_secret`, stores locally
2. **Invite Member:** Admin encrypts `group_secret` with invitee's pubkey (NaCl box), sends via Socket.IO
3. **Send Message:** Sender encrypts with `group_secret` (NaCl secretbox), backend broadcasts
4. **Receive Message:** All members decrypt with same `group_secret`
5. **Kick Member (Future):** Rotate `group_secret`, redistribute to remaining members

### Backend Socket.IO Events

```typescript
// Client → Server
'join_group_room': { groupId }
'leave_group_room': { groupId }
'group_message': { groupId, encryptedContent, nonce }
'group_key_share': { groupId, recipientPubkey, encryptedKey, nonce }
'request_group_key': { groupId }

// Server → Client
'group_message': { groupId, senderPubkey, encryptedContent, nonce, timestamp }
'group_member_joined': { groupId, memberPubkey }
'group_member_left': { groupId, memberPubkey }
'group_member_kicked': { groupId, memberPubkey }
'group_key_shared': { groupId, senderPubkey, encryptedKey, nonce }
```

### Arcium MPC Integration (v0.7.0)

Arcium encrypts on-chain state via multi-party computation:
- `is_mutual_contact` — verify both sides of a Relationship are Accepted (~30K gates)
- `count_accepted` — count accepted contacts privately (507M ACUs)
- `add_two_numbers` — demo/testing circuit (473M ACUs)

All 3 comp defs LIVE on devnet. See `.dev/ARCIUM_INTEGRATION.md` for details.

---

## CRITICAL UX FEATURE: Invite Unregistered Users

The `invite` instruction creates a Relationship PDA with `init`:
- PDA is seeded by both pubkeys in canonical order — same PDA regardless of who initiates
- If invitee hasn't registered yet, the Relationship PDA still exists on-chain
- When invitee registers and loads contacts via `getProgramAccounts`, they see pending invitations
- No WalletDescriptor needed — each relationship is its own account

**Implementation:** `programs/mukon-messenger/src/lib.rs` invite instruction

---

## Known UX Issue: Double Wallet Sign on Group Creation

**Problem:** Creating a group requires **2 wallet signatures**:
1. Create group + invite members (transaction 1)
2. Store admin's encrypted group key on-chain (transaction 2)

**Why it happens:** The `createGroupWithMembers` function in `MessengerContext.tsx` sends two separate transactions for safety, but this creates a poor UX.

**Solution (Easy Fix):**
Combine both into ONE transaction by adding `createStoreGroupKeyInstruction` to the initial instructions array:

```typescript
// Current (2 transactions):
const instructions = [
  createCreateGroupInstruction(...),
  ...invitees.map(invitee => createInviteToGroupInstruction(...))
];
const transaction = await buildTransaction(connection, wallet.publicKey, instructions);
// Sign #1 ^^

// Later...
const storeKeyIx = createStoreGroupKeyInstruction(...);
const storeKeyTx = await buildTransaction(connection, wallet.publicKey, [storeKeyIx]);
// Sign #2 ^^

// FIXED (1 transaction):
const instructions = [
  createCreateGroupInstruction(...),
  ...invitees.map(invitee => createInviteToGroupInstruction(...)),
  createStoreGroupKeyInstruction(...)  // Add here!
];
const transaction = await buildTransaction(connection, wallet.publicKey, instructions);
// Only 1 sign! ^^
```

**File:** `app/src/contexts/MessengerContext.tsx` around line 1384-1438

---

## Testing Guidelines

### Manual E2E Testing Flow

**Prerequisites:**
- Both wallets registered on program 54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy
- Backend running (check IP in `app/src/config.ts`)
- Metro: `npm start -- --reset-cache`

**Test Flow (Two Devices):**
1. Device 1: Connect wallet → register → copy address
2. Device 2: Connect wallet → register → copy address
3. Device 1: Add contact (Device 2 address) → send invitation
4. Device 2: See invitation → accept
5. Exchange messages (both decrypt correctly)

**Success Criteria:**
- Both wallets send/receive messages
- Messages decrypt correctly
- No duplicate messages
- No constant wallet prompts
- Messages persist after leaving/re-entering chat

### Performance Expectations
- Registration: ~2-3s (on-chain tx)
- Invitation/Accept: ~2-3s (on-chain tx)
- Message send: <100ms (WebSocket)
- Message receive: Real-time (<50ms)

---

## Bounty Targets

### Primary: Arcium ($10,000)
- Best integration: $3k
- Most <encrypted> potential: $1k x 2

### Secondary: Open Track ($18,000)
- Privacy messenger (Light Protocol)

### Stretch: ShadowWire/Radr Labs ($15,000)
- Private payment splits in chat

### Easy: Helius ($5,000)
- Use their RPC

---

## Hackathon Submission Checklist

**CRITICAL:**
- [ ] **Remove CLAUDE.md** from submission branch (or .gitignore it)
- [ ] Keep it locally for post-hackathon development

**Architecture Decisions:**
- ✅ STEM Proto: Won't mention in public docs (code is substantially original)
- ✅ Contact Management: Delete + Block implemented

**Production Launch:**
- 🚀 **GOING TO MAINNET** around hackathon submission
- 🎯 **Backend:** Deploy to Fly.io (WebSocket support, edge deployment, low latency)
- 📝 See PRODUCTION_DEPLOY.md

**Deployment Timeline:**
1. ✅ Week 1 (Jan 20-26): Core messenger MVP (DMs, groups, encryption)
2. 🔄 Week 2 (Jan 27-30): Arcium integration, UI polish, deploy to Fly.io/mainnet, submit hackathon
3. ✅ Week 3+ (Feb): Persistence (Postgres), monitoring, launch on Solana Mobile dApp Store

**Before mainnet:**
- [x] Deploy backend to Fly.io
- [ ] Make backend URL configurable (dev vs prod)
- [ ] Deploy program to mainnet-beta
- [x] Add message persistence (Fly.io Postgres)
- [ ] Add monitoring (Sentry, UptimeRobot)
- [ ] Test extensively on mainnet

---

## Git Commit Guidelines

**IMPORTANT:**
- Do not include Claude credits in commits
- Solo dev workflow: only push to remote at END of session
- Commit frequently locally, but don't waste tokens pushing after every commit

---

## Project Assets

- `logo.jpg` - Project logo
- `icon.png` - App icon
