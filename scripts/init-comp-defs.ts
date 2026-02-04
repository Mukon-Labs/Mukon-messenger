import * as anchor from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import {
  getArciumProgram,
  getLookupTableAddress,
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getArciumProgramId,
  uploadCircuit,
} from "@arcium-hq/client";

const PROGRAM_ID = new PublicKey(
  "54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy"
);
const LUT_PROGRAM_ID = new PublicKey(
  "AddressLookupTab1e1111111111111111111111111"
);

const CIRCUITS = [
  "is_mutual_contact",
  "count_accepted",
  "add_two_numbers",
] as const;

// Discriminators from IDL (UPDATE AFTER arcium build via scripts/update-discriminators.js)
// These are for the init_<circuit>_comp_def instructions, NOT the circuits themselves
const DISCRIMINATORS: Record<string, Buffer> = {
  is_mutual_contact: Buffer.from([0x0b, 0x2e, 0xb2, 0xaa, 0xc0, 0x96, 0x1b, 0xd0]), // 0b2eb2aac0961bd0
  count_accepted: Buffer.from([0x11, 0xee, 0xc7, 0x80, 0x8e, 0x16, 0x75, 0x5e]),
  add_two_numbers: Buffer.from([0x43, 0xee, 0x95, 0x82, 0xa3, 0xa4, 0x21, 0xf1]),
};

function getCompDefAddress(circuit: string): PublicKey {
  const offsetBytes = getCompDefAccOffset(circuit);
  const offsetNum = Buffer.from(offsetBytes).readUInt32LE(0);
  return getCompDefAccAddress(PROGRAM_ID, offsetNum);
}

async function main() {
  const keypairPath = path.join(homedir(), ".config", "solana", "id.json");
  const keypairData = JSON.parse(readFileSync(keypairPath, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log("Payer:", payer.publicKey.toBase58());

  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed"
  );
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);

  // Use Arcium program to fetch MXE account
  const arciumProgram = getArciumProgram(provider);

  const mxeAccount = getMXEAccAddress(PROGRAM_ID);
  console.log("MXE Account:", mxeAccount.toBase58());

  const mxeAcc = await (arciumProgram as any).account.mxeAccount.fetch(mxeAccount);
  const lutAddress = getLookupTableAddress(PROGRAM_ID, mxeAcc.lutOffsetSlot);
  console.log("LUT Address:", lutAddress.toBase58());

  // Init each comp def
  for (const circuit of CIRCUITS) {
    const compDefAccount = getCompDefAddress(circuit);
    console.log(`\nInitializing comp def: ${circuit}`);
    console.log("  CompDef PDA:", compDefAccount.toBase58());

    const cuIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    const ix = new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: mxeAccount, isSigner: false, isWritable: true },
        { pubkey: compDefAccount, isSigner: false, isWritable: true },
        { pubkey: lutAddress, isSigner: false, isWritable: true },
        { pubkey: LUT_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: getArciumProgramId(), isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: PROGRAM_ID,
      data: DISCRIMINATORS[circuit],
    });

    try {
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const message = new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: [cuIx, ix],
      }).compileToV0Message();
      const tx = new VersionedTransaction(message);
      tx.sign([payer]);

      const sig = await connection.sendTransaction(tx, {
        skipPreflight: false,
      });
      await connection.confirmTransaction(sig, "confirmed");
      console.log("  TX:", sig);
    } catch (e: any) {
      console.error(`  Failed: ${e.message}`);
      if (e.logs) {
        console.error("  Logs:", e.logs.slice(-5).join("\n  "));
      }
    }
  }

  // Upload circuit binaries
  console.log("\n--- Uploading circuits ---\n");
  for (const circuit of CIRCUITS) {
    const arcisPath = path.join(__dirname, "..", "build", `${circuit}.arcis`);
    const rawCircuit = new Uint8Array(readFileSync(arcisPath));

    console.log(`Uploading ${circuit} (${rawCircuit.length} bytes)...`);

    try {
      await uploadCircuit(
        provider as any,
        circuit,
        PROGRAM_ID,
        rawCircuit,
        true
      );
      console.log(`  Uploaded: ${circuit}`);
    } catch (e: any) {
      console.error(`  Upload failed: ${e.message}`);
    }
  }

  console.log("\nDone.");
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Remaining balance: ${balance / 1e9} SOL`);
}

main().catch(console.error);
