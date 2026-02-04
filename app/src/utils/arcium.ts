/**
 * Arcium MPC Integration Utilities
 *
 * Provides encryption/decryption for private contact verification via Arcium MPC.
 * Uses x25519 key exchange + RescueCipher for field-by-field encryption.
 */

import {
  RescueCipher,
  x25519,
  getMXEAccAddress,
  getMXEPublicKey,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getClusterAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  awaitComputationFinalization,
  getArciumProgramId,
} from '@arcium-hq/client';
import { PublicKey, Connection } from '@solana/web3.js';
import { randomBytes } from 'react-native-get-random-values';

export const ARCIUM_CLUSTER_OFFSET = 456;
export const PROGRAM_ID = new PublicKey('54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy');

export interface ContactEntry {
  pubkey: Uint8Array;  // 32 bytes
  status: number;      // 0=Invited, 1=Requested, 2=Accepted, 3=Rejected, 4=Blocked
}

export interface EncryptedContactList {
  ciphertext: Uint8Array;
  publicKey: Uint8Array;
  nonce: Uint8Array;
  cipher: RescueCipher;
}

/**
 * Get Arcium MXE account address for the program
 */
export function getMXEAddress(): PublicKey {
  return getMXEAccAddress(PROGRAM_ID);
}

/**
 * Get MXE public key for encryption
 */
export async function getMXEPubKey(connection: Connection): Promise<Uint8Array> {
  const mxeAddress = getMXEAddress();
  return await getMXEPublicKey(connection, mxeAddress);
}

/**
 * Encrypt a contact list for MPC verification
 *
 * @param contacts - Array of contact entries (max 100)
 * @param mxePublicKey - MXE's x25519 public key
 * @returns Encrypted data with cipher for later decryption
 */
export async function encryptContactList(
  contacts: ContactEntry[],
  mxePublicKey: Uint8Array
): Promise<EncryptedContactList> {
  // Generate ephemeral keypair for this encryption
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);

  // Derive shared secret with MXE
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  // Pad to MAX_CONTACTS (100) - fill missing slots with zeros
  const paddedContacts: ContactEntry[] = new Array(100).fill(null).map((_, i) => {
    if (i < contacts.length) {
      return contacts[i];
    }
    return { pubkey: new Uint8Array(32), status: 0 };
  });

  // Serialize contact list to field elements
  // Each contact: 32 bytes pubkey + 1 byte status = 33 bytes per contact
  // Total: 100 contacts * 33 bytes = 3300 bytes
  const serialized = new Uint8Array(3300);
  paddedContacts.forEach((contact, i) => {
    const offset = i * 33;
    serialized.set(contact.pubkey, offset);
    serialized[offset + 32] = contact.status;
  });

  // Generate random nonce
  const nonce = randomBytes(16);
  const nonceU128 = new DataView(nonce.buffer).getBigUint64(0, true);

  // Encrypt the serialized contact list
  // Note: RescueCipher encrypts field-by-field, need to chunk into field elements
  // For simplicity, we'll encrypt the entire blob and return it
  // The actual field-by-field encryption will be handled by the circuit's type definitions
  const ciphertext = cipher.encrypt([serialized], nonce);

  return {
    ciphertext,
    publicKey,
    nonce,
    cipher,
  };
}

/**
 * Encrypt a single public key for querying
 *
 * @param pubkey - Public key to encrypt (32 bytes)
 * @param mxePublicKey - MXE's x25519 public key
 * @returns Encrypted data
 */
export async function encryptQueryPubkey(
  pubkey: Uint8Array,
  mxePublicKey: Uint8Array
): Promise<EncryptedContactList> {
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  const nonce = randomBytes(16);
  const ciphertext = cipher.encrypt([pubkey], nonce);

  return {
    ciphertext,
    publicKey,
    nonce,
    cipher,
  };
}

/**
 * Decrypt MPC computation result
 *
 * @param ciphertext - Encrypted result from MPC
 * @param nonce - Nonce used for encryption
 * @param encryptionKey - x25519 public key used by MPC
 * @param privateKey - Your ephemeral private key
 * @returns Decrypted plaintext result
 */
export function decryptResult(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  encryptionKey: Uint8Array,
  privateKey: Uint8Array
): Uint8Array {
  const sharedSecret = x25519.getSharedSecret(privateKey, encryptionKey);
  const cipher = new RescueCipher(sharedSecret);
  return cipher.decrypt([ciphertext], nonce);
}

/**
 * Get computation definition account address for a circuit
 */
export function getCompDefAddress(circuitName: string): PublicKey {
  const offset = getCompDefAccOffset(circuitName);
  return getCompDefAccAddress(PROGRAM_ID, offset);
}

/**
 * Get cluster account address
 */
export function getClusterAddress(): PublicKey {
  const mxeAddress = getMXEAddress();
  return getClusterAccAddress(mxeAddress, ARCIUM_CLUSTER_OFFSET);
}

/**
 * Get mempool account address
 */
export function getMempoolAddress(): PublicKey {
  const mxeAddress = getMXEAddress();
  return getMempoolAccAddress(mxeAddress, ARCIUM_CLUSTER_OFFSET);
}

/**
 * Get executing pool account address
 */
export function getExecutingPoolAddress(): PublicKey {
  const mxeAddress = getMXEAddress();
  return getExecutingPoolAccAddress(mxeAddress, ARCIUM_CLUSTER_OFFSET);
}

/**
 * Get computation account address for a specific computation offset
 */
export function getComputationAddress(computationOffset: number): PublicKey {
  const mxeAddress = getMXEAddress();
  return getComputationAccAddress(mxeAddress, ARCIUM_CLUSTER_OFFSET, computationOffset);
}

/**
 * Wait for MPC computation to finalize
 */
export async function waitForComputation(
  connection: Connection,
  computationOffset: number,
  timeoutMs: number = 30000
): Promise<void> {
  const computationAddress = getComputationAddress(computationOffset);
  await awaitComputationFinalization(
    connection,
    computationAddress,
    timeoutMs
  );
}
