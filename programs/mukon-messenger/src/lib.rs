use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use sha2::{Digest, Sha256};
// ARCIUM TEMPORARILY DISABLED - Re-enable after core demo
// use arcium_anchor::prelude::*;
// use arcium_client::idl::arcium::types::{CircuitSource, OffChainCircuitSource};
// use arcium_macros::{circuit_hash, comp_def_offset};

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

declare_id!("GCTzU7Y6yaBNzW6WA1EJR6fnY9vLNZEEPcgsydCD8mpj");

// CPI signer for Light System Program calls
pub const LIGHT_CPI_SIGNER: CpiSigner =
    light_sdk::derive_light_cpi_signer!("GCTzU7Y6yaBNzW6WA1EJR6fnY9vLNZEEPcgsydCD8mpj");

// ARCIUM TEMPORARILY DISABLED
// const COMP_DEF_OFFSET_IS_ACCEPTED_CONTACT: u32 = comp_def_offset!("is_accepted_contact");
// const COMP_DEF_OFFSET_COUNT_ACCEPTED: u32 = comp_def_offset!("count_accepted");
// const COMP_DEF_OFFSET_ADD_TWO_NUMBERS: u32 = comp_def_offset!("add_two_numbers");
// const SIGN_PDA_SEED: [u8; 20] = *b"ArciumSignerAccount";

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
    // ARCIUM TEMPORARILY DISABLED
    // #[msg("Computation aborted")]
    // AbortedComputation,
    // #[msg("Cluster not set")]
    // ClusterNotSet,
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

// ARCIUM TEMPORARILY DISABLED - using regular #[program] instead
#[program]
pub mod mukon_messenger {
    use super::*;

    pub fn register(ctx: Context<Register>, display_name: String, avatar_data: String, encryption_public_key: [u8; 32]) -> Result<()> {
        let wallet_descriptor = &mut ctx.accounts.wallet_descriptor;
        let user_profile = &mut ctx.accounts.user_profile;
        let payer = &ctx.accounts.payer;

        require!(display_name.len() <= 32, ErrorCode::DisplayNameTooLong);

        // Only initialize peers if this is a new account (not created by an invite)
        // If account was created by invite instruction, peers already has pending invitations
        if wallet_descriptor.owner == Pubkey::default() {
            wallet_descriptor.owner = payer.key();
            wallet_descriptor.peers = vec![];
        } else {
            // Account exists (created by invite) - just update owner, preserve peers
            wallet_descriptor.owner = payer.key();
        }

        user_profile.owner = payer.key();
        user_profile.display_name = display_name.clone();
        user_profile.avatar_type = AvatarType::Emoji;
        user_profile.avatar_data = avatar_data;
        user_profile.encryption_public_key = encryption_public_key;

        msg!("Register: {:?} with display name: {}", payer.key(), display_name);

        Ok(())
    }

    pub fn update_profile(
        ctx: Context<UpdateProfile>,
        display_name: Option<String>,
        avatar_type: Option<AvatarType>,
        avatar_data: Option<String>,
        encryption_public_key: Option<[u8; 32]>
    ) -> Result<()> {
        let user_profile = &mut ctx.accounts.user_profile;

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

        msg!("Profile updated: {:?}", ctx.accounts.payer.key());

        Ok(())
    }

    /// Close profile account and return rent (useful for testing/redeployment)
    /// WARNING: This is a destructive operation - use with caution!
    pub fn close_profile(ctx: Context<CloseProfile>) -> Result<()> {
        // Verify UserProfile PDA
        let (expected_profile_pda, _) = Pubkey::find_program_address(
            &[
                b"user_profile",
                ctx.accounts.payer.key().as_ref(),
                USER_PROFILE_VERSION.as_ref(),
            ],
            ctx.program_id,
        );

        require_keys_eq!(
            ctx.accounts.user_profile.key(),
            expected_profile_pda,
            ErrorCode::InvalidHash
        );

        // Verify WalletDescriptor PDA
        let (expected_descriptor_pda, _) = Pubkey::find_program_address(
            &[
                b"wallet_descriptor",
                ctx.accounts.payer.key().as_ref(),
                WALLET_DESCRIPTOR_VERSION.as_ref(),
            ],
            ctx.program_id,
        );

        require_keys_eq!(
            ctx.accounts.wallet_descriptor.key(),
            expected_descriptor_pda,
            ErrorCode::InvalidHash
        );

        // Close UserProfile
        let profile_lamports = ctx.accounts.user_profile.lamports();
        **ctx.accounts.user_profile.lamports.borrow_mut() = 0;
        **ctx.accounts.payer.lamports.borrow_mut() += profile_lamports;
        ctx.accounts.user_profile.try_borrow_mut_data()?.fill(0);

        // Close WalletDescriptor
        let descriptor_lamports = ctx.accounts.wallet_descriptor.lamports();
        **ctx.accounts.wallet_descriptor.lamports.borrow_mut() = 0;
        **ctx.accounts.payer.lamports.borrow_mut() += descriptor_lamports;
        ctx.accounts.wallet_descriptor.try_borrow_mut_data()?.fill(0);

        msg!("Profile and descriptor closed: {:?}", ctx.accounts.payer.key());
        Ok(())
    }

    pub fn invite(ctx: Context<Invite>, _hash: [u8; 32]) -> Result<()> {
        let inviter = &ctx.accounts.payer;
        let invitee = &ctx.accounts.invitee;
        let inviter_descriptor = &mut ctx.accounts.payer_descriptor;
        let invitee_descriptor = &mut ctx.accounts.invitee_descriptor;

        // Initialize invitee_descriptor if it's a new account
        if invitee_descriptor.owner == Pubkey::default() {
            invitee_descriptor.owner = invitee.key();
            invitee_descriptor.peers = vec![];
        }

        let hash = get_chat_hash(inviter.key(), invitee.key());
        require!(hash == _hash, ErrorCode::InvalidHash);

        // Check inviter's side: allow re-invite if Rejected, block if Blocked
        let inviter_peer = inviter_descriptor.peers.iter_mut()
            .find(|p| p.wallet == invitee.key());

        match inviter_peer {
            Some(peer) if peer.state == PeerState::Rejected => {
                // Re-inviting rejected contact - update state
                peer.state = PeerState::Invited;
            },
            Some(peer) if peer.state == PeerState::Blocked => {
                // Cannot invite blocked user
                return Err(ErrorCode::AlreadyInvited.into());
            },
            Some(_) => {
                // Peer exists with non-Rejected/non-Blocked status
                return Err(ErrorCode::AlreadyInvited.into());
            },
            None => {
                // New peer - add to list
                inviter_descriptor.peers.push(Peer {
                    wallet: invitee.key(),
                    state: PeerState::Invited,
                });
            }
        }

        // Check invitee's side: allow re-invite if Rejected, block if Blocked
        let invitee_peer = invitee_descriptor.peers.iter_mut()
            .find(|p| p.wallet == inviter.key());

        match invitee_peer {
            Some(peer) if peer.state == PeerState::Rejected => {
                // Re-inviting rejected contact - update state
                peer.state = PeerState::Requested;
            },
            Some(peer) if peer.state == PeerState::Blocked => {
                // Cannot invite blocked user
                return Err(ErrorCode::AlreadyInvited.into());
            },
            Some(_) => {
                // Peer exists with non-Rejected/non-Blocked status
                return Err(ErrorCode::AlreadyInvited.into());
            },
            None => {
                // New peer - add to list
                invitee_descriptor.peers.push(Peer {
                    wallet: inviter.key(),
                    state: PeerState::Requested,
                });
            }
        }

        let conversation = &mut ctx.accounts.conversation;
        conversation.participants = [inviter.key(), invitee.key()];
        conversation.created_at = Clock::get()?.unix_timestamp;

        msg!("Invite: sender={:?}, target={:?}, chat={:?}",
             inviter.key(), invitee.key(), hash);

        Ok(())
    }

    pub fn accept(ctx: Context<Accept>) -> Result<()> {
        let me = &ctx.accounts.payer;
        let peer = &ctx.accounts.peer;
        let me_descriptor = &mut ctx.accounts.payer_descriptor;
        let peer_descriptor = &mut ctx.accounts.peer_descriptor;

        require!(
            me_descriptor.peers.iter()
                .any(|p| p.wallet == peer.key() && p.state == PeerState::Requested),
            ErrorCode::NotRequested
        );
        require!(
            peer_descriptor.peers.iter()
                .any(|p| p.wallet == me.key() && p.state == PeerState::Invited),
            ErrorCode::NotInvited
        );

        for p in me_descriptor.peers.iter_mut() {
            if p.wallet == peer.key() {
                p.state = PeerState::Accepted;
                break;
            }
        }
        for p in peer_descriptor.peers.iter_mut() {
            if p.wallet == me.key() {
                p.state = PeerState::Accepted;
                break;
            }
        }

        msg!("Accept: accepter={:?}, inviter={:?}, chat={:?}",
             me.key(), peer.key(), get_chat_hash(me.key(), peer.key()));

        Ok(())
    }

    pub fn reject(ctx: Context<Reject>) -> Result<()> {
        let me = &ctx.accounts.payer;
        let peer = &ctx.accounts.peer;
        let me_descriptor = &mut ctx.accounts.payer_descriptor;
        let peer_descriptor = &mut ctx.accounts.peer_descriptor;

        // Allow rejecting/deleting ANY contact that exists in YOUR descriptor
        // Don't check peer's state - allow cleanup regardless of their side (handles corrupted states)
        require!(
            me_descriptor.peers.iter()
                .any(|p| p.wallet == peer.key() &&
                     (p.state == PeerState::Requested || p.state == PeerState::Invited || p.state == PeerState::Accepted || p.state == PeerState::Rejected)),
            ErrorCode::NotRequested
        );

        for p in me_descriptor.peers.iter_mut() {
            if p.wallet == peer.key() {
                p.state = PeerState::Rejected;
                break;
            }
        }
        for p in peer_descriptor.peers.iter_mut() {
            if p.wallet == me.key() {
                p.state = PeerState::Rejected;
                break;
            }
        }

        msg!("Reject: rejecter={:?}, inviter={:?}",
             me.key(), peer.key());

        Ok(())
    }

    pub fn block(ctx: Context<Block>) -> Result<()> {
        let me = &ctx.accounts.payer;
        let peer = &ctx.accounts.peer;
        let me_descriptor = &mut ctx.accounts.payer_descriptor;
        let peer_descriptor = &mut ctx.accounts.peer_descriptor;

        // Can block anyone you have a relationship with (any state except doesn't exist)
        require!(
            me_descriptor.peers.iter()
                .any(|p| p.wallet == peer.key()),
            ErrorCode::NotInvited
        );
        require!(
            peer_descriptor.peers.iter()
                .any(|p| p.wallet == me.key()),
            ErrorCode::NotInvited
        );

        // Set both sides to Blocked (symmetric)
        for p in me_descriptor.peers.iter_mut() {
            if p.wallet == peer.key() {
                p.state = PeerState::Blocked;
                break;
            }
        }
        for p in peer_descriptor.peers.iter_mut() {
            if p.wallet == me.key() {
                p.state = PeerState::Blocked;
                break;
            }
        }

        msg!("Block: blocker={:?}, blocked={:?}",
             me.key(), peer.key());

        Ok(())
    }

    pub fn unblock(ctx: Context<Unblock>) -> Result<()> {
        let me = &ctx.accounts.payer;
        let peer = &ctx.accounts.peer;
        let me_descriptor = &mut ctx.accounts.payer_descriptor;
        let peer_descriptor = &mut ctx.accounts.peer_descriptor;

        // Can only unblock if currently blocked
        require!(
            me_descriptor.peers.iter()
                .any(|p| p.wallet == peer.key() && p.state == PeerState::Blocked),
            ErrorCode::NotInvited
        );
        require!(
            peer_descriptor.peers.iter()
                .any(|p| p.wallet == me.key() && p.state == PeerState::Blocked),
            ErrorCode::NotInvited
        );

        // Change Blocked → Rejected (allows re-invite after unblock)
        for p in me_descriptor.peers.iter_mut() {
            if p.wallet == peer.key() {
                p.state = PeerState::Rejected;
                break;
            }
        }
        for p in peer_descriptor.peers.iter_mut() {
            if p.wallet == me.key() {
                p.state = PeerState::Rejected;
                break;
            }
        }

        msg!("Unblock: unblocker={:?}, unblocked={:?}",
             me.key(), peer.key());

        Ok(())
    }

    // ========== GROUP CHAT INSTRUCTIONS ==========

    pub fn create_group(
        ctx: Context<CreateGroup>,
        group_id: [u8; 32],
        name: String,
        encryption_pubkey: [u8; 32],
        token_gate: Option<TokenGate>
    ) -> Result<()> {
        require!(name.len() <= 64, ErrorCode::GroupNameTooLong);

        let group = &mut ctx.accounts.group;
        group.group_id = group_id;
        group.creator = ctx.accounts.payer.key();
        group.name = name.clone();
        group.created_at = Clock::get()?.unix_timestamp;
        group.members = vec![ctx.accounts.payer.key()];
        group.encryption_pubkey = encryption_pubkey;
        group.token_gate = token_gate;

        msg!("Group created: id={:?}, name={}, creator={:?}",
             group_id, name, ctx.accounts.payer.key());

        Ok(())
    }

    pub fn update_group(
        ctx: Context<UpdateGroup>,
        name: Option<String>,
        token_gate: Option<TokenGate>
    ) -> Result<()> {
        let group = &mut ctx.accounts.group;

        // Only creator can update group
        require!(
            group.creator == ctx.accounts.payer.key(),
            ErrorCode::NotGroupAdmin
        );

        if let Some(new_name) = name {
            require!(new_name.len() <= 64, ErrorCode::GroupNameTooLong);
            group.name = new_name;
        }

        if let Some(new_gate) = token_gate {
            group.token_gate = Some(new_gate);
        }

        msg!("Group updated: id={:?}", group.group_id);

        Ok(())
    }

    pub fn invite_to_group(ctx: Context<InviteToGroup>) -> Result<()> {
        let group = &ctx.accounts.group;

        // Any member can invite (creator can kick bad actors)
        require!(
            group.members.contains(&ctx.accounts.payer.key()),
            ErrorCode::NotGroupMember
        );

        // Check if group is full
        require!(group.members.len() < 30, ErrorCode::GroupFull);

        // Check if already a member or invited
        require!(
            !group.members.contains(&ctx.accounts.invitee.key()),
            ErrorCode::AlreadyInvited
        );

        // Create or update invite
        let invite = &mut ctx.accounts.group_invite;
        invite.group_id = group.group_id;
        invite.inviter = ctx.accounts.payer.key();
        invite.invitee = ctx.accounts.invitee.key();
        invite.status = GroupInviteStatus::Pending;
        invite.created_at = Clock::get()?.unix_timestamp;

        msg!("Group invite: group={:?}, invitee={:?}",
             group.group_id, ctx.accounts.invitee.key());

        Ok(())
    }

    pub fn accept_group_invite(ctx: Context<AcceptGroupInvite>) -> Result<()> {
        let group = &mut ctx.accounts.group;
        let invite = &mut ctx.accounts.group_invite;

        // Verify invite status
        require!(
            invite.status == GroupInviteStatus::Pending,
            ErrorCode::NotInvited
        );

        // Verify invitee is the signer
        require!(
            invite.invitee == ctx.accounts.payer.key(),
            ErrorCode::NotInvited
        );

        // Check token gate if exists
        if let Some(gate) = &group.token_gate {
            let token_account = ctx.accounts.user_token_account.as_ref()
                .ok_or(ErrorCode::TokenAccountRequired)?;

            // SECURITY FIX: Verify token account ownership
            require!(
                token_account.owner == ctx.accounts.payer.key(),
                ErrorCode::InvalidTokenAccount
            );

            require!(token_account.mint == gate.token_mint, ErrorCode::InsufficientTokenBalance);
            require!(token_account.amount >= gate.min_balance, ErrorCode::InsufficientTokenBalance);
        }

        // Check if group is full
        require!(group.members.len() < 30, ErrorCode::GroupFull);

        // Add to group
        group.members.push(ctx.accounts.payer.key());

        // Update invite status
        invite.status = GroupInviteStatus::Accepted;

        msg!("Group invite accepted: group={:?}, member={:?}",
             group.group_id, ctx.accounts.payer.key());

        Ok(())
    }

    pub fn reject_group_invite(ctx: Context<RejectGroupInvite>) -> Result<()> {
        let invite = &mut ctx.accounts.group_invite;

        // Verify invite status
        require!(
            invite.status == GroupInviteStatus::Pending,
            ErrorCode::NotInvited
        );

        // Verify invitee is the signer
        require!(
            invite.invitee == ctx.accounts.payer.key(),
            ErrorCode::NotInvited
        );

        // Update invite status
        invite.status = GroupInviteStatus::Rejected;

        msg!("Group invite rejected: group={:?}, invitee={:?}",
             invite.group_id, ctx.accounts.payer.key());

        Ok(())
    }

    pub fn leave_group(ctx: Context<LeaveGroup>) -> Result<()> {
        let group = &mut ctx.accounts.group;

        // Cannot leave if you're the creator
        require!(
            group.creator != ctx.accounts.payer.key(),
            ErrorCode::CannotRemoveCreator
        );

        // Verify member is in group
        require!(
            group.members.contains(&ctx.accounts.payer.key()),
            ErrorCode::NotGroupMember
        );

        // Remove from members
        group.members.retain(|m| m != &ctx.accounts.payer.key());

        msg!("Left group: group={:?}, member={:?}",
             group.group_id, ctx.accounts.payer.key());

        Ok(())
    }

    pub fn kick_member(ctx: Context<KickMember>) -> Result<()> {
        let group = &mut ctx.accounts.group;

        // Only creator can kick (admin-only for MVP)
        require!(
            group.creator == ctx.accounts.payer.key(),
            ErrorCode::NotGroupAdmin
        );

        // Cannot kick the creator
        require!(
            ctx.accounts.member.key() != group.creator,
            ErrorCode::CannotRemoveCreator
        );

        // Verify member is in group
        require!(
            group.members.contains(&ctx.accounts.member.key()),
            ErrorCode::NotGroupMember
        );

        // Remove from members
        group.members.retain(|m| m != &ctx.accounts.member.key());

        msg!("Kicked from group: group={:?}, member={:?}",
             group.group_id, ctx.accounts.member.key());

        Ok(())
    }

    pub fn close_group(ctx: Context<CloseGroup>) -> Result<()> {
        let group = &ctx.accounts.group;

        // Only creator can delete
        require!(
            group.creator == ctx.accounts.payer.key(),
            ErrorCode::NotGroupAdmin
        );

        // Transfer lamports back to creator
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
        let key_share = &mut ctx.accounts.group_key_share;
        let group = &ctx.accounts.group;

        // Verify payer is a member of the group
        require!(
            group.members.contains(&ctx.accounts.payer.key()),
            ErrorCode::NotGroupMember
        );

        // Store the encrypted key share
        key_share.group_id = group.group_id;
        key_share.member = ctx.accounts.payer.key();
        key_share.encrypted_key = encrypted_key;
        key_share.nonce = nonce;

        msg!("Group key stored for member: {:?}", ctx.accounts.payer.key());

        Ok(())
    }

    pub fn close_group_key(ctx: Context<CloseGroupKey>) -> Result<()> {
        // Verify the key share belongs to the payer
        require!(
            ctx.accounts.group_key_share.member == ctx.accounts.payer.key(),
            ErrorCode::Unauthorized
        );

        // Transfer lamports back to member
        let key_share_lamports = ctx.accounts.group_key_share.to_account_info().lamports();
        **ctx.accounts.group_key_share.to_account_info().lamports.borrow_mut() = 0;
        **ctx.accounts.payer.lamports.borrow_mut() += key_share_lamports;

        msg!("Group key share closed for member: {:?}", ctx.accounts.payer.key());

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
        let group = &ctx.accounts.group;

        // Verify signer is a member of the group
        require!(
            group.members.contains(&ctx.accounts.signer.key()),
            ErrorCode::NotGroupMember
        );

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

        // Any member can invite (creator can kick bad actors)
        require!(
            group.members.contains(&ctx.accounts.signer.key()),
            ErrorCode::NotGroupMember
        );

        // Check if group is full
        require!(group.members.len() < 30, ErrorCode::GroupFull);

        // Check if already a member
        require!(
            !group.members.contains(&ctx.accounts.invitee.key()),
            ErrorCode::AlreadyInvited
        );

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

        // Add to group
        group.members.push(ctx.accounts.signer.key());

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
    // TEMPORARILY DISABLED - Re-enable after core demo

    /*
    /// Initialize computation definition for is_accepted_contact circuit
    pub fn init_is_accepted_contact_comp_def(ctx: Context<InitIsAcceptedContactCompDef>) -> Result<()> {
        init_comp_def(
            ctx.accounts,
            Some(CircuitSource::OffChain(OffChainCircuitSource {
                source: "https://mukon-circuits.fly.dev/is_accepted_contact.arcis".to_string(),
                hash: circuit_hash!("is_accepted_contact"),
            })),
            None,
        )?;
        msg!("Initialized comp def: is_accepted_contact");
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

    /// Queue MPC computation to check if a contact is accepted
    pub fn check_is_contact(
        ctx: Context<CheckIsContact>,
        computation_offset: u64,
        encrypted_contact_list: Vec<u8>,
        encrypted_query_pubkey: Vec<u8>,
        pub_key: [u8; 32],
        nonce_list: u128,
        nonce_query: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce_list)
            .encrypted_bytes(encrypted_contact_list)
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce_query)
            .encrypted_bytes(encrypted_query_pubkey)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CheckIsContactCallback::callback_ix(
                computation_offset,
                &ctx.accounts.mxe_account,
                &[],
            )?],
            1,
            0,
        )?;

        msg!("Queued is_contact computation: offset={}", computation_offset);
        Ok(())
    }

    /// Callback for is_accepted_contact computation
    #[arcium_callback(encrypted_ix = "is_accepted_contact")]
    pub fn check_is_contact_callback(
        ctx: Context<CheckIsContactCallback>,
        output: SignedComputationOutputs<IsAcceptedContactOutput>,
    ) -> Result<()> {
        let result = match output.verify_output(
            &ctx.accounts.cluster_account,
            &ctx.accounts.computation_account,
        ) {
            Ok(IsAcceptedContactOutput { field_0 }) => field_0,
            Err(e) => {
                msg!("MPC computation failed: {}", e);
                return Err(ErrorCode::AbortedComputation.into());
            }
        };

        emit!(ContactCheckResult {
            ciphertext: result.ciphertexts[0],
            nonce: result.nonce,
            encryption_key: result.encryption_key,
        });

        msg!("is_contact computation completed");
        Ok(())
    }

    /// Queue MPC computation to count accepted contacts
    pub fn count_accepted_contacts(
        ctx: Context<CountAcceptedContacts>,
        computation_offset: u64,
        encrypted_contact_list: Vec<u8>,
        pub_key: [u8; 32],
        nonce_list: u128,
    ) -> Result<()> {
        let args = ArgBuilder::new()
            .x25519_pubkey(pub_key)
            .plaintext_u128(nonce_list)
            .encrypted_bytes(encrypted_contact_list)
            .build();

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![CountAcceptedContactsCallback::callback_ix(
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
    pub fn count_accepted_contacts_callback(
        ctx: Context<CountAcceptedContactsCallback>,
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
    */
}

// ========== ACCOUNT STRUCTURES ==========

const WALLET_DESCRIPTOR_VERSION: [u8; 1] = [1];
const USER_PROFILE_VERSION: [u8; 1] = [1];
const CONVERSATION_VERSION: [u8; 1] = [1];
const GROUP_VERSION: [u8; 1] = [1];
const GROUP_INVITE_VERSION: [u8; 1] = [1];
const GROUP_KEY_SHARE_VERSION: [u8; 1] = [1];

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
    pub name: String,
    pub created_at: i64,
    pub members: Vec<Pubkey>,
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

#[account]
pub struct GroupKeyShare {
    pub group_id: [u8; 32],
    pub member: Pubkey,
    pub encrypted_key: Vec<u8>,
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
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 4 + 100 * (32 + 1),  // Same size as invite creates
        seeds = [b"wallet_descriptor", payer.key().as_ref(), WALLET_DESCRIPTOR_VERSION.as_ref()],
        bump
    )]
    pub wallet_descriptor: Account<'info, WalletDescriptor>,
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

#[derive(Accounts)]
pub struct UpdateProfile<'info> {
    #[account(
        mut,
        seeds = [b"user_profile", payer.key().as_ref(), USER_PROFILE_VERSION.as_ref()],
        bump,
        realloc = 8 + 32 + (4 + 32) + 1 + (4 + 128) + 32,
        realloc::payer = payer,
        realloc::zero = true
    )]
    pub user_profile: Account<'info, UserProfile>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseProfile<'info> {
    /// CHECK: Old account structure may not deserialize. Client must pass correct PDA.
    #[account(mut)]
    pub user_profile: UncheckedAccount<'info>,
    /// CHECK: Old WalletDescriptor may not deserialize. Client must pass correct PDA.
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
    #[account(
        mut,
        seeds = [b"wallet_descriptor", payer.key().as_ref(), WALLET_DESCRIPTOR_VERSION.as_ref()],
        bump,
        realloc = 8 + 32 + 4 + (payer_descriptor.peers.len() + 1) * (32 + 1),
        realloc::payer = payer,
        realloc::zero = true
    )]
    pub payer_descriptor: Account<'info, WalletDescriptor>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 4 + 100 * (32 + 1),
        seeds = [b"wallet_descriptor", invitee.key().as_ref(), WALLET_DESCRIPTOR_VERSION.as_ref()],
        bump
    )]
    pub invitee_descriptor: Account<'info, WalletDescriptor>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 64 + 8,
        seeds = [b"conversation", _hash.as_ref(), CONVERSATION_VERSION.as_ref()],
        bump
    )]
    pub conversation: Account<'info, Conversation>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Accept<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: peer is a public key
    pub peer: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"wallet_descriptor", payer.key().as_ref(), WALLET_DESCRIPTOR_VERSION.as_ref()],
        bump
    )]
    pub payer_descriptor: Account<'info, WalletDescriptor>,
    #[account(
        mut,
        seeds = [b"wallet_descriptor", peer.key().as_ref(), WALLET_DESCRIPTOR_VERSION.as_ref()],
        bump
    )]
    pub peer_descriptor: Account<'info, WalletDescriptor>,
}

#[derive(Accounts)]
pub struct Reject<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: peer is a public key
    pub peer: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"wallet_descriptor", payer.key().as_ref(), WALLET_DESCRIPTOR_VERSION.as_ref()],
        bump
    )]
    pub payer_descriptor: Account<'info, WalletDescriptor>,
    #[account(
        mut,
        seeds = [b"wallet_descriptor", peer.key().as_ref(), WALLET_DESCRIPTOR_VERSION.as_ref()],
        bump
    )]
    pub peer_descriptor: Account<'info, WalletDescriptor>,
}

#[derive(Accounts)]
pub struct Block<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: peer is a public key
    pub peer: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"wallet_descriptor", payer.key().as_ref(), WALLET_DESCRIPTOR_VERSION.as_ref()],
        bump
    )]
    pub payer_descriptor: Account<'info, WalletDescriptor>,
    #[account(
        mut,
        seeds = [b"wallet_descriptor", peer.key().as_ref(), WALLET_DESCRIPTOR_VERSION.as_ref()],
        bump
    )]
    pub peer_descriptor: Account<'info, WalletDescriptor>,
}

#[derive(Accounts)]
pub struct Unblock<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: peer is a public key
    pub peer: AccountInfo<'info>,
    #[account(
        mut,
        seeds = [b"wallet_descriptor", payer.key().as_ref(), WALLET_DESCRIPTOR_VERSION.as_ref()],
        bump
    )]
    pub payer_descriptor: Account<'info, WalletDescriptor>,
    #[account(
        mut,
        seeds = [b"wallet_descriptor", peer.key().as_ref(), WALLET_DESCRIPTOR_VERSION.as_ref()],
        bump
    )]
    pub peer_descriptor: Account<'info, WalletDescriptor>,
}

// ========== GROUP CONTEXT STRUCTURES ==========

#[derive(Accounts)]
#[instruction(group_id: [u8; 32], name: String, encryption_pubkey: [u8; 32], token_gate: Option<TokenGate>)]
pub struct CreateGroup<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32 + 32 + (4 + 64) + 8 + (4 + 30 * 32) + 32 + (1 + 32 + 8),
        seeds = [b"group", group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump
    )]
    pub group: Account<'info, Group>,
    #[account(mut)]
    pub payer: Signer<'info>,
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
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptGroupInvite<'info> {
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump,
        realloc = 8 + 32 + 32 + (4 + 64) + 8 + (4 + (group.members.len() + 1) * 32) + 32 + (1 + 32 + 8),
        realloc::payer = payer,
        realloc::zero = false
    )]
    pub group: Account<'info, Group>,
    #[account(
        mut,
        seeds = [b"group_invite", group.group_id.as_ref(), payer.key().as_ref(), GROUP_INVITE_VERSION.as_ref()],
        bump
    )]
    pub group_invite: Account<'info, GroupInvite>,
    pub user_token_account: Option<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Option<Program<'info, Token>>,
}

#[derive(Accounts)]
pub struct RejectGroupInvite<'info> {
    #[account(
        mut,
        seeds = [b"group_invite", group_invite.group_id.as_ref(), payer.key().as_ref(), GROUP_INVITE_VERSION.as_ref()],
        bump
    )]
    pub group_invite: Account<'info, GroupInvite>,
    #[account(mut)]
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct LeaveGroup<'info> {
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump,
        realloc = 8 + 32 + 32 + (4 + 64) + 8 + (4 + (group.members.len().saturating_sub(1)) * 32) + 32 + (1 + 32 + 8),
        realloc::payer = payer,
        realloc::zero = false
    )]
    pub group: Account<'info, Group>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct KickMember<'info> {
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump,
        realloc = 8 + 32 + 32 + (4 + 64) + 8 + (4 + (group.members.len().saturating_sub(1)) * 32) + 32 + (1 + 32 + 8),
        realloc::payer = payer,
        realloc::zero = false
    )]
    pub group: Account<'info, Group>,
    /// CHECK: member to kick
    pub member: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
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
}

#[derive(Accounts)]
#[instruction(group_id: [u8; 32], encrypted_key: Vec<u8>, nonce: [u8; 24])]
pub struct StoreGroupKey<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + 32 + 32 + (4 + 48) + 24,  // disc + group_id + member + Vec(encrypted_key) + nonce
        seeds = [b"group_key", group_id.as_ref(), payer.key().as_ref(), GROUP_KEY_SHARE_VERSION.as_ref()],
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
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseGroupKey<'info> {
    #[account(
        mut,
        close = payer,
        seeds = [b"group_key", group_key_share.group_id.as_ref(), payer.key().as_ref(), GROUP_KEY_SHARE_VERSION.as_ref()],
        bump
    )]
    pub group_key_share: Account<'info, GroupKeyShare>,
    #[account(mut)]
    pub payer: Signer<'info>,
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
/// Note: Group account modified to add member
#[derive(Accounts)]
pub struct AcceptGroupInviteCompressed<'info> {
    #[account(
        mut,
        seeds = [b"group", group.group_id.as_ref(), GROUP_VERSION.as_ref()],
        bump,
        realloc = 8 + 32 + 32 + (4 + 64) + 8 + (4 + (group.members.len() + 1) * 32) + 32 + (1 + 32 + 8),
        realloc::payer = signer,
        realloc::zero = false
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

// ARCIUM ACCOUNT STRUCTS - TEMPORARILY DISABLED
/*
/// Context for initializing is_accepted_contact computation definition
#[init_computation_definition_accounts("is_accepted_contact", payer)]
#[derive(Accounts)]
pub struct InitIsAcceptedContactCompDef<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    /// CHECK: not initialized yet
    #[account(mut)]
    pub comp_def_account: UncheckedAccount<'info>,
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
    pub arcium_program: Program<'info, Arcium>,
    pub system_program: Program<'info, System>,
}

/// Context for queueing is_accepted_contact computation
#[queue_computation_accounts("is_accepted_contact", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct CheckIsContact<'info> {
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_IS_ACCEPTED_CONTACT))]
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

/// Context for is_accepted_contact callback
#[callback_accounts("is_accepted_contact")]
#[derive(Accounts)]
pub struct CheckIsContactCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_IS_ACCEPTED_CONTACT))]
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
pub struct CountAcceptedContactsCallback<'info> {
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

// ========== ARCIUM MPC EVENTS ==========

/// Event emitted when contact check computation completes
#[event]
pub struct ContactCheckResult {
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
*/
