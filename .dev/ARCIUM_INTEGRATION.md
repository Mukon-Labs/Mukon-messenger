# Arcium MPC Integration

## Status: ARCHITECTURE PIVOT (v0.7.0) - Feb 4, 2026

Program ID: `54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy`
MXE Account: `5EJeKvZL6dPFcNuVVUWctDzZLU16pJA4sucg3ysPXJdr`
Cluster offset: `456` (devnet v0.7.0)
Authority: `4nAa99e7ekqEJRhkw9oWY4aH9eQpH7KTETRtDdWW9TJz`

## Architecture: Per-Relationship PDAs

Replaced WalletDescriptor (Vec<Peer>) with individual Relationship PDAs:
- Seeds: `["relationship", min(a,b), max(a,b), version]`
- 82 bytes per relationship (vs 6,904 bytes for 100-peer WalletDescriptor)
- O(1) lookup via PDA derivation
- Status per side: 0=Empty, 1=Invited, 2=Requested, 3=Accepted, 4=Rejected, 5=Blocked

## Devnet Comp Def Status

| Circuit | ACUs | Status | PDA |
|---------|------|--------|-----|
| is_mutual_contact | ~30K gates | **LIVE** | `4hgECiUZxENzowauo5BfYNAqRF84q8EZntQ6jJMxVmz9` |
| count_accepted | 507M | **LIVE** | `HJQsfG2SSWgEWxA6Tyd6pXL1iowhvMn48CK1xHYACTxJ` |
| add_two_numbers | 473M | **LIVE** | `2AuLH92uNpNCkenHYatPHptZMaaZeWkuDWCHayhCSgKR` |

### Previous Circuit (Removed)

`is_accepted_contact` was BLOCKED at 1.17B ACUs (limit ~700-800M). The 32-byte encrypted pubkey comparison was too expensive even at MAX_CONTACTS=2. Replaced by `is_mutual_contact` which compares two u8 status values.

## Dependencies

| Crate | Version | Notes |
|-------|---------|-------|
| arcium-anchor | 0.7.0 | includes `idl-build` feature |
| arcium-client | 0.7.0 | `default-features = false` (critical for SBF) |
| arcium-macros | 0.7.0 | `circuit_hash!` macro |
| arcis | 0.7.0 | encrypted-ixs circuit definitions |
| @arcium-hq/client | 0.7.0 | TypeScript helpers (root package.json) |

## Circuits (encrypted-ixs/src/lib.rs)

1. **is_mutual_contact** - Check if both sides of a Relationship have Accepted status
   - Input: `Enc<Shared, RelationshipStatus>` (2 bytes: status_a, status_b)
   - Output: `Enc<Shared, bool>`
   - Estimated: ~100-150M ACUs (two u8 comparisons)
2. **count_accepted** - Count accepted contacts privately
   - Input: `Enc<Shared, ContactList>`
   - Output: `Enc<Shared, u32>`
3. **add_two_numbers** - Demo/testing circuit
   - Input: `Enc<Shared, AddInput>`
   - Output: `Enc<Shared, u32>`

## Program Instructions (programs/mukon-messenger/src/lib.rs)

**Init Comp Def (3):**
- `init_is_mutual_contact_comp_def`
- `init_count_accepted_comp_def`
- `init_add_two_numbers_comp_def`

**Queue Computation (1):**
- `check_mutual_contact` - Queue mutual contact verification MPC

**Callbacks (2):**
- `is_mutual_contact_callback` - Handle mutual contact check result
- `count_accepted_callback` - Handle count result

**Events:**
- `MutualContactResult { ciphertext, nonce, encryption_key }`
- `ContactCountResult { ciphertext, nonce, encryption_key }`

## v0.7.0 API Notes

- `default-features = false` on `arcium-client` (prevents tokio/socket2 on SBF)
- `comp_def_offset()` is a function (not macro), lives in `arcium_anchor`
- `SIGN_PDA_SEED` imported from `arcium_anchor::prelude` (type `&[u8]`)
- Callback naming: `<encrypted_ix_name>_callback` / `<Name>Callback`
- `callback_url` removed from `queue_computation`
- LUT accounts required in InitCompDef structs
- `encrypted_bytes()` removed; use `account()` for large structs
- `arcium-anchor/idl-build` feature needed in Cargo.toml
- `getCompDefAccOffset()` returns Uint8Array, must convert to u32 via `readUInt32LE(0)` before passing to `getCompDefAccAddress()`

## Deployment Steps

```bash
# 1. Deploy program + init MXE (one-time)
arcium deploy --cluster-offset 456 --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url https://api.devnet.solana.com

# 2. Init comp defs (one-time, via script)
npx ts-node --transpile-only scripts/init-comp-defs.ts

# 3. Upgrade program only (after code changes)
arcium deploy --skip-init --cluster-offset 456 --recovery-set-size 4 \
  --keypair-path ~/.config/solana/id.json \
  --rpc-url https://api.devnet.solana.com
```

## Previous Program IDs (closed)

- `GCTzU7Y6yaBNzW6WA1EJR6fnY9vLNZEEPcgsydCD8mpj` - original pre-arcium program
- `Azw2mvDpmXzHsU46WzumXhzPAZKpRsrXBvHUfFHz2EB5` - first arcium attempt (MXE authority bug)
