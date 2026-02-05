/**
 * Script to close stale Relationship PDAs
 * Run with: npx ts-node --transpile-only scripts/close-relationships.ts
 */

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

const PROGRAM_ID = new PublicKey('54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy');
const RELATIONSHIP_VERSION = Buffer.from([1]);
const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=0815e357-862c-4209-bdbe-2329e2e032d5';

// The 3 test wallets with stale relationships
const WALLET_A = new PublicKey('Hx2ED5bfbDaDxAYHFiGjLQ7bYVcZ4bPQd7L2PA52nQkD');
const WALLET_B = new PublicKey('39Eui8zXW8S14TkTQX9dE4yRhHYqpk1B9GcUEzWFnoXw');
const WALLET_C = new PublicKey('3uBhqxZT3oCY9F9127YvU3XeoZC4ouB2yCzf3HdgXzLr');

function canonicalOrder(a: PublicKey, b: PublicKey): [PublicKey, PublicKey] {
  const aBytes = a.toBytes();
  const bBytes = b.toBytes();
  for (let i = 0; i < 32; i++) {
    if (aBytes[i] < bBytes[i]) return [a, b];
    if (aBytes[i] > bBytes[i]) return [b, a];
  }
  return [a, b];
}

function getRelationshipPDA(a: PublicKey, b: PublicKey): PublicKey {
  const [userA, userB] = canonicalOrder(a, b);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('relationship'), userA.toBuffer(), userB.toBuffer(), RELATIONSHIP_VERSION],
    PROGRAM_ID
  );
  return pda;
}

function createCloseRelationshipInstruction(payer: PublicKey, peer: PublicKey) {
  const [userA, userB] = canonicalOrder(payer, peer);
  const relationship = getRelationshipPDA(payer, peer);
  const discriminator = Buffer.from([0x05, 0x3d, 0x2f, 0xb6, 0x95, 0xc0, 0xd7, 0x1a]);

  return {
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: peer, isSigner: false, isWritable: false },
      { pubkey: userA, isSigner: false, isWritable: false },
      { pubkey: userB, isSigner: false, isWritable: false },
      { pubkey: relationship, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data: discriminator,
  };
}

async function main() {
  // Load keypair from default Solana config
  const keypairPath = path.join(process.env.HOME!, '.config/solana/id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Payer:', payer.publicKey.toBase58());
  console.log('');

  const connection = new Connection(RPC_URL, 'confirmed');

  // Relationship pairs to close
  const pairs: [PublicKey, PublicKey][] = [
    [WALLET_A, WALLET_B],
    [WALLET_A, WALLET_C],
    [WALLET_B, WALLET_C],
  ];

  for (const [a, b] of pairs) {
    const relationshipPDA = getRelationshipPDA(a, b);
    console.log(`Checking ${a.toBase58().slice(0, 8)}... <-> ${b.toBase58().slice(0, 8)}...`);
    console.log(`  PDA: ${relationshipPDA.toBase58()}`);

    const accountInfo = await connection.getAccountInfo(relationshipPDA);
    if (!accountInfo) {
      console.log('  ⏭️  No relationship exists, skipping');
      console.log('');
      continue;
    }

    console.log(`  Found relationship (${accountInfo.data.length} bytes, ${accountInfo.lamports / 1e9} SOL rent)`);

    // Close it using the payer's keypair
    // Note: Either party can close, but we need a signature from someone
    // This script uses the deploy keypair which won't work unless it's one of the wallets
    // Instead, let's just log what needs to be closed
    console.log('  ❌ Needs to be closed from the app (either party can close)');
    console.log('');
  }

  console.log('');
  console.log('To close these from the app, add a "Close Relationship" button in contacts screen');
  console.log('or we can add a closeRelationship function to MessengerContext');
}

main().catch(console.error);
