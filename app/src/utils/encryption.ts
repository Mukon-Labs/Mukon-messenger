import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import { sha256 } from 'js-sha256';
import { Buffer } from 'buffer';

/**
 * Derives an encryption keypair from a wallet signature
 */
export function deriveEncryptionKeypair(signature: Uint8Array): nacl.BoxKeyPair {
  // Use the signature as seed for deterministic keypair generation
  const seed = signature.slice(0, 32);
  return nacl.box.keyPair.fromSecretKey(seed);
}

/**
 * Encrypts a message for a recipient using their public key
 */
export function encryptMessage(
  content: string,
  recipientPublicKey: Uint8Array,
  senderSecretKey: Uint8Array
): { encrypted: string; nonce: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = new TextEncoder().encode(content);

  const encrypted = nacl.box(
    messageBytes,
    nonce,
    recipientPublicKey,
    senderSecretKey
  );

  return {
    encrypted: Buffer.from(encrypted).toString('base64'),
    nonce: Buffer.from(nonce).toString('base64'),
  };
}

/**
 * Decrypts a message using the recipient's secret key
 */
export function decryptMessage(
  encrypted: string,
  nonce: string,
  senderPublicKey: Uint8Array,
  recipientSecretKey: Uint8Array
): string | null {
  try {
    const encryptedBytes = Buffer.from(encrypted, 'base64');
    const nonceBytes = Buffer.from(nonce, 'base64');

    const decrypted = nacl.box.open(
      encryptedBytes,
      nonceBytes,
      senderPublicKey,
      recipientSecretKey
    );

    if (!decrypted) {
      return null;
    }

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('Decryption failed:', error);
    return null;
  }
}

/**
 * Gets a deterministic chat hash from two public keys (sorted)
 */
export function getChatHash(a: PublicKey, b: PublicKey): Uint8Array {
  const combined = Buffer.alloc(64);

  // Sort pubkeys deterministically
  if (a.toBuffer().compare(b.toBuffer()) < 0) {
    a.toBuffer().copy(combined, 0);
    b.toBuffer().copy(combined, 32);
  } else {
    b.toBuffer().copy(combined, 0);
    a.toBuffer().copy(combined, 32);
  }

  // Use js-sha256 instead of Node's crypto
  const hash = sha256.array(combined);
  return new Uint8Array(hash);
}

/**
 * Truncates a wallet address for display (e.g., "7xKp...3mNq")
 */
export function truncateAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

// ========== PRIVATE SOCIAL GRAPH ENCRYPTION HELPERS ==========

/**
 * Derive a symmetric relationship key from two NaCl keypairs (x25519 DH).
 * Result is the same from both sides: deriveRelationshipKey(alice, bob) === deriveRelationshipKey(bob, alice)
 */
export function deriveRelationshipKey(myNaclPrivkey: Uint8Array, theirNaclPubkey: Uint8Array): Uint8Array {
  return nacl.box.before(theirNaclPubkey, myNaclPrivkey);
}

/**
 * Encrypt PrivateRelationship data: { userA: PublicKey, userB: PublicKey }
 * Uses the DH-derived relationship key (symmetric from both sides).
 */
export function encryptRelationshipData(
  userA: PublicKey,
  userB: PublicKey,
  key: Uint8Array
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const plaintext = new Uint8Array(64);
  plaintext.set(userA.toBytes(), 0);
  plaintext.set(userB.toBytes(), 32);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, key);
  return { ciphertext, nonce };
}

export function decryptRelationshipData(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  key: Uint8Array
): { userA: PublicKey; userB: PublicKey } | null {
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) return null;
  return {
    userA: new PublicKey(plaintext.slice(0, 32)),
    userB: new PublicKey(plaintext.slice(32, 64)),
  };
}

/**
 * Encrypt a list of contact index entries.
 * Each entry is { randomId: Uint8Array(32), counterparty: Uint8Array(32) } — 64 bytes each.
 * Uses the user's own NaCl private key (32 bytes) as the secretbox key — only they can decrypt.
 */
export function encryptContactIndexEntries(
  entries: Array<{ randomId: Uint8Array; counterparty: Uint8Array }>,
  myNaclPrivkey: Uint8Array
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const plaintext = new Uint8Array(entries.length * 64);
  entries.forEach((e, i) => {
    plaintext.set(e.randomId.slice(0, 32), i * 64);
    plaintext.set(e.counterparty.slice(0, 32), i * 64 + 32);
  });
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, myNaclPrivkey);
  return { ciphertext, nonce };
}

export function decryptContactIndexEntries(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  myNaclPrivkey: Uint8Array
): Array<{ randomId: Uint8Array; counterparty: Uint8Array }> | null {
  const plaintext = nacl.secretbox.open(ciphertext, nonce, myNaclPrivkey);
  if (!plaintext) return null;
  const count = plaintext.length / 64;
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      randomId: plaintext.slice(i * 64, i * 64 + 32),
      counterparty: plaintext.slice(i * 64 + 32, i * 64 + 64),
    });
  }
  return entries;
}

/**
 * Encrypt group index entries (list of 32-byte group_ids).
 */
export function encryptGroupIndexEntries(
  groupIds: Uint8Array[],
  myNaclPrivkey: Uint8Array
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const plaintext = new Uint8Array(groupIds.length * 32);
  groupIds.forEach((id, i) => plaintext.set(id.slice(0, 32), i * 32));
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, myNaclPrivkey);
  return { ciphertext, nonce };
}

export function decryptGroupIndexEntries(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  myNaclPrivkey: Uint8Array
): Uint8Array[] | null {
  const plaintext = nacl.secretbox.open(ciphertext, nonce, myNaclPrivkey);
  if (!plaintext) return null;
  const count = plaintext.length / 32;
  const ids = [];
  for (let i = 0; i < count; i++) ids.push(plaintext.slice(i * 32, i * 32 + 32));
  return ids;
}

/**
 * Encrypt group members list with the group secret.
 */
export function encryptGroupMembers(
  members: PublicKey[],
  groupSecret: Uint8Array
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const plaintext = new Uint8Array(members.length * 32);
  members.forEach((m, i) => plaintext.set(m.toBytes(), i * 32));
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, groupSecret);
  return { ciphertext, nonce };
}

export function decryptGroupMembers(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  groupSecret: Uint8Array
): PublicKey[] | null {
  const plaintext = nacl.secretbox.open(ciphertext, nonce, groupSecret);
  if (!plaintext) return null;
  const count = plaintext.length / 32;
  const members = [];
  for (let i = 0; i < count; i++) members.push(new PublicKey(plaintext.slice(i * 32, i * 32 + 32)));
  return members;
}

/**
 * Encrypt/decrypt group name with the group secret.
 */
export function encryptGroupName(
  name: string,
  groupSecret: Uint8Array
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const plaintext = new TextEncoder().encode(name);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, groupSecret);
  return { ciphertext, nonce };
}

export function decryptGroupName(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  groupSecret: Uint8Array
): string | null {
  const plaintext = nacl.secretbox.open(ciphertext, nonce, groupSecret);
  if (!plaintext) return null;
  return new TextDecoder().decode(plaintext);
}

/**
 * Encrypt an invite sender pubkey for the recipient using nacl.box.
 * Only the recipient (with their private key) can decrypt.
 */
export function encryptSenderForRecipient(
  senderPubkey: PublicKey,
  recipientNaclPubkey: Uint8Array,
  senderNaclPrivkey: Uint8Array
): { ciphertext: Uint8Array; nonce: Uint8Array } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box(senderPubkey.toBytes(), nonce, recipientNaclPubkey, senderNaclPrivkey);
  return { ciphertext, nonce };
}

export function decryptSenderFromRecipient(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  senderNaclPubkey: Uint8Array,
  recipientNaclPrivkey: Uint8Array
): PublicKey | null {
  const plaintext = nacl.box.open(ciphertext, nonce, senderNaclPubkey, recipientNaclPrivkey);
  if (!plaintext) return null;
  return new PublicKey(plaintext);
}
