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
- QR code contact sharing
- Push notifications

---

## Development Guidelines

**IMPORTANT - Dev Servers & Builds:**
- NEVER run dev servers (npx expo start, npm run dev) - user runs these
- NEVER run builds (npx expo run:android) - user builds and installs via ADB
- User needs device logs directly (not visible to Claude)

**Backend URL:**
- Configured in `app/src/config.ts`
- Both dev and prod: https://backend-rough-bird-7310.fly.dev (deployed on Fly.io)

**Team Workflow:**
- Ryu (AI assistant) works on feature branches but cannot commit to main
- Always cherry-pick from Ryu's branches — never merge directly (his branches revert backend changes, delete files, stack on each other)
- Review every branch diff carefully before cherry-picking

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
npm run build:prebuild  # if native deps changed (expo-camera, expo-notifications, etc.)
```

### 6. Test on Device
```bash
adb install -r app-debug.apk
```

**What are discriminators?** 8-byte instruction identifiers (first 8 bytes of `sha256("global:instruction_name")`). Must match between client and program.

---

## Current Status (as of 2026-02-25)

**Deployed:**
- Solana program: `54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy` (devnet)
- Backend: Fly.io (https://backend-rough-bird-7310.fly.dev) — **1 machine**, SIN region
- Database: Fly.io Postgres (`mukon-db`, SIN region, scales to 0 when idle)
- Arcium MXE: `5EJeKvZL6dPFcNuVVUWctDzZLU16pJA4sucg3ysPXJdr` (cluster offset 456)

**Recent Work (Feb 25):**
- ✅ **Session keys (1-click UX)**: SessionToken PDA + `create_session`/`revoke_session` instructions
  - Client generates ed25519 keypair, stores in AsyncStorage, creates session on-chain with ONE wallet popup
  - All subsequent transactions auto-signed via `signAndSendTransaction` helper using session key
  - `resolve_authority()` helper in program validates session token or direct signer
- ✅ **Arcium v0.8.0**: Bumped arcium-anchor, arcium-client, arcium-macros, arcis from 0.7.0 to 0.8.0
- ✅ **On-chain key distribution**: `inviteToGroup` and `createGroupWithMembers` now call `store_group_key_for_member` to store encrypted keys on-chain. `acceptGroupInvite` fetches GroupKeyShare PDA from chain.
- ✅ **Group key rotation**: `kickMember` generates new group secret, distributes to remaining members via on-chain + socket. `group_member_left` auto-rotates if admin.
- ✅ **Auth fix**: `store_group_key_for_member` now only allows admin (creator) to store keys
- ✅ **Register + session bundle**: Register and create_session combined into single wallet popup with 0.05 SOL funding
- ✅ **parseEncryptionPubkey fix**: Proper Borsh layout parsing for UserProfile (was using `data.slice(data.length-32)` which grabbed trailing zeros from fixed-size Anchor buffer)
- ✅ **Backend**: Added `group_key_rotated` socket event for distributing rotated keys
- ✅ **Socket stability overhaul**: Fixed constant disconnect/reconnect loop on Android
  - Scaled Fly.io from 2 machines to 1 (eliminates session affinity issues)
  - WebSocket-first transport (`['websocket', 'polling']` instead of polling-only)
  - Removed `allowEIO3`, `cookie`, `upgrade: false`, `forceNew: true`
  - Socket init gated on `encryptionReady` (no premature connections)
  - Removed duplicate reconnect handler (was causing double re-auth)
  - `reconnectionAttempts: Infinity` (was 10)
- ✅ **Local-first message storage (Signal-like architecture)**:
  - Messages persist to AsyncStorage on device — app works offline, full history available
  - On receive: save locally immediately, acknowledge to server
  - On send: optimistic update saved to AsyncStorage
  - On load: local cache shown instantly, then merge from backend for missed messages
  - Backend is now a **temporary delivery buffer** — Postgres cleaned up after client acknowledges
  - `messages_delivered` / `group_messages_delivered` socket events for acknowledgement
  - `?acknowledge=true` query param on GET endpoints for fetch-and-delete on reconnect
  - AsyncStorage keys: `@mukon_messages_${wallet}_${conversationId}`, `@mukon_group_messages_${wallet}_${groupId}`

**Previous Work (Feb 23):**
- ✅ **Fly.io Postgres**: Messages, read receipts, group avatars, pending key shares now persist across deploys
  - `backend/src/db.js` — connection pool, schema init, CRUD functions
  - `backend/src/index.js` — `store` abstraction with in-memory fallback when `DATABASE_URL` not set
  - 6 tables: messages, group_messages, read_receipts, group_read_receipts, group_avatars, pending_key_shares
  - `onlineUsers` and `groupRooms` remain in-memory (ephemeral connection state)
  - `/health` endpoint reports database connectivity status
- ✅ **Cherry-picked from Ryu's branches:**
  - Wallet session persistence with `reauthorize()` fallback (fixes Known Issue #6)
  - Socket.IO reconnection with exponential backoff + room rejoin
  - Local push notifications via `expo-notifications`
  - `store_group_key_for_member` program instruction (needs discriminator update)
  - `ConnectionStatus` tracking in MessengerContext
  - QR code display/scanner screens
  - Read receipts toggle in Settings
  - Added deps: `pg`, `expo-notifications`, `expo-camera`, `react-native-qrcode-svg`

**Previous Work (Feb 4 - Architecture Pivot):**
- ✅ **Per-Relationship PDAs**: Replaced WalletDescriptor (Vec<Peer>) with individual Relationship PDAs
  - Seeds: `["relationship", min(a,b), max(a,b), version]` — canonical ordering
  - 82 bytes per relationship (vs 6,904 bytes for 100-peer WalletDescriptor)
  - O(1) lookup via PDA derivation
  - Status per side: 0=Empty, 1=Invited, 2=Requested, 3=Accepted, 4=Rejected, 5=Blocked
- ✅ **Arcium v0.8.0**: Upgraded from v0.6.2 through v0.7.0 to v0.8.0, deployed 3 live comp defs
- ✅ **Client updated**: loadContacts uses getProgramAccounts with memcmp filters

**Previous Work (Feb 3):**
- ✅ **Light Protocol V2**: Complete production-ready implementation (disabled on devnet)
- ✅ **Arcium v0.7.0 enable**: `default-features = false` on arcium-client for SBF

**Previous Work (Feb 1):**
- ✅ Build system, invite cancellation, real-time sync, Fly.io backend

---

## Working Features

**DMs:**
- ✅ Wallet connection (Solana Mobile Wallet Adapter)
- ✅ Wallet session persistence (reauthorize on app restart)
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
- ✅ Real-time delivery (Socket.IO, WebSocket-first with polling fallback)
- ✅ **Local-first message storage** (AsyncStorage on device — works offline, full history)
- ✅ Backend as temporary delivery buffer (Postgres, cleaned up after client acknowledges)
- ✅ Duplicate detection
- ✅ Push notifications (local, via expo-notifications)

**Profile & Contacts:**
- ✅ Emoji avatars (200+ curated emojis)
- ✅ Avatar display in chat, header, drawer, contacts
- ✅ DM always-show avatar with first-letter fallback
- ✅ Always-editable username
- ✅ .sol/.skr domain resolution (SNS)
- ✅ Custom contact names (local AsyncStorage)
- ✅ Name priority: Custom > Domain > On-chain > Pubkey
- ✅ QR code display (share wallet address)
- ✅ QR code scanner (scan to add contact)

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
- ✅ `store_group_key_for_member` — admin stores keys for invitees on-chain (integrated into invite + create flows)
- ✅ **Session keys** — ed25519 session keypair eliminates repeated wallet popups (SessionToken PDA)
- ✅ **Key rotation on kick** — new group secret generated and distributed to remaining members (on-chain + socket)

**UI/UX:**
- ✅ Telegram-style drawer navigation
- ✅ Settings screen with read receipts toggle
- ✅ Three-tier build system (build / clean / prebuild)
- ✅ SVG crypto wallpaper (wallet, key, shield, chain, coin, hex, Solana swoosh)
- ✅ Connection status tracking (disconnected / connecting / connected / reconnecting)

---

## Known Issues

**Active:**
1. 🟡 **Light Protocol ZK Compression** — V2 architecture complete but disabled on devnet
   - Devnet Light System Program panics during verify_proof
   - Architecture production-ready for mainnet deployment
   - `USE_ZK_COMPRESSION = false` in MessengerContext
2. 🐛 **Unread message badges not incrementing** — Needs two-device testing with physical devices
3. 🐛 **Read ticks not showing** — Backend emits `messages_read` but needs two-device testing
4. **Domain resolution** — Needs mainnet testing with real .sol/.skr domains

**Fixed:**
- ~~**Socket instability**~~ — FIXED (Feb 25): WebSocket-first, 1 Fly machine, encryption gate, no duplicate handlers
- ~~**Message persistence**~~ — FIXED (Feb 25): Local-first AsyncStorage, backend is temporary buffer
- ~~**Wallet persistence**~~ — FIXED: `reauthorize()` with fallback, `isRestoring` state
- ~~**Backend persistence**~~ — FIXED: Fly.io Postgres, data survives deploys
- ~~**Socket reconnection**~~ — FIXED: Exponential backoff, room rejoin on reconnect
- ~~**Double wallet signature on group creation**~~ — FIXED (Feb 25): Session keys eliminate repeated wallet popups
- ~~**`store_group_key_for_member` discriminator**~~ — FIXED (Feb 25): Program rebuilt with Arcium v0.8.0, discriminators updated
- ~~**Group key rotation**~~ — FIXED (Feb 25): Rotates on kick, distributes new key to remaining members via on-chain + socket

---

## What We're Building

A local-first encrypted messenger where:
1. Wallet address = identity (no phone number)
2. Contact list encrypted on-chain (Arcium)
3. Messages E2E encrypted (NaCl/TweetNaCl)
4. Messages stored locally on device (AsyncStorage) — works offline
5. Backend is a temporary encrypted relay (buffers for offline, deletes after delivery)
6. Only metadata/pointers on-chain

---

## Technical Architecture

### Current (MVP)
```
CLIENT (React Native + Expo)
  ├── Solana Mobile Wallet Adapter (MWA)
  ├── E2E encryption (NaCl box - asymmetric for DMs)
  ├── Group encryption (NaCl secretbox - symmetric)
  ├── MessengerContext (centralized socket/state)
  ├── WalletContext (session persistence + reauthorize)
  ├── Push notifications (expo-notifications, local)
  ├── QR codes (expo-camera + react-native-qrcode-svg)
  └── Chat UI

SOLANA PROGRAM (Anchor + Arcium v0.8.0)
  Program ID: 54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy

  Accounts:
  ├── UserProfile (name, avatar, encryption pubkey)
  ├── Relationship (per-pair PDA: user_a, user_b, status_a, status_b, created_at)
  ├── Conversation (participants, created_at)
  ├── Group (members, token gate, encryption pubkey)
  ├── GroupInvite (pending invitations)
  ├── GroupKeyShare (encrypted group key backup per member)
  ├── SessionToken (session key delegation for 1-click UX)
  └── WalletDescriptor (LEGACY — close_wallet_descriptor to reclaim rent)

  Instructions (22):
  ├── register / update_profile / close_profile
  ├── invite / accept / reject / block / unblock
  ├── close_wallet_descriptor (legacy cleanup)
  ├── create_group / update_group / close_group
  ├── invite_to_group / accept_group_invite / reject_group_invite
  ├── leave_group / kick_member
  ├── store_group_key / store_group_key_for_member / close_group_key
  ├── create_session / revoke_session
  └── (Light Protocol compressed variants — disabled on devnet)

MESSAGE BACKEND (Temporary Relay — NOT permanent storage)
  ├── Socket.IO for real-time delivery (WebSocket-first, 1 machine)
  ├── Fly.io Postgres as temporary delivery buffer
  ├── Messages deleted after client acknowledges receipt
  ├── In-memory fallback when DATABASE_URL not set (local dev)
  ├── Wallet signature authentication
  ├── messages_delivered / group_messages_delivered socket events
  ├── ?acknowledge=true on GET endpoints (fetch-and-delete)
  └── Group key distribution

LOCAL STORAGE (AsyncStorage — source of truth)
  ├── Messages persist on device (works offline)
  ├── Load local cache first → merge backend missed messages
  ├── Optimistic send saved immediately
  ├── Keys: @mukon_messages_${wallet}_${id}, @mukon_group_messages_${wallet}_${id}
  └── Group keys, unread counts, read timestamps also persisted
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

LAYER 1: ON-CHAIN (Arcium MPC)
  ├── Contact lists (encrypted)
  ├── Conversation existence (encrypted)
  ├── User profiles (encrypted)
  └── Social graph (encrypted)
```

---

## Directory Structure

```
mukon-messenger/
├── programs/mukon-messenger/
│   ├── src/lib.rs          # Anchor program (Arcium v0.8.0 + Light Protocol)
│   └── Cargo.toml
├── encrypted-ixs/           # Arcium MPC circuit definitions
│   └── src/lib.rs
├── app/                     # React Native client
│   ├── src/
│   │   ├── contexts/
│   │   │   ├── MessengerContext.tsx  # Centralized state/socket/reconnection
│   │   │   ├── WalletContext.tsx     # MWA + session persistence
│   │   │   ├── CallContext.tsx       # Voice call state (UI only)
│   │   │   └── AlertContext.tsx      # Dark alert provider
│   │   ├── screens/
│   │   │   ├── QRCodeDisplayScreen.tsx  # Show wallet as QR
│   │   │   ├── QRScannerScreen.tsx      # Scan QR to add contact
│   │   │   └── ...
│   │   ├── components/
│   │   ├── utils/
│   │   │   ├── transactions.ts  # Manual tx builders + discriminators
│   │   │   ├── encryption.ts
│   │   │   ├── notifications.ts # Push notification helpers
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
│   ├── CHANGELOG.md
│   ├── ARCIUM_INTEGRATION.md
│   └── LIGHT_PROTOCOL_INTEGRATION.md
└── README.md
```

---

## Group Chat Architecture

### Core Settings
- **Group ID:** Pure random 32 bytes (maximum privacy)
- **Max Members:** 30 for MVP
- **Admin Model:** Creator = only admin (MVP)
- **Visibility:** Members see each other (encrypted from outsiders via Arcium)
- **Key Rotation:** On kicks (auto-rotates, distributes to remaining members via on-chain + socket)
- **Invitations:** Any member can invite (not just admin)

### Token Gating
- Simple fungible token balance check on accept
- User passes token account, program verifies `amount >= min_balance`
- NFT gating is post-MVP

### Group Encryption Model

Messages NOT stored on-chain. Shared secret encryption:

1. **Create Group:** Creator generates random 32-byte `group_secret`, stores locally
2. **Invite Member:** Admin encrypts `group_secret` with invitee's pubkey (NaCl box), sends via Socket.IO
3. **Send Message:** Sender encrypts with `group_secret` (NaCl secretbox), backend broadcasts
4. **Receive Message:** All members decrypt with same `group_secret`
5. **Kick Member:** Rotate `group_secret`, redistribute to remaining members (on-chain + socket)

### Arcium MPC Integration (v0.8.0)

Arcium encrypts on-chain state via multi-party computation:
- `is_mutual_contact` — verify both sides of a Relationship are Accepted (~30K gates)
- `count_accepted` — count accepted contacts privately (507M ACUs)
- `add_two_numbers` — demo/testing circuit (473M ACUs)

All 3 comp defs LIVE on devnet. See `.dev/ARCIUM_INTEGRATION.md` for details.

---

## Account Structures

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
pub struct GroupKeyShare {
    pub group_id: [u8; 32],
    pub member: Pubkey,
    pub encrypted_key: Vec<u8>,      // NaCl box encrypted
    pub nonce: [u8; 24],
}

/// Session key delegation — eliminates repeated wallet popups
/// Seeds: ["session", owner, session_pubkey]
#[account]
pub struct SessionToken {
    pub owner: Pubkey,               // Wallet that created the session
    pub session_pubkey: Pubkey,      // Ed25519 session key (stored on device)
    pub created_at: i64,
    pub expires_at: i64,
}
```

---

## CRITICAL UX FEATURE: Invite Unregistered Users

The `invite` instruction creates a Relationship PDA with `init`:
- PDA is seeded by both pubkeys in canonical order — same PDA regardless of who initiates
- If invitee hasn't registered yet, the Relationship PDA still exists on-chain
- When invitee registers and loads contacts via `getProgramAccounts`, they see pending invitations
- No WalletDescriptor needed — each relationship is its own account

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
- Messages persist after leaving/re-entering chat (local-first)
- Messages persist after closing and reopening app (AsyncStorage)
- Messages still visible when backend is unreachable (offline mode)
- No socket disconnect/reconnect loop (single `Connected to backend via websocket` log)

### Performance Expectations
- Registration: ~2-3s (on-chain tx)
- Invitation/Accept: ~2-3s (on-chain tx)
- Message send: <100ms (WebSocket)
- Message receive: Real-time (<50ms)

---

## Ryu's Unmerged Branch Audit (Feb 23)

Branches reviewed and cherry-picked where useful. Remaining branches with **incomplete** features — do NOT merge:

| Branch | Feature | Status | Why Skipped |
|--------|---------|--------|-------------|
| `fix/version-migration` | Account version migration | Duplicate | 0 unique commits vs backend-reconnection |
| `feat/qr-codes` | QR codes | Duplicate | 0 unique commits vs version-migration |
| `feat/message-expiration` | Message expiry + search | Incomplete | `searchMessages()` never implemented; expiry has APIs but no UI |
| `feat/iq-labs-integration` | IQ Labs SDK | Docs only | 423 lines of docs, zero implementation code, unused npm dep |
| `feat/escrow-deals` | Escrow/OTC deals | Dangerous | DealCard UI accepts deals but `// TODO: Add Solana transaction handling` — never transfers tokens |

**Common issue across all Ryu branches:**
- All branched from `f807e4a` (before voice calls + Postgres)
- All delete `backend/src/db.js` and revert backend to in-memory
- All delete voice call files (branched before those commits)
- All stacked on each other — can't merge independently

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

## Production Checklist

- [x] Deploy backend to Fly.io
- [x] Add message persistence (Fly.io Postgres)
- [x] Fix socket stability (1 machine, WebSocket-first, encryption gate)
- [x] Local-first message storage (AsyncStorage, backend as temp buffer)
- [ ] Make backend URL configurable (dev vs prod)
- [ ] Deploy program to mainnet-beta
- [x] Update `store_group_key_for_member` discriminator (rebuilt program with Arcium v0.8.0)
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
