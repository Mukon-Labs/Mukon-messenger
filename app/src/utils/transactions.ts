import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import {
  deriveAddress as lightDeriveAddress,
  deriveAddressSeed,
  createBN254,
  getDefaultAddressTreeInfo,
  type BN254,
  type HashWithTree,
  type AddressWithTree,
  type ValidityProofWithContext
} from '@lightprotocol/stateless.js';

const PROGRAM_ID = new PublicKey('54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy');

// Instruction discriminators from IDL
// NOTE: Group discriminators need to be computed after program deployment
// Use: anchor idl parse -f programs/mukon-messenger/target/idl/mukon_messenger.json
// NOTE: create_session, revoke_session, and store_group_key_for_member discriminators
// are PLACEHOLDERS. Run `node scripts/update-discriminators.js` after program rebuild.
const DISCRIMINATORS = {
  accept: Buffer.from([0x41, 0x96, 0x46, 0xd8, 0x85, 0x06, 0x6b, 0x04]), // 419646d885066b04
  accept_group_invite: Buffer.from([0xbe, 0x30, 0x7f, 0x36, 0x49, 0x93, 0xe3, 0xfd]), // be307f364993e3fd
  accept_group_invite_compressed: Buffer.from([0x05, 0x90, 0xdc, 0xba, 0x61, 0x11, 0xbd, 0xff]), // 0590dcba6111bdff
  accept_private_invite: Buffer.from([0x32, 0x75, 0x25, 0xa6, 0x65, 0x20, 0xc3, 0xfc]), // 327525a66520c3fc
  block: Buffer.from([0xee, 0xea, 0x6e, 0x15, 0x79, 0x2b, 0x32, 0x91]), // eeea6e15792b3291
  check_mutual_contact: Buffer.from([0x4e, 0x62, 0x21, 0xd2, 0x9e, 0x00, 0xec, 0xac]), // 4e6221d29e00ecac
  close_compressed_group_key: Buffer.from([0xd2, 0x80, 0x92, 0xc1, 0xd7, 0x10, 0xd5, 0xb7]), // d28092c1d710d5b7
  close_group: Buffer.from([0x28, 0xbb, 0xc9, 0xbb, 0x12, 0xc2, 0x7a, 0xe8]), // 28bbc9bb12c27ae8
  close_group_key: Buffer.from([0x5d, 0x2b, 0xd4, 0x16, 0x33, 0x97, 0x3e, 0x03]), // 5d2bd41633973e03
  close_old_relationship: Buffer.from([0xd0, 0x54, 0x3d, 0x18, 0xa7, 0xb6, 0xff, 0x2d]), // d0543d18a7b6ff2d
  close_profile: Buffer.from([0xa7, 0x24, 0xb5, 0x08, 0x88, 0x9e, 0x2e, 0xcf]), // a724b508889e2ecf
  close_relationship: Buffer.from([0x05, 0x3d, 0x2f, 0xb6, 0x95, 0xc0, 0xd7, 0x1a]), // 053d2fb695c0d71a
  close_wallet_descriptor: Buffer.from([0x9f, 0x11, 0x66, 0x26, 0xc1, 0x44, 0xbc, 0x54]), // 9f116626c144bc54
  count_accepted_callback: Buffer.from([0x2c, 0x63, 0x42, 0x0d, 0x15, 0x07, 0x1c, 0xaa]), // 2c63420d15071caa
  count_accepted_contacts: Buffer.from([0xd3, 0x76, 0x6e, 0xfb, 0xe2, 0x3a, 0x3c, 0x4d]), // d3766efbe23a3c4d
  create_contact_index: Buffer.from([0x96, 0x78, 0x14, 0xed, 0xf2, 0x2d, 0x5a, 0xb1]), // 967814edf22d5ab1
  create_group: Buffer.from([0x4f, 0x3c, 0x9e, 0x86, 0x3d, 0xc7, 0x38, 0xf8]), // 4f3c9e863dc738f8
  create_group_index: Buffer.from([0x82, 0xce, 0xe7, 0x12, 0x5e, 0xa2, 0x14, 0x9e]), // 82cee7125ea2149e
  create_private_invite: Buffer.from([0x00, 0x9b, 0x1e, 0xed, 0x82, 0xc6, 0x67, 0xf3]), // 009b1eed82c667f3
  create_session: Buffer.from([0xf2, 0xc1, 0x8f, 0xb3, 0x96, 0x19, 0x7a, 0xe3]), // f2c18fb396197ae3
  delete_private_relationship: Buffer.from([0x06, 0xec, 0xb6, 0xa8, 0xce, 0x78, 0x8e, 0x2d]), // 06ecb6a8ce788e2d
  init_add_two_numbers_comp_def: Buffer.from([0x43, 0xee, 0x95, 0x82, 0xa3, 0xa4, 0x21, 0xf1]), // 43ee9582a3a421f1
  init_count_accepted_comp_def: Buffer.from([0x11, 0xee, 0xc7, 0x80, 0x8e, 0x16, 0x75, 0x5e]), // 11eec7808e16755e
  init_is_mutual_contact_comp_def: Buffer.from([0x0b, 0x2e, 0xb2, 0xaa, 0xc0, 0x96, 0x1b, 0xd0]), // 0b2eb2aac0961bd0
  invite: Buffer.from([0xf2, 0x18, 0xeb, 0xe1, 0x85, 0xd3, 0xbd, 0xfa]), // f218ebe185d3bdfa
  invite_to_group: Buffer.from([0xf2, 0x88, 0x70, 0x57, 0x31, 0xcf, 0xc1, 0x54]), // f288705731cfc154
  invite_to_group_compressed: Buffer.from([0x20, 0x35, 0xa0, 0x27, 0x5f, 0x4e, 0xd7, 0xb9]), // 2035a0275f4ed7b9
  is_mutual_contact_callback: Buffer.from([0x0f, 0x67, 0x3e, 0xdc, 0x79, 0x40, 0x19, 0x35]), // 0f673edc79401935
  kick_member: Buffer.from([0x4e, 0x41, 0xd7, 0xf4, 0x67, 0xca, 0xe4, 0x1b]), // 4e41d7f467cae41b
  leave_group: Buffer.from([0x0a, 0x04, 0x7d, 0x1c, 0x2e, 0x17, 0xe9, 0x1d]), // 0a047d1c2e17e91d
  register: Buffer.from([0xd3, 0x7c, 0x43, 0x0f, 0xd3, 0xc2, 0xb2, 0xf0]), // d37c430fd3c2b2f0
  reject: Buffer.from([0x87, 0x07, 0x3f, 0x55, 0x83, 0x72, 0x6f, 0xe0]), // 87073f5583726fe0
  reject_group_invite: Buffer.from([0xa2, 0xe1, 0x8b, 0x8e, 0x35, 0xb6, 0xd9, 0xe7]), // a2e18b8e35b6d9e7
  reject_group_invite_compressed: Buffer.from([0x61, 0x09, 0x98, 0x1d, 0xfc, 0x5a, 0x0d, 0x9c]), // 6109981dfc5a0d9c
  reject_private_invite: Buffer.from([0xe4, 0x4b, 0xb3, 0xb4, 0x98, 0xbd, 0x9d, 0x69]), // e44bb3b498bd9d69
  revoke_session: Buffer.from([0x56, 0x5c, 0xc6, 0x78, 0x90, 0x02, 0x07, 0xc2]), // 565cc678900207c2
  store_compressed_group_key: Buffer.from([0xaa, 0x74, 0x0b, 0x51, 0xbb, 0x27, 0x2e, 0x2f]), // aa740b51bb272e2f
  store_group_key: Buffer.from([0x25, 0x39, 0x5b, 0x44, 0x63, 0x70, 0xce, 0x9b]), // 25395b446370ce9b
  store_group_key_for_member: Buffer.from([0x18, 0x8c, 0xa4, 0xea, 0xaf, 0xb5, 0xb2, 0xae]), // 188ca4eaafb5b2ae
  unblock: Buffer.from([0xc2, 0x31, 0xad, 0x2b, 0xf6, 0xa4, 0x0e, 0x0b]), // c231ad2bf6a40e0b
  update_contact_index: Buffer.from([0x5a, 0xc7, 0x3a, 0xce, 0xf9, 0xef, 0x7a, 0xe6]), // 5ac73acef9ef7ae6
  update_group: Buffer.from([0x09, 0xf2, 0x01, 0x6e, 0x5b, 0x16, 0xac, 0x61]), // 09f2016e5b16ac61
  update_group_index: Buffer.from([0x8d, 0xee, 0x1b, 0x80, 0x48, 0x72, 0xfc, 0xbf]), // 8dee1b804872fcbf
  update_group_members_list: Buffer.from([0xdf, 0x6b, 0xb9, 0xfa, 0x35, 0x25, 0xf8, 0x74]), // df6bb9fa3525f874
  update_profile: Buffer.from([0x62, 0x43, 0x63, 0xce, 0x56, 0x73, 0xaf, 0x01]), // 624363ce5673af01
  update_relationship_status: Buffer.from([0x1b, 0x71, 0xed, 0x55, 0x12, 0x81, 0xbf, 0xde]), // 1b71ed551281bfde
};

// PDA derivation helpers
export function getWalletDescriptorPDA(owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('wallet_descriptor'), owner.toBuffer(), Buffer.from([1])],
    PROGRAM_ID
  );
  return pda;
}

export function getUserProfilePDA(owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_profile'), owner.toBuffer(), Buffer.from([1])],
    PROGRAM_ID
  );
  return pda;
}

export function getConversationPDA(chatHash: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('conversation'), chatHash, Buffer.from([1])],
    PROGRAM_ID
  );
  return pda;
}

export function getGroupPDA(groupId: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('group'), Buffer.from(groupId), Buffer.from([1])],
    PROGRAM_ID
  );
  return pda;
}

export function getGroupInvitePDA(groupId: Uint8Array, invitee: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('group_invite'), Buffer.from(groupId), invitee.toBuffer(), Buffer.from([1])],
    PROGRAM_ID
  );
  return pda;
}

export function getGroupKeySharePDA(groupId: Uint8Array, member: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('group_key'), Buffer.from(groupId), member.toBuffer(), Buffer.from([1])],
    PROGRAM_ID
  );
  return pda;
}

export function getSessionTokenPDA(sessionKey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('session'), sessionKey.toBuffer(), Buffer.from([1])],
    PROGRAM_ID
  );
  return pda;
}

/**
 * Session token info passed to instruction builders.
 * When present, the session key signs instead of the wallet.
 */
export interface SessionInfo {
  sessionKey: PublicKey;      // The device keypair (signer)
  walletPubkey: PublicKey;    // The original wallet authority
  sessionTokenPDA: PublicKey; // The SessionToken PDA
}

/**
 * Canonical ordering helper for Relationship PDAs
 * Returns [min(a,b), max(a,b)]
 */
function canonicalOrder(a: PublicKey, b: PublicKey): [PublicKey, PublicKey] {
  return a.toBuffer().compare(b.toBuffer()) < 0 ? [a, b] : [b, a];
}

export function getRelationshipPDA(a: PublicKey, b: PublicKey): PublicKey {
  const [min, max] = canonicalOrder(a, b);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('relationship'), min.toBuffer(), max.toBuffer(), Buffer.from([1])],
    PROGRAM_ID
  );
  return pda;
}

export function getPrivateRelationshipPDA(randomId: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('priv_rel'), Buffer.from(randomId), Buffer.from([1])],
    PROGRAM_ID
  );
  return pda;
}

export function getContactIndexPDA(owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('contact_index'), owner.toBuffer(), Buffer.from([1])],
    PROGRAM_ID
  );
  return pda;
}

export function getInvitePointerPDA(recipient: PublicKey, randomId: Uint8Array): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('invite_ptr'), recipient.toBuffer(), Buffer.from(randomId), Buffer.from([1])],
    PROGRAM_ID
  );
  return pda;
}

export function getGroupIndexPDA(owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('group_index'), owner.toBuffer(), Buffer.from([1])],
    PROGRAM_ID
  );
  return pda;
}

// Borsh serialization helpers
function serializeString(str: string): Buffer {
  const encoded = Buffer.from(str, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(encoded.length, 0);
  return Buffer.concat([length, encoded]);
}

function serializeBytes(bytes: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([length, Buffer.from(bytes)]);
}

// ========== SESSION KEY INSTRUCTIONS ==========

/**
 * Build create_session instruction.
 * The wallet (authority) signs once to authorize a device keypair.
 */
export function createCreateSessionInstruction(
  authority: PublicKey,
  sessionKey: PublicKey,
  validUntil: number
): TransactionInstruction {
  const sessionTokenPDA = getSessionTokenPDA(sessionKey);

  // Serialize: discriminator + valid_until (i64 LE)
  const validUntilBuf = Buffer.alloc(8);
  validUntilBuf.writeBigInt64LE(BigInt(validUntil), 0);

  const data = Buffer.concat([
    DISCRIMINATORS.create_session,
    validUntilBuf,
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: sessionTokenPDA, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: sessionKey, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build revoke_session instruction.
 * Only the original wallet authority can revoke.
 */
export function createRevokeSessionInstruction(
  authority: PublicKey,
  sessionKey: PublicKey
): TransactionInstruction {
  const sessionTokenPDA = getSessionTokenPDA(sessionKey);

  const data = DISCRIMINATORS.revoke_session;

  return new TransactionInstruction({
    keys: [
      { pubkey: sessionTokenPDA, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// ========== PROFILE INSTRUCTIONS ==========

/**
 * Build register instruction
 */
export function createRegisterInstruction(
  payer: PublicKey,
  displayName: string,
  avatarData: string,
  encryptionPublicKey: Uint8Array
): TransactionInstruction {
  const userProfile = getUserProfilePDA(payer);

  // Serialize instruction data: discriminator + displayName + avatarData + encryptionPublicKey
  const data = Buffer.concat([
    DISCRIMINATORS.register,
    serializeString(displayName),
    serializeString(avatarData),
    Buffer.from(encryptionPublicKey),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: userProfile, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build close_profile instruction
 */
export function createCloseProfileInstruction(
  payer: PublicKey,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const userProfile = getUserProfilePDA(authority);

  const data = DISCRIMINATORS.close_profile;

  return new TransactionInstruction({
    keys: [
      { pubkey: userProfile, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build invite instruction
 */
export function createInviteInstruction(
  payer: PublicKey,
  invitee: PublicKey,
  chatHash: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const [userA, userB] = canonicalOrder(authority, invitee);
  const relationship = getRelationshipPDA(authority, invitee);
  const conversation = getConversationPDA(chatHash);

  const data = Buffer.concat([
    DISCRIMINATORS.invite,
    Buffer.from(chatHash),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: invitee, isSigner: false, isWritable: false },
      { pubkey: userA, isSigner: false, isWritable: false },
      { pubkey: userB, isSigner: false, isWritable: false },
      { pubkey: relationship, isSigner: false, isWritable: true },
      { pubkey: conversation, isSigner: false, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build accept instruction
 */
export function createAcceptInstruction(
  payer: PublicKey,
  peer: PublicKey,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const [userA, userB] = canonicalOrder(authority, peer);
  const relationship = getRelationshipPDA(authority, peer);

  const data = DISCRIMINATORS.accept;

  return new TransactionInstruction({
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: peer, isSigner: false, isWritable: false },
      { pubkey: userA, isSigner: false, isWritable: false },
      { pubkey: userB, isSigner: false, isWritable: false },
      { pubkey: relationship, isSigner: false, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build reject instruction (delete contact)
 */
export function createRejectInstruction(
  payer: PublicKey,
  peer: PublicKey,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const [userA, userB] = canonicalOrder(authority, peer);
  const relationship = getRelationshipPDA(authority, peer);

  const data = DISCRIMINATORS.reject;

  return new TransactionInstruction({
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: peer, isSigner: false, isWritable: false },
      { pubkey: userA, isSigner: false, isWritable: false },
      { pubkey: userB, isSigner: false, isWritable: false },
      { pubkey: relationship, isSigner: false, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// Aliases for consistency
export const createAcceptInvitationInstruction = createAcceptInstruction;
export const createRejectInvitationInstruction = createRejectInstruction;

/**
 * Build block instruction (hard block contact)
 */
export function createBlockInstruction(
  payer: PublicKey,
  peer: PublicKey,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const [userA, userB] = canonicalOrder(authority, peer);
  const relationship = getRelationshipPDA(authority, peer);

  const data = DISCRIMINATORS.block;

  return new TransactionInstruction({
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: peer, isSigner: false, isWritable: false },
      { pubkey: userA, isSigner: false, isWritable: false },
      { pubkey: userB, isSigner: false, isWritable: false },
      { pubkey: relationship, isSigner: false, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build unblock instruction (change Blocked → Rejected)
 */
export function createUnblockInstruction(
  payer: PublicKey,
  peer: PublicKey,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const [userA, userB] = canonicalOrder(authority, peer);
  const relationship = getRelationshipPDA(authority, peer);

  const data = DISCRIMINATORS.unblock;

  return new TransactionInstruction({
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: peer, isSigner: false, isWritable: false },
      { pubkey: userA, isSigner: false, isWritable: false },
      { pubkey: userB, isSigner: false, isWritable: false },
      { pubkey: relationship, isSigner: false, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build close_relationship instruction - closes Relationship PDA and returns rent
 */
export function createCloseRelationshipInstruction(
  payer: PublicKey,
  peer: PublicKey,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const [userA, userB] = canonicalOrder(authority, peer);
  const relationship = getRelationshipPDA(authority, peer);

  const data = DISCRIMINATORS.close_relationship;

  return new TransactionInstruction({
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: peer, isSigner: false, isWritable: false },
      { pubkey: userA, isSigner: false, isWritable: false },
      { pubkey: userB, isSigner: false, isWritable: false },
      { pubkey: relationship, isSigner: false, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build update_profile instruction
 * @param session - Optional session info. If provided, sessionKey signs instead of wallet.
 */
export function createUpdateProfileInstruction(
  payer: PublicKey,
  displayName: string | null,
  avatarType: 'Emoji' | 'Nft' | null,
  avatarData: string | null,
  encryptionPublicKey: Uint8Array | null,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const userProfile = getUserProfilePDA(authority);

  // Serialize instruction data: discriminator + Option<String> + Option<AvatarType> + Option<String> + Option<[u8; 32]>
  const parts: Buffer[] = [DISCRIMINATORS.update_profile];

  // Serialize Option<String> for display_name
  if (displayName !== null) {
    parts.push(Buffer.from([1])); // Some
    parts.push(serializeString(displayName));
  } else {
    parts.push(Buffer.from([0])); // None
  }

  // Serialize Option<AvatarType> for avatar_type
  if (avatarType !== null) {
    parts.push(Buffer.from([1])); // Some
    parts.push(Buffer.from([avatarType === 'Emoji' ? 0 : 1])); // Enum: Emoji=0, Nft=1
  } else {
    parts.push(Buffer.from([0])); // None
  }

  // Serialize Option<String> for avatar_data
  if (avatarData !== null) {
    parts.push(Buffer.from([1])); // Some
    parts.push(serializeString(avatarData));
  } else {
    parts.push(Buffer.from([0])); // None
  }

  // Serialize Option<[u8; 32]> for encryption_public_key
  if (encryptionPublicKey !== null) {
    parts.push(Buffer.from([1])); // Some
    parts.push(Buffer.from(encryptionPublicKey));
  } else {
    parts.push(Buffer.from([0])); // None
  }

  const data = Buffer.concat(parts);

  const keys = [
    { pubkey: userProfile, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: !session, isWritable: false },
    { pubkey: signer, isSigner: true, isWritable: true },
    // session_token: Option<Account> — pass PDA if session, else program ID for None
    { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ========== GROUP INSTRUCTION BUILDERS ==========

/**
 * Serialize Option<TokenGate>
 */
function serializeOptionTokenGate(tokenGate: { mint: PublicKey; minBalance: bigint } | null): Buffer {
  if (tokenGate === null) {
    return Buffer.from([0]); // None
  }

  const minBalanceBuffer = Buffer.alloc(8);
  minBalanceBuffer.writeBigUInt64LE(tokenGate.minBalance, 0);

  return Buffer.concat([
    Buffer.from([1]), // Some
    tokenGate.mint.toBuffer(),
    minBalanceBuffer,
  ]);
}

/**
 * Build create_group instruction (encrypted name + members)
 */
export function createCreateGroupInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  encryptedName: Uint8Array,
  nameNonce: Uint8Array,
  encryptionPubkey: Uint8Array,
  tokenGate: { mint: PublicKey; minBalance: bigint } | null,
  encryptedMembers: Uint8Array,
  membersNonce: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const group = getGroupPDA(groupId);

  const data = Buffer.concat([
    DISCRIMINATORS.create_group,
    Buffer.from(groupId),
    serializeBytes(encryptedName),
    Buffer.from(nameNonce),
    Buffer.from(encryptionPubkey),
    serializeOptionTokenGate(tokenGate),
    serializeBytes(encryptedMembers),
    Buffer.from(membersNonce),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: group, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build update_group instruction (encrypted name)
 */
export function createUpdateGroupInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  encryptedName: Uint8Array | null,
  nameNonce: Uint8Array | null,
  tokenGate: { mint: PublicKey; minBalance: bigint } | null,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const group = getGroupPDA(groupId);

  const parts: Buffer[] = [DISCRIMINATORS.update_group];

  if (encryptedName !== null && nameNonce !== null) {
    parts.push(Buffer.from([1])); // Some encrypted_name
    parts.push(serializeBytes(encryptedName));
    parts.push(Buffer.from([1])); // Some name_nonce
    parts.push(Buffer.from(nameNonce));
  } else {
    parts.push(Buffer.from([0])); // None encrypted_name
    parts.push(Buffer.from([0])); // None name_nonce
  }

  parts.push(serializeOptionTokenGate(tokenGate));

  const data = Buffer.concat(parts);

  return new TransactionInstruction({
    keys: [
      { pubkey: group, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build invite_to_group instruction
 */
export function createInviteToGroupInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  invitee: PublicKey,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const group = getGroupPDA(groupId);
  const groupInvite = getGroupInvitePDA(groupId, invitee);

  const data = DISCRIMINATORS.invite_to_group;

  return new TransactionInstruction({
    keys: [
      { pubkey: group, isSigner: false, isWritable: true },
      { pubkey: groupInvite, isSigner: false, isWritable: true },
      { pubkey: invitee, isSigner: false, isWritable: false },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build accept_group_invite instruction
 */
export function createAcceptGroupInviteInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  userTokenAccount: PublicKey | null,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const group = getGroupPDA(groupId);
  const groupInvite = getGroupInvitePDA(groupId, authority);
  const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

  const data = DISCRIMINATORS.accept_group_invite;

  const keys = [
    { pubkey: group, isSigner: false, isWritable: true },
    { pubkey: groupInvite, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount ?? PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: authority, isSigner: !session, isWritable: false },
    { pubkey: signer, isSigner: true, isWritable: true },
    { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: userTokenAccount ? TOKEN_PROGRAM_ID : PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build reject_group_invite instruction
 */
export function createRejectGroupInviteInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const groupInvite = getGroupInvitePDA(groupId, authority);

  const data = DISCRIMINATORS.reject_group_invite;

  return new TransactionInstruction({
    keys: [
      { pubkey: groupInvite, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: !session, isWritable: false },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build leave_group instruction
 */
export function createLeaveGroupInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const group = getGroupPDA(groupId);

  const data = DISCRIMINATORS.leave_group;

  return new TransactionInstruction({
    keys: [
      { pubkey: group, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build kick_member instruction
 */
export function createKickMemberInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  member: PublicKey,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const group = getGroupPDA(groupId);

  const data = DISCRIMINATORS.kick_member;

  return new TransactionInstruction({
    keys: [
      { pubkey: group, isSigner: false, isWritable: true },
      { pubkey: member, isSigner: false, isWritable: false },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build close_group instruction (admin only - deletes group)
 */
export function createCloseGroupInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const group = getGroupPDA(groupId);

  const data = DISCRIMINATORS.close_group;

  return new TransactionInstruction({
    keys: [
      { pubkey: group, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build store_group_key instruction (stores encrypted group key on-chain for recovery)
 */
export function createStoreGroupKeyInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  encryptedKey: Uint8Array,
  nonce: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const groupKeyShare = getGroupKeySharePDA(groupId, authority);
  const group = getGroupPDA(groupId);

  const encryptedKeyBuffer = Buffer.from(encryptedKey);
  const nonceBuffer = Buffer.from(nonce);

  const data = Buffer.concat([
    DISCRIMINATORS.store_group_key,
    Buffer.from(groupId),
    Buffer.from([
      encryptedKeyBuffer.length & 0xff,
      (encryptedKeyBuffer.length >> 8) & 0xff,
      (encryptedKeyBuffer.length >> 16) & 0xff,
      (encryptedKeyBuffer.length >> 24) & 0xff,
    ]),
    encryptedKeyBuffer,
    nonceBuffer,
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: groupKeyShare, isSigner: false, isWritable: true },
      { pubkey: group, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: !session, isWritable: false },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build close_group_key instruction (closes group key share account and recovers rent)
 */
export function createCloseGroupKeyInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const groupKeyShare = getGroupKeySharePDA(groupId, authority);

  const data = DISCRIMINATORS.close_group_key;

  return new TransactionInstruction({
    keys: [
      { pubkey: groupKeyShare, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: !session, isWritable: false },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function createStoreGroupKeyForMemberInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  member: PublicKey,
  encryptedKey: Uint8Array,
  nonce: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const groupKeyShare = getGroupKeySharePDA(groupId, member);
  const group = getGroupPDA(groupId);

  const encryptedKeyBuffer = Buffer.from(encryptedKey);
  const nonceBuffer = Buffer.from(nonce);

  const data = Buffer.concat([
    DISCRIMINATORS.store_group_key_for_member,
    Buffer.from(groupId),
    Buffer.from(member.toBytes()),
    Buffer.from([
      encryptedKeyBuffer.length & 0xff,
      (encryptedKeyBuffer.length >> 8) & 0xff,
      (encryptedKeyBuffer.length >> 16) & 0xff,
      (encryptedKeyBuffer.length >> 24) & 0xff,
    ]),
    encryptedKeyBuffer,
    nonceBuffer,
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: groupKeyShare, isSigner: false, isWritable: true },
      { pubkey: group, isSigner: false, isWritable: false },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// ========== PRIVATE SOCIAL GRAPH INSTRUCTION BUILDERS ==========

export function createCreateContactIndexInstruction(payer: PublicKey): TransactionInstruction {
  const contactIndex = getContactIndexPDA(payer);
  return new TransactionInstruction({
    keys: [
      { pubkey: contactIndex, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: DISCRIMINATORS.create_contact_index,
  });
}

export function createUpdateContactIndexInstruction(
  payer: PublicKey,
  encryptedEntries: Uint8Array,
  nonce: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const contactIndex = getContactIndexPDA(authority);

  const data = Buffer.concat([
    DISCRIMINATORS.update_contact_index,
    serializeBytes(encryptedEntries),
    Buffer.from(nonce),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: contactIndex, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function createCreateGroupIndexInstruction(payer: PublicKey): TransactionInstruction {
  const groupIndex = getGroupIndexPDA(payer);
  return new TransactionInstruction({
    keys: [
      { pubkey: groupIndex, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: DISCRIMINATORS.create_group_index,
  });
}

export function createUpdateGroupIndexInstruction(
  payer: PublicKey,
  encryptedEntries: Uint8Array,
  nonce: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const groupIndex = getGroupIndexPDA(authority);

  const data = Buffer.concat([
    DISCRIMINATORS.update_group_index,
    serializeBytes(encryptedEntries),
    Buffer.from(nonce),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: groupIndex, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function createCreatePrivateInviteInstruction(
  payer: PublicKey,
  randomId: Uint8Array,
  recipient: PublicKey,
  encryptedData: Uint8Array,
  dataNonce: Uint8Array,
  encryptedSender: Uint8Array,
  senderNonce: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const privateRelationship = getPrivateRelationshipPDA(randomId);
  const invitePointer = getInvitePointerPDA(recipient, randomId);

  const data = Buffer.concat([
    DISCRIMINATORS.create_private_invite,
    Buffer.from(randomId),
    serializeBytes(encryptedData),
    Buffer.from(dataNonce),
    serializeBytes(encryptedSender),
    Buffer.from(senderNonce),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: privateRelationship, isSigner: false, isWritable: true },
      { pubkey: invitePointer, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: false },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function createAcceptPrivateInviteInstruction(
  payer: PublicKey,
  randomId: Uint8Array,
  recipientPubkey: PublicKey,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const privateRelationship = getPrivateRelationshipPDA(randomId);
  const invitePointer = getInvitePointerPDA(recipientPubkey, randomId);

  return new TransactionInstruction({
    keys: [
      { pubkey: privateRelationship, isSigner: false, isWritable: true },
      { pubkey: invitePointer, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: DISCRIMINATORS.accept_private_invite,
  });
}

export function createRejectPrivateInviteInstruction(
  payer: PublicKey,
  randomId: Uint8Array,
  recipientPubkey: PublicKey,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const privateRelationship = getPrivateRelationshipPDA(randomId);
  const invitePointer = getInvitePointerPDA(recipientPubkey, randomId);

  return new TransactionInstruction({
    keys: [
      { pubkey: privateRelationship, isSigner: false, isWritable: true },
      { pubkey: invitePointer, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: DISCRIMINATORS.reject_private_invite,
  });
}

export function createUpdateRelationshipStatusInstruction(
  payer: PublicKey,
  randomId: Uint8Array,
  side: 0 | 1,
  newStatus: number,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const privateRelationship = getPrivateRelationshipPDA(randomId);

  const data = Buffer.concat([
    DISCRIMINATORS.update_relationship_status,
    Buffer.from([side]),
    Buffer.from([newStatus]),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: privateRelationship, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function createDeletePrivateRelationshipInstruction(
  payer: PublicKey,
  randomId: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const privateRelationship = getPrivateRelationshipPDA(randomId);

  return new TransactionInstruction({
    keys: [
      { pubkey: privateRelationship, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: DISCRIMINATORS.delete_private_relationship,
  });
}

export function createUpdateGroupMembersListInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  encryptedMembers: Uint8Array,
  membersNonce: Uint8Array,
  session?: SessionInfo
): TransactionInstruction {
  const signer = session ? session.sessionKey : payer;
  const group = getGroupPDA(groupId);

  const data = Buffer.concat([
    DISCRIMINATORS.update_group_members_list,
    serializeBytes(encryptedMembers),
    Buffer.from(membersNonce),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: group, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

export function createCloseOldRelationshipInstruction(
  payer: PublicKey,
  peer: PublicKey,
  session?: SessionInfo
): TransactionInstruction {
  const authority = session ? session.walletPubkey : payer;
  const signer = session ? session.sessionKey : payer;
  const relationship = getRelationshipPDA(authority, peer);

  return new TransactionInstruction({
    keys: [
      { pubkey: relationship, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: session ? session.sessionTokenPDA : PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: DISCRIMINATORS.close_old_relationship,
  });
}

// ========== TRANSACTION BUILDER ==========

/**
 * Build a VersionedTransaction from instructions
 */
export async function buildTransaction(
  connection: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[]
): Promise<VersionedTransaction> {
  // Get latest blockhash
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  // Build v0 transaction message
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  // Create versioned transaction
  return new VersionedTransaction(message);
}

// Deserialization helpers
export interface Peer {
  pubkey: PublicKey;
  status: 'Invited' | 'Requested' | 'Accepted' | 'Rejected' | 'Blocked';
}

export interface WalletDescriptor {
  owner: PublicKey;
  peers: Peer[];
}

export function deserializeWalletDescriptor(data: Buffer): WalletDescriptor {
  let offset = 8; // Skip 8-byte discriminator

  // Read owner (32 bytes)
  const owner = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  // Read peers vector length (4 bytes)
  const peersLength = data.readUInt32LE(offset);
  offset += 4;

  // Read each peer
  const peers: Peer[] = [];
  for (let i = 0; i < peersLength; i++) {
    // Read peer pubkey (32 bytes)
    const pubkey = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;

    // Read peer state (1 byte)
    const stateNum = data.readUInt8(offset);
    offset += 1;

    const status = ['Invited', 'Requested', 'Accepted', 'Rejected', 'Blocked'][stateNum] as
      | 'Invited'
      | 'Requested'
      | 'Accepted'
      | 'Rejected'
      | 'Blocked';

    peers.push({ pubkey, status });
  }

  return { owner, peers };
}

// Relationship deserialization
export interface RelationshipData {
  userA: PublicKey;
  userB: PublicKey;
  statusA: number;
  statusB: number;
  createdAt: bigint;
}

// Status constants matching the program
export const RELATIONSHIP_STATUS = {
  EMPTY: 0,
  INVITED: 1,
  REQUESTED: 2,
  ACCEPTED: 3,
  REJECTED: 4,
  BLOCKED: 5,
} as const;

const STATUS_NAME_MAP: Record<number, 'Invited' | 'Requested' | 'Accepted' | 'Rejected' | 'Blocked'> = {
  1: 'Invited',
  2: 'Requested',
  3: 'Accepted',
  4: 'Rejected',
  5: 'Blocked',
};

export function deserializeRelationship(data: Buffer): RelationshipData {
  let offset = 8; // Skip 8-byte discriminator

  const userA = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const userB = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const statusA = data.readUInt8(offset);
  offset += 1;

  const statusB = data.readUInt8(offset);
  offset += 1;

  const createdAt = data.readBigInt64LE(offset);
  offset += 8;

  return { userA, userB, statusA, statusB, createdAt };
}

/**
 * Given a Relationship and the current user's pubkey,
 * return the peer's pubkey and the current user's status as a string
 */
export function getContactFromRelationship(
  rel: RelationshipData,
  myPubkey: PublicKey
): { peerPubkey: PublicKey; myStatus: 'Invited' | 'Requested' | 'Accepted' | 'Rejected' | 'Blocked' } | null {
  const isA = rel.userA.equals(myPubkey);
  const isB = rel.userB.equals(myPubkey);
  if (!isA && !isB) return null;

  const myStatusNum = isA ? rel.statusA : rel.statusB;
  const myStatus = STATUS_NAME_MAP[myStatusNum];
  if (!myStatus) return null;

  const peerPubkey = isA ? rel.userB : rel.userA;
  return { peerPubkey, myStatus };
}

export { PROGRAM_ID };

// Group types and deserialization
export interface TokenGate {
  mint: PublicKey;
  minBalance: bigint;
}

export interface Group {
  groupId: Uint8Array;
  creator: PublicKey;
  createdAt: bigint;
  memberCount: number;
  encryptionPubkey: Uint8Array;
  tokenGate: TokenGate | null;
  encryptedName: Uint8Array;
  nameNonce: Uint8Array;
  encryptedMembers: Uint8Array;
  membersNonce: Uint8Array;
  // Client-populated after decryption (not on-chain)
  name?: string;
  members?: PublicKey[];
}

export interface PrivateRelationship {
  randomId: Uint8Array;
  statusA: number;
  statusB: number;
  createdAt: bigint;
  initiator: PublicKey;
  encryptedData: Uint8Array;
  dataNonce: Uint8Array;
}

export interface ContactIndex {
  owner: PublicKey;
  encryptedEntries: Uint8Array;
  nonce: Uint8Array;
}

export interface InvitePointer {
  recipient: PublicKey;
  randomId: Uint8Array;
  encryptedSender: Uint8Array;
  senderNonce: Uint8Array;
  createdAt: bigint;
}

export interface GroupIndex {
  owner: PublicKey;
  encryptedEntries: Uint8Array;
  nonce: Uint8Array;
}

export interface GroupInvite {
  groupId: Uint8Array;
  inviter: PublicKey;
  invitee: PublicKey;
  status: 'Pending' | 'Accepted' | 'Rejected';
  createdAt: bigint;
}

export interface GroupKeyShare {
  groupId: Uint8Array;
  member: PublicKey;
  encryptedKey: Uint8Array;
  nonce: Uint8Array;
}

export function deserializeGroup(data: Buffer): Group {
  let offset = 8; // Skip discriminator

  const groupId = new Uint8Array(data.slice(offset, offset + 32)); offset += 32;
  const creator = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const createdAt = data.readBigInt64LE(offset); offset += 8;
  const memberCount = data.readUInt32LE(offset); offset += 4;
  const encryptionPubkey = new Uint8Array(data.slice(offset, offset + 32)); offset += 32;

  const hasTokenGate = data.readUInt8(offset); offset += 1;
  let tokenGate: TokenGate | null = null;
  if (hasTokenGate === 1) {
    const mint = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const minBalance = data.readBigUInt64LE(offset); offset += 8;
    tokenGate = { mint, minBalance };
  }

  const encNameLen = data.readUInt32LE(offset); offset += 4;
  const encryptedName = new Uint8Array(data.slice(offset, offset + encNameLen)); offset += encNameLen;
  const nameNonce = new Uint8Array(data.slice(offset, offset + 24)); offset += 24;

  const encMembersLen = data.readUInt32LE(offset); offset += 4;
  const encryptedMembers = new Uint8Array(data.slice(offset, offset + encMembersLen)); offset += encMembersLen;
  const membersNonce = new Uint8Array(data.slice(offset, offset + 24)); offset += 24;

  return { groupId, creator, createdAt, memberCount, encryptionPubkey, tokenGate, encryptedName, nameNonce, encryptedMembers, membersNonce };
}

export function deserializePrivateRelationship(data: Buffer): PrivateRelationship {
  let offset = 8;
  const randomId = new Uint8Array(data.slice(offset, offset + 32)); offset += 32;
  const statusA = data.readUInt8(offset); offset += 1;
  const statusB = data.readUInt8(offset); offset += 1;
  const createdAt = data.readBigInt64LE(offset); offset += 8;
  const initiator = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const encDataLen = data.readUInt32LE(offset); offset += 4;
  const encryptedData = new Uint8Array(data.slice(offset, offset + encDataLen)); offset += encDataLen;
  const dataNonce = new Uint8Array(data.slice(offset, offset + 24)); offset += 24;
  return { randomId, statusA, statusB, createdAt, initiator, encryptedData, dataNonce };
}

export function deserializeContactIndex(data: Buffer): ContactIndex {
  let offset = 8;
  const owner = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const entriesLen = data.readUInt32LE(offset); offset += 4;
  const encryptedEntries = new Uint8Array(data.slice(offset, offset + entriesLen)); offset += entriesLen;
  const nonce = new Uint8Array(data.slice(offset, offset + 24)); offset += 24;
  return { owner, encryptedEntries, nonce };
}

export function deserializeInvitePointer(data: Buffer): InvitePointer {
  let offset = 8;
  const recipient = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const randomId = new Uint8Array(data.slice(offset, offset + 32)); offset += 32;
  const senderLen = data.readUInt32LE(offset); offset += 4;
  const encryptedSender = new Uint8Array(data.slice(offset, offset + senderLen)); offset += senderLen;
  const senderNonce = new Uint8Array(data.slice(offset, offset + 24)); offset += 24;
  const createdAt = data.readBigInt64LE(offset); offset += 8;
  return { recipient, randomId, encryptedSender, senderNonce, createdAt };
}

export function deserializeGroupIndex(data: Buffer): GroupIndex {
  let offset = 8;
  const owner = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const entriesLen = data.readUInt32LE(offset); offset += 4;
  const encryptedEntries = new Uint8Array(data.slice(offset, offset + entriesLen)); offset += entriesLen;
  const nonce = new Uint8Array(data.slice(offset, offset + 24)); offset += 24;
  return { owner, encryptedEntries, nonce };
}

export function deserializeGroupInvite(data: Buffer): GroupInvite {
  let offset = 8; // Skip 8-byte discriminator

  // Read group_id (32 bytes)
  const groupId = new Uint8Array(data.slice(offset, offset + 32));
  offset += 32;

  // Read inviter (32 bytes)
  const inviter = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  // Read invitee (32 bytes)
  const invitee = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  // Read status (1 byte)
  const statusNum = data.readUInt8(offset);
  offset += 1;
  const status = ['Pending', 'Accepted', 'Rejected'][statusNum] as 'Pending' | 'Accepted' | 'Rejected';

  // Read created_at (8 bytes)
  const createdAt = data.readBigInt64LE(offset);
  offset += 8;

  return {
    groupId,
    inviter,
    invitee,
    status,
    createdAt,
  };
}

export function deserializeGroupKeyShare(data: Buffer): GroupKeyShare {
  let offset = 8; // Skip 8-byte discriminator

  // Read group_id (32 bytes)
  const groupId = new Uint8Array(data.slice(offset, offset + 32));
  offset += 32;

  // Read member (32 bytes)
  const member = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  // Read encrypted_key (Vec<u8>: 4 bytes length + data)
  const encryptedKeyLength = data.readUInt32LE(offset);
  offset += 4;
  const encryptedKey = new Uint8Array(data.slice(offset, offset + encryptedKeyLength));
  offset += encryptedKeyLength;

  // Read nonce (24 bytes)
  const nonce = new Uint8Array(data.slice(offset, offset + 24));
  offset += 24;

  return {
    groupId,
    member,
    encryptedKey,
    nonce,
  };
}

// ========== LIGHT PROTOCOL ZK COMPRESSION INSTRUCTION BUILDERS ==========

/**
 * Light Protocol Compressed Account Types
 * These match the Rust structs in the program
 */

// Import Light Protocol SDK
// Note: lightRpc is already configured in config.ts
import { lightRpc } from '../config';
import {
  getRegisteredProgramPda,
  getAccountCompressionAuthority,
  lightSystemProgram,
  accountCompressionProgram,
  noopProgram,
} from '@lightprotocol/stateless.js';

/**
 * Helper: Derive compressed address using Light Protocol
 * Same seeds as PDA but uses address tree for derivation
 */
async function deriveCompressedAddress(
  seeds: (Buffer | Uint8Array)[],
  programId: PublicKey
): Promise<{ address: PublicKey; addressTree: PublicKey; addressQueue: PublicKey }> {
  // Get default address tree info from Light Protocol
  const addressTreeInfo = await getDefaultAddressTreeInfo(lightRpc);
  const addressTree = addressTreeInfo.tree;
  const addressQueue = addressTreeInfo.queue;

  // Convert seeds to Uint8Array format expected by SDK
  const seedsArray = seeds.map(s => new Uint8Array(s));

  // Derive address seed (V2: no programId here)
  const addressSeed = deriveAddressSeed(seedsArray);

  // Derive the compressed address (V2: programId goes here)
  const address = lightDeriveAddress(addressSeed, addressTree, programId);

  return { address, addressTree, addressQueue };
}

/**
 * Helper: Pack Light System accounts into remaining_accounts
 * Uses V2 account layout (6 system accounts)
 *
 * V2 Account Order (6 system accounts):
 * 0. Light System Program
 * 1. CPI Signer PDA (derived from program with seeds ["cpi_authority"])
 * 2. Registered Program PDA
 * 3. Account Compression Authority
 * 4. Account Compression Program
 * 5. System Program
 * 6+. Tree accounts (address/state trees and queues)
 *
 * NOTE: Light Protocol CPI currently fails on devnet due to indexer limitations.
 *       This code is architecturally correct and ready for mainnet.
 */
function packLightSystemAccounts(
  addressTree?: PublicKey,
  addressQueue?: PublicKey,
  stateTree?: PublicKey,
  stateQueue?: PublicKey
): { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] {
  const accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];

  // Derive CPI Signer PDA from our program
  const [cpiSignerPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("cpi_authority")],
    PROGRAM_ID
  );

  // V2 system accounts (6 total)
  const LIGHT_SYSTEM_PROGRAM = new PublicKey(lightSystemProgram);
  const REGISTERED_PROGRAM_PDA = getRegisteredProgramPda();
  const ACCOUNT_COMPRESSION_AUTHORITY = getAccountCompressionAuthority();
  const ACCOUNT_COMPRESSION_PROGRAM = new PublicKey(accountCompressionProgram);

  accounts.push(
    { pubkey: LIGHT_SYSTEM_PROGRAM, isSigner: false, isWritable: false },           // [0]
    { pubkey: cpiSignerPda, isSigner: false, isWritable: false },                   // [1]
    { pubkey: REGISTERED_PROGRAM_PDA, isSigner: false, isWritable: false },         // [2]
    { pubkey: ACCOUNT_COMPRESSION_AUTHORITY, isSigner: false, isWritable: false },  // [3]
    { pubkey: ACCOUNT_COMPRESSION_PROGRAM, isSigner: false, isWritable: false },    // [4]
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }         // [5]
  );

  // Add Merkle tree accounts starting at index 6
  if (addressTree) {
    accounts.push({ pubkey: addressTree, isSigner: false, isWritable: true });
  }
  if (addressQueue) {
    accounts.push({ pubkey: addressQueue, isSigner: false, isWritable: true });
  }
  if (stateTree) {
    accounts.push({ pubkey: stateTree, isSigner: false, isWritable: true });
  }
  if (stateQueue) {
    accounts.push({ pubkey: stateQueue, isSigner: false, isWritable: true });
  }

  return accounts;
}

/**
 * Helper: Serialize ValidityProof for instruction data
 * Rust type: Option<CompressedProof> wrapped in ValidityProof
 * Borsh serializes Option<T> as 0x01 + T for Some, or 0x00 for None
 */
function serializeValidityProof(proofWithContext: ValidityProofWithContext): Buffer {
  const proof = proofWithContext.compressedProof;
  if (!proof) {
    // None: single 0x00 byte
    return Buffer.from([0x00]);
  }

  // Some: 0x01 + proof bytes
  const a = Buffer.alloc(32);
  const b = Buffer.alloc(64);
  const c = Buffer.alloc(32);

  Buffer.from(proof.a).copy(a);
  Buffer.from(proof.b).copy(b);
  Buffer.from(proof.c).copy(c);

  return Buffer.concat([Buffer.from([0x01]), a, b, c]);
}

/**
 * Helper: Serialize PackedAddressTreeInfo for instruction data
 * Rust struct:
 *   address_merkle_tree_pubkey_index: u8 (1 byte)
 *   address_queue_pubkey_index: u8       (1 byte)
 *   root_index: u16                      (2 bytes, little-endian)
 * Total: 4 bytes
 */
function serializePackedAddressTreeInfo(
  addressMerkleTreePubkeyIndex: number,
  addressQueuePubkeyIndex: number,
  rootIndex: number
): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt8(addressMerkleTreePubkeyIndex, 0);
  buffer.writeUInt8(addressQueuePubkeyIndex, 1);
  buffer.writeUInt16LE(rootIndex, 2);
  return buffer;
}

/**
 * Helper: Serialize CompressedAccountMeta for instruction data
 * Rust struct:
 *   tree_info: PackedStateTreeInfo {
 *     root_index: u16              (2 bytes)
 *     prove_by_index: bool         (1 byte)
 *     merkle_tree_pubkey_index: u8 (1 byte)
 *     queue_pubkey_index: u8       (1 byte)
 *     leaf_index: u32              (4 bytes)
 *   }
 *   address: [u8; 32]              (32 bytes)
 *   output_state_tree_index: u8    (1 byte)
 * Total: 42 bytes
 */
function serializeCompressedAccountMeta(
  rootIndex: number,
  proveByIndex: boolean,
  stateMerkleTreePubkeyIndex: number,
  stateQueuePubkeyIndex: number,
  leafIndex: number,
  address: PublicKey,
  outputStateTreeIndex: number
): Buffer {
  const buffer = Buffer.alloc(42);
  buffer.writeUInt16LE(rootIndex, 0);
  buffer.writeUInt8(proveByIndex ? 1 : 0, 2);
  buffer.writeUInt8(stateMerkleTreePubkeyIndex, 3);
  buffer.writeUInt8(stateQueuePubkeyIndex, 4);
  buffer.writeUInt32LE(leafIndex, 5);
  address.toBuffer().copy(buffer, 9);
  buffer.writeUInt8(outputStateTreeIndex, 41);
  return buffer;
}

/**
 * Build store_compressed_group_key instruction
 *
 * Creates a compressed GroupKeyShare account using ZK compression.
 * This reduces on-chain storage costs by ~10x compared to regular accounts.
 *
 * @param payer - The wallet storing the key (must be group member)
 * @param groupId - The group's 32-byte identifier
 * @param encryptedKey - The encrypted group key (exactly 48 bytes - NaCl box output)
 * @param nonce - The encryption nonce (exactly 24 bytes)
 * @returns TransactionInstruction ready to sign and send
 */
export async function createStoreCompressedGroupKeyInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  encryptedKey: Uint8Array,
  nonce: Uint8Array
): Promise<TransactionInstruction> {
  // Validate input sizes
  if (encryptedKey.length !== 48) {
    throw new Error('Encrypted key must be exactly 48 bytes (NaCl box output)');
  }
  if (nonce.length !== 24) {
    throw new Error('Nonce must be exactly 24 bytes');
  }

  // Derive compressed address (same seeds as PDA)
  const { address, addressTree, addressQueue } = await deriveCompressedAddress(
    [Buffer.from('group_key'), Buffer.from(groupId), payer.toBuffer()],
    PROGRAM_ID
  );

  // Get validity proof from Light RPC
  // This proves the address doesn't exist yet (for CREATE operation)
  let validityProof: ValidityProofWithContext;
  try {
    // Convert address to BN254 for SDK
    const addressBN = createBN254(address.toBytes());

    // For CREATE: empty hashes (no existing accounts), new address to prove non-existence
    const newAddresses: AddressWithTree[] = [{
      address: addressBN,
      tree: addressTree,
      queue: addressQueue,
    }];

    // Use V0 proof API (V2 account structure is separate from proof version)
    validityProof = await lightRpc.getValidityProofV0([], newAddresses);
  } catch (error) {
    console.error('Failed to get validity proof:', error);
    throw new Error('Failed to fetch validity proof from Light RPC');
  }

  // Pack Light System accounts + Merkle trees into remaining_accounts
  // These accounts are at specific indices referenced in the instruction data
  const remainingAccounts = packLightSystemAccounts(addressTree, addressQueue);
  const addressTreeIndex = 5; // After 5 Light System accounts (V1)
  const addressQueueIndex = 6;
  const outputStateTreeIndex = 0; // Default state tree

  // Build instruction data
  const data = Buffer.concat([
    DISCRIMINATORS.store_compressed_group_key,
    serializeValidityProof(validityProof),
    serializePackedAddressTreeInfo(addressTreeIndex, addressQueueIndex, validityProof.rootIndices[0]),
    Buffer.from([outputStateTreeIndex]),
    Buffer.from(groupId),
    Buffer.from(encryptedKey),
    Buffer.from(nonce),
  ]);

  // Regular accounts (group for validation)
  const group = getGroupPDA(groupId);

  return new TransactionInstruction({
    keys: [
      { pubkey: group, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      ...remainingAccounts,
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build close_compressed_group_key instruction
 *
 * Closes a compressed GroupKeyShare account and recovers rent.
 * You must provide the current account data to prove you own it.
 *
 * @param payer - The wallet that created the key share
 * @param groupId - The group's 32-byte identifier
 * @param encryptedKey - The current encrypted key (48 bytes)
 * @param nonce - The current nonce (24 bytes)
 * @returns TransactionInstruction ready to sign and send
 */
export async function createCloseCompressedGroupKeyInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  encryptedKey: Uint8Array,
  nonce: Uint8Array
): Promise<TransactionInstruction> {
  // Validate input sizes
  if (encryptedKey.length !== 48) {
    throw new Error('Encrypted key must be exactly 48 bytes');
  }
  if (nonce.length !== 24) {
    throw new Error('Nonce must be exactly 24 bytes');
  }

  // Derive compressed address
  const { address, addressTree, addressQueue } = await deriveCompressedAddress(
    [Buffer.from('group_key'), Buffer.from(groupId), payer.toBuffer()],
    PROGRAM_ID
  );

  // Fetch compressed account to get state tree info
  let compressedAccount;
  try {
    const addressBN = createBN254(address.toBytes());
    compressedAccount = await lightRpc.getCompressedAccount(addressBN);

    if (!compressedAccount) {
      throw new Error('Compressed account not found');
    }
  } catch (error) {
    console.error('Failed to fetch compressed account:', error);
    throw new Error('Failed to fetch compressed account from Light RPC');
  }

  // Get validity proof (proves account EXISTS for CLOSE operation)
  let validityProof: ValidityProofWithContext;
  try {
    // For CLOSE: prove existing account exists (pass its hash)
    const hashes: HashWithTree[] = [{
      hash: compressedAccount.hash,
      tree: compressedAccount.treeInfo.tree,
      queue: compressedAccount.treeInfo.queue,
    }];

    // Use V0 proof API (V2 account structure is separate from proof version)
    validityProof = await lightRpc.getValidityProofV0(hashes, []);
  } catch (error) {
    console.error('Failed to get validity proof:', error);
    throw new Error('Failed to fetch validity proof from Light RPC');
  }

  // Pack Light System accounts + Merkle trees
  const remainingAccounts = packLightSystemAccounts(
    undefined,
    undefined,
    compressedAccount.treeInfo.tree,
    compressedAccount.treeInfo.queue
  );
  const stateTreeIndex = 6; // After 6 Light System accounts (V2)
  const stateQueueIndex = 7;
  const outputStateTreeIndex = 0;

  // Build instruction data
  const data = Buffer.concat([
    DISCRIMINATORS.close_compressed_group_key,
    serializeValidityProof(validityProof),
    serializeCompressedAccountMeta(
      validityProof.rootIndices[0],
      validityProof.proveByIndices[0],
      stateTreeIndex,
      stateQueueIndex,
      validityProof.leafIndices[0],
      address,
      outputStateTreeIndex
    ),
    Buffer.from(groupId),
    payer.toBuffer(),
    Buffer.from(encryptedKey),
    Buffer.from(nonce),
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      ...remainingAccounts,
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build invite_to_group_compressed instruction
 *
 * Creates a compressed GroupInvite account using ZK compression.
 * Any group member can invite (not just admin).
 *
 * @param payer - The inviter (must be group member)
 * @param groupId - The group's 32-byte identifier
 * @param invitee - The wallet being invited
 * @returns TransactionInstruction ready to sign and send
 */
export async function createInviteToGroupCompressedInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  invitee: PublicKey
): Promise<TransactionInstruction> {
  // Derive compressed address for invite
  const { address, addressTree, addressQueue } = await deriveCompressedAddress(
    [Buffer.from('group_invite'), Buffer.from(groupId), invitee.toBuffer()],
    PROGRAM_ID
  );

  // Get validity proof (proves invite doesn't exist yet)
  let validityProof: ValidityProofWithContext;
  try {
    // Convert address to BN254 for SDK
    const addressBN = createBN254(address.toBytes());

    // For CREATE: prove new address doesn't exist
    const newAddresses: AddressWithTree[] = [{
      address: addressBN,
      tree: addressTree,
      queue: addressQueue,
    }];

    // Use V0 proof API (V2 account structure is separate from proof version)
    validityProof = await lightRpc.getValidityProofV0([], newAddresses);
  } catch (error) {
    console.error('Failed to get validity proof:', error);
    throw new Error('Failed to fetch validity proof from Light RPC');
  }

  // Pack Light System accounts + Merkle trees
  const remainingAccounts = packLightSystemAccounts(addressTree, addressQueue);
  const addressTreeIndex = 6; // After 6 Light System accounts (V2)
  const addressQueueIndex = 7;
  const outputStateTreeIndex = 0;

  // Build instruction data
  const data = Buffer.concat([
    DISCRIMINATORS.invite_to_group_compressed,
    serializeValidityProof(validityProof),
    serializePackedAddressTreeInfo(addressTreeIndex, addressQueueIndex, validityProof.rootIndices[0]),
    Buffer.from([outputStateTreeIndex]),
  ]);

  // Regular accounts
  const group = getGroupPDA(groupId);

  return new TransactionInstruction({
    keys: [
      { pubkey: group, isSigner: false, isWritable: true },
      { pubkey: invitee, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ...remainingAccounts,
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build accept_group_invite_compressed instruction
 *
 * Accepts a compressed group invite and adds member to group.
 * Validates token gate if present.
 *
 * @param payer - The invitee accepting the invite
 * @param groupId - The group's 32-byte identifier
 * @param inviter - The wallet that sent the invite
 * @param status - Current invite status (0=Pending, 1=Accepted, 2=Rejected)
 * @param createdAt - Invite creation timestamp
 * @param userTokenAccount - Token account for token-gated groups (null if no gate)
 * @returns TransactionInstruction ready to sign and send
 */
export async function createAcceptGroupInviteCompressedInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  inviter: PublicKey,
  status: number,
  createdAt: bigint,
  userTokenAccount: PublicKey | null
): Promise<TransactionInstruction> {
  // Derive compressed address for invite
  const { address, addressTree, addressQueue } = await deriveCompressedAddress(
    [Buffer.from('group_invite'), Buffer.from(groupId), payer.toBuffer()],
    PROGRAM_ID
  );

  // Fetch compressed invite account
  let compressedAccount;
  try {
    const addressBN = createBN254(address.toBytes());
    compressedAccount = await lightRpc.getCompressedAccount(addressBN);

    if (!compressedAccount) {
      throw new Error('Compressed invite not found');
    }
  } catch (error) {
    console.error('Failed to fetch compressed account:', error);
    throw new Error('Failed to fetch compressed invite from Light RPC');
  }

  // Get validity proof (proves invite exists for UPDATE operation)
  let validityProof: ValidityProofWithContext;
  try {
    // For UPDATE: prove existing account exists
    const hashes: HashWithTree[] = [{
      hash: compressedAccount.hash,
      tree: compressedAccount.treeInfo.tree,
      queue: compressedAccount.treeInfo.queue,
    }];

    // Use V0 proof API (V2 account structure is separate from proof version)
    validityProof = await lightRpc.getValidityProofV0(hashes, []);
  } catch (error) {
    console.error('Failed to get validity proof:', error);
    throw new Error('Failed to fetch validity proof from Light RPC');
  }

  // Pack Light System accounts + Merkle trees
  const remainingAccounts = packLightSystemAccounts(
    undefined,
    undefined,
    compressedAccount.treeInfo.tree,
    compressedAccount.treeInfo.queue
  );
  const stateTreeIndex = 6; // After 6 Light System accounts (V2)
  const stateQueueIndex = 7;
  const outputStateTreeIndex = 0;

  // Build instruction data
  const createdAtBuffer = Buffer.alloc(8);
  createdAtBuffer.writeBigInt64LE(createdAt, 0);

  const data = Buffer.concat([
    DISCRIMINATORS.accept_group_invite_compressed,
    serializeValidityProof(validityProof),
    serializeCompressedAccountMeta(
      validityProof.rootIndices[0],
      validityProof.proveByIndices[0],
      stateTreeIndex,
      stateQueueIndex,
      validityProof.leafIndices[0],
      address,
      outputStateTreeIndex
    ),
    Buffer.from(groupId),
    inviter.toBuffer(),
    payer.toBuffer(),
    Buffer.from([status]),
    createdAtBuffer,
  ]);

  // Regular accounts
  const group = getGroupPDA(groupId);
  const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

  return new TransactionInstruction({
    keys: [
      { pubkey: group, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount ?? PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount ? TOKEN_PROGRAM_ID : PROGRAM_ID, isSigner: false, isWritable: false },
      ...remainingAccounts,
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build reject_group_invite_compressed instruction
 *
 * Rejects a compressed group invite (updates status to Rejected).
 *
 * @param payer - The invitee rejecting the invite
 * @param groupId - The group's 32-byte identifier
 * @param inviter - The wallet that sent the invite
 * @param status - Current invite status (should be 0=Pending)
 * @param createdAt - Invite creation timestamp
 * @returns TransactionInstruction ready to sign and send
 */
export async function createRejectGroupInviteCompressedInstruction(
  payer: PublicKey,
  groupId: Uint8Array,
  inviter: PublicKey,
  status: number,
  createdAt: bigint
): Promise<TransactionInstruction> {
  // Derive compressed address for invite
  const { address, addressTree, addressQueue } = await deriveCompressedAddress(
    [Buffer.from('group_invite'), Buffer.from(groupId), payer.toBuffer()],
    PROGRAM_ID
  );

  // Fetch compressed invite account
  let compressedAccount;
  try {
    const addressBN = createBN254(address.toBytes());
    compressedAccount = await lightRpc.getCompressedAccount(addressBN);

    if (!compressedAccount) {
      throw new Error('Compressed invite not found');
    }
  } catch (error) {
    console.error('Failed to fetch compressed account:', error);
    throw new Error('Failed to fetch compressed invite from Light RPC');
  }

  // Get validity proof (proves invite exists for UPDATE operation)
  let validityProof: ValidityProofWithContext;
  try {
    // For UPDATE: prove existing account exists
    const hashes: HashWithTree[] = [{
      hash: compressedAccount.hash,
      tree: compressedAccount.treeInfo.tree,
      queue: compressedAccount.treeInfo.queue,
    }];

    // Use V0 proof API (V2 account structure is separate from proof version)
    validityProof = await lightRpc.getValidityProofV0(hashes, []);
  } catch (error) {
    console.error('Failed to get validity proof:', error);
    throw new Error('Failed to fetch validity proof from Light RPC');
  }

  // Pack Light System accounts + Merkle trees
  const remainingAccounts = packLightSystemAccounts(
    undefined,
    undefined,
    compressedAccount.treeInfo.tree,
    compressedAccount.treeInfo.queue
  );
  const stateTreeIndex = 6; // After 6 Light System accounts (V2)
  const stateQueueIndex = 7;
  const outputStateTreeIndex = 0;

  // Build instruction data
  const createdAtBuffer = Buffer.alloc(8);
  createdAtBuffer.writeBigInt64LE(createdAt, 0);

  const data = Buffer.concat([
    DISCRIMINATORS.reject_group_invite_compressed,
    serializeValidityProof(validityProof),
    serializeCompressedAccountMeta(
      validityProof.rootIndices[0],
      validityProof.proveByIndices[0],
      stateTreeIndex,
      stateQueueIndex,
      validityProof.leafIndices[0],
      address,
      outputStateTreeIndex
    ),
    Buffer.from(groupId),
    inviter.toBuffer(),
    payer.toBuffer(),
    Buffer.from([status]),
    createdAtBuffer,
  ]);

  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      ...remainingAccounts,
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// ========== ARCIUM MPC INSTRUCTIONS ==========

import {
  getMXEAddress,
  getCompDefAddress,
  getClusterAddress,
  getMempoolAddress,
  getExecutingPoolAddress,
  getComputationAddress,
} from './arcium';

/**
 * Get Arcium program ID
 */
const ARCIUM_PROGRAM_ID = new PublicKey('ARC1vt8SFJnGv4fXvsKvkBHmvfNSHM6S5kBQxUe96Xd8');

/**
 * Get Arcium fee pool address
 */
const ARCIUM_FEE_POOL = new PublicKey('ARC2qzR5QYWvFcVPxfpBvTQ3wjcr7qg7rPStGpaBT1DF');

/**
 * Get Arcium clock account address
 */
const ARCIUM_CLOCK = new PublicKey('ARC3JqAVRc8jj1tNe4u1oGbf4VPMHYxj5VhvNhGSC3D6');

/**
 * Build init_is_mutual_contact_comp_def instruction
 */
export async function createInitIsMutualContactCompDefInstruction(
  payer: PublicKey
): Promise<TransactionInstruction> {
  const mxeAccount = await getMXEAddress();
  const compDefAccount = await getCompDefAddress('is_mutual_contact');

  const data = DISCRIMINATORS.init_is_mutual_contact_comp_def;

  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: mxeAccount, isSigner: false, isWritable: true },
      { pubkey: compDefAccount, isSigner: false, isWritable: true },
      { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build init_count_accepted_comp_def instruction
 */
export async function createInitCountAcceptedCompDefInstruction(
  payer: PublicKey
): Promise<TransactionInstruction> {
  const mxeAccount = await getMXEAddress();
  const compDefAccount = await getCompDefAddress('count_accepted');

  const data = DISCRIMINATORS.init_count_accepted_comp_def;

  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: mxeAccount, isSigner: false, isWritable: true },
      { pubkey: compDefAccount, isSigner: false, isWritable: true },
      { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build init_add_two_numbers_comp_def instruction
 */
export async function createInitAddTwoNumbersCompDefInstruction(
  payer: PublicKey
): Promise<TransactionInstruction> {
  const mxeAccount = await getMXEAddress();
  const compDefAccount = await getCompDefAddress('add_two_numbers');

  const data = DISCRIMINATORS.init_add_two_numbers_comp_def;

  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: mxeAccount, isSigner: false, isWritable: true },
      { pubkey: compDefAccount, isSigner: false, isWritable: true },
      { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Get sign PDA for Arcium
 */
function getSignPDA(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('ArciumSignerAccount')],
    PROGRAM_ID
  );
  return pda;
}

const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');

/**
 * Build check_mutual_contact instruction — queues MPC to verify relationship is mutual
 *
 * Args: computation_offset (u64), relationship_account (Pubkey),
 *       relationship_offset (u32), relationship_length (u32),
 *       pub_key ([u8; 32] x25519 ephemeral), nonce (u128)
 */
export async function createCheckMutualContactInstruction(
  payer: PublicKey,
  computationOffset: number,
  relationshipAccount: PublicKey,
  relationshipOffset: number,
  relationshipLength: number,
  x25519PubKey: Uint8Array,
  nonce: Uint8Array,
  session?: SessionInfo,
): Promise<TransactionInstruction> {
  const signerPubkey = session ? session.sessionPubkey : payer;

  const data = Buffer.alloc(8 + 8 + 32 + 4 + 4 + 32 + 16);
  let offset = 0;
  DISCRIMINATORS.check_mutual_contact.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(BigInt(computationOffset), offset); offset += 8;
  Buffer.from(relationshipAccount.toBytes()).copy(data, offset); offset += 32;
  data.writeUInt32LE(relationshipOffset, offset); offset += 4;
  data.writeUInt32LE(relationshipLength, offset); offset += 4;
  Buffer.from(x25519PubKey).copy(data, offset); offset += 32;
  Buffer.from(nonce).copy(data, offset); // 16 bytes for u128

  const keys = [
    { pubkey: signerPubkey, isSigner: true, isWritable: true },
    { pubkey: getSignPDA(), isSigner: false, isWritable: true },
    { pubkey: await getMXEAddress(), isSigner: false, isWritable: false },
    { pubkey: await getMempoolAddress(), isSigner: false, isWritable: true },
    { pubkey: await getExecutingPoolAddress(), isSigner: false, isWritable: true },
    { pubkey: await getComputationAddress(computationOffset), isSigner: false, isWritable: true },
    { pubkey: await getCompDefAddress('is_mutual_contact'), isSigner: false, isWritable: false },
    { pubkey: await getClusterAddress(), isSigner: false, isWritable: true },
    { pubkey: ARCIUM_FEE_POOL, isSigner: false, isWritable: true },
    { pubkey: ARCIUM_CLOCK, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  if (session) {
    keys.push({ pubkey: session.sessionTokenPDA, isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
}

/**
 * Build count_accepted_contacts instruction — queues MPC to count accepted contacts privately
 */
export async function createCountAcceptedContactsInstruction(
  payer: PublicKey,
  computationOffset: number,
  contactListAccount: PublicKey,
  contactListOffset: number,
  contactListLength: number,
  x25519PubKey: Uint8Array,
  nonce: Uint8Array,
  session?: SessionInfo,
): Promise<TransactionInstruction> {
  const signerPubkey = session ? session.sessionPubkey : payer;

  const data = Buffer.alloc(8 + 8 + 32 + 4 + 4 + 32 + 16);
  let offset = 0;
  DISCRIMINATORS.count_accepted_contacts.copy(data, offset); offset += 8;
  data.writeBigUInt64LE(BigInt(computationOffset), offset); offset += 8;
  Buffer.from(contactListAccount.toBytes()).copy(data, offset); offset += 32;
  data.writeUInt32LE(contactListOffset, offset); offset += 4;
  data.writeUInt32LE(contactListLength, offset); offset += 4;
  Buffer.from(x25519PubKey).copy(data, offset); offset += 32;
  Buffer.from(nonce).copy(data, offset); // 16 bytes for u128

  const keys = [
    { pubkey: signerPubkey, isSigner: true, isWritable: true },
    { pubkey: getSignPDA(), isSigner: false, isWritable: true },
    { pubkey: await getMXEAddress(), isSigner: false, isWritable: false },
    { pubkey: await getMempoolAddress(), isSigner: false, isWritable: true },
    { pubkey: await getExecutingPoolAddress(), isSigner: false, isWritable: true },
    { pubkey: await getComputationAddress(computationOffset), isSigner: false, isWritable: true },
    { pubkey: await getCompDefAddress('count_accepted'), isSigner: false, isWritable: false },
    { pubkey: await getClusterAddress(), isSigner: false, isWritable: true },
    { pubkey: ARCIUM_FEE_POOL, isSigner: false, isWritable: true },
    { pubkey: ARCIUM_CLOCK, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  if (session) {
    keys.push({ pubkey: session.sessionTokenPDA, isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
}

