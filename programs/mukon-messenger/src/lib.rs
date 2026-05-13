use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use sha2::{Digest, Sha256};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};
use arcium_macros::circuit_hash;

// Light Protocol ZK Compression imports (V2)
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    cpi::{v2::CpiAccounts, CpiSigner, InvokeLightSystemProgram, LightCpiInstruction},
    instruction::{
        account_meta::CompressedAccountMeta,
        PackedAddressTreeInfo,
        ValidityProof,
    },
    LightDiscriminator,
    LightHasher,
};

declare_id!("54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy");

// CPI signer for Light System Program calls
pub const LIGHT_CPI_SIGNER: CpiSigner =
    light_sdk::derive_light_cpi_signer!("54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy");

const COMP_DEF_OFFSET_IS_MUTUAL_CONTACT: u32 = comp_def_offset("is_mutual_contact");
const COMP_DEF_OFFSET_COUNT_ACCEPTED: u32 = comp_def_offset("count_accepted");
const _COMP_DEF_OFFSET_ADD_TWO_NUMBERS: u32 = comp_def_offset("add_two_numbers");

#[error_code]
pub enum ErrorCode {
    #[msg("Already invited")]
    AlreadyInvited,
    #[msg("Not invited")]
    NotInvited,
    #[msg("Not requested")]
    NotRequested,
    #[msg("Invalid hash")]
    InvalidHash,
    #[msg("Display name too long")]
    DisplayNameTooLong,
    #[msg("Group name too long")]
    GroupNameTooLong,
    #[msg("Group is full")]
    GroupFull,
    #[msg("Not a group member")]
    NotGroupMember,
    #[msg("Not group admin")]
    NotGroupAdmin,
    #[msg("Cannot remove creator")]
    CannotRemoveCreator,
    #[msg("Insufficient token balance")]
    InsufficientTokenBalance,
    #[msg("Token account required")]
    TokenAccountRequired,
    #[msg("Token account does not belong to user")]
    InvalidTokenAccount,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Computation aborted")]
    AbortedComputation,
    #[msg("Cluster not set")]
    ClusterNotSet,
    #[msg("Invalid session")]
    InvalidSession,
    #[msg("Session expired")]
    SessionExpired,
    #[msg("Invite already exists")]
    InviteAlreadyExists,
    #[msg("Not the invite recipient")]
    NotInviteRecipient,
    #[msg("Not the relationship initiator")]
    NotRelationshipInitiator,
    #[msg("Index owner mismatch")]
    IndexOwnerMismatch,
}

// Deterministic hash function for chat PDAs
fn get_chat_hash(a: Pubkey, b: Pubkey) -> [u8; 32] {
    let mut c: [u8; 64] = [0; 64];

    for i in 0..32 {
        if a.to_bytes()[i] == b.to_bytes()[i] {
            continue;
        }
        if a.to_bytes()[i] < b.to_bytes()[i] {
            c[0..32].copy_from_slice(&a.to_bytes());
            c[32..64].copy_from_slice(&b.to_bytes());
        } else {
            c[0..32].copy_from_slice(&b.to_bytes());
            c[32..64].copy_from_slice(&a.to_bytes());
        }
        break;
    }

    let mut hasher = Sha256::new();
    hasher.update(&c);
    hasher.finalize().into()
}

// Relationship status constants
const STATUS_EMPTY: u8 = 0;
const STATUS_INVITED: u8 = 1;
const STATUS_REQUESTED: u8 = 2;
const STATUS_ACCEPTED: u8 = 3;
const STATUS_REJECTED: u8 = 4;
const STATUS_BLOCKED: u8 = 5;

/// Returns (min, max) canonical ordering of two pubkeys
fn canonical_order(a: Pubkey, b: Pubkey) -> (Pubkey, Pubkey) {
    if a < b { (a, b) } else { (b, a) }
}

/// Resolve the actual wallet authority from either a direct signer or a session token.
/// If session_token is provided, validates the session key matches the payer and is not expired,
/// then returns the wallet authority. Otherwise returns the payer key directly.
fn resolve_authority(payer: &Pubkey, session_token: Option<&SessionToken>) -> Result<Pubkey> {
    if let Some(session) = session_token {
        require!(session.session_key == *payer, ErrorCode::InvalidSession);
        require!(Clock::get()?.unix_timestamp <= session.valid_until, ErrorCode::SessionExpired);
        Ok(session.authority)
    } else {
        Ok(*payer)
    }
}

#[arcium_program]
pub mod mukon_messenger {
    use super::*;

    pub fn register(ctx: Context<Register>, display_name: String, avatar_data: String, encryption_public_key: [u8; 32]) -> Result<()> {
        let user_profile = &mut ctx.accounts.user_profile;
        let payer = &ctx.accounts.payer;

        require!(display_name.len() <= 32, ErrorCode::DisplayNameTooLong);

        user_profile.owner = payer.key();
        user_profile.display_name = display_name.clone();
        user_profile.avatar_type = AvatarType::Emoji;
        user_profile.avatar_data = avatar_data;
        user_profile.encryption_public_key = encryption_public_key;

        msg!("Register: {:?} with display name: {}", payer.key(), display_name);

        Ok(())
    }

    /// Create a session token that allows a device keypair to sign on behalf of the wallet.
    /// The wallet signs once; all subsequent on-chain actions use the session key (zero popups).
    pub fn create_session(ctx: Context<CreateSession>, valid_until: i64) -> Result<()> {
        let session = &mut ctx.accounts.session_token;
        session.authority = ctx.accounts.authority.key();
        session.session_key = ctx.accounts.session_key.key();
        session.valid_until = valid_until;

        msg!("Session created: authority={:?}, session_key={:?}, valid_until={}",
             session.authority, session.session_key, valid_until);

        Ok(())
    }

    /// Revoke a session token. Only the original wallet authority can revoke.
    pub fn revoke_session(ctx: Context<RevokeSession>) -> Result<()> {
        msg!("Session revoked: authority={:?}, session_key={:?}",
             ctx.accounts.session_token.authority, ctx.accounts.session_token.session_key);
        Ok(())
    }

    pub fn update_profile(
        ctx: Context<UpdateProfile>,
        display_name: Option<String>,
        avatar_type: Option<AvatarType>,
        avatar_data: Option<String>,
        encryption_public_key: Option<[u8; 32]>
    ) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;

        // Verify the passed authority account matches the resolved authority
        require!(ctx.accounts.authority.key() == authority, ErrorCode::Unauthorized);
        let user_profile = &mut ctx.accounts.user_profile;

        // Verify the resolved authority owns this profile
        require!(user_profile.owner == authority, ErrorCode::Unauthorized);

        if let Some(name) = display_name {
            require!(name.len() <= 32, ErrorCode::DisplayNameTooLong);
            user_profile.display_name = name;
        }

        if let Some(atype) = avatar_type {
            user_profile.avatar_type = atype;
        }

        if let Some(adata) = avatar_data {
            user_profile.avatar_data = adata;
        }

        if let Some(key) = encryption_public_key {
            user_profile.encryption_public_key = key;
        }

        msg!("Profile updated: {:?}", authority);

        Ok(())
    }

    /// Close profile account and return rent (useful for testing/redeployment)
    /// WARNING: This is a destructive operation - use with caution!
    pub fn close_profile(ctx: Context<CloseProfile>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;

        // Verify UserProfile PDA using resolved authority
        let (expected_profile_pda, _) = Pubkey::find_program_address(
            &[
                b"user_profile",
                authority.as_ref(),
                USER_PROFILE_VERSION.as_ref(),
            ],
            ctx.program_id,
        );

        require_keys_eq!(
            ctx.accounts.user_profile.key(),
            expected_profile_pda,
            ErrorCode::InvalidHash
        );

        // Close UserProfile — return lamports to the payer (session key or wallet)
        let profile_lamports = ctx.accounts.user_profile.lamports();
        **ctx.accounts.user_profile.lamports.borrow_mut() = 0;
        **ctx.accounts.payer.lamports.borrow_mut() += profile_lamports;
        ctx.accounts.user_profile.try_borrow_mut_data()?.fill(0);

        msg!("Profile closed: {:?}", authority);
        Ok(())
    }

    /// Close a legacy WalletDescriptor to reclaim rent (migration helper)
    pub fn close_wallet_descriptor(ctx: Context<CloseWalletDescriptor>) -> Result<()> {
        let (expected_pda, _) = Pubkey::find_program_address(
            &[
                b"wallet_descriptor",
                ctx.accounts.payer.key().as_ref(),
                WALLET_DESCRIPTOR_VERSION.as_ref(),
            ],
            ctx.program_id,
        );

        require_keys_eq!(
            ctx.accounts.wallet_descriptor.key(),
            expected_pda,
            ErrorCode::InvalidHash
        );

        let descriptor_lamports = ctx.accounts.wallet_descriptor.lamports();
        **ctx.accounts.wallet_descriptor.lamports.borrow_mut() = 0;
        **ctx.accounts.payer.lamports.borrow_mut() += descriptor_lamports;
        ctx.accounts.wallet_descriptor.try_borrow_mut_data()?.fill(0);

        msg!("WalletDescriptor closed: {:?}", ctx.accounts.payer.key());
        Ok(())
    }

    pub fn invite(ctx: Context<Invite>, _hash: [u8; 32]) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let invitee = &ctx.accounts.invitee;
        let relationship = &mut ctx.accounts.relationship;

        let hash = get_chat_hash(authority, invitee.key());
        require!(hash == _hash, ErrorCode::InvalidHash);

        // Validate canonical ordering
        let user_a = ctx.accounts.user_a.key();
        let user_b = ctx.accounts.user_b.key();
        require!(user_a < user_b, ErrorCode::InvalidHash);

        // Validate that user_a and user_b match authority and invitee
        let (expected_a, expected_b) = canonical_order(authority, invitee.key());
        require!(user_a == expected_a && user_b == expected_b, ErrorCode::InvalidHash);

        // If PDA already exists (re-invite), only allow from Rejected or Empty state
        if relationship.user_a != Pubkey::default() {
            require!(
                relationship.status_a == STATUS_REJECTED && relationship.status_b == STATUS_REJECTED,
                ErrorCode::AlreadyInvited
            );
        }

        relationship.user_a = user_a;
        relationship.user_b = user_b;
        relationship.created_at = Clock::get()?.unix_timestamp;

        // Set status based on canonical ordering
        if authority == user_a {
            relationship.status_a = STATUS_INVITED;
            relationship.status_b = STATUS_REQUESTED;
        } else {
            relationship.status_a = STATUS_REQUESTED;
            relationship.status_b = STATUS_INVITED;
        }

        let conversation = &mut ctx.accounts.conversation;
        conversation.participants = [authority, invitee.key()];
        conversation.created_at = Clock::get()?.unix_timestamp;

        msg!("Invite: sender={:?}, target={:?}, chat={:?}",
             authority, invitee.key(), hash);

        Ok(())
    }

    pub fn accept(ctx: Context<Accept>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let peer = &ctx.accounts.peer;
        let relationship = &mut ctx.accounts.relationship;

        let (user_a, _) = canonical_order(authority, peer.key());

        // Verify caller has Requested status and peer has Invited status
        if authority == user_a {
            require!(relationship.status_a == STATUS_REQUESTED, ErrorCode::NotRequested);
            require!(relationship.status_b == STATUS_INVITED, ErrorCode::NotInvited);
        } else {
            require!(relationship.status_b == STATUS_REQUESTED, ErrorCode::NotRequested);
            require!(relationship.status_a == STATUS_INVITED, ErrorCode::NotInvited);
        }

        relationship.status_a = STATUS_ACCEPTED;
        relationship.status_b = STATUS_ACCEPTED;

        msg!("Accept: accepter={:?}, inviter={:?}, chat={:?}",
             authority, peer.key(), get_chat_hash(authority, peer.key()));

        Ok(())
    }

    pub fn reject(ctx: Context<Reject>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let peer = &ctx.accounts.peer;
        let relationship = &mut ctx.accounts.relationship;

        let (user_a, _) = canonical_order(authority, peer.key());

        // Allow rejecting any non-blocked relationship
        let my_status = if authority == user_a { relationship.status_a } else { relationship.status_b };
        require!(
            my_status == STATUS_REQUESTED || my_status == STATUS_INVITED || my_status == STATUS_ACCEPTED || my_status == STATUS_REJECTED,
            ErrorCode::NotRequested
        );

        relationship.status_a = STATUS_REJECTED;
        relationship.status_b = STATUS_REJECTED;

        msg!("Reject: rejecter={:?}, peer={:?}",
             authority, peer.key());

        Ok(())
    }

    pub fn block(ctx: Context<Block>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let peer = &ctx.accounts.peer;
        let relationship = &mut ctx.accounts.relationship;

        // Relationship must exist (any non-empty status)
        let (user_a, _) = canonical_order(authority, peer.key());
        let my_status = if authority == user_a { relationship.status_a } else { relationship.status_b };
        require!(my_status != STATUS_EMPTY, ErrorCode::NotInvited);

        relationship.status_a = STATUS_BLOCKED;
        relationship.status_b = STATUS_BLOCKED;

        msg!("Block: blocker={:?}, blocked={:?}",
             authority, peer.key());

        Ok(())
    }

    pub fn unblock(ctx: Context<Unblock>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let peer = &ctx.accounts.peer;
        let relationship = &mut ctx.accounts.relationship;

        // Can only unblock if currently blocked
        require!(
            relationship.status_a == STATUS_BLOCKED && relationship.status_b == STATUS_BLOCKED,
            ErrorCode::NotInvited
        );

        // Change Blocked → Rejected (allows re-invite after unblock)
        relationship.status_a = STATUS_REJECTED;
        relationship.status_b = STATUS_REJECTED;

        msg!("Unblock: unblocker={:?}, unblocked={:?}",
             authority, peer.key());

        Ok(())
    }

    /// Close a Relationship PDA and return rent (either party can close)
    pub fn close_relationship(ctx: Context<CloseRelationship>) -> Result<()> {
        // Session support — resolve_authority validates if session token is used
        let _authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;

        let relationship_lamports = ctx.accounts.relationship.to_account_info().lamports();
        **ctx.accounts.relationship.to_account_info().lamports.borrow_mut() = 0;
        **ctx.accounts.payer.lamports.borrow_mut() += relationship_lamports;
        ctx.accounts.relationship.to_account_info().try_borrow_mut_data()?.fill(0);

        msg!("Relationship closed: {:?} <-> {:?}",
             ctx.accounts.user_a.key(), ctx.accounts.user_b.key());
        Ok(())
    }

    // ========== GROUP CHAT INSTRUCTIONS ==========

    pub fn create_group(
        ctx: Context<CreateGroup>,
        group_id: [u8; 32],
        encrypted_name: Vec<u8>,
        name_nonce: [u8; 24],
        encryption_pubkey: [u8; 32],
        token_gate: Option<TokenGate>,
        encrypted_members: Vec<u8>,
        members_nonce: [u8; 24],
    ) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;

        let group = &mut ctx.accounts.group;
        group.group_id = group_id;
        group.creator = authority;
        group.created_at = Clock::get()?.unix_timestamp;
        group.member_count = 1;
        group.encryption_pubkey = encryption_pubkey;
        group.token_gate = token_gate;
        group.encrypted_name = encrypted_name;
        group.name_nonce = name_nonce;
        group.encrypted_members = encrypted_members;
        group.members_nonce = members_nonce;

        msg!("Group created: id={:?}, creator={:?}", group_id, authority);

        Ok(())
    }

    pub fn update_group(
        ctx: Context<UpdateGroup>,
        encrypted_name: Option<Vec<u8>>,
        name_nonce: Option<[u8; 24]>,
        token_gate: Option<TokenGate>
    ) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let group = &mut ctx.accounts.group;

        require!(group.creator == authority, ErrorCode::NotGroupAdmin);

        if let (Some(enc_name), Some(nonce)) = (encrypted_name, name_nonce) {
            group.encrypted_name = enc_name;
            group.name_nonce = nonce;
        }

        if let Some(new_gate) = token_gate {
            group.token_gate = Some(new_gate);
        }

        msg!("Group updated: id={:?}", group.group_id);

        Ok(())
    }

    pub fn invite_to_group(ctx: Context<InviteToGroup>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let group = &ctx.accounts.group;

        // Only creator can invite (member list is encrypted — post-MVP: any member via GroupKeyShare)
        require!(group.creator == authority, ErrorCode::NotGroupAdmin);

        require!(group.member_count < 30, ErrorCode::GroupFull);

        let invite = &mut ctx.accounts.group_invite;
        invite.group_id = group.group_id;
        invite.inviter = authority;
        invite.invitee = ctx.accounts.invitee.key();
        invite.status = GroupInviteStatus::Pending;
        invite.created_at = Clock::get()?.unix_timestamp;

        msg!("Group invite: group={:?}, invitee={:?}",
             group.group_id, ctx.accounts.invitee.key());

        Ok(())
    }

    pub fn accept_group_invite(ctx: Context<AcceptGroupInvite>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;

        // Verify the passed authority account matches the resolved authority
        require!(ctx.accounts.authority.key() == authority, ErrorCode::Unauthorized);

        let group = &mut ctx.accounts.group;
        let invite = &mut ctx.accounts.group_invite;

        // Verify invite status
        require!(
            invite.status == GroupInviteStatus::Pending,
            ErrorCode::NotInvited
        );

        // Verify invitee is the resolved authority
        require!(invite.invitee == authority, ErrorCode::NotInvited);

        // Check token gate if exists
        if let Some(gate) = &group.token_gate {
            let token_account = ctx.accounts.user_token_account.as_ref()
                .ok_or(ErrorCode::TokenAccountRequired)?;

            // SECURITY FIX: Verify token account ownership against resolved authority
            require!(
                token_account.owner == authority,
                ErrorCode::InvalidTokenAccount
            );

            require!(token_account.mint == gate.token_mint, ErrorCode::InsufficientTokenBalance);
            require!(token_account.amount >= gate.min_balance, ErrorCode::InsufficientTokenBalance);
        }

        require!(group.member_count < 30, ErrorCode::GroupFull);

        group.member_count += 1;

        invite.status = GroupInviteStatus::Accepted;

        msg!("Group invite accepted: group={:?}, member={:?}",
             group.group_id, authority);

        Ok(())
    }

    pub fn reject_group_invite(ctx: Context<RejectGroupInvite>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;

        // Verify the passed authority account matches the resolved authority
        require!(ctx.accounts.authority.key() == authority, ErrorCode::Unauthorized);

        let invite = &mut ctx.accounts.group_invite;

        // Verify invite status
        require!(
            invite.status == GroupInviteStatus::Pending,
            ErrorCode::NotInvited
        );

        // Verify invitee is the resolved authority
        require!(invite.invitee == authority, ErrorCode::NotInvited);

        // Update invite status
        invite.status = GroupInviteStatus::Rejected;

        msg!("Group invite rejected: group={:?}, invitee={:?}",
             invite.group_id, authority);

        Ok(())
    }

    pub fn leave_group(ctx: Context<LeaveGroup>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let group = &mut ctx.accounts.group;

        require!(group.creator != authority, ErrorCode::CannotRemoveCreator);
        require!(group.member_count > 0, ErrorCode::NotGroupMember);

        group.member_count -= 1;

        msg!("Left group: group={:?}, member={:?}", group.group_id, authority);

        Ok(())
    }

    pub fn kick_member(ctx: Context<KickMember>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let group = &mut ctx.accounts.group;

        require!(group.creator == authority, ErrorCode::NotGroupAdmin);
        require!(ctx.accounts.member.key() != group.creator, ErrorCode::CannotRemoveCreator);
        require!(group.member_count > 0, ErrorCode::NotGroupMember);

        group.member_count -= 1;

        msg!("Kicked from group: group={:?}, member={:?}",
             group.group_id, ctx.accounts.member.key());

        Ok(())
    }

    pub fn close_group(ctx: Context<CloseGroup>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let group = &ctx.accounts.group;

        // Only creator can delete
        require!(group.creator == authority, ErrorCode::NotGroupAdmin);

        // Transfer lamports back to payer (session key or wallet)
        let group_lamports = ctx.accounts.group.to_account_info().lamports();
        **ctx.accounts.group.to_account_info().lamports.borrow_mut() = 0;
        **ctx.accounts.payer.lamports.borrow_mut() += group_lamports;

        msg!("Group closed: group={:?}", group.group_id);

        Ok(())
    }

    pub fn store_group_key(
        ctx: Context<StoreGroupKey>,
        _group_id: [u8; 32],
        encrypted_key: Vec<u8>,
        nonce: [u8; 24],
    ) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;

        // Verify the passed authority account matches the resolved authority
        require!(ctx.accounts.authority.key() == authority, ErrorCode::Unauthorized);

        let key_share = &mut ctx.accounts.group_key_share;
        let group = &ctx.accounts.group;

        // Store the encrypted key share
        key_share.group_id = group.group_id;
        key_share.member = authority;
        key_share.encrypted_key = encrypted_key;
        key_share.nonce = nonce;

        msg!("Group key stored for member: {:?}", authority);

        Ok(())
    }

    pub fn close_group_key(ctx: Context<CloseGroupKey>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;

        // Verify the passed authority account matches the resolved authority
        require!(ctx.accounts.authority.key() == authority, ErrorCode::Unauthorized);

        // Verify the key share belongs to the resolved authority
        require!(
            ctx.accounts.group_key_share.member == authority,
            ErrorCode::Unauthorized
        );

        // Transfer lamports back to payer (session key or wallet)
        let key_share_lamports = ctx.accounts.group_key_share.to_account_info().lamports();
        **ctx.accounts.group_key_share.to_account_info().lamports.borrow_mut() = 0;
        **ctx.accounts.payer.lamports.borrow_mut() += key_share_lamports;

        msg!("Group key share closed for member: {:?}", authority);

        Ok(())
    }

    /// Store a group key on behalf of another member
    /// Only the group creator (admin) can store keys for other members.
    /// This eliminates Socket.IO dependency for key distribution.
    pub fn store_group_key_for_member(
        ctx: Context<StoreGroupKeyForMember>,
        group_id: [u8; 32],
        member: Pubkey,
        encrypted_key: Vec<u8>,
        nonce: [u8; 24],
    ) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let key_share = &mut ctx.accounts.group_key_share;
        let group = &ctx.accounts.group;

        // SECURITY: Only the group creator can store keys for other members
        // Note: No member check — admin stores keys at invite time, before invitee accepts
        require!(group.creator == authority, ErrorCode::NotGroupAdmin);

        // Store the encrypted key share for the member
        key_share.group_id = group_id;
        key_share.member = member;
        key_share.encrypted_key = encrypted_key;
        key_share.nonce = nonce;

        msg!("Group key stored for member: {:?} by admin: {:?}", member, authority);

        Ok(())
    }

    // ========== LIGHT PROTOCOL ZK COMPRESSION INSTRUCTIONS ==========
    //
    // KNOWN ISSUE: Light Protocol custom CPI fails on devnet with verify_proof panic.
    // This is a devnet infrastructure limitation, not a code issue.
    // Architecture is ready for mainnet deployment when infrastructure stabilizes.
    // Fallback: Use regular PDA versions (invite_to_group, accept_group_invite, etc.)
    //
    // Technical details:
    // - V2 CPI with 6-account structure (includes CPI signer PDA)
    // - V0 validity proofs (cross-version compatibility)
    // - Devnet Light System Program panics during proof verification
    // - All compressed operations return to regular PDAs until indexer is fixed

    /// Store a group key share using ZK compression
    /// Replaces store_group_key for new operations
    pub fn store_compressed_group_key<'info>(
        ctx: Context<'_, '_, '_, 'info, StoreCompressedGroupKey<'info>>,
        proof: ValidityProof,
        address_tree_info: PackedAddressTreeInfo,
        output_state_tree_index: u8,
        group_id: [u8; 32],
        encrypted_key: [u8; 48],
        nonce: [u8; 24],
    ) -> Result<()> {
        // Set up CPI accounts
        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.signer.as_ref(),
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        // Get address tree account from remaining accounts
        let address_tree_account = ctx.remaining_accounts
            .get(address_tree_info.address_merkle_tree_pubkey_index as usize)
            .ok_or(ErrorCode::Unauthorized)?;

        // Derive address for this key share
        let (address, address_seed) = derive_address(
            &[b"group_key", group_id.as_ref(), ctx.accounts.signer.key().as_ref()],
            address_tree_account.key,
            &crate::ID,
        );

        let new_address_params =
            address_tree_info.into_new_address_params_assigned_packed(address_seed, Some(0));

        // Create new compressed account
        let mut key_share = LightAccount::<CompressedGroupKeyShare>::new_init(
            &crate::ID,
            Some(address),
            output_state_tree_index,
        );

        key_share.group_id = group_id;
        key_share.member = ctx.accounts.signer.key();
        key_share.encrypted_key = encrypted_key;
        key_share.nonce = nonce;

        // Invoke Light System Program via CPI
        light_sdk::cpi::v2::LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
            .with_light_account(key_share)?
            .with_new_addresses(&[new_address_params])
            .invoke(light_cpi_accounts)?;

        msg!("Compressed group key stored for member: {:?}", ctx.accounts.signer.key());
        Ok(())
    }

    /// Close a compressed group key share
    pub fn close_compressed_group_key<'info>(
        ctx: Context<'_, '_, '_, 'info, CloseCompressedGroupKey<'info>>,
        proof: ValidityProof,
        account_meta: CompressedAccountMeta,
        group_id: [u8; 32],
        member: Pubkey,
        encrypted_key: [u8; 48],
        nonce: [u8; 24],
    ) -> Result<()> {
        // Reconstruct the account data
        let key_share_data = CompressedGroupKeyShare {
            group_id,
            member,
            encrypted_key,
            nonce,
        };

        // Verify the key share belongs to the signer
        require!(
            key_share_data.member == ctx.accounts.signer.key(),
            ErrorCode::Unauthorized
        );

        // Create close operation
        let key_share = LightAccount::<CompressedGroupKeyShare>::new_close(
            &crate::ID,
            &account_meta,
            key_share_data,
        )?;

        // Set up CPI accounts
        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.signer.as_ref(),
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        // Invoke Light System Program via CPI
        light_sdk::cpi::v2::LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
            .with_light_account(key_share)?
            .invoke(light_cpi_accounts)?;

        msg!("Compressed group key share closed for member: {:?}", ctx.accounts.signer.key());
        Ok(())
    }

    /// Invite a user to a group using ZK compression
    /// Replaces invite_to_group for new operations
    pub fn invite_to_group_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, InviteToGroupCompressed<'info>>,
        proof: ValidityProof,
        address_tree_info: PackedAddressTreeInfo,
        output_state_tree_index: u8,
    ) -> Result<()> {
        let group = &ctx.accounts.group;

        // Only creator can invite (member list is encrypted)
        require!(group.creator == ctx.accounts.signer.key(), ErrorCode::NotGroupAdmin);

        require!(group.member_count < 30, ErrorCode::GroupFull);

        // Set up CPI accounts
        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.signer.as_ref(),
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        // Get address tree account from remaining accounts
        let address_tree_account = ctx.remaining_accounts
            .get(address_tree_info.address_merkle_tree_pubkey_index as usize)
            .ok_or(ErrorCode::Unauthorized)?;

        // Derive address for this invite
        let (address, address_seed) = derive_address(
            &[b"group_invite", group.group_id.as_ref(), ctx.accounts.invitee.key().as_ref()],
            address_tree_account.key,
            &crate::ID,
        );

        let new_address_params =
            address_tree_info.into_new_address_params_assigned_packed(address_seed, Some(0));

        // Create new compressed invite
        let mut invite = LightAccount::<CompressedGroupInvite>::new_init(
            &crate::ID,
            Some(address),
            output_state_tree_index,
        );

        invite.group_id = group.group_id;
        invite.inviter = ctx.accounts.signer.key();
        invite.invitee = ctx.accounts.invitee.key();
        invite.status = 0; // Pending
        invite.created_at = Clock::get()?.unix_timestamp;

        // Invoke Light System Program via CPI
        light_sdk::cpi::v2::LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
            .with_light_account(invite)?
            .with_new_addresses(&[new_address_params])
            .invoke(light_cpi_accounts)?;

        msg!("Group invite (compressed): group={:?}, invitee={:?}",
             group.group_id, ctx.accounts.invitee.key());

        Ok(())
    }

    /// Accept a compressed group invite
    pub fn accept_group_invite_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, AcceptGroupInviteCompressed<'info>>,
        proof: ValidityProof,
        account_meta: CompressedAccountMeta,
        group_id: [u8; 32],
        inviter: Pubkey,
        invitee: Pubkey,
        status: u8,
        created_at: i64,
    ) -> Result<()> {
        let group = &mut ctx.accounts.group;

        // Reconstruct current invite state
        let current_invite = CompressedGroupInvite {
            group_id,
            inviter,
            invitee,
            status,
            created_at,
        };

        // Verify invite status is Pending
        require!(
            current_invite.status == 0,
            ErrorCode::NotInvited
        );

        // Verify invitee is the signer
        require!(
            current_invite.invitee == ctx.accounts.signer.key(),
            ErrorCode::NotInvited
        );

        // Check token gate if present
        if let Some(token_gate) = &group.token_gate {
            let user_token_account = ctx.accounts.user_token_account.as_ref()
                .ok_or(ErrorCode::TokenAccountRequired)?;

            require!(
                user_token_account.owner == ctx.accounts.signer.key(),
                ErrorCode::InvalidTokenAccount
            );

            require!(
                user_token_account.mint == token_gate.token_mint,
                ErrorCode::InvalidTokenAccount
            );

            require!(
                user_token_account.amount >= token_gate.min_balance,
                ErrorCode::InsufficientTokenBalance
            );
        }

        group.member_count += 1;

        // Update compressed invite status to Accepted
        let mut invite = LightAccount::<CompressedGroupInvite>::new_mut(
            &crate::ID,
            &account_meta,
            current_invite,
        )?;
        invite.status = 1; // Accepted

        // Set up CPI accounts
        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.signer.as_ref(),
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        // Invoke Light System Program via CPI
        light_sdk::cpi::v2::LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
            .with_light_account(invite)?
            .invoke(light_cpi_accounts)?;

        msg!("Group invite accepted (compressed): group={:?}, member={:?}",
             group.group_id, ctx.accounts.signer.key());

        Ok(())
    }

    /// Reject a compressed group invite
    pub fn reject_group_invite_compressed<'info>(
        ctx: Context<'_, '_, '_, 'info, RejectGroupInviteCompressed<'info>>,
        proof: ValidityProof,
        account_meta: CompressedAccountMeta,
        group_id: [u8; 32],
        inviter: Pubkey,
        invitee: Pubkey,
        status: u8,
        created_at: i64,
    ) -> Result<()> {
        // Reconstruct current invite state
        let current_invite = CompressedGroupInvite {
            group_id,
            inviter,
            invitee,
            status,
            created_at,
        };

        // Verify invite status is Pending
        require!(
            current_invite.status == 0,
            ErrorCode::NotInvited
        );

        // Verify invitee is the signer
        require!(
            current_invite.invitee == ctx.accounts.signer.key(),
            ErrorCode::NotInvited
        );

        // Save group_id for logging before moving current_invite
        let log_group_id = current_invite.group_id;

        // Update compressed invite status to Rejected
        let mut invite = LightAccount::<CompressedGroupInvite>::new_mut(
            &crate::ID,
            &account_meta,
            current_invite,
        )?;
        invite.status = 2; // Rejected

        // Set up CPI accounts
        let light_cpi_accounts = CpiAccounts::new(
            ctx.accounts.signer.as_ref(),
            ctx.remaining_accounts,
            crate::LIGHT_CPI_SIGNER,
        );

        // Invoke Light System Program via CPI
        light_sdk::cpi::v2::LightSystemProgramCpi::new_cpi(crate::LIGHT_CPI_SIGNER, proof)
            .with_light_account(invite)?
            .invoke(light_cpi_accounts)?;

        msg!("Group invite rejected (compressed): group={:?}, invitee={:?}",
             log_group_id, ctx.accounts.signer.key());

        Ok(())
    }

    // ========== ARCIUM MPC INSTRUCTIONS ==========

    /// Initialize computation definition for is_mutual_contact circuit
    pub fn init_is_mutual_contact_comp_def(ctx: Context<InitIsMutualContactCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://mukon-circuits.fly.dev/is_mutual_contact.arcis".to_string(),
                hash: circuit_hash!("is_mutual_contact"),
            })),
            None,
        )?;
        msg!("Initialized comp def: is_mutual_contact");
        Ok(())
    }

    /// Initialize computation definition for count_accepted circuit
    pub fn init_count_accepted_comp_def(ctx: Context<InitCountAcceptedCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://mukon-circuits.fly.dev/count_accepted.arcis".to_string(),
                hash: circuit_hash!("count_accepted"),
            })),
            None,
        )?;
        msg!("Initialized comp def: count_accepted");
        Ok(())
    }

    /// Initialize computation definition for add_two_numbers circuit (demo)
    pub fn init_add_two_numbers_comp_def(ctx: Context<InitAddTwoNumbersCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://mukon-circuits.fly.dev/add_two_numbers.arcis".to_string(),
                hash: circuit_hash!("add_two_numbers"),
            })),
            None,
        )?;
        msg!("Initialized comp def: add_two_numbers");
        Ok(())
    }

    /// Queue MPC computation to check if a relationship is mutually accepted
    pub fn check_mutual_contact(
        ctx: Context<CheckMutualContact>,
        computation_offset: u64,
        relationship_account: Pubkey,
        relationship_offset: u32,
        relationship_length: u32,
        pub_key: [u8; 32],
        nonce: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce)
            .account(relationship_account, relationship_offset, relationship_length)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![IsMutualContactCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;

        msg!("Queued mutual_contact computation: offset={}", computation_offset);
        Ok(())
    }

    /// Callback for is_mutual_contact computation
    #[arcium_callback(encrypted_ix = "is_mutual_contact")]
    pub fn is_mutual_contact_callback(
        ctx: Context<IsMutualContactCallback>,
        output: SignedComputationOutputs<IsMutualContactOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(IsMutualContactOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("MPC computation failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        emit!(MutualContactResult {
            ciphertext: result.ciphertexts[0],
            nonce: result.nonce,
            encryption_key: result.encryption_key,
        });

        msg!("mutual_contact computation completed");
        Ok(())
    }

    /// Queue MPC computation to count accepted contacts
    pub fn count_accepted_contacts(
        ctx: Context<CountAcceptedContacts>,
        computation_offset: u64,
        contact_list_account: Pubkey,
        contact_list_offset: u32,
        contact_list_length: u32,
        pub_key: [u8; 32],
        nonce_list: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce_list)
            .account(contact_list_account, contact_list_offset, contact_list_length)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            vec![CountAcceptedCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;

        msg!("Queued count_accepted computation: offset={}", computation_offset);
        Ok(())
    }

    /// Callback for count_accepted computation
    #[arcium_callback(encrypted_ix = "count_accepted")]
    pub fn count_accepted_callback(
        ctx: Context<CountAcceptedCallback>,
        output: SignedComputationOutputs<CountAcceptedOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(CountAcceptedOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("MPC computation failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        emit!(ContactCountResult {
            ciphertext: result.ciphertexts[0],
            nonce: result.nonce,
            encryption_key: result.encryption_key,
        });

        msg!("count_accepted computation completed");
        Ok(())
    }

    // ========== PRIVATE SOCIAL GRAPH INSTRUCTIONS ==========

    pub fn create_contact_index(ctx: Context<CreateContactIndex>) -> Result<()> {
        let index = &mut ctx.accounts.contact_index;
        index.owner = ctx.accounts.payer.key();
        index.encrypted_entries = vec![];
        index.nonce = [0u8; 24];
        msg!("ContactIndex created: owner={:?}", index.owner);
        Ok(())
    }

    pub fn update_contact_index(
        ctx: Context<UpdateContactIndex>,
        encrypted_entries: Vec<u8>,
        nonce: [u8; 24],
    ) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let index = &mut ctx.accounts.contact_index;
        require!(index.owner == authority, ErrorCode::IndexOwnerMismatch);
        index.encrypted_entries = encrypted_entries;
        index.nonce = nonce;
        Ok(())
    }

    pub fn create_group_index(ctx: Context<CreateGroupIndex>) -> Result<()> {
        let index = &mut ctx.accounts.group_index;
        index.owner = ctx.accounts.payer.key();
        index.encrypted_entries = vec![];
        index.nonce = [0u8; 24];
        msg!("GroupIndex created: owner={:?}", index.owner);
        Ok(())
    }

    pub fn update_group_index(
        ctx: Context<UpdateGroupIndex>,
        encrypted_entries: Vec<u8>,
        nonce: [u8; 24],
    ) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let index = &mut ctx.accounts.group_index;
        require!(index.owner == authority, ErrorCode::IndexOwnerMismatch);
        index.encrypted_entries = encrypted_entries;
        index.nonce = nonce;
        Ok(())
    }

    /// Creates a PrivateRelationship + InvitePointer atomically.
    /// Initiator's status set to Accepted (3), recipient's to Invited (1).
    pub fn create_private_invite(
        ctx: Context<CreatePrivateInvite>,
        random_id: [u8; 32],
        encrypted_data: Vec<u8>,
        data_nonce: [u8; 24],
        encrypted_sender: Vec<u8>,
        sender_nonce: [u8; 24],
    ) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;

        let rel = &mut ctx.accounts.private_relationship;
        rel.random_id = random_id;
        rel.status_a = 3; // Accepted — initiator always starts accepted
        rel.status_b = 1; // Invited — recipient hasn't responded
        rel.created_at = Clock::get()?.unix_timestamp;
        rel.initiator = authority;
        rel.encrypted_data = encrypted_data;
        rel.data_nonce = data_nonce;

        let ptr = &mut ctx.accounts.invite_pointer;
        ptr.recipient = ctx.accounts.recipient.key();
        ptr.random_id = random_id;
        ptr.encrypted_sender = encrypted_sender;
        ptr.sender_nonce = sender_nonce;
        ptr.created_at = Clock::get()?.unix_timestamp;

        msg!("Private invite created: random_id={:?}", random_id);
        Ok(())
    }

    /// Accept a private invite. Sets status_b = 3. Closes InvitePointer (returns rent).
    pub fn accept_private_invite(ctx: Context<AcceptPrivateInvite>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        require!(
            ctx.accounts.invite_pointer.recipient == authority,
            ErrorCode::NotInviteRecipient
        );
        ctx.accounts.private_relationship.status_b = 3; // Accepted
        msg!("Private invite accepted: random_id={:?}", ctx.accounts.private_relationship.random_id);
        Ok(())
    }

    /// Reject a private invite. Sets status_b = 4. Closes InvitePointer (returns rent).
    pub fn reject_private_invite(ctx: Context<RejectPrivateInvite>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        require!(
            ctx.accounts.invite_pointer.recipient == authority,
            ErrorCode::NotInviteRecipient
        );
        ctx.accounts.private_relationship.status_b = 4; // Rejected
        msg!("Private invite rejected: random_id={:?}", ctx.accounts.private_relationship.random_id);
        Ok(())
    }

    /// Update one side's status (block = 5, unblock = 3).
    /// side: 0 = initiator (status_a), 1 = recipient (status_b).
    /// Auth for side 1: knowledge of random_id (non-initiator with account access).
    pub fn update_relationship_status(
        ctx: Context<UpdateRelationshipStatus>,
        side: u8,
        new_status: u8,
    ) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let rel = &mut ctx.accounts.private_relationship;
        match side {
            0 => {
                require!(rel.initiator == authority, ErrorCode::NotRelationshipInitiator);
                rel.status_a = new_status;
            }
            1 => {
                // Recipient: must not be the initiator (knowledge of random_id = proof of being the other party)
                require!(rel.initiator != authority, ErrorCode::Unauthorized);
                rel.status_b = new_status;
            }
            _ => return Err(ErrorCode::Unauthorized.into()),
        }
        msg!("Relationship status updated: side={}, status={}", side, new_status);
        Ok(())
    }

    /// Close a PrivateRelationship and reclaim rent.
    /// Auth: initiator can always delete; either party can delete if statuses are terminal.
    pub fn delete_private_relationship(ctx: Context<DeletePrivateRelationship>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let rel = &ctx.accounts.private_relationship;
        let is_terminal = matches!(rel.status_a, 4 | 5) && matches!(rel.status_b, 4 | 5);
        require!(
            rel.initiator == authority || is_terminal,
            ErrorCode::NotRelationshipInitiator
        );
        msg!("Private relationship deleted: random_id={:?}", rel.random_id);
        Ok(())
    }

    /// Admin-only: update the encrypted members display blob on the group account.
    pub fn update_group_members_list(
        ctx: Context<UpdateGroupMembersList>,
        encrypted_members: Vec<u8>,
        members_nonce: [u8; 24],
    ) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let group = &mut ctx.accounts.group;
        require!(group.creator == authority, ErrorCode::NotGroupAdmin);
        group.encrypted_members = encrypted_members;
        group.members_nonce = members_nonce;
        msg!("Group members list updated: id={:?}", group.group_id);
        Ok(())
    }

    /// Close a legacy Relationship PDA and reclaim rent (migration helper).
    pub fn close_old_relationship(ctx: Context<CloseOldRelationship>) -> Result<()> {
        let authority = resolve_authority(
            &ctx.accounts.payer.key(),
            ctx.accounts.session_token.as_deref(),
        )?;
        let rel = &ctx.accounts.relationship;
        require!(rel.user_a == authority || rel.user_b == authority, ErrorCode::Unauthorized);
        msg!("Old relationship closed: user_a={:?}", rel.user_a);
        Ok(())
    }
}

// ========== ACCOUNT STRUCTURES ==========

const WALLET_DESCRIPTOR_VERSION: [u8; 1] = [1];
const USER_PROFILE_VERSION: [u8; 1] = [1];
const CONVERSATION_VERSION: [u8; 1] = [1];
const GROUP_VERSION: [u8; 1] = [1];
const GROUP_INVITE_VERSION: [u8; 1] = [1];
const GROUP_KEY_SHARE_VERSION: [u8; 1] = [1];
const RELATIONSHIP_VERSION: [u8; 1] = [1];
const SESSION_TOKEN_VERSION: [u8; 1] = [1];
const PRIVATE_RELATIONSHIP_VERSION: [u8; 1] = [1];
const CONTACT_INDEX_VERSION: [u8; 1] = [1];
const INVITE_POINTER_VERSION: [u8; 1] = [1];
const GROUP_INDEX_VERSION: [u8; 1] = [1];

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum PeerState {
    Invited = 0,
    Requested = 1,
    Accepted = 2,
    Rejected = 3,
    Blocked = 4,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum AvatarType {
    Emoji = 0,
    Nft = 1,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum GroupInviteStatus {
    Pending = 0,
    Accepted = 1,
    Rejected = 2,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Peer {
    pub wallet: Pubkey,
    pub state: PeerState,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TokenGate {
    pub token_mint: Pubkey,
    pub min_balance: u64,
}

#[account]
pub struct WalletDescriptor {
    pub owner: Pubkey,
    pub peers: Vec<Peer>,
}

#[account]
pub struct UserProfile {
    pub owner: Pubkey,
    pub display_name: String,
    pub avatar_type: AvatarType,
    pub avatar_data: String,
    pub encryption_public_key: [u8; 32],
}

#[account]
pub struct Conversation {
    pub participants: [Pubkey; 2],
    pub created_at: i64,
}

#[account]
pub struct Group {
    pub group_id: [u8; 32],
    pub creator: Pubkey,
    pub created_at: i64,
    pub member_count: u32,              // plaintext — enforces 30-member limit
    pub encryption_pubkey: [u8; 32],
    pub token_gate: Option<TokenGate>,
    pub encrypted_name: Vec<u8>,        // nacl.secretbox(name, group_secret)
    pub name_nonce: [u8; 24],
    pub encrypted_members: Vec<u8>,     // nacl.secretbox(Vec<Pubkey>, group_secret)
    pub members_nonce: [u8; 24],
}

#[account]
pub struct GroupInvite {
    pub group_id: [u8; 32],
    pub inviter: Pubkey,
    pub invitee: Pubkey,
    pub status: GroupInviteStatus,
    pub created_at: i64,
}

#[account]
pub struct GroupKeyShare {
    pub group_id: [u8; 32],
    pub member: Pubkey,
    pub encrypted_key: Vec<u8>,
    pub nonce: [u8; 24],
}

/// Per-relationship PDA for DM contacts
/// Seeds: ["relationship", min(a,b), max(a,b), RELATIONSHIP_VERSION]
#[account]
pub struct Relationship {
    pub user_a: Pubkey,     // min(pubkey_a, pubkey_b) — canonical ordering
    pub user_b: Pubkey,     // max(pubkey_a, pubkey_b)
    pub status_a: u8,       // user_a's status (0=empty, 1=invited, 2=requested, 3=accepted, 4=rejected, 5=blocked)
    pub status_b: u8,       // user_b's status
    pub created_at: i64,
}
// Space: 8 + 32 + 32 + 1 + 1 + 8 = 82 bytes

/// Session token: allows a device keypair to sign on behalf of a wallet.
/// Seeds: ["session", session_key]
#[account]
pub struct SessionToken {
    pub authority: Pubkey,     // the wallet that authorized this session
    pub session_key: Pubkey,   // the local device keypair
    pub valid_until: i64,      // expiration timestamp
}
// Space: 8 + 32 + 32 + 8 = 80 bytes

// ========== PRIVATE SOCIAL GRAPH STRUCTURES ==========

/// Private DM relationship PDA — seeds: ["priv_rel", random_id]
/// Fixed-length fields placed before Vec so status bytes land at known offsets for Arcium:
///   offset 8  = random_id [u8;32]
///   offset 40 = status_a  ← Arcium is_mutual_contact reads here
///   offset 41 = status_b
#[account]
pub struct PrivateRelationship {
    pub random_id: [u8; 32],
    pub status_a: u8,
    pub status_b: u8,
    pub created_at: i64,
    pub initiator: Pubkey,
    pub encrypted_data: Vec<u8>,  // nacl.secretbox({ user_a: Pubkey, user_b: Pubkey })
    pub data_nonce: [u8; 24],
}

/// Per-user encrypted contact list index — seeds: ["contact_index", owner]
#[account]
pub struct ContactIndex {
    pub owner: Pubkey,
    pub encrypted_entries: Vec<u8>,  // nacl.secretbox(Vec<{ random_id, counterparty }>)
    pub nonce: [u8; 24],
}

/// On-chain invite delivery pointer — seeds: ["invite_ptr", recipient, random_id]
/// Closed on accept/reject (returns rent to recipient).
/// Reveals: recipient has N pending invites. Sender identity encrypted.
#[account]
pub struct InvitePointer {
    pub recipient: Pubkey,
    pub random_id: [u8; 32],
    pub encrypted_sender: Vec<u8>,  // nacl.box(sender_pubkey, recipient_nacl_pubkey)
    pub sender_nonce: [u8; 24],
    pub created_at: i64,
}

/// Per-user encrypted group list index — seeds: ["group_index", owner]
#[account]
pub struct GroupIndex {
    pub owner: Pubkey,
    pub encrypted_entries: Vec<u8>,  // nacl.secretbox(Vec<group_id: [u8;32]>)
    pub nonce: [u8; 24],
}

// ========== COMPRESSED ACCOUNT STRUCTURES (Light Protocol ZK Compression) ==========

/// Compressed version of GroupKeyShare for ZK compression
/// Using fixed-size encrypted_key [u8; 48] instead of Vec<u8>
/// NaCl box output for 32-byte key is always 48 bytes
#[event]
#[derive(Clone, Debug, LightDiscriminator, LightHasher)]
pub struct CompressedGroupKeyShare {
    #[hash]
    pub group_id: [u8; 32],
    #[hash]
    pub member: Pubkey,
    #[hash]
    pub encrypted_key: [u8; 48],  // Fixed-size: NaCl box output for 32-byte key
    #[hash]
    pub nonce: [u8; 24],
}
// Total: 32 + 32 + 48 + 24 = 136 bytes + 8 discriminator = 144 bytes

impl Default for CompressedGroupKeyShare {
    fn default() -> Self {
        Self {
            group_id: [0u8; 32],
            member: Pubkey::default(),
            encrypted_key: [0u8; 48],
            nonce: [0u8; 24],
        }
    }
}

/// Compressed version of GroupInvite for ZK compression
/// Status is stored as u8 instead of enum for compressed format
#[event]
#[derive(Clone, Debug, Default, LightDiscriminator, LightHasher)]
pub struct CompressedGroupInvite {
    #[hash]
    pub group_id: [u8; 32],
    #[hash]
    pub inviter: Pubkey,
    #[hash]
    pub invitee: Pubkey,
    #[hash]
    pub status: u8,        // 0=Pending, 1=Accepted, 2=Rejected
    #[hash]
    pub created_at: i64,
}
// Total: 32 + 32 + 32 + 1 + 8 = 105 bytes + 8 discriminator = 113 bytes

// ========== CONTEXT STRUCTURES ==========

#[derive(Accounts)]
#[instruction(display_name: String, avatar_data: String, encryption_public_key: [u8; 32])]
pub struct Register<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + (4 + 32) + 1 + (4 + 128) + 32,
        seeds = [b"user_profile", payer.key().as_ref(), USER_PROFILE_VERSION.as_ref()],
        bump
    )]
    pub user_profile: Account<'info, UserProfile>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Create a session token allowing a device keypair to sign on behalf of the wallet.
/// The wallet (authority) signs this transaction once. All future txs use session_key.
#[derive(Accounts)]
pub struct CreateSession<'info> {
    #[account(
        init,
        payer = authority,
        space = 80,  // 8 disc + 32 authority + 32 session_key + 8 valid_until
        seeds = [b"session", session_key.key().as_ref(), SESSION_TOKEN_VERSION.as_ref()],
        bump
    )]
    pub session_token: Account<'info, SessionToken>,
    #[account(mut)]
    pub authority: Signer<'info>,  // The wallet — signs once
    /// CHECK: The device keypair public key (does not need to sign this tx)
    pub session_key: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}

/// Revoke a session token. Only the original wallet authority can revoke.
#[derive(Accounts)]
pub struct RevokeSession<'info> {
    #[account(
        mut,
        close = authority,
        seeds = [b"session", session_token.session_key.as_ref(), SESSION_TOKEN_VERSION.as_ref()],
        bump,
        has_one = authority
    )]
    pub session_token: Account<'info, SessionToken>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    #[account(
        mut,
        seeds = [b"user_profile", authority.key().as_ref(), USER_PROFILE_VERSION.as_ref()],
        bump,
        realloc = 8 + 32 + (4 + 32) + 1 + (4 + 128) + 32,
        realloc::payer = payer,
        realloc::zero = true
    )]
    pub user_profile: Account<'info, UserProfile>,
    /// CHECK: The wallet pubkey used for PDA derivation. When using sessions, this differs from payer.
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseProfile<'info> {
    /// CHECK: Old account structure may not deserialize. Client must pass correct PDA.
    #[account(mut)]
    pub user_profile: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseWalletDescriptor<'info> {
    /// CHECK: Legacy WalletDescriptor account. Client must pass correct PDA.
    #[account(mut)]
    pub wallet_descriptor: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(_hash: [u8; 32])]
pub struct Invite<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: invitee is a public key
    pub invitee: AccountInfo<'info>,
    /// CHECK: must be min(authority, invitee) — validated in instruction
    pub user_a: AccountInfo<'info>,
    /// CHECK: must be max(authority, invitee) — validated in instruction
    pub user_b: AccountInfo<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 82,  // 8 + 32 + 32 + 1 + 1 + 8
        seeds = [b"relationship", user_a.key().as_ref(), user_b.key().as_ref(), RELATIONSHIP_VERSION.as_ref()],
        bump
    )]
    pub relationship: Account<'info, Relationship>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 64 + 8,
        seeds = [b"conversation", _hash.as_ref(), CONVERSATION_VERSION.as_ref()],
        bump
    )]
    pub conversation: Account<'info, Conversation>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Accept<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: peer is a public key
    pub peer: AccountInfo<'info>,
    /// CHECK: must be min(authority, peer) — validated in instruction
    pub user_a: AccountInfo<'info>,
    /// CHECK: must be max(authority, peer) — validated in instruction
    pub user_b: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"relationship", user_a.key().as_ref(), user_b.key().as_ref(), RELATIONSHIP_VERSION.as_ref()],
        bump
    )]
    pub relationship: Account<'info, Relationship>,
    pub session_token: Option<Account<'info, SessionToken>>,
}

#[derive(Accounts)]
pub struct Reject<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: peer is a public key
    pub peer: AccountInfo<'info>,
    /// CHECK: must be min(authority, peer)
    pub user_a: AccountInfo<'info>,
    /// CHECK: must be max(authority, peer)
    pub user_b: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"relationship", user_a.key().as_ref(), user_b.key().as_ref(), RELATIONSHIP_VERSION.as_ref()],
        bump
    )]
    pub relationship: Account<'info, Relationship>,
    pub session_token: Option<Account<'info, SessionToken>>,
}

#[derive(Accounts)]
pub struct Block<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: peer is a public key
    pub peer: AccountInfo<'info>,
    /// CHECK: must be min(authority, peer)
    pub user_a: AccountInfo<'info>,
    /// CHECK: must be max(authority, peer)
    pub user_b: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"relationship", user_a.key().as_ref(), user_b.key().as_ref(), RELATIONSHIP_VERSION.as_ref()],
        bump
    )]
    pub relationship: Account<'info, Relationship>,
    pub session_token: Option<Account<'info, SessionToken>>,
}

#[derive(Accounts)]
pub struct Unblock<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: peer is a public key
    pub peer: AccountInfo<'info>,
    /// CHECK: must be min(authority, peer)
    pub user_a: AccountInfo<'info>,
    /// CHECK: must be max(authority, peer)
    pub user_b: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"relationship", user_a.key().as_ref(), user_b.key().as_ref(), RELATIONSHIP_VERSION.as_ref()],
        bump
    )]
    pub relationship: Account<'info, Relationship>,
    pub session_token: Option<Account<'info, SessionToken>>,
}

#[derive(Accounts)]
pub struct CloseRelationship<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the other party in the relationship
    pub peer: AccountInfo<'info>,
    /// CHECK: must be min(authority, peer)
    pub user_a: AccountInfo<'info>,
    /// CHECK: must be max(authority, peer)
    pub user_b: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"relationship", user_a.key().as_ref(), user_b.key().as_ref(), RELATIONSHIP_VERSION.as_ref()],
        bump
    )]
    pub relationship: Account<'info, Relationship>,
    pub session_token: Option<Account<'info, SessionToken>>,
}

// ========== GROUP CONTEXT STRUCTURES ==========

#[derive(Accounts)]
#[instruction(group_id: [u8; 32], encrypted_name: Vec<u8>, name_nonce: [u8; 24], encryption_pubkey: [u8; 32], token_gate: Option<TokenGate>, encrypted_members: Vec<u8>, members_nonce: [u8; 24])]
pub struct CreateGroup<'info> {
    #[account(
        init,
        payer = payer,
        // disc + group_id + creator + created_at + member_count + enc_pubkey + token_gate
        // + encrypted_name (max 96 bytes) + name_nonce + encrypted_members (max 1008 bytes) + members_nonce
        space = 8 + 32 + 32 + 8 + 4 + 32 + (1 + 32 + 8) + (4 + 96) + 24 + (4 + 1008) + 24,
        seeds = [b"group", group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateGroup<'info> {
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InviteToGroup<'info> {
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 32 + 32 + 1 + 8,
        seeds = [b"group_invite", group.group_id.as_ref(), invitee.key().as_ref(), GROUP_INVITE_VERSION.as_ref()],
        bump
    )]
    pub group_invite: Account<'info, GroupInvite>,
    /// CHECK: invitee is a public key
    pub invitee: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptGroupInvite<'info> {
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    #[account(
        mut,
        seeds = [b"group_invite", group.group_id.as_ref(), authority.key().as_ref(), GROUP_INVITE_VERSION.as_ref()],
        bump
    )]
    pub group_invite: Account<'info, GroupInvite>,
    pub user_token_account: Option<Account<'info, TokenAccount>>,
    /// CHECK: The wallet pubkey. When using sessions, differs from payer. Used for PDA derivation.
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
    pub token_program: Option<Program<'info, Token>>,
}

#[derive(Accounts)]
pub struct RejectGroupInvite<'info> {
    #[account(
        mut,
        seeds = [b"group_invite", group_invite.group_id.as_ref(), authority.key().as_ref(), GROUP_INVITE_VERSION.as_ref()],
        bump
    )]
    pub group_invite: Account<'info, GroupInvite>,
    /// CHECK: The wallet pubkey. When using sessions, differs from payer. Used for PDA derivation.
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
}

#[derive(Accounts)]
pub struct LeaveGroup<'info> {
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct KickMember<'info> {
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    /// CHECK: member to kick
    pub member: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseGroup<'info> {
    #[account(
        mut,
        close = payer,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
}

#[derive(Accounts)]
#[instruction(group_id: [u8; 32], encrypted_key: Vec<u8>, nonce: [u8; 24])]
pub struct StoreGroupKey<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 32 + (4 + 48) + 24,  // disc + group_id + member + Vec(encrypted_key) + nonce
        seeds = [b"group_key", group_id.as_ref(), authority.key().as_ref(), GROUP_KEY_SHARE_VERSION.as_ref()],
        bump
    )]
    pub group_key_share: Account<'info, GroupKeyShare>,
    #[account(
        seeds = [b"group", group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    /// CHECK: The wallet pubkey. When using sessions, differs from payer. Used for PDA derivation.
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseGroupKey<'info> {
    #[account(
        mut,
        close = payer,
        seeds = [b"group_key", group_key_share.group_id.as_ref(), authority.key().as_ref(), GROUP_KEY_SHARE_VERSION.as_ref()],
        bump
    )]
    pub group_key_share: Account<'info, GroupKeyShare>,
    /// CHECK: The wallet pubkey. When using sessions, differs from payer. Used for PDA derivation.
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
}

/// Context for storing a group key on behalf of another member
/// Only admin (creator) can store keys for other members
#[derive(Accounts)]
#[instruction(group_id: [u8; 32], member: Pubkey, encrypted_key: Vec<u8>, nonce: [u8; 24])]
pub struct StoreGroupKeyForMember<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 32 + (4 + 48) + 24,  // disc + group_id + member + Vec(encrypted_key) + nonce
        seeds = [b"group_key", group_id.as_ref(), member.as_ref(), GROUP_KEY_SHARE_VERSION.as_ref()],
        bump
    )]
    pub group_key_share: Account<'info, GroupKeyShare>,
    #[account(
        seeds = [b"group", group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

// ========== LIGHT PROTOCOL ZK COMPRESSION CONTEXT STRUCTURES ==========

/// Context for storing compressed group key
/// Note: Group account needed for membership validation
#[derive(Accounts)]
pub struct StoreCompressedGroupKey<'info> {
    #[account(
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    #[account(mut)]
    pub signer: Signer<'info>,
    // remaining_accounts: Light system accounts + Merkle tree accounts provided by client
}

/// Minimal context for closing compressed group key
#[derive(Accounts)]
pub struct CloseCompressedGroupKey<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    // remaining_accounts: Light system accounts + Merkle tree accounts
}

/// Context for compressed group invites
/// Note: Group account needed for validation and invitee reference
#[derive(Accounts)]
pub struct InviteToGroupCompressed<'info> {
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    /// CHECK: invitee is a public key
    pub invitee: AccountInfo<'info>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
    // remaining_accounts: Light system accounts + Merkle tree accounts
}

/// Context for accepting compressed group invite
#[derive(Accounts)]
pub struct AcceptGroupInviteCompressed<'info> {
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    pub user_token_account: Option<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Option<Program<'info, Token>>,
    // remaining_accounts: Light system accounts + Merkle tree accounts
}

/// Minimal context for rejecting compressed group invite
#[derive(Accounts)]
pub struct RejectGroupInviteCompressed<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    // remaining_accounts: Light system accounts + Merkle tree accounts
}

// ========== ARCIUM MPC CONTEXT STRUCTURES ==========

/// Context for initializing is_mutual_contact computation definition
#[init_computation_definition_accounts("is_mutual_contact", payer)]
#[derive(Accounts)]
pub struct InitIsMutualContactCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: not initialized yet
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: validated by arcium via derive_mxe_lut_pda
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: validated by address constraint
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

/// Context for initializing count_accepted computation definition
#[init_computation_definition_accounts("count_accepted", payer)]
#[derive(Accounts)]
pub struct InitCountAcceptedCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: not initialized yet
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: validated by arcium via derive_mxe_lut_pda
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: validated by address constraint
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

/// Context for initializing add_two_numbers computation definition
#[init_computation_definition_accounts("add_two_numbers", payer)]
#[derive(Accounts)]
pub struct InitAddTwoNumbersCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: not initialized yet
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
    /// CHECK: validated by arcium via derive_mxe_lut_pda
    #[account(mut, address = derive_mxe_lut_pda!(mxe_account.lut_offset_slot))]
    pub address_lookup_table: UncheckedAccount<'info>,
    /// CHECK: validated by address constraint
    #[account(address = LUT_PROGRAM_ID)]
    pub lut_program: UncheckedAccount<'info>,
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

/// Context for queueing is_mutual_contact computation
#[queue_computation_accounts("is_mutual_contact", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CheckMutualContact<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init_if_needed, space = 9, payer = payer, seeds = [&SIGN_PDA_SEED], bump, address = derive_sign_pda!())]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_IS_MUTUAL_CONTACT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

/// Context for is_mutual_contact callback
#[callback_accounts("is_mutual_contact")]
#[derive(Accounts)]
pub struct IsMutualContactCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_IS_MUTUAL_CONTACT))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: checked by arcium
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: instructions sysvar
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

/// Context for queueing count_accepted computation
#[queue_computation_accounts("count_accepted", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CountAcceptedContacts<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init_if_needed, space = 9, payer = payer, seeds = [&SIGN_PDA_SEED], bump, address = derive_sign_pda!())]
    pub sign_pda_account: Account<'info, ArciumSignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    #[account(mut, address = derive_mempool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset, mxe_account, ErrorCode::ClusterNotSet))]
    /// CHECK: checked by arcium
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_COUNT_ACCEPTED))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(mut, address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Account<'info, FeePool>,
    #[account(mut, address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,
}

/// Context for count_accepted callback
#[callback_accounts("count_accepted")]
#[derive(Accounts)]
pub struct CountAcceptedCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_COUNT_ACCEPTED))]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Account<'info, MXEAccount>,
    /// CHECK: checked by arcium
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_cluster_pda!(mxe_account, ErrorCode::ClusterNotSet))]
    pub cluster_account: Account<'info, Cluster>,
    /// CHECK: instructions sysvar
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

// ========== PRIVATE SOCIAL GRAPH CONTEXT STRUCTURES ==========

#[derive(Accounts)]
pub struct CreateContactIndex<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + (4 + 0) + 24,  // empty on creation; grows via update_contact_index
        seeds = [b"contact_index", payer.key().as_ref(), CONTACT_INDEX_VERSION.as_ref()],
        bump
    )]
    pub contact_index: Account<'info, ContactIndex>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(encrypted_entries: Vec<u8>, nonce: [u8; 24])]
pub struct UpdateContactIndex<'info> {
    #[account(
        mut,
        seeds = [b"contact_index", authority.key().as_ref(), CONTACT_INDEX_VERSION.as_ref()],
        bump,
        realloc = 8 + 32 + (4 + encrypted_entries.len()) + 24,
        realloc::payer = payer,
        realloc::zero = false
    )]
    pub contact_index: Account<'info, ContactIndex>,
    /// CHECK: Wallet pubkey for PDA derivation; may differ from payer when using sessions.
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateGroupIndex<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + (4 + 0) + 24,  // empty on creation; grows via update_group_index
        seeds = [b"group_index", payer.key().as_ref(), GROUP_INDEX_VERSION.as_ref()],
        bump
    )]
    pub group_index: Account<'info, GroupIndex>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(encrypted_entries: Vec<u8>, nonce: [u8; 24])]
pub struct UpdateGroupIndex<'info> {
    #[account(
        mut,
        seeds = [b"group_index", authority.key().as_ref(), GROUP_INDEX_VERSION.as_ref()],
        bump,
        realloc = 8 + 32 + (4 + encrypted_entries.len()) + 24,
        realloc::payer = payer,
        realloc::zero = false
    )]
    pub group_index: Account<'info, GroupIndex>,
    /// CHECK: Wallet pubkey for PDA derivation; may differ from payer when using sessions.
    pub authority: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(random_id: [u8; 32], encrypted_data: Vec<u8>, data_nonce: [u8; 24], encrypted_sender: Vec<u8>, sender_nonce: [u8; 24])]
pub struct CreatePrivateInvite<'info> {
    // space: disc + random_id + status_a + status_b + created_at + initiator + enc_data + data_nonce
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 1 + 1 + 8 + 32 + (4 + encrypted_data.len()) + 24,
        seeds = [b"priv_rel", random_id.as_ref(), PRIVATE_RELATIONSHIP_VERSION.as_ref()],
        bump
    )]
    pub private_relationship: Account<'info, PrivateRelationship>,
    // space: disc + recipient + random_id + enc_sender + sender_nonce + created_at
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + (4 + encrypted_sender.len()) + 24 + 8,
        seeds = [b"invite_ptr", recipient.key().as_ref(), random_id.as_ref(), INVITE_POINTER_VERSION.as_ref()],
        bump
    )]
    pub invite_pointer: Account<'info, InvitePointer>,
    /// CHECK: recipient is a public key
    pub recipient: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptPrivateInvite<'info> {
    #[account(
        mut,
        seeds = [b"priv_rel", private_relationship.random_id.as_ref(), PRIVATE_RELATIONSHIP_VERSION.as_ref()],
        bump
    )]
    pub private_relationship: Account<'info, PrivateRelationship>,
    #[account(
        mut,
        close = payer,
        seeds = [b"invite_ptr", invite_pointer.recipient.as_ref(), invite_pointer.random_id.as_ref(), INVITE_POINTER_VERSION.as_ref()],
        bump,
        constraint = invite_pointer.random_id == private_relationship.random_id @ ErrorCode::Unauthorized
    )]
    pub invite_pointer: Account<'info, InvitePointer>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RejectPrivateInvite<'info> {
    #[account(
        mut,
        seeds = [b"priv_rel", private_relationship.random_id.as_ref(), PRIVATE_RELATIONSHIP_VERSION.as_ref()],
        bump
    )]
    pub private_relationship: Account<'info, PrivateRelationship>,
    #[account(
        mut,
        close = payer,
        seeds = [b"invite_ptr", invite_pointer.recipient.as_ref(), invite_pointer.random_id.as_ref(), INVITE_POINTER_VERSION.as_ref()],
        bump,
        constraint = invite_pointer.random_id == private_relationship.random_id @ ErrorCode::Unauthorized
    )]
    pub invite_pointer: Account<'info, InvitePointer>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateRelationshipStatus<'info> {
    #[account(
        mut,
        seeds = [b"priv_rel", private_relationship.random_id.as_ref(), PRIVATE_RELATIONSHIP_VERSION.as_ref()],
        bump
    )]
    pub private_relationship: Account<'info, PrivateRelationship>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
}

#[derive(Accounts)]
pub struct DeletePrivateRelationship<'info> {
    #[account(
        mut,
        close = payer,
        seeds = [b"priv_rel", private_relationship.random_id.as_ref(), PRIVATE_RELATIONSHIP_VERSION.as_ref()],
        bump
    )]
    pub private_relationship: Account<'info, PrivateRelationship>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(encrypted_members: Vec<u8>, members_nonce: [u8; 24])]
pub struct UpdateGroupMembersList<'info> {
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump,
        realloc = 8 + 32 + 32 + 8 + 4 + 32 + (1 + 32 + 8) + (4 + group.encrypted_name.len()) + 24 + (4 + encrypted_members.len()) + 24,
        realloc::payer = payer,
        realloc::zero = false
    )]
    pub group: Account<'info, Group>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseOldRelationship<'info> {
    #[account(
        mut,
        close = payer,
        seeds = [b"relationship", relationship.user_a.as_ref(), relationship.user_b.as_ref(), RELATIONSHIP_VERSION.as_ref()],
        bump
    )]
    pub relationship: Account<'info, Relationship>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub session_token: Option<Account<'info, SessionToken>>,
    pub system_program: Program<'info, System>,
}

// ========== ARCIUM MPC EVENTS ==========

/// Event emitted when mutual contact check computation completes
#[event]
pub struct MutualContactResult {
    pub ciphertext: [u8; 32],
    pub nonce: u128,
    pub encryption_key: [u8; 32],
}

/// Event emitted when contact count computation completes
#[event]
pub struct ContactCountResult {
    pub ciphertext: [u8; 32],
    pub nonce: u128,
    pub encryption_key: [u8; 32],
}
