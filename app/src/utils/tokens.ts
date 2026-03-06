import { Buffer } from 'buffer';
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from '@solana/spl-token';

export interface TokenBalance {
  mint: string;
  symbol?: string;
  balance: number; // UI amount (decimals applied)
  rawBalance: string;
  decimals: number;
  tokenAccount: PublicKey;
}

export async function fetchSOLBalance(
  connection: Connection,
  pubkey: PublicKey,
): Promise<number> {
  const lamports = await connection.getBalance(pubkey);
  return lamports / LAMPORTS_PER_SOL;
}

export async function fetchTokenAccounts(
  connection: Connection,
  owner: PublicKey,
): Promise<TokenBalance[]> {
  const response = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });

  return response.value
    .map((item) => {
      const info = item.account.data.parsed.info;
      const amount = info.tokenAmount;
      return {
        mint: info.mint as string,
        balance: amount.uiAmount as number,
        rawBalance: amount.amount as string,
        decimals: amount.decimals as number,
        tokenAccount: item.pubkey,
      };
    })
    .filter((t) => t.balance > 0);
}

export function createSOLTransferInstruction(
  from: PublicKey,
  to: PublicKey,
  lamports: number,
): TransactionInstruction {
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports });
}

export async function createSPLTransferInstructions(
  connection: Connection,
  from: PublicKey,
  to: PublicKey,
  mint: PublicKey,
  amount: bigint,
): Promise<TransactionInstruction[]> {
  const instructions: TransactionInstruction[] = [];

  const senderATA = getAssociatedTokenAddressSync(mint, from);
  const recipientATA = getAssociatedTokenAddressSync(mint, to);

  // Check if recipient ATA exists, create if needed
  const recipientAccount = await connection.getAccountInfo(recipientATA);
  if (!recipientAccount) {
    instructions.push(
      createAssociatedTokenAccountInstruction(from, recipientATA, to, mint),
    );
  }

  instructions.push(
    createTransferInstruction(senderATA, recipientATA, from, amount),
  );

  return instructions;
}
