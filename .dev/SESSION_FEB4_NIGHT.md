# Session Notes - Feb 5 (Continued from Feb 4 Night)

## What We Were Fixing

### Bug 1: Group members can't decrypt messages
**Problem:** Members who accept group invites don't receive the group key, so they can't send/decrypt messages.

**Root cause:** Group key shared via Socket.IO during creation. If member was offline or had socket instability (those xhr errors), the key share was stored in backend's in-memory `pendingKeyShares`. If backend restarts or member requests the key later, it's gone with no recovery path.

**Fix (IN PROGRESS - NOT FULLY TESTED):**
- Backend: When `request_group_key` finds no pending share, broadcast `group_key_needed` to group room
- Client: Listen for `group_key_needed`, encrypt group key with requester's pubkey, share via `share_group_key`
- Client: Request key in 3 places:
  1. `acceptGroupInvite` (existing)
  2. `recoverMissingKeys` effect - if on-chain backup not found (new)
  3. `joinGroupRoom` - when opening chat if key missing (new)

**Status:** Backend deployed. Client changes in but not tested. Need at least one key-holder viewing the group chat for the broadcast to work.

### Bug 2: Can't re-invite after deregistering
**Problem:** Closed all UserProfile accounts to test fresh. Relationship PDAs still exist with status=Accepted. Re-invite fails with `AlreadyInvited` error.

**Root cause:** `close_profile` only closes UserProfile PDA. Relationship PDAs persist.

**Fix (IN PROGRESS - NOT DEPLOYED):**
- Added `close_relationship` instruction to program (built, not deployed)
- Allows either party to close Relationship PDA and reclaim rent
- Context struct: CloseRelationship with user_a, user_b, relationship PDA

**Status:** Code written, arcium build succeeded. Need to:
1. `anchor build`
2. `arcium deploy --skip-init --cluster-offset 456 --recovery-set-size 4 --keypair-path ~/.config/solana/id.json --rpc-url https://api.devnet.solana.com`
3. Add client tx builder to `app/src/utils/transactions.ts`
4. Run `node scripts/update-discriminators.js`
5. Close old Relationship PDAs
6. Test re-invite

## Other Changes (Cosmetic)

- **Settings screen:** Updated program ID display from `DGAPfs1...` to `54QTyrUR...`
- **useMukonMessenger.ts:** Updated stale program ID (dead code but consistent)
- **README.md:** Fixed DM instruction count (10 → 9)
- **CLAUDE.md:** Fixed DM instruction count (10 → 9)
- **MessengerContext.tsx:** Removed broken `storeGroupKeyOnChain` dynamic import (was failing with "not a function")

## Files Changed (Not Yet Committed)

```
modified:   README.md (instruction count fix - cosmetic)
modified:   .dev/CLAUDE.md (instruction count fix - cosmetic)
modified:   app/src/contexts/MessengerContext.tsx (group key fixes + removed broken import)
modified:   app/src/hooks/useMukonMessenger.ts (stale program ID fix - dead code)
modified:   app/src/screens/SettingsScreen.tsx (program ID display fix)
modified:   backend/src/index.js (group_key_needed broadcast - DEPLOYED)
modified:   programs/mukon-messenger/src/lib.rs (close_relationship instruction - NOT DEPLOYED)
```

## Next Session TODO

1. **Deploy program** with `close_relationship` instruction
2. **Add client tx builder** for `close_relationship` (transactions.ts)
3. **Update discriminators** (`node scripts/update-discriminators.js`)
4. **Close old Relationship PDAs** between test wallets
5. **Fresh test:** Register → Invite → Accept → Create group → Invite to group → Accept → Test decryption
6. **Verify:** Both group key recovery paths work (on-chain backup + socket broadcast)

## Test Wallets (Current State - All De-registered)

- `Hx2ED5bfbDaDxAYHFiGjLQ7bYVcZ4bPQd7L2PA52nQkD` - Re-registered (no profile name/avatar)
- `39Eui8zXW8S14TkTQX9dE4yRhHYqpk1B9GcUEzWFnoXw` - Not yet re-registered
- `3uBhqxZT3oCY9F9127YvU3XeoZC4ouB2yCzf3HdgXzLr` - Not yet re-registered

All have stale Relationship PDAs with status=Accepted. Need to close these before re-inviting.

## Known Issues (Unrelated to Current Work)

- Socket instability on physical device (xhr post/poll errors) - deferred
- AsyncStorage has 27 stale group keys from previous sessions - harmless but could clear app data
- Helius RPC occasionally returns 403 on `getProgramAccounts` - rate limiting or daily quota?
