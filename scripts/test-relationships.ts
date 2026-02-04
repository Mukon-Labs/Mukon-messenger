/**
 * Devnet integration test for Relationship PDA architecture
 * Tests: register, invite, accept, reject, re-invite, block, unblock
 *
 * Usage: npx ts-node --transpile-only scripts/test-relationships.ts
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { homedir } from "os";
import path from "path";

const PROGRAM_ID = new PublicKey(
  "54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy"
);

const RELATIONSHIP_VERSION = Buffer.from([1]);
const USER_PROFILE_VERSION = Buffer.from([1]);
const CONVERSATION_VERSION = Buffer.from([1]);

// Discriminators from IDL
const DISC = {
  register: Buffer.from([0xd3, 0x7c, 0x43, 0x0f, 0xd3, 0xc2, 0xb2, 0xf0]),
  invite: Buffer.from([0xf2, 0x18, 0xeb, 0xe1, 0x85, 0xd3, 0xbd, 0xfa]),
  accept: Buffer.from([0x41, 0x96, 0x46, 0xd8, 0x85, 0x06, 0x6b, 0x04]),
  reject: Buffer.from([0x87, 0x07, 0x3f, 0x55, 0x83, 0x72, 0x6f, 0xe0]),
  block: Buffer.from([0xee, 0xea, 0x6e, 0x15, 0x79, 0x2b, 0x32, 0x91]),
  unblock: Buffer.from([0xc2, 0x31, 0xad, 0x2b, 0xf6, 0xa4, 0x0e, 0x0b]),
  close_profile: Buffer.from([0xa7, 0x24, 0xb5, 0x08, 0x88, 0x9e, 0x2e, 0xcf]),
};

const STATUS_NAMES: Record<number, string> = {
  0: "Empty",
  1: "Invited",
  2: "Requested",
  3: "Accepted",
  4: "Rejected",
  5: "Blocked",
};

// ========== PDA helpers ==========

function canonicalOrder(a: PublicKey, b: PublicKey): [PublicKey, PublicKey] {
  return a.toBuffer().compare(b.toBuffer()) < 0 ? [a, b] : [b, a];
}

function getRelationshipPDA(a: PublicKey, b: PublicKey): PublicKey {
  const [min, max] = canonicalOrder(a, b);
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("relationship"),
      min.toBuffer(),
      max.toBuffer(),
      RELATIONSHIP_VERSION,
    ],
    PROGRAM_ID
  );
  return pda;
}

function getUserProfilePDA(owner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_profile"), owner.toBuffer(), USER_PROFILE_VERSION],
    PROGRAM_ID
  );
  return pda;
}

function getChatHash(a: PublicKey, b: PublicKey): Buffer {
  const combined = Buffer.alloc(64);
  if (a.toBuffer().compare(b.toBuffer()) < 0) {
    a.toBuffer().copy(combined, 0);
    b.toBuffer().copy(combined, 32);
  } else {
    b.toBuffer().copy(combined, 0);
    a.toBuffer().copy(combined, 32);
  }
  return createHash("sha256").update(combined).digest();
}

function getConversationPDA(chatHash: Buffer): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("conversation"), chatHash, CONVERSATION_VERSION],
    PROGRAM_ID
  );
  return pda;
}

// ========== Serialization ==========

function serializeString(str: string): Buffer {
  const encoded = Buffer.from(str, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(encoded.length, 0);
  return Buffer.concat([length, encoded]);
}

// ========== Instruction builders ==========

function buildRegisterIx(
  payer: PublicKey,
  displayName: string,
  avatarData: string,
  encryptionKey: Uint8Array
): TransactionInstruction {
  return new TransactionInstruction({
    keys: [
      { pubkey: getUserProfilePDA(payer), isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([
      DISC.register,
      serializeString(displayName),
      serializeString(avatarData),
      Buffer.from(encryptionKey),
    ]),
  });
}

function buildInviteIx(
  payer: PublicKey,
  invitee: PublicKey
): TransactionInstruction {
  const [userA, userB] = canonicalOrder(payer, invitee);
  const chatHash = getChatHash(payer, invitee);
  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: invitee, isSigner: false, isWritable: false },
      { pubkey: userA, isSigner: false, isWritable: false },
      { pubkey: userB, isSigner: false, isWritable: false },
      {
        pubkey: getRelationshipPDA(payer, invitee),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: getConversationPDA(chatHash),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
    ],
    programId: PROGRAM_ID,
    data: Buffer.concat([DISC.invite, chatHash]),
  });
}

function buildDmIx(
  disc: Buffer,
  payer: PublicKey,
  peer: PublicKey
): TransactionInstruction {
  const [userA, userB] = canonicalOrder(payer, peer);
  return new TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: peer, isSigner: false, isWritable: false },
      { pubkey: userA, isSigner: false, isWritable: false },
      { pubkey: userB, isSigner: false, isWritable: false },
      {
        pubkey: getRelationshipPDA(payer, peer),
        isSigner: false,
        isWritable: true,
      },
    ],
    programId: PROGRAM_ID,
    data: disc,
  });
}

function buildCloseProfileIx(payer: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    keys: [
      { pubkey: getUserProfilePDA(payer), isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
    ],
    programId: PROGRAM_ID,
    data: DISC.close_profile,
  });
}

// ========== Transaction helpers ==========

async function sendTx(
  connection: Connection,
  instructions: TransactionInstruction[],
  signers: Keypair[]
): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: signers[0].publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign(signers);
  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

function deserializeRelationship(data: Buffer) {
  let offset = 8;
  const userA = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  const userB = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  const statusA = data.readUInt8(offset);
  offset += 1;
  const statusB = data.readUInt8(offset);
  offset += 1;
  return { userA, userB, statusA, statusB };
}

async function fetchRelationship(
  connection: Connection,
  a: PublicKey,
  b: PublicKey
) {
  const pda = getRelationshipPDA(a, b);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  return deserializeRelationship(info.data as Buffer);
}

// ========== Test runner ==========

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

async function main() {
  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );

  // Load funder keypair
  const funderPath = path.join(homedir(), ".config", "solana", "id.json");
  const funderData = JSON.parse(readFileSync(funderPath, "utf-8"));
  const funder = Keypair.fromSecretKey(Uint8Array.from(funderData));
  console.log(`Funder: ${funder.publicKey.toBase58()}`);

  const balance = await connection.getBalance(funder.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);

  // Create two fresh test wallets
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  console.log(`Alice: ${alice.publicKey.toBase58()}`);
  console.log(`Bob:   ${bob.publicKey.toBase58()}`);
  console.log(
    `Relationship PDA: ${getRelationshipPDA(alice.publicKey, bob.publicKey).toBase58()}\n`
  );

  // Fund test wallets from funder
  console.log("--- Funding test wallets ---");
  {
    const ix1 = SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: alice.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL,
    });
    const ix2 = SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: bob.publicKey,
      lamports: 0.1 * LAMPORTS_PER_SOL,
    });
    await sendTx(connection, [ix1, ix2], [funder]);
    console.log("  Funded Alice + Bob with 0.1 SOL each\n");
  }

  // ========== Test 1: Register ==========
  console.log("--- Test 1: Register ---");
  {
    const fakeEncKey = new Uint8Array(32).fill(0xaa);

    const sig1 = await sendTx(
      connection,
      [buildRegisterIx(alice.publicKey, "Alice", "🦊", fakeEncKey)],
      [alice]
    );
    assert(!!sig1, "Alice registered");

    const sig2 = await sendTx(
      connection,
      [buildRegisterIx(bob.publicKey, "Bob", "🐻", fakeEncKey)],
      [bob]
    );
    assert(!!sig2, "Bob registered");

    // Verify profile exists
    const profileInfo = await connection.getAccountInfo(
      getUserProfilePDA(alice.publicKey)
    );
    assert(profileInfo !== null, "Alice profile PDA exists");
    assert(profileInfo!.data.length > 0, "Alice profile has data");
  }

  // ========== Test 2: Invite ==========
  console.log("\n--- Test 2: Alice invites Bob ---");
  {
    const sig = await sendTx(
      connection,
      [buildInviteIx(alice.publicKey, bob.publicKey)],
      [alice]
    );
    assert(!!sig, "Invite tx confirmed");

    const rel = await fetchRelationship(
      connection,
      alice.publicKey,
      bob.publicKey
    );
    assert(rel !== null, "Relationship PDA exists");

    const [expectedA] = canonicalOrder(alice.publicKey, bob.publicKey);
    const aliceIsA = alice.publicKey.equals(expectedA);

    if (aliceIsA) {
      assert(rel!.statusA === 1, `Alice (user_a) status = Invited (${STATUS_NAMES[rel!.statusA]})`);
      assert(rel!.statusB === 2, `Bob (user_b) status = Requested (${STATUS_NAMES[rel!.statusB]})`);
    } else {
      assert(rel!.statusA === 2, `Bob (user_a) status = Requested (${STATUS_NAMES[rel!.statusA]})`);
      assert(rel!.statusB === 1, `Alice (user_b) status = Invited (${STATUS_NAMES[rel!.statusB]})`);
    }

    // Verify conversation PDA exists
    const chatHash = getChatHash(alice.publicKey, bob.publicKey);
    const convInfo = await connection.getAccountInfo(
      getConversationPDA(chatHash)
    );
    assert(convInfo !== null, "Conversation PDA exists");
  }

  // ========== Test 3: Duplicate invite fails ==========
  console.log("\n--- Test 3: Duplicate invite fails ---");
  {
    try {
      await sendTx(
        connection,
        [buildInviteIx(alice.publicKey, bob.publicKey)],
        [alice]
      );
      assert(false, "Duplicate invite should have failed");
    } catch (e: any) {
      assert(
        e.toString().includes("AlreadyInvited") ||
          e.toString().includes("already in use") ||
          e.toString().includes("custom program error"),
        `Duplicate invite rejected: ${e.message?.slice(0, 80)}`
      );
    }
  }

  // ========== Test 4: Accept ==========
  console.log("\n--- Test 4: Bob accepts ---");
  {
    const sig = await sendTx(
      connection,
      [buildDmIx(DISC.accept, bob.publicKey, alice.publicKey)],
      [bob]
    );
    assert(!!sig, "Accept tx confirmed");

    const rel = await fetchRelationship(
      connection,
      alice.publicKey,
      bob.publicKey
    );
    assert(rel!.statusA === 3, `user_a status = Accepted (${STATUS_NAMES[rel!.statusA]})`);
    assert(rel!.statusB === 3, `user_b status = Accepted (${STATUS_NAMES[rel!.statusB]})`);
  }

  // ========== Test 5: Reject ==========
  console.log("\n--- Test 5: Bob rejects (deletes contact) ---");
  {
    const sig = await sendTx(
      connection,
      [buildDmIx(DISC.reject, bob.publicKey, alice.publicKey)],
      [bob]
    );
    assert(!!sig, "Reject tx confirmed");

    const rel = await fetchRelationship(
      connection,
      alice.publicKey,
      bob.publicKey
    );
    assert(rel!.statusA === 4, `user_a status = Rejected (${STATUS_NAMES[rel!.statusA]})`);
    assert(rel!.statusB === 4, `user_b status = Rejected (${STATUS_NAMES[rel!.statusB]})`);
  }

  // ========== Test 6: Re-invite after reject ==========
  console.log("\n--- Test 6: Alice re-invites after reject ---");
  {
    const sig = await sendTx(
      connection,
      [buildInviteIx(alice.publicKey, bob.publicKey)],
      [alice]
    );
    assert(!!sig, "Re-invite tx confirmed");

    const rel = await fetchRelationship(
      connection,
      alice.publicKey,
      bob.publicKey
    );
    const [expectedA] = canonicalOrder(alice.publicKey, bob.publicKey);
    const aliceIsA = alice.publicKey.equals(expectedA);

    if (aliceIsA) {
      assert(rel!.statusA === 1, `Alice (user_a) re-invited = Invited (${STATUS_NAMES[rel!.statusA]})`);
      assert(rel!.statusB === 2, `Bob (user_b) re-invited = Requested (${STATUS_NAMES[rel!.statusB]})`);
    } else {
      assert(rel!.statusA === 2, `Bob (user_a) re-invited = Requested (${STATUS_NAMES[rel!.statusA]})`);
      assert(rel!.statusB === 1, `Alice (user_b) re-invited = Invited (${STATUS_NAMES[rel!.statusB]})`);
    }
  }

  // ========== Test 7: Accept again, then block ==========
  console.log("\n--- Test 7: Accept then block ---");
  {
    await sendTx(
      connection,
      [buildDmIx(DISC.accept, bob.publicKey, alice.publicKey)],
      [bob]
    );

    const rel1 = await fetchRelationship(
      connection,
      alice.publicKey,
      bob.publicKey
    );
    assert(rel1!.statusA === 3 && rel1!.statusB === 3, "Both Accepted before block");

    await sendTx(
      connection,
      [buildDmIx(DISC.block, alice.publicKey, bob.publicKey)],
      [alice]
    );

    const rel2 = await fetchRelationship(
      connection,
      alice.publicKey,
      bob.publicKey
    );
    assert(rel2!.statusA === 5, `user_a status = Blocked (${STATUS_NAMES[rel2!.statusA]})`);
    assert(rel2!.statusB === 5, `user_b status = Blocked (${STATUS_NAMES[rel2!.statusB]})`);
  }

  // ========== Test 8: Unblock ==========
  console.log("\n--- Test 8: Alice unblocks Bob ---");
  {
    await sendTx(
      connection,
      [buildDmIx(DISC.unblock, alice.publicKey, bob.publicKey)],
      [alice]
    );

    const rel = await fetchRelationship(
      connection,
      alice.publicKey,
      bob.publicKey
    );
    assert(rel!.statusA === 4, `user_a status = Rejected (${STATUS_NAMES[rel!.statusA]})`);
    assert(rel!.statusB === 4, `user_b status = Rejected (${STATUS_NAMES[rel!.statusB]})`);
  }

  // ========== Test 9: Re-invite after unblock ==========
  console.log("\n--- Test 9: Bob re-invites after unblock ---");
  {
    const sig = await sendTx(
      connection,
      [buildInviteIx(bob.publicKey, alice.publicKey)],
      [bob]
    );
    assert(!!sig, "Re-invite after unblock confirmed");

    const rel = await fetchRelationship(
      connection,
      alice.publicKey,
      bob.publicKey
    );
    const [expectedA] = canonicalOrder(alice.publicKey, bob.publicKey);
    const bobIsA = bob.publicKey.equals(expectedA);

    if (bobIsA) {
      assert(rel!.statusA === 1, `Bob (user_a) = Invited (${STATUS_NAMES[rel!.statusA]})`);
      assert(rel!.statusB === 2, `Alice (user_b) = Requested (${STATUS_NAMES[rel!.statusB]})`);
    } else {
      assert(rel!.statusA === 2, `Alice (user_a) = Requested (${STATUS_NAMES[rel!.statusA]})`);
      assert(rel!.statusB === 1, `Bob (user_b) = Invited (${STATUS_NAMES[rel!.statusB]})`);
    }
  }

  // ========== Test 10: getProgramAccounts (loadContacts simulation) ==========
  console.log("\n--- Test 10: getProgramAccounts (loadContacts) ---");
  {
    // Find relationships where alice is user_a
    const asA = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { dataSize: 82 },
        { memcmp: { offset: 8, bytes: alice.publicKey.toBase58() } },
      ],
    });

    // Find relationships where alice is user_b
    const asB = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { dataSize: 82 },
        { memcmp: { offset: 40, bytes: alice.publicKey.toBase58() } },
      ],
    });

    const total = asA.length + asB.length;
    assert(total >= 1, `Found ${total} relationship(s) for Alice via getProgramAccounts`);

    // Verify we can deserialize
    const allAccounts = [...asA, ...asB];
    for (const { pubkey, account } of allAccounts) {
      const rel = deserializeRelationship(account.data as Buffer);
      const isA = rel.userA.equals(alice.publicKey);
      const peer = isA ? rel.userB : rel.userA;
      const myStatus = isA ? rel.statusA : rel.statusB;
      console.log(
        `    ${pubkey.toBase58().slice(0, 8)}... peer=${peer.toBase58().slice(0, 8)}... myStatus=${STATUS_NAMES[myStatus]}`
      );
    }
    assert(true, "All relationships deserialized successfully");
  }

  // ========== Test 11: Cleanup (close profiles) ==========
  console.log("\n--- Test 11: Close profiles (cleanup) ---");
  {
    try {
      await sendTx(connection, [buildCloseProfileIx(alice.publicKey)], [alice]);
      assert(true, "Alice profile closed");
    } catch (e: any) {
      assert(false, `Alice close failed: ${e.message?.slice(0, 80)}`);
    }

    try {
      await sendTx(connection, [buildCloseProfileIx(bob.publicKey)], [bob]);
      assert(true, "Bob profile closed");
    } catch (e: any) {
      assert(false, `Bob close failed: ${e.message?.slice(0, 80)}`);
    }
  }

  // ========== Summary ==========
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    console.log("❌ SOME TESTS FAILED");
    process.exit(1);
  } else {
    console.log("✅ ALL TESTS PASSED");
  }

  const finalBalance = await connection.getBalance(funder.publicKey);
  console.log(
    `\nSOL spent: ${((balance - finalBalance) / LAMPORTS_PER_SOL).toFixed(6)} SOL`
  );
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
