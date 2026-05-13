/**
 * Arcium MPC Integration Utilities
 *
 * Provides encryption/decryption for private contact verification via Arcium MPC.
 * Uses x25519 key exchange + RescueCipher for field-by-field encryption.
 *
 * NOTE: All imports from @arcium-hq/client are LAZY (dynamic import) because
 * the package imports Node.js 'crypto' which doesn't exist on React Native/Hermes.
 * Lazy loading avoids the Metro bundler error at build time.
 */

import { PublicKey, Connection } from '@solana/web3.js';
import { randomBytes } from 'react-native-get-random-values';

export const ARCIUM_CLUSTER_OFFSET = 456;
export const PROGRAM_ID = new PublicKey('54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy');

// Lazy-load the Arcium client to avoid eager 'crypto' import on Hermes
let _arciumClient: any = null;
async function getArciumClient() {
  if (!_arciumClient) {
    _arciumClient = await import('@arcium-hq/client');
  }
  return _arciumClient;
}

export interface ContactEntry {
  pubkey: Uint8Array;  // 32 bytes
  status: number;      // 0=Invited, 1=Requested, 2=Accepted, 3=Rejected, 4=Blocked
}

export interface EncryptedContactList {
  ciphertext: Uint8Array;
  publicKey: Uint8Array;
  nonce: Uint8Array;
  cipher: any; // RescueCipher
}

/**
 * Get Arcium MXE account address for the program
 */
export async function getMXEAddress(): Promise<PublicKey> {
  const client = await getArciumClient();
  return client.getMXEAccAddress(PROGRAM_ID);
}

/**
 * Get MXE public key for encryption
 */
export async function getMXEPubKey(connection: Connection): Promise<Uint8Array> {
  const client = await getArciumClient();
  const mxeAddress = client.getMXEAccAddress(PROGRAM_ID);
  return await client.getMXEPublicKey(connection, mxeAddress);
}

/**
 * Encrypt a contact list for MPC verification
 */
export async function encryptContactList(
  contacts: ContactEntry[],
  mxePublicKey: Uint8Array
): Promise<EncryptedContactList> {
  const client = await getArciumClient();
  const privateKey = client.x25519.utils.randomSecretKey();
  const publicKey = client.x25519.getPublicKey(privateKey);
  const sharedSecret = client.x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new client.RescueCipher(sharedSecret);

  const paddedContacts: ContactEntry[] = new Array(100).fill(null).map((_, i) => {
    if (i < contacts.length) return contacts[i];
    return { pubkey: new Uint8Array(32), status: 0 };
  });

  const serialized = new Uint8Array(3300);
  paddedContacts.forEach((contact, i) => {
    const offset = i * 33;
    serialized.set(contact.pubkey, offset);
    serialized[offset + 32] = contact.status;
  });

  const nonce = randomBytes(16);
  const ciphertext = cipher.encrypt([serialized], nonce);

  return { ciphertext, publicKey, nonce, cipher };
}

/**
 * Encrypt a single public key for querying
 */
export async function encryptQueryPubkey(
  pubkey: Uint8Array,
  mxePublicKey: Uint8Array
): Promise<EncryptedContactList> {
  const client = await getArciumClient();
  const privateKey = client.x25519.utils.randomSecretKey();
  const publicKey = client.x25519.getPublicKey(privateKey);
  const sharedSecret = client.x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new client.RescueCipher(sharedSecret);

  const nonce = randomBytes(16);
  const ciphertext = cipher.encrypt([pubkey], nonce);

  return { ciphertext, publicKey, nonce, cipher };
}

/**
 * Decrypt MPC computation result
 */
export async function decryptResult(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  encryptionKey: Uint8Array,
  privateKey: Uint8Array
): Promise<Uint8Array> {
  const client = await getArciumClient();
  const sharedSecret = client.x25519.getSharedSecret(privateKey, encryptionKey);
  const cipher = new client.RescueCipher(sharedSecret);
  return cipher.decrypt([ciphertext], nonce);
}

/**
 * Generate ephemeral x25519 keypair and nonce for an MPC computation
 */
export async function generateEphemeralKeys(): Promise<{ publicKey: Uint8Array; privateKey: Uint8Array; nonce: Uint8Array }> {
  const client = await getArciumClient();
  const privateKey = client.x25519.utils.randomSecretKey();
  const publicKey = client.x25519.getPublicKey(privateKey);
  const nonce = randomBytes(16);
  return { publicKey, privateKey, nonce };
}

/**
 * Get computation definition account address for a circuit
 */
export async function getCompDefAddress(circuitName: string): Promise<PublicKey> {
  const client = await getArciumClient();
  const offset = client.getCompDefAccOffset(circuitName);
  return client.getCompDefAccAddress(PROGRAM_ID, offset);
}

/**
 * Get cluster account address
 */
export async function getClusterAddress(): Promise<PublicKey> {
  const client = await getArciumClient();
  const mxeAddress = client.getMXEAccAddress(PROGRAM_ID);
  return client.getClusterAccAddress(mxeAddress, ARCIUM_CLUSTER_OFFSET);
}

/**
 * Get mempool account address
 */
export async function getMempoolAddress(): Promise<PublicKey> {
  const client = await getArciumClient();
  const mxeAddress = client.getMXEAccAddress(PROGRAM_ID);
  return client.getMempoolAccAddress(mxeAddress, ARCIUM_CLUSTER_OFFSET);
}

/**
 * Get executing pool account address
 */
export async function getExecutingPoolAddress(): Promise<PublicKey> {
  const client = await getArciumClient();
  const mxeAddress = client.getMXEAccAddress(PROGRAM_ID);
  return client.getExecutingPoolAccAddress(mxeAddress, ARCIUM_CLUSTER_OFFSET);
}

/**
 * Get computation account address for a specific computation offset
 */
export async function getComputationAddress(computationOffset: number): Promise<PublicKey> {
  const client = await getArciumClient();
  const mxeAddress = client.getMXEAccAddress(PROGRAM_ID);
  return client.getComputationAccAddress(mxeAddress, ARCIUM_CLUSTER_OFFSET, computationOffset);
}

/**
 * Wait for MPC computation to finalize
 */
export async function waitForComputation(
  connection: Connection,
  computationOffset: number,
  timeoutMs: number = 30000
): Promise<void> {
  const computationAddress = await getComputationAddress(computationOffset);
  const client = await getArciumClient();
  await client.awaitComputationFinalization(
    connection,
    computationAddress,
    timeoutMs
  );
}
