import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { io, Socket } from 'socket.io-client';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getUserProfilePDA,
  getWalletDescriptorPDA,
  getRelationshipPDA,
  getGroupPDA,
  getGroupInvitePDA,
  getGroupKeySharePDA,
  getSessionTokenPDA,
  createRegisterInstruction,
  createUpdateProfileInstruction,
  createCloseProfileInstruction,
  createInviteInstruction,
  createAcceptInvitationInstruction,
  createRejectInvitationInstruction,
  createBlockInstruction,
  createUnblockInstruction,
  createCloseRelationshipInstruction,
  createCreateGroupInstruction,
  createUpdateGroupInstruction,
  createInviteToGroupInstruction,
  createAcceptGroupInviteInstruction,
  createRejectGroupInviteInstruction,
  createLeaveGroupInstruction,
  createKickMemberInstruction,
  createCloseGroupInstruction,
  createStoreGroupKeyInstruction,
  createStoreGroupKeyForMemberInstruction,
  createCloseGroupKeyInstruction,
  createCreateSessionInstruction,
  createRevokeSessionInstruction,
  // ZK Compression instructions
  createStoreCompressedGroupKeyInstruction,
  createCloseCompressedGroupKeyInstruction,
  createInviteToGroupCompressedInstruction,
  createAcceptGroupInviteCompressedInstruction,
  createRejectGroupInviteCompressedInstruction,
  buildTransaction,
  deserializeRelationship,
  getContactFromRelationship,
  deserializeGroup,
  deserializeGroupInvite,
  deserializeGroupKeyShare,
  PROGRAM_ID,
  type Group,
  type GroupInvite,
  type GroupKeyShare,
  type TokenGate,
  type SessionInfo,
} from '../utils/transactions';
import { deriveEncryptionKeypair, getChatHash } from '../utils/encryption';
import type { WalletContextType } from './WalletContext';
import { BACKEND_URL, SOLANA_RPC_URL } from '../config';
import { initializeNotifications, sendMessageNotification } from '../utils/notifications';
// ARCIUM TEMPORARILY DISABLED - Re-enable after core demo
// import {
//   getMXEPubKey,
//   encryptContactList,
//   encryptQueryPubkey,
//   waitForComputation,
//   type ContactEntry,
// } from '../utils/arcium';

// ============================================================================
// FEATURE FLAG: ZK Compression
// ============================================================================
// When enabled, uses Light Protocol compressed accounts for:
// - Group key storage (store_compressed_group_key vs store_group_key)
// - Group invitations (invite_to_group_compressed vs invite_to_group)
// Cost savings: ~90% reduction in on-chain storage rent
//
// DISABLED: Light Protocol CPI fails on devnet due to infrastructure limitations
// - Devnet Light System Program panics during verify_proof
// - V2 architecture is complete and ready for mainnet
// - Fallback to regular PDA operations for hackathon demo
const USE_ZK_COMPRESSION = false;

/**
 * Parse the encryption public key from a UserProfile account's raw data.
 * Layout: discriminator(8) + owner(32) + name_len(4) + name(N) + avatar_type(1) + avatar_len(4) + avatar(M) + enc_pubkey(32)
 * NOTE: Cannot use data.slice(data.length - 32) because Anchor allocates fixed space with trailing zeros.
 */
function parseEncryptionPubkey(data: Buffer): Uint8Array | null {
  try {
    let offset = 8 + 32; // skip discriminator + owner
    const nameLen = data.readUInt32LE(offset);
    offset += 4 + nameLen; // skip name length + name
    offset += 1; // skip avatar_type
    const avatarLen = data.readUInt32LE(offset);
    offset += 4 + avatarLen; // skip avatar length + avatar
    return new Uint8Array(data.slice(offset, offset + 32));
  } catch {
    return null;
  }
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface Contact {
  publicKey: PublicKey;
  displayName?: string;
  encryptionPublicKey?: Uint8Array;
  state: 'Invited' | 'Requested' | 'Accepted' | 'Rejected' | 'Blocked';
  avatarUrl?: string;
}

interface Profile {
  displayName: string;
  avatarUrl?: string | null;
  publicKey: PublicKey;
  encryptionPublicKey?: string;
}

interface MessengerContextType {
  connection: Connection;
  socket: Socket | null;
  profile: Profile | null;
  contacts: Contact[];
  messages: Map<string, any[]>;
  unreadCounts: Map<string, number>;
  readTimestamps: Map<string, number>;
  loading: boolean;
  profileChecked: boolean;
  encryptionReady: boolean;
  // DM methods
  register: (displayName: string, avatarData?: string) => Promise<string | null>;
  updateProfile: (displayName: string, avatarType?: 'Emoji' | 'Nft', avatarData?: string) => Promise<string>;
  closeProfile: () => Promise<string>;
  invite: (inviteePubkey: PublicKey) => Promise<string>;
  acceptInvitation: (inviterPubkey: PublicKey) => Promise<string>;
  rejectInvitation: (inviterPubkey: PublicKey) => Promise<string>;
  deleteContact: (contactPubkey: PublicKey) => Promise<string>;
  blockContact: (contactPubkey: PublicKey) => Promise<string>;
  unblockContact: (contactPubkey: PublicKey) => Promise<string>;
  closeRelationship: (contactPubkey: PublicKey) => Promise<string>;
  sendMessage: (conversationId: string, content: string, recipientPubkey: PublicKey, replyToMessageId?: string) => Promise<void>;
  deleteMessage: (conversationId: string, messageId: string, deleteForBoth: boolean) => void;
  joinConversation: (conversationId: string) => void;
  leaveConversation: (conversationId: string) => void;
  decryptConversationMessage: (encrypted: string, nonce: string, senderPubkey: PublicKey, recipientPubkey: PublicKey) => string | null;
  loadConversationMessages: (conversationId: string) => Promise<void>;
  loadContacts: () => Promise<void>;
  loadProfile: () => Promise<void>;
  // Group methods
  groups: Group[];
  groupInvites: GroupInvite[];
  groupMessages: Map<string, any[]>;
  groupKeys: Map<string, Uint8Array>;
  createGroup: (name: string, tokenGate?: TokenGate) => Promise<{ groupId: Uint8Array; txSignature: string }>;
  createGroupWithMembers: (name: string, invitees: PublicKey[], tokenGate?: TokenGate) => Promise<{ groupId: Uint8Array; txSignature: string }>;
  updateGroup: (groupId: Uint8Array, name?: string, tokenGate?: TokenGate) => Promise<string>;
  inviteToGroup: (groupId: Uint8Array, inviteePubkey: PublicKey) => Promise<string>;
  acceptGroupInvite: (groupId: Uint8Array, userTokenAccount?: PublicKey) => Promise<string>;
  rejectGroupInvite: (groupId: Uint8Array) => Promise<string>;
  leaveGroup: (groupId: Uint8Array) => Promise<string>;
  kickMember: (groupId: Uint8Array, memberPubkey: PublicKey) => Promise<string>;
  closeGroup: (groupId: Uint8Array) => Promise<string>;
  sendGroupMessage: (groupId: string, content: string) => Promise<void>;
  loadGroups: () => Promise<void>;
  loadGroupInvites: () => Promise<void>;
  loadGroupMessages: (groupId: string) => Promise<void>;
  joinGroupRoom: (groupId: string) => void;
  leaveGroupRoom: (groupId: string) => void;
  groupAvatars: Map<string, string>;
  setGroupAvatarShared: (groupId: string, emoji: string) => Promise<void>;
  connectionStatus: ConnectionStatus;
  wallet: WalletContextType | null;
  // Arcium MPC methods
  verifyContactPrivately: (queryPubkey: string) => Promise<boolean | null>;
}

const MessengerContext = createContext<MessengerContextType | null>(null);

export const useMessenger = () => {
  const context = useContext(MessengerContext);
  if (!context) {
    throw new Error('useMessenger must be used within MessengerProvider');
  }
  return context;
};

export const MessengerProvider: React.FC<{ children: React.ReactNode; wallet: WalletContextType | null; cluster?: string }> = ({
  children,
  wallet,
  cluster = 'devnet',
}) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Map<string, any[]>>(new Map());
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [encryptionKeys, setEncryptionKeys] = useState<nacl.BoxKeyPair | null>(null);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profileChecked, setProfileChecked] = useState(false); // true after initial cache check
  const derivingKeys = useRef(false);
  // Group state
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupInvites, setGroupInvites] = useState<GroupInvite[]>([]);
  const [groupMessages, setGroupMessages] = useState<Map<string, any[]>>(new Map());
  const [groupKeys, setGroupKeys] = useState<Map<string, Uint8Array>>(new Map()); // groupId -> symmetric key
  const [activeGroupRoom, setActiveGroupRoom] = useState<string | null>(null);
  const [readTimestamps, setReadTimestamps] = useState<Map<string, number>>(new Map()); // conversationId/groupId -> latest read timestamp
  const [groupAvatars, setGroupAvatars] = useState<Map<string, string>>(new Map()); // groupId -> emoji (Fix 4)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');

  // Session key state — allows auto-signing without wallet popups
  const [sessionKeypair, setSessionKeypair] = useState<Keypair | null>(null);
  const sessionInfoRef = useRef<SessionInfo | null>(null);
  const sessionKeypairRef = useRef<Keypair | null>(null);
  const backupInFlightRef = useRef<Set<string>>(new Set()); // Prevent duplicate on-chain backups

  // Refs for socket handlers to avoid stale closures (Fix 2b, 2d, Fix 7)
  const encryptionKeysRef = useRef<nacl.BoxKeyPair | null>(null);
  const contactsRef = useRef<Contact[]>([]);
  const groupKeysRef = useRef<Map<string, Uint8Array>>(new Map());
  const activeGroupRoomRef = useRef<string | null>(null);
  const activeConversationRef = useRef<string | null>(null); // Fix 7: DM unread badges
  const groupsRef = useRef<Group[]>([]);
  const hasLoadedPersistedKeys = useRef(false); // Guard to prevent race condition on persist

  const connection = useMemo(
    () => new Connection(SOLANA_RPC_URL, 'confirmed'),
    []
  );

  // Keep refs in sync with state (Fix 2b, 2d)
  useEffect(() => {
    sessionKeypairRef.current = sessionKeypair;
  }, [sessionKeypair]);

  useEffect(() => {
    encryptionKeysRef.current = encryptionKeys;
  }, [encryptionKeys]);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  useEffect(() => {
    groupKeysRef.current = groupKeys;
  }, [groupKeys]);

  useEffect(() => {
    activeGroupRoomRef.current = activeGroupRoom;
  }, [activeGroupRoom]);

  useEffect(() => {
    activeConversationRef.current = activeConversation;
  }, [activeConversation]);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  // Persist group keys to AsyncStorage (Fix 2e)
  useEffect(() => {
    if (!wallet?.publicKey) return;
    if (!hasLoadedPersistedKeys.current) return; // GUARD: Don't persist until keys are loaded

    const persistGroupKeys = async () => {
      try {
        const keysArray = Array.from(groupKeys.entries()).map(([groupId, key]) => ({
          groupId,
          key: Buffer.from(key).toString('base64'),
        }));
        await AsyncStorage.setItem(
          `groupKeys_${wallet.publicKey.toBase58()}`,
          JSON.stringify(keysArray)
        );
      } catch (error) {
        console.error('Failed to persist group keys:', error);
      }
    };

    persistGroupKeys();
  }, [groupKeys, wallet?.publicKey]);

  // Persist unread counts to AsyncStorage (Feature 4)
  useEffect(() => {
    if (!wallet?.publicKey) return;
    if (!hasLoadedPersistedKeys.current) return; // Use same guard

    const persistUnreadCounts = async () => {
      try {
        const countsArray = Array.from(unreadCounts.entries());
        await AsyncStorage.setItem(
          `unreadCounts_${wallet.publicKey.toBase58()}`,
          JSON.stringify(countsArray)
        );
      } catch (error) {
        console.error('Failed to persist unread counts:', error);
      }
    };

    persistUnreadCounts();
  }, [unreadCounts, wallet?.publicKey]);

  // Persist read timestamps to AsyncStorage (Fix 8)
  useEffect(() => {
    if (!wallet?.publicKey) return;
    if (!hasLoadedPersistedKeys.current) return; // Use same guard

    const persistReadTimestamps = async () => {
      try {
        const timestampsArray = Array.from(readTimestamps.entries());
        await AsyncStorage.setItem(
          `readTimestamps_${wallet.publicKey.toBase58()}`,
          JSON.stringify(timestampsArray)
        );
      } catch (error) {
        console.error('Failed to persist read timestamps:', error);
      }
    };

    persistReadTimestamps();
  }, [readTimestamps, wallet?.publicKey]);

  // ========== LOCAL-FIRST MESSAGE PERSISTENCE ==========
  // Messages stored locally on device (AsyncStorage) — app works offline, full history available
  // Backend is a temporary delivery buffer — messages deleted after client acknowledges receipt

  const saveLocalMessages = useCallback(async (walletAddress: string, conversationId: string, msgs: any[]) => {
    try {
      await AsyncStorage.setItem(
        `@mukon_messages_${walletAddress}_${conversationId}`,
        JSON.stringify(msgs)
      );
    } catch (error) {
      console.error('Failed to save local messages:', error);
    }
  }, []);

  const loadLocalMessages = useCallback(async (walletAddress: string, conversationId: string): Promise<any[]> => {
    try {
      const stored = await AsyncStorage.getItem(`@mukon_messages_${walletAddress}_${conversationId}`);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to load local messages:', error);
      return [];
    }
  }, []);

  const saveLocalGroupMessages = useCallback(async (walletAddress: string, groupId: string, msgs: any[]) => {
    try {
      await AsyncStorage.setItem(
        `@mukon_group_messages_${walletAddress}_${groupId}`,
        JSON.stringify(msgs)
      );
    } catch (error) {
      console.error('Failed to save local group messages:', error);
    }
  }, []);

  const loadLocalGroupMessages = useCallback(async (walletAddress: string, groupId: string): Promise<any[]> => {
    try {
      const stored = await AsyncStorage.getItem(`@mukon_group_messages_${walletAddress}_${groupId}`);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error('Failed to load local group messages:', error);
      return [];
    }
  }, []);

  // Load cached profile immediately on mount to prevent showing register screen (Fix: wallet persistence)
  useEffect(() => {
    if (!wallet?.publicKey) return;
    setProfileChecked(false); // Reset on wallet change

    const loadCachedProfile = async () => {
      try {
        const cached = await AsyncStorage.getItem(`@mukon_profile_${wallet.publicKey.toBase58()}`);
        if (cached) {
          const { displayName, avatarUrl, encryptionPublicKey } = JSON.parse(cached);
          console.log('📱 Loaded cached profile from storage');
          setProfile({
            displayName,
            avatarUrl,
            publicKey: wallet.publicKey,
            encryptionPublicKey,
          });
        }
      } catch (error) {
        console.warn('Failed to load cached profile:', error);
      } finally {
        setProfileChecked(true);
      }
    };

    loadCachedProfile();
  }, [wallet?.publicKey]);

  // Load persisted group keys on mount (Fix 2e)
  useEffect(() => {
    if (!wallet?.publicKey) return;

    const loadPersistedData = async () => {
      try {
        // Load group keys
        const storedKeys = await AsyncStorage.getItem(`groupKeys_${wallet.publicKey.toBase58()}`);
        if (storedKeys) {
          const keysArray = JSON.parse(storedKeys);
          const keysMap = new Map(
            keysArray.map((item: any) => [
              item.groupId,
              new Uint8Array(Buffer.from(item.key, 'base64')),
            ])
          );
          setGroupKeys(keysMap);
          console.log(`✅ Loaded ${keysMap.size} persisted group keys`);
        }

        // Load unread counts (Feature 4)
        const storedCounts = await AsyncStorage.getItem(`unreadCounts_${wallet.publicKey.toBase58()}`);
        if (storedCounts) {
          const countsArray = JSON.parse(storedCounts);
          const countsMap = new Map(countsArray);
          setUnreadCounts(countsMap);
          console.log(`✅ Loaded ${countsMap.size} persisted unread counts`);
        }

        // Load read timestamps (Fix 8)
        const storedTimestamps = await AsyncStorage.getItem(`readTimestamps_${wallet.publicKey.toBase58()}`);
        if (storedTimestamps) {
          const timestampsArray = JSON.parse(storedTimestamps);
          const timestampsMap = new Map(timestampsArray);
          setReadTimestamps(timestampsMap);
          console.log(`✅ Loaded ${timestampsMap.size} persisted read timestamps`);
        }
      } catch (error) {
        console.error('Failed to load persisted data:', error);
      } finally {
        hasLoadedPersistedKeys.current = true; // Unlock persist effect
      }
    };

    loadPersistedData();
  }, [wallet?.publicKey]);

  // Derive encryption keys from signature obtained during wallet connect
  useEffect(() => {
    if (!wallet?.publicKey) return;
    if (encryptionKeys) return; // Already have keys

    // Use wallet context's encryptionSignature (reactive) with global fallback
    const signature = wallet.encryptionSignature || (window as any).__mukonEncryptionSignature;
    if (!signature) {
      console.warn('⚠️ No encryption signature available yet');
      return;
    }

    try {
      console.log('🔐 Deriving encryption keypair from signature...');
      const keypair = deriveEncryptionKeypair(signature);
      setEncryptionKeys(keypair);
      setEncryptionReady(true);
      console.log('✅ Encryption keypair derived');
    } catch (error) {
      console.error('❌ Failed to derive encryption keys:', error);
    }
  }, [wallet?.publicKey, wallet?.encryptionSignature, encryptionKeys]);

  // ========== SESSION KEY LIFECYCLE ==========
  // After encryption is ready, load or create a session key for auto-signing
  // This eliminates wallet popups for all on-chain operations after initial setup
  useEffect(() => {
    if (!wallet?.publicKey || !encryptionReady || !wallet.signTransaction) return;
    if (sessionKeypair) return; // Already have session key

    const setupSessionKey = async () => {
      const walletAddress = wallet.publicKey!.toBase58();
      const storageKey = `@mukon_session_keypair_${walletAddress}`;

      try {
        // Try to load existing session keypair from AsyncStorage
        const stored = await AsyncStorage.getItem(storageKey);
        if (stored) {
          const { secretKey, validUntil } = JSON.parse(stored);
          const secretKeyBytes = new Uint8Array(Buffer.from(secretKey, 'base64'));
          const kp = Keypair.fromSecretKey(secretKeyBytes);

          // Check if session is still valid (with 1 hour buffer)
          const now = Math.floor(Date.now() / 1000);
          if (validUntil > now + 3600) {
            // Verify on-chain session token still exists
            const sessionTokenPDA = getSessionTokenPDA(kp.publicKey);
            const accountInfo = await connection.getAccountInfo(sessionTokenPDA);

            if (accountInfo) {
              // Check session key balance — top up if running low
              const balance = await connection.getBalance(kp.publicKey);
              const MIN_BALANCE = Math.floor(0.01 * LAMPORTS_PER_SOL);
              if (balance < MIN_BALANCE && wallet.signTransaction) {
                console.log(`⚠️ Session key balance low (${balance / LAMPORTS_PER_SOL} SOL), topping up...`);
                try {
                  const topUpIx = SystemProgram.transfer({
                    fromPubkey: wallet.publicKey!,
                    toPubkey: kp.publicKey,
                    lamports: Math.floor(0.05 * LAMPORTS_PER_SOL),
                  });
                  const topUpTx = await buildTransaction(connection, wallet.publicKey!, [topUpIx]);
                  const signedTopUp = await wallet.signTransaction(topUpTx);
                  const topUpSig = await connection.sendTransaction(signedTopUp);
                  await connection.confirmTransaction(topUpSig, 'confirmed');
                  console.log('✅ Session key topped up');
                } catch (topUpErr) {
                  console.warn('⚠️ Failed to top up session key:', topUpErr);
                }
              }

              console.log('✅ Loaded existing session key from storage');
              setSessionKeypair(kp);
              sessionInfoRef.current = {
                sessionKey: kp.publicKey,
                walletPubkey: wallet.publicKey!,
                sessionTokenPDA,
              };
              return;
            } else {
              console.log('⚠️ Session token not found on-chain, creating new session');
              await AsyncStorage.removeItem(storageKey);
            }
          } else {
            console.log('⚠️ Session key expired, creating new session');
            await AsyncStorage.removeItem(storageKey);
          }
        }

        // Generate new session keypair
        const newKeypair = Keypair.generate();
        const validUntil = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // 7 days

        // Create session on-chain + fund session key (ONE wallet popup)
        // 0.05 SOL covers ~500 transactions on devnet
        const SESSION_FUND_LAMPORTS = Math.floor(0.05 * LAMPORTS_PER_SOL);
        console.log('🔑 Creating session key (one-time wallet approval)...');
        const createSessionIx = createCreateSessionInstruction(
          wallet.publicKey!,
          newKeypair.publicKey,
          validUntil
        );
        const fundSessionIx = SystemProgram.transfer({
          fromPubkey: wallet.publicKey!,
          toPubkey: newKeypair.publicKey,
          lamports: SESSION_FUND_LAMPORTS,
        });

        // Both instructions in ONE transaction = ONE wallet popup
        const transaction = await buildTransaction(connection, wallet.publicKey!, [createSessionIx, fundSessionIx]);
        const signedTransaction = await wallet.signTransaction!(transaction);
        const txSignature = await connection.sendTransaction(signedTransaction);
        await connection.confirmTransaction(txSignature, 'confirmed');

        console.log(`✅ Session key created + funded with ${SESSION_FUND_LAMPORTS / LAMPORTS_PER_SOL} SOL:`, txSignature);

        // Store session keypair in AsyncStorage
        await AsyncStorage.setItem(storageKey, JSON.stringify({
          secretKey: Buffer.from(newKeypair.secretKey).toString('base64'),
          validUntil,
        }));

        setSessionKeypair(newKeypair);
        const sessionTokenPDA = getSessionTokenPDA(newKeypair.publicKey);
        sessionInfoRef.current = {
          sessionKey: newKeypair.publicKey,
          walletPubkey: wallet.publicKey!,
          sessionTokenPDA,
        };

        console.log('✅ Session key stored and ready — no more wallet popups');
      } catch (error) {
        console.error('⚠️ Failed to setup session key, falling back to wallet signing:', error);
        // Non-fatal — all functions fall back to wallet.signTransaction when session is null
      }
    };

    setupSessionKey();
  }, [wallet?.publicKey, encryptionReady, wallet?.signTransaction, sessionKeypair]);

  // Helper: Sign and send transaction using session key (no wallet popup)
  // Falls back to wallet.signTransaction if no session key available
  const signAndSendTransaction = useCallback(async (
    instructions: any[],
    opts?: { skipConfirmation?: boolean }
  ): Promise<string> => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    const session = sessionInfoRef.current;
    const kp = sessionKeypair;

    if (session && kp) {
      // Session key path — no wallet popup
      const payer = kp.publicKey;
      const transaction = await buildTransaction(connection, payer, instructions);
      transaction.sign([kp]);
      const txSignature = await connection.sendRawTransaction(transaction.serialize());
      if (!opts?.skipConfirmation) {
        await connection.confirmTransaction(txSignature, 'confirmed');
      }
      return txSignature;
    } else {
      // Fallback — wallet signs (popup)
      if (!wallet.signTransaction) throw new Error('Wallet cannot sign');
      const transaction = await buildTransaction(connection, wallet.publicKey, instructions);
      const signedTransaction = await wallet.signTransaction(transaction);
      const txSignature = await connection.sendTransaction(signedTransaction);
      if (!opts?.skipConfirmation) {
        await connection.confirmTransaction(txSignature, 'confirmed');
      }
      return txSignature;
    }
  }, [wallet?.publicKey, wallet?.signTransaction, sessionKeypair, connection]);

  // Recover missing group keys from on-chain encrypted backups
  useEffect(() => {
    if (!wallet?.publicKey || !encryptionKeys || groups.length === 0) return;
    if (!hasLoadedPersistedKeys.current) return; // Wait for local keys to load first

    const recoverMissingKeys = async () => {
      for (const group of groups) {
        const groupIdHex = Buffer.from(group.groupId).toString('hex');

        // Skip if we already have the key
        if (groupKeys.has(groupIdHex)) continue;

        console.log(`🔍 Missing key for group ${groupIdHex.slice(0, 8)}..., attempting recovery from on-chain`);

        try {
          // Fetch GroupKeyShare PDA
          const groupKeySharePDA = getGroupKeySharePDA(group.groupId, wallet.publicKey);
          const accountInfo = await connection.getAccountInfo(groupKeySharePDA);

          if (!accountInfo) {
            console.warn(`⚠️ No on-chain key backup found for group ${groupIdHex.slice(0, 8)}...`);
            // Fallback: request key from online group members via socket
            if (socket) {
              socket.emit('request_group_key', { groupId: groupIdHex });
              console.log(`🔑 Requested key via socket for group ${groupIdHex.slice(0, 8)}...`);
            }
            continue;
          }

          // Deserialize GroupKeyShare
          const keyShare = deserializeGroupKeyShare(accountInfo.data);

          // Determine sender's encryption pubkey for NaCl box.open
          // If we're the creator, we encrypted with our own pubkey (self-backup)
          // If not, the admin encrypted for us — need admin's pubkey
          let senderEncPubkey: Uint8Array = encryptionKeys.publicKey;

          if (!group.creator.equals(wallet.publicKey)) {
            // Fetch admin's encryption pubkey from on-chain profile
            try {
              const creatorProfilePDA = getUserProfilePDA(group.creator);
              const creatorAccount = await connection.getAccountInfo(creatorProfilePDA);
              if (creatorAccount) {
                const data = creatorAccount.data;
                senderEncPubkey = parseEncryptionPubkey(data) ?? undefined;
                if (senderEncPubkey) console.log(`🔑 Using admin's encryption key for decryption`);
              }
            } catch (fetchErr) {
              console.error('Failed to fetch admin encryption key:', fetchErr);
            }
          }

          // Decrypt the group key
          const decryptedKey = nacl.box.open(
            keyShare.encryptedKey,
            keyShare.nonce,
            senderEncPubkey,
            encryptionKeys.secretKey
          );

          if (decryptedKey) {
            setGroupKeys(prev => {
              const updated = new Map(prev);
              updated.set(groupIdHex, decryptedKey);
              return updated;
            });
            console.log(`✅ Recovered group key from on-chain for ${groupIdHex.slice(0, 8)}...`);
          } else {
            console.error(`❌ Failed to decrypt on-chain key for group ${groupIdHex.slice(0, 8)}...`);
            // Fallback: request via socket
            if (socket) {
              socket.emit('request_group_key', { groupId: groupIdHex });
              console.log(`🔑 Fallback: requested key via socket for ${groupIdHex.slice(0, 8)}...`);
            }
          }
        } catch (err) {
          console.error(`Failed to recover key for group ${groupIdHex.slice(0, 8)}:`, err);
        }
      }
    };

    recoverMissingKeys();
  }, [wallet?.publicKey, encryptionKeys, groups, groupKeys, socket]);

  // Initialize socket connection (ONE instance for entire app)
  useEffect(() => {
    if (!wallet?.publicKey) return;
    if (!encryptionReady) return; // Gate on encryption readiness

    console.log('🔌 Connecting to backend:', BACKEND_URL);

    const newSocket = io(BACKEND_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      timeout: 20000,
      autoConnect: true,
    });

    // Set initial connection status
    setConnectionStatus('connecting');

    // Initialize push notifications
    initializeNotifications().then((success) => {
      if (success) {
        console.log('✅ Push notifications initialized');
      }
    });

    // Authentication function - extracted for reuse on reconnect
    const authenticateSocket = async () => {
      if (!newSocket.connected) {
        console.warn('Socket not connected, skipping authentication');
        return;
      }

      try {
        const encryptionSig = (window as any).__mukonEncryptionSignature;
        if (!encryptionSig) {
          console.error('❌ No encryption signature available for socket auth');
          setConnectionStatus('disconnected');
          return;
        }

        newSocket.emit('authenticate', {
          publicKey: wallet.publicKey!.toBase58(),
          signature: bs58.encode(encryptionSig),
        });
        console.log('🔐 Socket authenticated with cached signature (no popup)');
      } catch (error) {
        console.error('❌ Failed to authenticate:', error);
        setConnectionStatus('disconnected');
      }
    };

    // Resync missed messages and rejoin rooms after reconnection
    const resyncAfterReconnect = async () => {
      if (!wallet?.publicKey) return;
      if (!newSocket.connected) return; // Guard: only resync when actually connected

      console.log('🔄 Re-syncing after reconnect...');

      try {
        // Rejoin all active conversation rooms (using current messages Map)
        setMessages((prev) => {
          for (const [conversationId] of prev) {
            newSocket.emit('join_conversation', { conversationId });
          }
          console.log('🔄 Re-joined conversation rooms');
          return prev;
        });

        // Rejoin all group rooms (using ref to avoid stale closure)
        const currentGroups = groupsRef.current;
        for (const group of currentGroups) {
          const groupIdHex = Buffer.from(group.groupId).toString('hex');
          newSocket.emit('join_group_room', { groupId: groupIdHex });
        }
        console.log('🔄 Re-joined group rooms');
      } catch (error) {
        console.error('❌ Failed to resync after reconnect:', error);
      }
    };

    newSocket.on('connect', async () => {
      console.log('✅ Connected to backend via', newSocket.io.engine.transport.name);
      setConnectionStatus('connected');
      await authenticateSocket();
      // Resync rooms on reconnect (connect fires for both initial + reconnections)
      await resyncAfterReconnect();
    });

    newSocket.on('connect_error', (error) => {
      console.error('❌ Socket connection error:', error.message);
      setConnectionStatus('disconnected');
    });

    newSocket.on('disconnect', (reason) => {
      console.log('⚠️  Disconnected from backend:', reason);
      setConnectionStatus('disconnected');
    });

    // Handle reconnection
    newSocket.io.on('reconnect_attempt', (attemptNumber) => {
      console.log(`🔄 Reconnection attempt ${attemptNumber}...`);
      setConnectionStatus('reconnecting');
    });

    newSocket.io.on('reconnect_failed', () => {
      console.error('❌ All reconnection attempts failed');
      setConnectionStatus('disconnected');
    });

    newSocket.io.on('reconnect_error', (error) => {
      console.error('❌ Reconnection error:', error.message);
    });

    newSocket.on('authenticated', (data: any) => {
      if (data.success) {
        console.log('Authenticated with backend');
      } else {
        console.error('Authentication failed:', data.error);
        setConnectionStatus('disconnected');
      }
    });

    newSocket.on('new_message', (message: any) => {
      console.log('Received new_message event:', message);
      if (message.conversationId) {
        let wasNew = false;
        setMessages((prev) => {
          const updated = new Map(prev);
          const conversationMessages = updated.get(message.conversationId) || [];

          // Check if message already exists (avoid duplicates)
          const exists = conversationMessages.some(
            (msg: any) =>
              msg.id === message.id ||
              (msg.encrypted && message.encrypted &&
               msg.encrypted === message.encrypted &&
               msg.nonce === message.nonce &&
               msg.sender === message.sender) ||
              (msg.content && message.content &&
               msg.content === message.content &&
               Math.abs(msg.timestamp - message.timestamp) < 5000)
          );

          if (!exists) {
            const newMessages = [...conversationMessages, message];
            updated.set(message.conversationId, newMessages);
            wasNew = true;

            // Persist locally (fire and forget)
            if (wallet?.publicKey) {
              saveLocalMessages(wallet.publicKey.toBase58(), message.conversationId, newMessages);
            }

            // Increment unread count if not from current user and not in active conversation (Fix 7)
            const currentActiveConv = activeConversationRef.current;
            const isFromOther = message.sender !== wallet?.publicKey?.toBase58();
            const isNotActive = message.conversationId !== currentActiveConv;
            console.log(`📬 DM received - From other: ${isFromOther}, Not active: ${isNotActive}, Active conv: ${currentActiveConv?.slice(0, 8) || 'none'}`);

            if (isFromOther && isNotActive) {
              setUnreadCounts(prev => {
                const updated = new Map(prev);
                const newCount = (updated.get(message.conversationId) || 0) + 1;
                updated.set(message.conversationId, newCount);
                console.log(`✅ Incremented unread count for ${message.conversationId.slice(0, 8)}... to ${newCount}`);
                return updated;
              });

              // Send push notification
              const senderContact = contactsRef.current.find(
                c => c.publicKey.toBase58() === message.sender
              );
              sendMessageNotification(
                message.sender,
                senderContact?.displayName || message.senderName,
                message.content || 'New message',
                message.conversationId,
                'dm'
              );
            }
          }

          return updated;
        });
      }
    });

    newSocket.on('message_deleted', ({ conversationId, messageId }) => {
      console.log('Message deleted:', conversationId, messageId);
      setMessages((prev) => {
        const updated = new Map(prev);
        const conversationMessages = updated.get(conversationId) || [];
        const filtered = conversationMessages.filter(m => m.id !== messageId);
        updated.set(conversationId, filtered);

        // Persist deletion locally
        if (wallet?.publicKey) {
          saveLocalMessages(wallet.publicKey.toBase58(), conversationId, filtered);
        }

        return updated;
      });
    });

    newSocket.on('reaction_updated', ({ conversationId, messageId, reactions }) => {
      console.log('📨 Reaction updated:', {
        conversationId: conversationId.slice(0, 8) + '...',
        messageId,
        reactions: JSON.stringify(reactions)
      });
      setMessages((prev) => {
        const updated = new Map(prev);
        const conversationMessages = updated.get(conversationId) || [];
        console.log(`Updating message ${messageId} with reactions:`, reactions);
        const updatedMessages = conversationMessages.map(m =>
          m.id === messageId ? { ...m, reactions } : m
        );
        updated.set(conversationId, updatedMessages);
        return updated;
      });
    });

    // Feature 5: Message acks and read receipts (DMs)
    newSocket.on('message_ack', ({ messageId, conversationId, timestamp }) => {
      setMessages((prev) => {
        const updated = new Map(prev);
        const conversationMessages = updated.get(conversationId) || [];
        const updatedMessages = conversationMessages.map(m =>
          m.id === messageId || m.timestamp === timestamp ? { ...m, status: 'sent' } : m
        );
        updated.set(conversationId, updatedMessages);
        return updated;
      });
    });

    newSocket.on('messages_read', ({ conversationId, readerPubkey, latestTimestamp }) => {
      console.log(`📗 Received read receipt from ${readerPubkey.slice(0, 8)}... for conversation ${conversationId.slice(0, 8)}...`);
      if (readerPubkey === wallet?.publicKey?.toBase58()) return; // Ignore own read receipts

      // Update read timestamps for persistence
      setReadTimestamps(prev => {
        const updated = new Map(prev);
        const existing = updated.get(conversationId) || 0;
        if (latestTimestamp > existing) {
          updated.set(conversationId, latestTimestamp);
        }
        return updated;
      });

      // Update in-memory message statuses
      setMessages((prev) => {
        const updated = new Map(prev);
        const conversationMessages = updated.get(conversationId) || [];
        const updatedMessages = conversationMessages.map(m => {
          if (m.sender === wallet?.publicKey?.toBase58() && new Date(m.timestamp).getTime() <= latestTimestamp) {
            return { ...m, status: 'read' };
          }
          return m;
        });
        updated.set(conversationId, updatedMessages);
        return updated;
      });
    });

    // Group event handlers
    newSocket.on('group_message', (message: any) => {
      console.log('📨 Received group message:', message);
      if (message.groupId) {
        setGroupMessages((prev) => {
          const updated = new Map(prev);
          const groupMsgs = updated.get(message.groupId) || [];

          // Enhanced duplicate check (matches DM pattern)
          const exists = groupMsgs.some(
            (m: any) =>
              m.id === message.id ||
              (m.encrypted && message.encrypted &&
               m.encrypted === message.encrypted &&
               m.nonce === message.nonce &&
               m.sender === message.sender) ||
              (m.content && message.content &&
               m.content === message.content &&
               m.sender === message.sender &&
               Math.abs(m.timestamp - message.timestamp) < 5000)
          );

          if (!exists) {
            const newMessages = [...groupMsgs, message];
            updated.set(message.groupId, newMessages);

            // Persist locally (fire and forget)
            if (wallet?.publicKey) {
              saveLocalGroupMessages(wallet.publicKey.toBase58(), message.groupId, newMessages);
            }

            // Increment unread if not from self and not viewing this group
            const currentActiveGroup = activeGroupRoomRef.current;
            const isFromOther = message.sender !== wallet?.publicKey?.toBase58();
            const isNotActive = message.groupId !== currentActiveGroup;
            console.log(`📬 Group msg received - From other: ${isFromOther}, Not active: ${isNotActive}, Active group: ${currentActiveGroup?.slice(0, 8) || 'none'}`);

            if (isFromOther && isNotActive) {
              setUnreadCounts(prev => {
                const updated = new Map(prev);
                const newCount = (updated.get(message.groupId) || 0) + 1;
                updated.set(message.groupId, newCount);
                console.log(`✅ Incremented unread count for group ${message.groupId.slice(0, 8)}... to ${newCount}`);
                return updated;
              });

              // Send push notification for group message
              sendMessageNotification(
                message.sender,
                message.senderName || `${message.sender.slice(0, 8)}...`,
                message.content || 'New group message',
                message.groupId,
                'group',
                message.groupId
              );
            }
          }

          return updated;
        });
      }
    });

    newSocket.on('group_member_joined', ({ groupId, memberPubkey }) => {
      console.log('👥 Member joined group:', groupId, memberPubkey);
      // Reload groups to update member list
      // We'll trigger this in the individual screens that need it
    });

    newSocket.on('group_member_left', async ({ groupId, memberPubkey }) => {
      console.log('👋 Member left group:', groupId, memberPubkey);

      // Auto-rotate group key if we're the admin
      const currentGroups = groupsRef.current;
      const group = currentGroups.find(g => Buffer.from(g.groupId).toString('hex') === groupId);
      if (group && wallet?.publicKey && group.creator.equals(wallet.publicKey)) {
        console.log('🔄 Auto-rotating group key (admin) after member left...');
        // Trigger reload first to get updated member list, then rotation happens via kickMember-style logic
        // For leave events, we schedule rotation after a short delay to let the chain state settle
        setTimeout(async () => {
          try {
            const currentEncKeys = encryptionKeysRef.current;
            if (!currentEncKeys) return;

            const newGroupSecret = nacl.randomBytes(nacl.secretbox.keyLength);
            const session = sessionInfoRef.current || undefined;
            const groupIdBytes = Buffer.from(groupId, 'hex');

            // Update local key
            setGroupKeys(prev => {
              const updated = new Map(prev);
              updated.set(groupId, newGroupSecret);
              return updated;
            });

            // Store admin's own backup
            const adminNonce = nacl.randomBytes(nacl.box.nonceLength);
            const adminEncKey = nacl.box(newGroupSecret, adminNonce, currentEncKeys.publicKey, currentEncKeys.secretKey);
            const storeOwnIx = createStoreGroupKeyInstruction(wallet.publicKey!, groupIdBytes, adminEncKey, adminNonce, session);
            const sessionKp = sessionKeypairRef.current;
            if (session && sessionKp) {
              const tx = await buildTransaction(connection, sessionKp.publicKey, [storeOwnIx]);
              tx.sign([sessionKp]);
              const sig = await connection.sendRawTransaction(tx.serialize());
              await connection.confirmTransaction(sig, 'confirmed');
            } else {
              console.log('⏭️ No session key, skipping auto-rotation backup');
            }

            // Distribute to remaining members via socket
            const keyShares: Array<{ recipientPubkey: string; encryptedKey: string; nonce: string }> = [];
            const updatedGroups = groupsRef.current;
            const updatedGroup = updatedGroups.find(g => Buffer.from(g.groupId).toString('hex') === groupId);
            if (updatedGroup) {
              for (const member of updatedGroup.members) {
                if (member.equals(wallet.publicKey!)) continue;
                try {
                  let memberEncPubkey: Uint8Array | undefined = contactsRef.current.find(
                    c => c.publicKey.equals(member)
                  )?.encryptionPublicKey;
                  if (!memberEncPubkey) {
                    const profilePDA = getUserProfilePDA(member);
                    const profileAccount = await connection.getAccountInfo(profilePDA);
                    if (profileAccount) {
                      memberEncPubkey = parseEncryptionPubkey(profileAccount.data) ?? undefined;
                    }
                  }
                  if (memberEncPubkey) {
                    const mNonce = nacl.randomBytes(nacl.box.nonceLength);
                    const mEncKey = nacl.box(newGroupSecret, mNonce, memberEncPubkey, currentEncKeys.secretKey);
                    keyShares.push({
                      recipientPubkey: member.toBase58(),
                      encryptedKey: Buffer.from(mEncKey).toString('base64'),
                      nonce: Buffer.from(mNonce).toString('base64'),
                    });
                  }
                } catch (e) {
                  console.error(`Failed to encrypt rotated key for ${member.toBase58().slice(0, 8)}:`, e);
                }
              }
            }

            if (keyShares.length > 0) {
              newSocket.emit('group_key_rotated', { groupId, keyShares });
              console.log(`🔄 Auto-rotated group key after leave, distributed to ${keyShares.length} members`);
            }
          } catch (err) {
            console.error('⚠️ Auto-rotation after member leave failed:', err);
          }
        }, 3000);
      }
    });

    newSocket.on('group_member_kicked', ({ groupId, memberPubkey }) => {
      console.log('🚫 Member kicked from group:', groupId, memberPubkey);
    });

    // Contact invitation rejected notification
    newSocket.on('invitation_rejected', ({ rejectorPubkey, peerPubkey }) => {
      console.log('🚫 Invitation rejected by:', rejectorPubkey);
      // Reload contacts to update UI (will filter out Rejected contacts)
      loadContacts();
    });

    // Feature 5: Message acks and read receipts (Groups)
    newSocket.on('group_message_ack', ({ messageId, groupId, timestamp }) => {
      setGroupMessages((prev) => {
        const updated = new Map(prev);
        const groupMsgs = updated.get(groupId) || [];
        const updatedMessages = groupMsgs.map(m =>
          m.id === messageId || m.timestamp === timestamp ? { ...m, status: 'sent' } : m
        );
        updated.set(groupId, updatedMessages);
        return updated;
      });
    });

    newSocket.on('group_messages_read', ({ groupId, readerPubkey, latestTimestamp }) => {
      if (readerPubkey === wallet?.publicKey?.toBase58()) return; // Ignore own read receipts

      // Update read timestamps for persistence
      setReadTimestamps(prev => {
        const updated = new Map(prev);
        const existing = updated.get(groupId) || 0;
        if (latestTimestamp > existing) {
          updated.set(groupId, latestTimestamp);
        }
        return updated;
      });

      // Update in-memory message statuses
      setGroupMessages((prev) => {
        const updated = new Map(prev);
        const groupMsgs = updated.get(groupId) || [];
        const updatedMessages = groupMsgs.map(m => {
          if (m.sender === wallet?.publicKey?.toBase58() && new Date(m.timestamp).getTime() <= latestTimestamp) {
            return { ...m, status: 'read' };
          }
          return m;
        });
        updated.set(groupId, updatedMessages);
        return updated;
      });
    });

    newSocket.on('group_key_shared', async ({ groupId, senderPubkey, encryptedKey, nonce }) => {
      console.log('🔑 Received group key share from:', senderPubkey);

      // Use refs to avoid stale closure (Fix 2b)
      const currentEncryptionKeys = encryptionKeysRef.current;
      const currentContacts = contactsRef.current;

      if (currentEncryptionKeys) {
        try {
          // Try to find sender in contacts first
          let senderEncryptionPubkey = currentContacts.find(
            c => c.publicKey.toBase58() === senderPubkey
          )?.encryptionPublicKey;

          // If not found in contacts, fetch from on-chain (Fix 2c)
          if (!senderEncryptionPubkey) {
            console.log('⚠️ Sender not in contacts, fetching from on-chain...');
            try {
              const senderPubkeyObj = new PublicKey(senderPubkey);
              const senderProfilePDA = getUserProfilePDA(senderPubkeyObj);
              const senderAccountInfo = await connection.getAccountInfo(senderProfilePDA);

              if (senderAccountInfo) {
                const data = senderAccountInfo.data;
                let offset = 8 + 32; // Skip discriminator + owner
                const displayNameLength = data.readUInt32LE(offset);
                offset += 4 + displayNameLength;
                const avatarType = data.readUInt8(offset);
                offset += 1;
                const avatarUrlLength = data.readUInt32LE(offset);
                offset += 4 + avatarUrlLength;
                senderEncryptionPubkey = data.slice(offset, offset + 32);
                console.log('✅ Fetched sender encryption key from on-chain');
              }
            } catch (fetchError) {
              console.error('❌ Failed to fetch sender profile:', fetchError);
            }
          }

          if (senderEncryptionPubkey) {
            const encryptedBytes = Buffer.from(encryptedKey, 'base64');
            const nonceBytes = Buffer.from(nonce, 'base64');

            const decryptedKey = nacl.box.open(
              encryptedBytes,
              nonceBytes,
              senderEncryptionPubkey,
              currentEncryptionKeys.secretKey
            );

            if (decryptedKey) {
              setGroupKeys(prev => {
                const updated = new Map(prev);
                updated.set(groupId, decryptedKey);
                return updated;
              });
              console.log('✅ Group key decrypted and stored locally');

              // MANDATORY: Immediately backup to on-chain for recovery
              // This ensures the key survives even if socket delivery fails for future requests
              setTimeout(async () => {
                try {
                  // In-memory guard prevents duplicate concurrent backup attempts
                  if (backupInFlightRef.current.has(groupId)) {
                    console.log('⏭️ Group key backup already in progress, skipping');
                    return;
                  }
                  const backupKey = `groupKeyBackedUp_${wallet!.publicKey!.toBase58()}_${groupId}`;
                  const alreadyBackedUp = await AsyncStorage.getItem(backupKey);
                  if (alreadyBackedUp === 'true') {
                    console.log('⏭️ Group key already backed up on-chain, skipping');
                    return;
                  }
                  backupInFlightRef.current.add(groupId);

                  console.log('💾 Backing up group key on-chain (mandatory for recovery)...');

                  // Encrypt key with own pubkey for on-chain storage
                  const backupNonce = nacl.randomBytes(nacl.box.nonceLength);
                  const encryptedKeyForBackup = nacl.box(
                    decryptedKey,
                    backupNonce,
                    currentEncryptionKeys.publicKey,
                    currentEncryptionKeys.secretKey
                  );

                  // Create and send transaction
                  const groupIdBytes = Buffer.from(groupId, 'hex');
                  const session = sessionInfoRef.current || undefined;
                  const storeKeyIx = createStoreGroupKeyInstruction(
                    wallet!.publicKey!,
                    groupIdBytes,
                    encryptedKeyForBackup,
                    backupNonce,
                    session
                  );

                  // Use session key ref for auto-signing (avoids stale closure from socket handler)
                  const sessionKp = sessionKeypairRef.current;
                  const currentSession = sessionInfoRef.current;
                  if (currentSession && sessionKp) {
                    const tx = await buildTransaction(connection, sessionKp.publicKey, [storeKeyIx]);
                    tx.sign([sessionKp]);
                    const sig = await connection.sendRawTransaction(tx.serialize());
                    await connection.confirmTransaction(sig, 'confirmed');
                  } else {
                    // No session key available yet — skip to avoid wallet popup
                    // Key is already stored locally, on-chain backup will happen on next opportunity
                    console.log('⏭️ No session key yet, deferring on-chain backup');
                    return;
                  }

                  await AsyncStorage.setItem(backupKey, 'true');
                  console.log('✅ Group key backed up on-chain successfully');
                } catch (error) {
                  console.error('⚠️ Failed to backup group key on-chain:', error);
                  // Non-fatal - local key still works, but recovery won't be possible
                } finally {
                  backupInFlightRef.current.delete(groupId);
                }
              }, 2000); // 2s delay to avoid immediate wallet prompt after key share
            } else {
              console.error('❌ Failed to decrypt group key (decryption returned null)');
            }
          } else {
            console.error('❌ Could not find sender encryption public key');
          }
        } catch (error) {
          console.error('❌ Failed to decrypt group key:', error);
        }
      }
    });

    // Respond to group key requests from members who missed the initial share
    newSocket.on('group_key_needed', async ({ groupId, requesterPubkey }) => {
      console.log(`🔑 Group key requested by ${requesterPubkey.slice(0, 8)}... for ${groupId.slice(0, 8)}...`);

      const currentGroupKeys = groupKeysRef.current;
      const currentEncryptionKeys = encryptionKeysRef.current;
      const groupSecret = currentGroupKeys.get(groupId);

      if (!groupSecret || !currentEncryptionKeys) {
        console.log('⏭️ We don\'t have the key for this group, ignoring request');
        return;
      }

      try {
        // Get requester's encryption pubkey (from contacts or on-chain)
        const currentContacts = contactsRef.current;
        let requesterEncryptionPubkey = currentContacts.find(
          c => c.publicKey.toBase58() === requesterPubkey
        )?.encryptionPublicKey;

        if (!requesterEncryptionPubkey) {
          const requesterPubkeyObj = new PublicKey(requesterPubkey);
          const profilePDA = getUserProfilePDA(requesterPubkeyObj);
          const profileAccount = await connection.getAccountInfo(profilePDA);
          if (profileAccount) {
            requesterEncryptionPubkey = parseEncryptionPubkey(profileAccount.data) ?? undefined;
          }
        }

        if (requesterEncryptionPubkey) {
          const nonce = nacl.randomBytes(nacl.box.nonceLength);
          const encryptedKey = nacl.box(
            groupSecret,
            nonce,
            requesterEncryptionPubkey,
            currentEncryptionKeys.secretKey
          );

          newSocket.emit('share_group_key', {
            groupId,
            recipientPubkey: requesterPubkey,
            encryptedKey: Buffer.from(encryptedKey).toString('base64'),
            nonce: Buffer.from(nonce).toString('base64'),
          });
          console.log(`✅ Shared group key with ${requesterPubkey.slice(0, 8)}... (on-demand)`);
        }
      } catch (err) {
        console.error('Failed to share group key on demand:', err);
      }
    });

    // Group avatar handler (Fix 4)
    newSocket.on('group_avatar_updated', ({ groupId, avatar }) => {
      console.log(`🎨 Group avatar updated for ${groupId.slice(0, 8)}... to ${avatar}`);
      setGroupAvatars(prev => {
        const updated = new Map(prev);
        updated.set(groupId, avatar);
        return updated;
      });
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
      setConnectionStatus('disconnected');
    };
  }, [wallet?.publicKey, encryptionReady]);

  // Auto-join all group rooms on connect so we can respond to group_key_needed requests
  // This ensures members can share keys even when not actively viewing the chat
  useEffect(() => {
    if (!socket || !groups.length) return;

    // Join all group rooms the user is a member of
    for (const group of groups) {
      const groupIdHex = Buffer.from(group.groupId).toString('hex');
      socket.emit('join_group_room', { groupId: groupIdHex });
    }
    console.log(`🏠 Auto-joined ${groups.length} group room(s) for key sharing`);

    // Cleanup: leave rooms on unmount (socket disconnect handles this anyway)
    return () => {
      for (const group of groups) {
        const groupIdHex = Buffer.from(group.groupId).toString('hex');
        socket.emit('leave_group_room', { groupId: groupIdHex });
      }
    };
  }, [socket, groups]);

  // Register function — bundles register + session key creation + funding in ONE tx
  const register = async (displayName: string, avatarData: string = '') => {
    if (!wallet?.publicKey || !wallet.signTransaction || !wallet.signMessage) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const userProfile = getUserProfilePDA(wallet.publicKey);
      const accountInfo = await connection.getAccountInfo(userProfile);

      if (accountInfo) {
        console.log('User already registered');
        return null;
      }

      if (!encryptionKeys) {
        throw new Error('Encryption keys not available - please reconnect wallet');
      }
      console.log('Using existing encryption keys for registration');

      // Generate session keypair upfront so we can bundle everything
      const newSessionKeypair = Keypair.generate();
      const validUntil = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // 7 days
      const SESSION_FUND_LAMPORTS = Math.floor(0.05 * LAMPORTS_PER_SOL);

      console.log('Creating register + session instructions for:', displayName);
      const registerIx = createRegisterInstruction(
        wallet.publicKey,
        displayName,
        avatarData,
        encryptionKeys.publicKey
      );
      const createSessionIx = createCreateSessionInstruction(
        wallet.publicKey,
        newSessionKeypair.publicKey,
        validUntil
      );
      const fundSessionIx = SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: newSessionKeypair.publicKey,
        lamports: SESSION_FUND_LAMPORTS,
      });

      // ONE transaction, ONE wallet popup: register + create session + fund session
      console.log('Building transaction (register + session + fund)...');
      const transaction = await buildTransaction(connection, wallet.publicKey, [registerIx, createSessionIx, fundSessionIx]);

      console.log('Signing transaction with wallet...');
      const signedTransaction = await wallet.signTransaction(transaction);

      console.log('Sending transaction...');
      const txSignature = await connection.sendTransaction(signedTransaction);
      console.log('Transaction sent, signature:', txSignature);

      console.log('Confirming transaction...');
      await connection.confirmTransaction(txSignature, 'confirmed');
      console.log('Transaction confirmed!');

      // Store session keypair in AsyncStorage
      const storageKey = `@mukon_session_keypair_${wallet.publicKey.toBase58()}`;
      await AsyncStorage.setItem(storageKey, JSON.stringify({
        secretKey: Buffer.from(newSessionKeypair.secretKey).toString('base64'),
        validUntil,
      }));

      // Set session state so the useEffect skips creating another one
      setSessionKeypair(newSessionKeypair);
      const sessionTokenPDA = getSessionTokenPDA(newSessionKeypair.publicKey);
      sessionInfoRef.current = {
        sessionKey: newSessionKeypair.publicKey,
        walletPubkey: wallet.publicKey,
        sessionTokenPDA,
      };

      console.log(`✅ Registered + session key created + funded with ${SESSION_FUND_LAMPORTS / LAMPORTS_PER_SOL} SOL`);

      setProfile({ displayName, publicKey: wallet.publicKey });
      setEncryptionReady(true);
      return txSignature;
    } catch (error) {
      console.error('Failed to register:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Other functions (updateProfile, invite, etc.)
  const updateProfile = async (displayName: string, avatarType?: 'Emoji' | 'Nft', avatarData?: string) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      const instruction = createUpdateProfileInstruction(
        wallet.publicKey,
        displayName,
        avatarType || null,
        avatarData || null,
        encryptionKeys ? Array.from(encryptionKeys.publicKey) : null,
        session
      );
      const txSignature = await signAndSendTransaction([instruction]);

      // Reload profile to reflect changes
      await loadProfile();
      return txSignature;
    } catch (error) {
      console.error('Failed to update profile:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const closeProfile = async () => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      const instruction = createCloseProfileInstruction(wallet.publicKey, session);
      const txSignature = await signAndSendTransaction([instruction]);

      // Clear local state
      setProfile(null);
      setContacts([]);
      setMessages(new Map());
      setEncryptionReady(false);

      console.log('✅ Profile closed, account rent returned');
      return txSignature;
    } catch (error) {
      console.error('Failed to close profile:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const invite = async (inviteePubkey: PublicKey) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      // Calculate chat hash for the conversation PDA
      const chatHash = getChatHash(wallet.publicKey, inviteePubkey);
      const instruction = createInviteInstruction(wallet.publicKey, inviteePubkey, chatHash, session);
      const txSignature = await signAndSendTransaction([instruction]);

      await loadContacts();

      // Send system message for invitation
      if (socket) {
        const conversationId = Buffer.from(chatHash).toString('hex');
        const inviteMessage = {
          conversationId,
          sender: wallet.publicKey.toBase58(),
          recipient: inviteePubkey.toBase58(),
          type: 'system',
          content: `You've been invited to chat on Mukon! Accept the invitation to start messaging.`,
          timestamp: Date.now(),
        };

        socket.emit('send_message', inviteMessage);
        console.log('📨 Sent invitation system message');
      }

      return txSignature;
    } catch (error) {
      console.error('Failed to invite:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const acceptInvitation = async (inviterPubkey: PublicKey) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      const instruction = createAcceptInvitationInstruction(wallet.publicKey, inviterPubkey, session);
      const txSignature = await signAndSendTransaction([instruction]);

      await loadContacts();

      // Send system message for acceptance
      if (socket) {
        const chatHash = getChatHash(wallet.publicKey, inviterPubkey);
        const conversationId = Buffer.from(chatHash).toString('hex');
        const acceptMessage = {
          conversationId,
          sender: wallet.publicKey.toBase58(),
          recipient: inviterPubkey.toBase58(),
          type: 'system',
          content: `Invitation accepted! You can now chat securely.`,
          timestamp: Date.now(),
        };

        socket.emit('send_message', acceptMessage);
        console.log('📨 Sent acceptance system message');
      }

      return txSignature;
    } catch (error) {
      console.error('Failed to accept invitation:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const rejectInvitation = async (inviterPubkey: PublicKey) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      const instruction = createRejectInvitationInstruction(wallet.publicKey, inviterPubkey, session);
      const txSignature = await signAndSendTransaction([instruction]);

      // Notify the other user that invitation was rejected
      if (socket) {
        socket.emit('invitation_rejected', {
          rejectorPubkey: wallet.publicKey.toBase58(),
          peerPubkey: inviterPubkey.toBase58(),
        });
      }

      await loadContacts();
      return txSignature;
    } catch (error) {
      console.error('Failed to reject invitation:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const deleteContact = async (contactPubkey: PublicKey) => {
    return rejectInvitation(contactPubkey);
  };

  const blockContact = async (contactPubkey: PublicKey) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      const instruction = createBlockInstruction(wallet.publicKey, contactPubkey, session);
      const txSignature = await signAndSendTransaction([instruction]);

      await loadContacts();
      return txSignature;
    } catch (error) {
      console.error('Failed to block contact:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const unblockContact = async (contactPubkey: PublicKey) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      const instruction = createUnblockInstruction(wallet.publicKey, contactPubkey, session);
      const txSignature = await signAndSendTransaction([instruction]);

      await loadContacts();
      return txSignature;
    } catch (error) {
      console.error('Failed to unblock contact:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const closeRelationship = async (contactPubkey: PublicKey) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      const instruction = createCloseRelationshipInstruction(wallet.publicKey, contactPubkey, session);
      const txSignature = await signAndSendTransaction([instruction]);

      await loadContacts();
      console.log('✅ Relationship closed:', contactPubkey.toBase58().slice(0, 8));
      return txSignature;
    } catch (error) {
      console.error('Failed to close relationship:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (conversationId: string, content: string, recipientPubkey: PublicKey, replyToMessageId?: string) => {
    if (!wallet?.publicKey || !socket) throw new Error('Not ready');
    if (!encryptionKeys) throw new Error('Encryption keys not available');

    try {
      const recipient = contacts.find(c => c.publicKey.equals(recipientPubkey));
      if (!recipient?.encryptionPublicKey) {
        throw new Error('Recipient encryption key not found');
      }

      console.log('🔒 Encrypting message with NaCl box...');

      const nonce = nacl.randomBytes(nacl.box.nonceLength);
      const messageBytes = new TextEncoder().encode(content);

      const encrypted = nacl.box(
        messageBytes,
        nonce,
        recipient.encryptionPublicKey,
        encryptionKeys.secretKey
      );

      const timestamp = Date.now();
      const encryptedBase64 = Buffer.from(encrypted).toString('base64');
      const nonceBase64 = Buffer.from(nonce).toString('base64');

      socket.emit('send_message', {
        conversationId,
        encrypted: encryptedBase64,
        nonce: nonceBase64,
        sender: wallet.publicKey.toBase58(),
        timestamp,
        replyTo: replyToMessageId, // Reply reference
      });

      console.log('✅ Encrypted message sent via socket');

      // Optimistic update + persist locally
      const optimisticMsg = {
        id: `temp-${timestamp}`,
        conversationId,
        sender: wallet.publicKey!.toBase58(),
        content,
        encrypted: encryptedBase64,
        nonce: nonceBase64,
        timestamp,
        status: 'sending',
      };

      setMessages((prev) => {
        const updated = new Map(prev);
        const conversationMessages = updated.get(conversationId) || [];
        const newMessages = [...conversationMessages, optimisticMsg];
        updated.set(conversationId, newMessages);

        // Persist locally
        saveLocalMessages(wallet.publicKey!.toBase58(), conversationId, newMessages);

        return updated;
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      throw error;
    }
  };

  const deleteMessage = (conversationId: string, messageId: string, deleteForBoth: boolean) => {
    if (!socket) {
      console.error('Socket not connected');
      return;
    }

    if (deleteForBoth) {
      // Delete for everyone - emit to backend
      socket.emit('delete_message', { conversationId, messageId, deleteForBoth: true });
      console.log('🗑️ Deleting message for everyone:', messageId);
    } else {
      // Delete for self only - remove from local state
      setMessages((prev) => {
        const updated = new Map(prev);
        const conversationMessages = updated.get(conversationId) || [];
        updated.set(conversationId, conversationMessages.filter(m => m.id !== messageId));
        return updated;
      });
      console.log('🗑️ Deleted message locally:', messageId);
    }
  };

  const joinConversation = (conversationId: string) => {
    if (socket && wallet?.publicKey) {
      socket.emit('join_conversation', { conversationId });
      setActiveConversation(conversationId);
      setUnreadCounts((prev) => {
        const updated = new Map(prev);
        updated.delete(conversationId);
        return updated;
      });

      // Emit read receipts for latest message (Feature 5)
      const msgs = messages.get(conversationId) || [];
      if (msgs.length > 0) {
        const latestMessage = msgs[msgs.length - 1];
        socket.emit('messages_read', {
          conversationId,
          readerPubkey: wallet.publicKey.toBase58(),
          latestTimestamp: latestMessage.timestamp,
        });
        console.log(`📖 Emitted read receipt for conversation ${conversationId.slice(0, 8)}...`);
      }

      console.log('Joining conversation:', conversationId);
    }
  };

  const leaveConversation = (conversationId: string) => {
    if (socket) {
      socket.emit('leave_conversation', { conversationId });
      setActiveConversation(null);
      console.log('Leaving conversation:', conversationId);
    }
  };

  const decryptConversationMessage = (
    encrypted: string,
    nonce: string,
    senderPubkey: PublicKey,
    recipientPubkey: PublicKey
  ): string | null => {
    if (!wallet?.publicKey || !encryptionKeys) return null;

    try {
      const otherPersonPubkey = senderPubkey.equals(wallet.publicKey)
        ? recipientPubkey
        : senderPubkey;

      const otherPerson = contacts.find(c => c.publicKey.equals(otherPersonPubkey));
      if (!otherPerson?.encryptionPublicKey) {
        console.error('Conversation partner encryption key not found in contacts');
        return '[Encryption key not found]';
      }

      const encryptedBytes = Buffer.from(encrypted, 'base64');
      const nonceBytes = Buffer.from(nonce, 'base64');

      const decrypted = nacl.box.open(
        encryptedBytes,
        nonceBytes,
        otherPerson.encryptionPublicKey,
        encryptionKeys.secretKey
      );

      if (!decrypted) {
        console.error('Failed to decrypt message');
        return '[Unable to decrypt]';
      }

      return new TextDecoder().decode(decrypted);
    } catch (error) {
      console.error('Decryption error:', error);
      return '[Decryption failed]';
    }
  };

  const loadConversationMessages = async (conversationId: string) => {
    if (!wallet?.publicKey) return;
    const walletAddress = wallet.publicKey.toBase58();

    // Step 1: Load from local cache immediately (instant, works offline)
    const localMessages = await loadLocalMessages(walletAddress, conversationId);
    if (localMessages.length > 0) {
      console.log(`📱 Loaded ${localMessages.length} messages from local cache`);
      setMessages((prev) => {
        const updated = new Map(prev);
        updated.set(conversationId, localMessages);
        return updated;
      });
    }

    // Step 2: Fetch from backend to get any messages received while offline
    try {
      const encryptionSig = (window as any).__mukonEncryptionSignature;
      if (!encryptionSig) {
        console.error('No encryption signature available');
        return;
      }

      const signatureB58 = bs58.encode(encryptionSig);
      const url = `${BACKEND_URL}/messages/${conversationId}?sender=${walletAddress}&signature=${encodeURIComponent(signatureB58)}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to load messages: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`📜 Loaded ${data.messages.length} messages from backend`);

      // Parse persisted read timestamps
      const persistedReadTimestamps = new Map<string, number>();
      if (data.readTimestamps && Array.isArray(data.readTimestamps)) {
        data.readTimestamps.forEach((entry: { pubkey: string; timestamp: number }) => {
          persistedReadTimestamps.set(entry.pubkey, entry.timestamp);
        });
      }

      // Step 3: Merge local + backend, deduplicate (ID + encrypted+nonce+sender)
      setMessages((prev) => {
        const updated = new Map(prev);
        const currentMessages = updated.get(conversationId) || [];

        // Multi-field dedup: matches by ID or by encrypted content (handles temp-ID vs real-ID)
        const isDuplicate = (existing: any[], msg: any) =>
          existing.some((m: any) =>
            m.id === msg.id ||
            (m.encrypted && msg.encrypted &&
             m.encrypted === msg.encrypted &&
             m.nonce === msg.nonce &&
             m.sender === msg.sender)
          );

        // Filter out backend messages already in local cache, and replace temp messages with real ones
        const newFromBackend: any[] = [];
        for (const backendMsg of data.messages) {
          const tempMatch = currentMessages.findIndex((m: any) =>
            m.id !== backendMsg.id &&
            m.encrypted && backendMsg.encrypted &&
            m.encrypted === backendMsg.encrypted &&
            m.nonce === backendMsg.nonce &&
            m.sender === backendMsg.sender
          );
          if (tempMatch >= 0) {
            // Replace temp message with real backend message (preserves real ID)
            currentMessages[tempMatch] = { ...backendMsg, status: currentMessages[tempMatch].status };
          } else if (!isDuplicate(currentMessages, backendMsg)) {
            newFromBackend.push(backendMsg);
          }
        }

        // Apply read status based on persisted timestamps
        const applyReadStatus = (msg: any) => {
          if (msg.sender === walletAddress) {
            const otherPersonTimestamp = Array.from(persistedReadTimestamps.entries())
              .find(([pubkey]) => pubkey !== walletAddress)?.[1];
            if (otherPersonTimestamp && msg.timestamp <= otherPersonTimestamp) {
              return { ...msg, status: 'read' };
            }
            return { ...msg, status: msg.status || 'sent' };
          }
          return msg;
        };

        const merged = [...currentMessages.map(applyReadStatus), ...newFromBackend.map(applyReadStatus)]
          .sort((a, b) => a.timestamp - b.timestamp);

        updated.set(conversationId, merged);

        // Persist merged result back to local storage
        saveLocalMessages(walletAddress, conversationId, merged);

        return updated;
      });
    } catch (error) {
      console.error('Failed to load conversation messages from backend:', error);
      // Graceful offline: local cache is already shown
    }
  };

  // Debounce loadContacts to avoid 403 rate-limits on getProgramAccounts
  const loadContactsLastCall = useRef<number>(0);
  const loadContactsPending = useRef<boolean>(false);

  const loadContacts = async () => {
    if (!wallet?.publicKey) return;

    // Debounce: skip if called within last 3 seconds
    const now = Date.now();
    if (now - loadContactsLastCall.current < 3000) {
      if (!loadContactsPending.current) {
        loadContactsPending.current = true;
        setTimeout(() => {
          loadContactsPending.current = false;
          loadContacts();
        }, 3000);
      }
      return;
    }
    loadContactsLastCall.current = now;

    try {
      const myKey = wallet.publicKey;

      // Sequential to avoid double-hitting RPC rate limits
      const asA = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          { dataSize: 82 },
          { memcmp: { offset: 8, bytes: myKey.toBase58() } },
        ],
      });
      const asB = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          { dataSize: 82 },
          { memcmp: { offset: 40, bytes: myKey.toBase58() } },
        ],
      });

      const allRelationships = [...asA, ...asB];
      console.log('Found', allRelationships.length, 'relationships');

      const contactsWithKeys = await Promise.all(
        allRelationships.map(async ({ account }) => {
          const rel = deserializeRelationship(account.data);
          const contact = getContactFromRelationship(rel, myKey);
          if (!contact) return null;

          const peerProfilePDA = getUserProfilePDA(contact.peerPubkey);
          const peerAccountInfo = await connection.getAccountInfo(peerProfilePDA);

          let displayName: string | undefined;
          let avatarUrl: string | undefined;
          let encryptionPublicKey: Uint8Array | undefined;

          if (peerAccountInfo) {
            const data = peerAccountInfo.data;
            let offset = 8 + 32;
            const displayNameLength = data.readUInt32LE(offset);
            offset += 4;
            displayName = data.slice(offset, offset + displayNameLength).toString('utf-8');
            offset += displayNameLength;
            const avatarType = data.readUInt8(offset);
            offset += 1;
            const avatarUrlLength = data.readUInt32LE(offset);
            offset += 4;
            avatarUrl = data.slice(offset, offset + avatarUrlLength).toString('utf-8');
            offset += avatarUrlLength;
            encryptionPublicKey = data.slice(offset, offset + 32);

            if (contact.myStatus === 'Accepted') {
              console.log(
                `Loaded encryption key for ${contact.peerPubkey.toBase58().slice(0, 8)}...: ${Buffer.from(encryptionPublicKey).toString('hex').slice(0, 16)}...`
              );
            }
          }

          return {
            publicKey: contact.peerPubkey,
            displayName,
            avatarUrl,
            encryptionPublicKey,
            state: contact.myStatus,
          };
        })
      );

      const validContacts = contactsWithKeys.filter((c): c is NonNullable<typeof c> => c !== null);
      console.log('Loaded peers with encryption keys:', validContacts.filter(c => c.encryptionPublicKey).length);
      setContacts(validContacts);
    } catch (error) {
      console.error('Failed to load contacts:', error);
    }
  };

  const loadProfile = async () => {
    if (!wallet?.publicKey) return;

    try {
      const userProfile = getUserProfilePDA(wallet.publicKey);
      const accountInfo = await connection.getAccountInfo(userProfile);

      if (!accountInfo) {
        console.log('No profile found, user needs to register');
        setProfile(null);
        return;
      }

      if (!encryptionKeys) {
        console.warn('⚠️ Encryption keys not yet available, will retry when ready');
        setProfile(null);
        return;
      }

      const data = accountInfo.data;
      let offset = 8;

      offset += 32;

      const displayNameLength = data.readUInt32LE(offset);
      offset += 4;
      const displayNameBytes = data.slice(offset, offset + displayNameLength);
      const displayName = Buffer.from(displayNameBytes).toString('utf8');
      offset += displayNameLength;

      // Read avatar_type (1 byte enum) - CRITICAL FIX
      const avatarType = data.readUInt8(offset);
      offset += 1;

      const avatarUrlLength = data.readUInt32LE(offset);
      offset += 4;
      const avatarUrlBytes = data.slice(offset, offset + avatarUrlLength);
      const avatarUrl = avatarUrlLength > 0 ? Buffer.from(avatarUrlBytes).toString('utf8') : null;
      offset += avatarUrlLength;

      const encryptionPublicKeyBytes = data.slice(offset, offset + 32);
      const encryptionPublicKey = Buffer.from(encryptionPublicKeyBytes).toString('hex');

      console.log('Profile loaded:', { displayName, avatarUrl, encryptionPublicKey });

      const profileData = {
        displayName,
        avatarUrl: avatarUrl || null,
        publicKey: wallet.publicKey,
        encryptionPublicKey,
      };

      setProfile(profileData);

      // Cache profile to prevent showing register screen on app restart
      try {
        await AsyncStorage.setItem(
          `@mukon_profile_${wallet.publicKey.toBase58()}`,
          JSON.stringify({
            displayName,
            avatarUrl: avatarUrl || null,
            encryptionPublicKey,
          })
        );
      } catch (cacheError) {
        console.warn('Failed to cache profile:', cacheError);
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
      setProfile(null);
    }
  };

  // ========== ARCIUM MPC METHODS ==========

  /**
   * Verify contact privately using Arcium MPC
   * Returns true if contact is accepted, false if not, null on error
   * ARCIUM TEMPORARILY DISABLED - Re-enable after core demo
   */
  const verifyContactPrivately = async (queryPubkey: string): Promise<boolean | null> => {
    console.log('Arcium MPC verification temporarily disabled');
    return null;
    /*
    if (!wallet?.publicKey || !wallet.signTransaction) {
      console.error('Wallet not connected');
      return null;
    }

    try {
      console.log('🔒 Starting private contact verification via Arcium MPC...');

      // 1. Get MXE public key for encryption
      const mxePubKey = await getMXEPubKey(connection);
      console.log('✅ Got MXE public key:', Buffer.from(mxePubKey).toString('hex').slice(0, 16) + '...');

      // 2. Load contact list from on-chain WalletDescriptor
      const descriptorPDA = getWalletDescriptorPDA(wallet.publicKey);
      const accountInfo = await connection.getAccountInfo(descriptorPDA);

      if (!accountInfo) {
        console.log('No contacts found');
        return false;
      }

      const descriptor = deserializeWalletDescriptor(accountInfo.data);
      const contactEntries: ContactEntry[] = descriptor.peers.map(peer => ({
        pubkey: peer.pubkey.toBytes(),
        status: peer.status === 'Invited' ? 0 :
                peer.status === 'Requested' ? 1 :
                peer.status === 'Accepted' ? 2 :
                peer.status === 'Rejected' ? 3 : 4, // Blocked
      }));

      console.log(`📋 Encrypting ${contactEntries.length} contacts for MPC verification...`);

      // 3. Encrypt contact list
      const encryptedList = await encryptContactList(contactEntries, mxePubKey);

      // 4. Encrypt query pubkey
      const queryPubkeyBytes = new PublicKey(queryPubkey).toBytes();
      const encryptedQuery = await encryptQueryPubkey(queryPubkeyBytes, mxePubKey);

      // 5. Generate unique computation offset
      const computationOffset = Date.now();

      // 6. Build and send queue_computation transaction
      console.log('📤 Queueing MPC computation...');
      const instruction = createCheckIsContactInstruction(
        wallet.publicKey,
        computationOffset,
        encryptedList.ciphertext,
        encryptedQuery.ciphertext,
        encryptedList.publicKey,
        BigInt(new DataView(encryptedList.nonce.buffer).getBigUint64(0, true)),
        BigInt(new DataView(encryptedQuery.nonce.buffer).getBigUint64(0, true))
      );

      const transaction = await buildTransaction(connection, wallet.publicKey, [instruction]);
      const signedTx = await wallet.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTx.serialize());
      await connection.confirmTransaction(signature, 'confirmed');

      console.log('✅ MPC computation queued:', signature);

      // 7. Wait for computation to finalize
      console.log('⏳ Waiting for MPC nodes to compute result...');
      await waitForComputation(connection, computationOffset, 60000); // 60s timeout

      console.log('✅ MPC computation completed');

      // 8. Result decryption
      // NOTE: In production, you'd listen for ContactCheckResult event
      // and decrypt the result using the cipher from encryptedList/encryptedQuery
      // For now, we'll return null to indicate success but no result parsed
      console.log('⚠️ Result parsing not implemented yet - listen for ContactCheckResult event');

      return null;
    } catch (error) {
      console.error('❌ Private contact verification failed:', error);
      return null;
    }
    */
  };

  // Load profile and contacts when encryption keys are available
  useEffect(() => {
    if (wallet?.publicKey && encryptionReady) {
      loadProfile();
      loadContacts();
      loadGroups();
      loadGroupInvites();
    }
  }, [wallet?.publicKey, encryptionReady]);

  // Fix 5b: Fetch group avatars AFTER groups load AND socket connects
  useEffect(() => {
    if (!socket || groups.length === 0) return;

    console.log(`🎨 Fetching avatars for ${groups.length} groups...`);
    for (const group of groups) {
      const groupIdHex = Buffer.from(group.groupId).toString('hex');
      socket.emit('get_group_avatar', { groupId: groupIdHex }, (avatar: string | null) => {
        if (avatar) {
          setGroupAvatars(prev => {
            const updated = new Map(prev);
            updated.set(groupIdHex, avatar);
            return updated;
          });
          console.log(`✅ Fetched avatar for group ${groupIdHex.slice(0, 8)}...: ${avatar}`);
        }
      });
    }
  }, [socket, groups.length]);

  // ========== GROUP METHODS ==========

  const createGroup = async (name: string, tokenGate?: TokenGate) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');
    if (!encryptionKeys) throw new Error('Encryption keys not available');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      // Generate random group ID
      const groupId = nacl.randomBytes(32);

      // Generate random symmetric key for group
      const groupSecret = nacl.randomBytes(nacl.secretbox.keyLength);

      // Store group key locally
      const groupIdHex = Buffer.from(groupId).toString('hex');
      setGroupKeys(prev => {
        const updated = new Map(prev);
        updated.set(groupIdHex, groupSecret);
        return updated;
      });

      const instruction = createCreateGroupInstruction(
        wallet.publicKey,
        groupId,
        name,
        encryptionKeys.publicKey, // For key distribution
        tokenGate || null,
        session
      );

      const txSignature = await signAndSendTransaction([instruction]);

      await loadGroups();

      console.log('✅ Group created:', groupIdHex);
      return { groupId, txSignature };
    } catch (error) {
      console.error('Failed to create group:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const createGroupWithMembers = async (
    name: string,
    invitees: PublicKey[],
    tokenGate?: TokenGate
  ) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');
    if (!encryptionKeys) throw new Error('Encryption keys not available');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      // Generate random group ID
      const groupId = nacl.randomBytes(32);

      // Generate random symmetric key for group
      const groupSecret = nacl.randomBytes(nacl.secretbox.keyLength);

      // Store group key locally
      const groupIdHex = Buffer.from(groupId).toString('hex');
      setGroupKeys(prev => {
        const updated = new Map(prev);
        updated.set(groupIdHex, groupSecret);
        return updated;
      });

      // Prepare admin's encrypted key for on-chain storage (moved up to combine into one tx)
      const adminNonce = nacl.randomBytes(nacl.box.nonceLength);
      const adminEncryptedKey = nacl.box(
        groupSecret,
        adminNonce,
        encryptionKeys.publicKey,
        encryptionKeys.secretKey
      );

      // Build array of instructions: create + invites + store key (combined into ONE transaction)
      // Use ZK Compression for key storage and invites when enabled (90% storage cost reduction)
      const inviteInstructions = await Promise.all(
        invitees.map(invitee =>
          USE_ZK_COMPRESSION
            ? createInviteToGroupCompressedInstruction(wallet.publicKey, groupId, invitee)
            : Promise.resolve(createInviteToGroupInstruction(wallet.publicKey, groupId, invitee, session))
        )
      );

      // Use compressed for CREATE operation (works on devnet)
      // store_compressed_group_key uses LightAccount::new_init() - creates new account only
      const storeKeyInstruction = USE_ZK_COMPRESSION
        ? await createStoreCompressedGroupKeyInstruction(
            wallet.publicKey,
            groupId,
            adminEncryptedKey,
            adminNonce
          )
        : createStoreGroupKeyInstruction(
            wallet.publicKey,
            groupId,
            adminEncryptedKey,
            adminNonce,
            session
          );

      const instructions = [
        createCreateGroupInstruction(
          wallet.publicKey,
          groupId,
          name,
          encryptionKeys.publicKey,
          tokenGate || null,
          session
        ),
        ...inviteInstructions,
        storeKeyInstruction
      ];

      // Single transaction with all instructions
      const txSignature = await signAndSendTransaction(instructions);

      await loadGroups();

      console.log(`✅ Group created with ${invitees.length} invites (single signature):`, groupIdHex);
      console.log(`💾 Admin's encrypted group key stored on-chain`);

      // Mark as backed up so GroupChatScreen doesn't re-store
      const backupKey = `groupKeyBackedUp_${wallet.publicKey.toBase58()}_${groupIdHex}`;
      await AsyncStorage.setItem(backupKey, 'true');

      // Store encrypted key + nonce for later compressed account closure
      if (USE_ZK_COMPRESSION) {
        const keyDataKey = `groupKeyData_${wallet.publicKey.toBase58()}_${groupIdHex}`;
        await AsyncStorage.setItem(keyDataKey, JSON.stringify({
          encryptedKey: Array.from(adminEncryptedKey),
          nonce: Array.from(adminNonce)
        }));
      }

      // Share group key with all invitees via Socket.IO
      if (socket && encryptionKeys) {
        for (const inviteePubkey of invitees) {
          try {
            // Try to find invitee in contacts first
            let inviteeEncryptionPubkey: Uint8Array | undefined = contacts.find(c =>
              c.publicKey.equals(inviteePubkey)
            )?.encryptionPublicKey;

            // If not in contacts, fetch from on-chain
            if (!inviteeEncryptionPubkey) {
              console.log(`Fetching encryption pubkey from on-chain for ${inviteePubkey.toBase58().slice(0, 8)}...`);
              const profilePDA = getUserProfilePDA(inviteePubkey);
              const profileAccount = await connection.getAccountInfo(profilePDA);

              if (profileAccount) {
                inviteeEncryptionPubkey = parseEncryptionPubkey(profileAccount.data) ?? undefined;
              }
            }

            if (inviteeEncryptionPubkey) {
              // Encrypt group key with invitee's public key
              const nonce = nacl.randomBytes(nacl.box.nonceLength);
              const encryptedKey = nacl.box(
                groupSecret,
                nonce,
                inviteeEncryptionPubkey,
                encryptionKeys.secretKey
              );

              socket.emit('share_group_key', {
                groupId: groupIdHex,
                recipientPubkey: inviteePubkey.toBase58(),
                encryptedKey: Buffer.from(encryptedKey).toString('base64'),
                nonce: Buffer.from(nonce).toString('base64'),
              });

              console.log(`🔑 Shared group key with ${inviteePubkey.toBase58().slice(0, 8)}...`);

              // Store invitee's encrypted key share on-chain for recovery
              try {
                const storeForMemberIx = createStoreGroupKeyForMemberInstruction(
                  wallet.publicKey!,
                  groupId,
                  inviteePubkey,
                  encryptedKey,
                  nonce,
                  session
                );
                await signAndSendTransaction([storeForMemberIx]);
                console.log(`💾 Stored on-chain key share for ${inviteePubkey.toBase58().slice(0, 8)}...`);
              } catch (err) {
                console.error(`Failed to store invitee group key on-chain:`, err);
                // Non-fatal — invitee still has key via Socket.IO
              }
            } else {
              console.warn(`⚠️ Could not find encryption pubkey for ${inviteePubkey.toBase58().slice(0, 8)}...`);
            }
          } catch (err) {
            console.error(`Failed to share group key with ${inviteePubkey.toBase58().slice(0, 8)}:`, err);
          }
        }
      }

      return { groupId, txSignature };
    } catch (error) {
      console.error('Failed to create group with members:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateGroup = async (groupId: Uint8Array, name?: string, tokenGate?: TokenGate) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      const instruction = createUpdateGroupInstruction(
        wallet.publicKey,
        groupId,
        name || null,
        tokenGate || null,
        session
      );

      const txSignature = await signAndSendTransaction([instruction]);

      await loadGroups();
      return txSignature;
    } catch (error) {
      console.error('Failed to update group:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const inviteToGroup = async (groupId: Uint8Array, inviteePubkey: PublicKey) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');
    if (!encryptionKeys) throw new Error('Encryption keys not available');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      // ALWAYS use regular PDA version (not compressed)
      // Compressed operations fail on devnet with unknown account errors
      const instruction = createInviteToGroupInstruction(wallet.publicKey, groupId, inviteePubkey, session);
      const txSignature = await signAndSendTransaction([instruction]);

      // Share group key with invitee via Socket.IO (Fix 2d: use ref to avoid stale closure)
      const groupIdHex = Buffer.from(groupId).toString('hex');
      const groupSecret = groupKeysRef.current.get(groupIdHex);

      if (groupSecret && socket) {
        // Try to find invitee in contacts first
        let inviteeEncryptionPubkey: Uint8Array | undefined = contacts.find(c =>
          c.publicKey.equals(inviteePubkey)
        )?.encryptionPublicKey;

        // If not in contacts, fetch from on-chain
        if (!inviteeEncryptionPubkey) {
          console.log(`Fetching encryption pubkey from on-chain for ${inviteePubkey.toBase58().slice(0, 8)}...`);
          const profilePDA = getUserProfilePDA(inviteePubkey);
          const profileAccount = await connection.getAccountInfo(profilePDA);

          if (profileAccount) {
            inviteeEncryptionPubkey = parseEncryptionPubkey(profileAccount.data) ?? undefined;
          }
        }

        if (inviteeEncryptionPubkey) {
          // Encrypt group key with invitee's public key
          const nonce = nacl.randomBytes(nacl.box.nonceLength);
          const encryptedKey = nacl.box(
            groupSecret,
            nonce,
            inviteeEncryptionPubkey,
            encryptionKeys.secretKey
          );

          socket.emit('share_group_key', {
            groupId: groupIdHex,
            recipientPubkey: inviteePubkey.toBase58(),
            encryptedKey: Buffer.from(encryptedKey).toString('base64'),
            nonce: Buffer.from(nonce).toString('base64'),
          });

          console.log('🔑 Shared group key with invitee via Socket.IO');

          // Store invitee's encrypted key share on-chain for offline recovery
          try {
            const storeForMemberIx = createStoreGroupKeyForMemberInstruction(
              wallet.publicKey,
              groupId,
              inviteePubkey,
              encryptedKey,
              nonce,
              session
            );
            await signAndSendTransaction([storeForMemberIx]);
            console.log(`💾 Stored on-chain key share for ${inviteePubkey.toBase58().slice(0, 8)}...`);
          } catch (err) {
            console.error(`Failed to store on-chain key for invitee:`, err);
            // Non-fatal — invitee still has key via Socket.IO
          }
        } else {
          console.warn(`⚠️ Could not find encryption pubkey for ${inviteePubkey.toBase58().slice(0, 8)}...`);
        }
      }

      return txSignature;
    } catch (error) {
      console.error('Failed to invite to group:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const acceptGroupInvite = async (groupId: Uint8Array, userTokenAccount?: PublicKey) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;

      // Check if already accepted (prevents "NotInvited" error on double-tap / race condition)
      const groupInvitePDA = getGroupInvitePDA(groupId, wallet.publicKey);
      const inviteAccount = await connection.getAccountInfo(groupInvitePDA);
      if (inviteAccount) {
        const invite = deserializeGroupInvite(inviteAccount.data);
        if (invite.status === 'Accepted') {
          console.log('⏭️ Group invite already accepted, skipping on-chain tx');
          await loadGroups();
          await loadGroupInvites();
          // Still fetch key below
          const groupIdHex = Buffer.from(groupId).toString('hex');
          if (encryptionKeys && !groupKeys.has(groupIdHex)) {
            if (socket) {
              socket.emit('request_group_key', { groupId: groupIdHex });
            }
          }
          return 'already-accepted';
        }
      }

      const instruction = createAcceptGroupInviteInstruction(
        wallet.publicKey,
        groupId,
        userTokenAccount || null,
        session
      );

      const txSignature = await signAndSendTransaction([instruction]);

      await loadGroups();
      await loadGroupInvites();

      const groupIdHex = Buffer.from(groupId).toString('hex');

      // Try to fetch group key from on-chain (stored by admin via store_group_key_for_member)
      if (encryptionKeys && !groupKeys.has(groupIdHex)) {
        try {
          const groupKeySharePDA = getGroupKeySharePDA(groupId, wallet.publicKey);
          const accountInfo = await connection.getAccountInfo(groupKeySharePDA);

          if (accountInfo) {
            const keyShare = deserializeGroupKeyShare(accountInfo.data);

            // Key was encrypted by admin with nacl.box(secret, nonce, inviteePubkey, adminSecretKey)
            // To decrypt: nacl.box.open(encrypted, nonce, adminPubkey, inviteeSecretKey)
            // Fetch admin's encryption pubkey from the Group account
            const groupPDA = getGroupPDA(groupId);
            const groupAccount = await connection.getAccountInfo(groupPDA);
            let senderEncPubkey = encryptionKeys.publicKey; // fallback to own

            if (groupAccount) {
              const groupData = deserializeGroup(groupAccount.data);
              if (!groupData.creator.equals(wallet.publicKey)) {
                const creatorProfilePDA = getUserProfilePDA(groupData.creator);
                const creatorAccount = await connection.getAccountInfo(creatorProfilePDA);
                if (creatorAccount) {
                  senderEncPubkey = new Uint8Array(creatorAccount.data.slice(creatorAccount.data.length - 32));
                }
              }
            }

            const decryptedKey = nacl.box.open(
              keyShare.encryptedKey,
              keyShare.nonce,
              senderEncPubkey,
              encryptionKeys.secretKey
            );

            if (decryptedKey) {
              setGroupKeys(prev => {
                const updated = new Map(prev);
                updated.set(groupIdHex, decryptedKey);
                return updated;
              });
              console.log('✅ Fetched group key from on-chain backup');
            }
          }
        } catch (err) {
          console.error('Failed to fetch on-chain group key:', err);
        }
      }

      // Notify group via socket
      if (socket) {
        socket.emit('join_group', {
          groupId: groupIdHex,
          memberPubkey: wallet.publicKey.toBase58(),
        });

        // Fallback: request group key from backend (in case on-chain fetch failed)
        if (!groupKeys.has(groupIdHex)) {
          socket.emit('request_group_key', { groupId: groupIdHex });
          console.log('🔑 Requested group key from backend (fallback)');
        }
      }

      return txSignature;
    } catch (error) {
      console.error('Failed to accept group invite:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const rejectGroupInvite = async (groupId: Uint8Array) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      const instruction = createRejectGroupInviteInstruction(wallet.publicKey, groupId, session);
      const txSignature = await signAndSendTransaction([instruction]);

      await loadGroupInvites();
      return txSignature;
    } catch (error) {
      console.error('Failed to reject group invite:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const leaveGroup = async (groupId: Uint8Array) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      // Build instructions: leave group + close key share (to recover rent)
      const instructions = [createLeaveGroupInstruction(wallet.publicKey, groupId, session)];

      // Use compressed for CLOSE operation (works on devnet)
      // close_compressed_group_key uses LightAccount::new_close() - nullifies account only
      if (USE_ZK_COMPRESSION) {
        const groupIdHex = Buffer.from(groupId).toString('hex');
        const keyDataKey = `groupKeyData_${wallet.publicKey.toBase58()}_${groupIdHex}`;
        const keyDataStr = await AsyncStorage.getItem(keyDataKey);

        if (keyDataStr) {
          const keyData = JSON.parse(keyDataStr);
          const encryptedKey = new Uint8Array(keyData.encryptedKey);
          const nonce = new Uint8Array(keyData.nonce);

          instructions.push(
            await createCloseCompressedGroupKeyInstruction(
              wallet.publicKey,
              groupId,
              encryptedKey,
              nonce
            )
          );

          // Clean up stored key data
          await AsyncStorage.removeItem(keyDataKey);
        } else {
          console.warn('No stored key data for compressed close, skipping key closure');
        }
      } else {
        instructions.push(createCloseGroupKeyInstruction(wallet.publicKey, groupId, session));
      }

      const txSignature = await signAndSendTransaction(instructions);

      // Remove group key from local storage
      const groupIdHex = Buffer.from(groupId).toString('hex');
      setGroupKeys(prev => {
        const updated = new Map(prev);
        updated.delete(groupIdHex);
        return updated;
      });

      // Notify group via socket
      if (socket) {
        socket.emit('leave_group', {
          groupId: groupIdHex,
          memberPubkey: wallet.publicKey.toBase58(),
        });
      }

      await loadGroups();
      return txSignature;
    } catch (error) {
      console.error('Failed to leave group:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const kickMember = async (groupId: Uint8Array, memberPubkey: PublicKey) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');
    if (!encryptionKeys) throw new Error('Encryption keys not available');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      const instruction = createKickMemberInstruction(wallet.publicKey, groupId, memberPubkey, session);
      const txSignature = await signAndSendTransaction([instruction]);

      const groupIdHex = Buffer.from(groupId).toString('hex');

      // Notify group via socket
      if (socket) {
        socket.emit('kick_member', {
          groupId: groupIdHex,
          memberPubkey: memberPubkey.toBase58(),
        });
      }

      // KEY ROTATION: Generate new group key and distribute to remaining members
      // This ensures kicked member can't decrypt future messages
      try {
        const newGroupSecret = nacl.randomBytes(nacl.secretbox.keyLength);

        // Update local key
        setGroupKeys(prev => {
          const updated = new Map(prev);
          updated.set(groupIdHex, newGroupSecret);
          return updated;
        });

        // Store admin's own encrypted backup of new key on-chain
        const adminNonce = nacl.randomBytes(nacl.box.nonceLength);
        const adminEncryptedKey = nacl.box(
          newGroupSecret,
          adminNonce,
          encryptionKeys.publicKey,
          encryptionKeys.secretKey
        );
        const storeOwnKeyIx = createStoreGroupKeyInstruction(
          wallet.publicKey,
          groupId,
          adminEncryptedKey,
          adminNonce,
          session
        );
        await signAndSendTransaction([storeOwnKeyIx]);

        // Reload groups to get updated member list (without kicked member)
        await loadGroups();
        const updatedGroup = groupsRef.current.find(
          g => Buffer.from(g.groupId).toString('hex') === groupIdHex
        );

        if (updatedGroup) {
          // Prepare key shares for all remaining members
          const keyShares: Array<{ recipientPubkey: string; encryptedKey: string; nonce: string }> = [];

          for (const member of updatedGroup.members) {
            // Skip self (already stored above) and the kicked member
            if (member.equals(wallet.publicKey) || member.equals(memberPubkey)) continue;

            try {
              // Fetch member's encryption pubkey
              let memberEncPubkey: Uint8Array | undefined = contactsRef.current.find(
                c => c.publicKey.equals(member)
              )?.encryptionPublicKey;

              if (!memberEncPubkey) {
                const profilePDA = getUserProfilePDA(member);
                const profileAccount = await connection.getAccountInfo(profilePDA);
                if (profileAccount) {
                  memberEncPubkey = parseEncryptionPubkey(profileAccount.data) ?? undefined;
                }
              }

              if (memberEncPubkey) {
                const memberNonce = nacl.randomBytes(nacl.box.nonceLength);
                const memberEncryptedKey = nacl.box(
                  newGroupSecret,
                  memberNonce,
                  memberEncPubkey,
                  encryptionKeys.secretKey
                );

                // Store on-chain for offline recovery
                try {
                  const storeForMemberIx = createStoreGroupKeyForMemberInstruction(
                    wallet.publicKey,
                    groupId,
                    member,
                    memberEncryptedKey,
                    memberNonce,
                    session
                  );
                  await signAndSendTransaction([storeForMemberIx]);
                } catch (storeErr) {
                  console.error(`Failed to store rotated key on-chain for ${member.toBase58().slice(0, 8)}:`, storeErr);
                }

                keyShares.push({
                  recipientPubkey: member.toBase58(),
                  encryptedKey: Buffer.from(memberEncryptedKey).toString('base64'),
                  nonce: Buffer.from(memberNonce).toString('base64'),
                });
              }
            } catch (memberErr) {
              console.error(`Failed to encrypt rotated key for ${member.toBase58().slice(0, 8)}:`, memberErr);
            }
          }

          // Broadcast rotated keys via socket for immediate delivery
          if (socket && keyShares.length > 0) {
            socket.emit('group_key_rotated', {
              groupId: groupIdHex,
              keyShares,
            });
            console.log(`🔄 Rotated group key and distributed to ${keyShares.length} members`);
          }
        }
      } catch (rotationError) {
        console.error('⚠️ Key rotation failed after kick:', rotationError);
        // Non-fatal — kick succeeded, but key wasn't rotated
      }

      return txSignature;
    } catch (error) {
      console.error('Failed to kick member:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const closeGroup = async (groupId: Uint8Array) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const session = sessionInfoRef.current || undefined;
      const instruction = createCloseGroupInstruction(wallet.publicKey, groupId, session);
      const txSignature = await signAndSendTransaction([instruction]);

      // Remove group key from local storage
      const groupIdHex = Buffer.from(groupId).toString('hex');
      setGroupKeys(prev => {
        const updated = new Map(prev);
        updated.delete(groupIdHex);
        return updated;
      });

      // Notify group via socket
      if (socket) {
        socket.emit('group_deleted', {
          groupId: groupIdHex,
        });
      }

      await loadGroups();
      console.log('✅ Group closed, account rent returned');
      return txSignature;
    } catch (error) {
      console.error('Failed to close group:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const sendGroupMessage = async (groupId: string, content: string) => {
    if (!wallet?.publicKey || !socket) throw new Error('Not ready');
    if (!encryptionKeys) throw new Error('Encryption keys not available');

    try {
      const groupSecret = groupKeys.get(groupId);
      if (!groupSecret) {
        throw new Error('Group key not found - cannot encrypt message');
      }

      console.log('🔒 Encrypting group message with NaCl secretbox...');

      const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
      const messageBytes = new TextEncoder().encode(content);

      const encrypted = nacl.secretbox(messageBytes, nonce, groupSecret);

      const timestamp = Date.now();
      const encryptedBase64 = Buffer.from(encrypted).toString('base64');
      const nonceBase64 = Buffer.from(nonce).toString('base64');

      socket.emit('send_group_message', {
        groupId,
        encrypted: encryptedBase64,
        nonce: nonceBase64,
        sender: wallet.publicKey.toBase58(),
        timestamp,
      });

      console.log('✅ Encrypted group message sent via socket');

      // Optimistic update + persist locally
      const optimisticMsg = {
        id: `temp-${timestamp}`,
        groupId,
        sender: wallet.publicKey!.toBase58(),
        content,
        encrypted: encryptedBase64,
        nonce: nonceBase64,
        timestamp,
        status: 'sending',
      };

      setGroupMessages(prev => {
        const updated = new Map(prev);
        const msgs = updated.get(groupId) || [];
        const newMessages = [...msgs, optimisticMsg];
        updated.set(groupId, newMessages);

        // Persist locally
        saveLocalGroupMessages(wallet.publicKey!.toBase58(), groupId, newMessages);

        return updated;
      });
    } catch (error) {
      console.error('Failed to send group message:', error);
      throw error;
    }
  };

  const loadGroups = async () => {
    if (!wallet?.publicKey) return;

    try {
      console.log('📂 Loading groups for user...');

      // Strategy: Find all GroupInvite accounts where this user is the invitee with status=Accepted
      // Then fetch the corresponding Group account for each
      const PROGRAM_ID = new PublicKey('54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy');

      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          {
            // Filter for GroupInvite accounts (discriminator check if needed)
            dataSize: 8 + 32 + 32 + 32 + 1 + 8, // discriminator + groupId + inviter + invitee + status + createdAt
          },
          {
            // Filter for accounts where invitee = wallet.publicKey (offset 8 + 32 + 32 = 72)
            memcmp: {
              offset: 72,
              bytes: wallet.publicKey.toBase58(),
            },
          },
        ],
      });

      console.log(`Found ${accounts.length} group invite accounts`);

      // Filter for Accepted status (status byte = 1) and fetch Group data
      const loadedGroups: Group[] = [];
      const uniqueGroupIds = new Set<string>();

      for (const { account } of accounts) {
        try {
          const invite = deserializeGroupInvite(account.data);

          // Only process Accepted invites
          if (invite.status === 'Accepted') {
            const groupIdHex = Buffer.from(invite.groupId).toString('hex');

            // Skip if we've already loaded this group
            if (uniqueGroupIds.has(groupIdHex)) continue;
            uniqueGroupIds.add(groupIdHex);

            // Fetch the Group account
            const groupPDA = getGroupPDA(invite.groupId);
            const groupAccountInfo = await connection.getAccountInfo(groupPDA);

            if (groupAccountInfo) {
              const group = deserializeGroup(groupAccountInfo.data);
              loadedGroups.push(group);
              console.log(`✅ Loaded group: ${group.name} (${group.members.length} members)`);
            }
          }
        } catch (error) {
          console.error('Failed to deserialize group invite:', error);
        }
      }

      // Query 2: Find groups where user is the creator (Fix 2a: removed dataSize filter)
      // Creators are added directly to Group.members but don't have GroupInvite accounts
      // NOTE: Removed dataSize filter because Group accounts realloc on member changes
      const creatorGroups = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          {
            // Filter for Group account discriminator at offset 0
            memcmp: {
              offset: 0,
              bytes: bs58.encode(Buffer.from([0xd1, 0xf9, 0xd0, 0x3f, 0xb6, 0x59, 0xba, 0xfe])),
            },
          },
          {
            // Filter for accounts where creator = wallet.publicKey (offset 8 + 32 = 40)
            memcmp: {
              offset: 40,
              bytes: wallet.publicKey.toBase58(),
            },
          },
        ],
      });

      console.log(`Found ${creatorGroups.length} groups where user is creator`);

      // Merge and dedupe results
      for (const { account } of creatorGroups) {
        try {
          const group = deserializeGroup(account.data);
          const groupIdHex = Buffer.from(group.groupId).toString('hex');

          // Skip if we've already loaded this group
          if (!uniqueGroupIds.has(groupIdHex)) {
            uniqueGroupIds.add(groupIdHex);
            loadedGroups.push(group);
            console.log(`✅ Loaded creator group: ${group.name} (${group.members.length} members)`);
          }
        } catch (error) {
          console.error('Failed to deserialize creator group:', error);
        }
      }

      setGroups(loadedGroups);
      console.log(`📂 Loaded ${loadedGroups.length} groups total`);
    } catch (error) {
      console.error('Failed to load groups:', error);
      setGroups([]);
    }
  };

  const loadGroupInvites = async () => {
    if (!wallet?.publicKey) return;

    try {
      console.log('📬 Loading group invites...');
      const PROGRAM_ID = new PublicKey('54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy');

      // Query GroupInvite accounts where invitee = wallet.publicKey
      const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          {
            dataSize: 8 + 32 + 32 + 32 + 1 + 8, // GroupInvite size
          },
          {
            // Filter for accounts where invitee = wallet.publicKey (offset 72)
            memcmp: {
              offset: 72,
              bytes: wallet.publicKey.toBase58(),
            },
          },
        ],
      });

      console.log(`Found ${accounts.length} group invite accounts`);

      // Deserialize and filter for Pending status, verify group still exists
      const validInvites: GroupInvite[] = [];
      for (const { account } of accounts) {
        try {
          const invite = deserializeGroupInvite(account.data);

          // Only include Pending invites
          if (invite.status === 'Pending') {
            // Verify group still exists before showing invite
            const groupPDA = getGroupPDA(invite.groupId);
            const groupAccount = await connection.getAccountInfo(groupPDA);

            if (groupAccount) {
              validInvites.push(invite);
            } else {
              console.log(`⚠️ Skipping stale invite for deleted group ${Buffer.from(invite.groupId).toString('hex').slice(0, 8)}...`);
            }
          }
        } catch (error) {
          console.error('Failed to deserialize group invite:', error);
        }
      }

      setGroupInvites(validInvites);
      console.log(`📬 Loaded ${validInvites.length} valid pending group invites`);
    } catch (error) {
      console.error('Failed to load group invites:', error);
      setGroupInvites([]);
    }
  };

  const loadGroupMessages = async (groupId: string) => {
    if (!wallet?.publicKey) return;
    const walletAddress = wallet.publicKey.toBase58();

    // Step 1: Load from local cache immediately (instant, works offline)
    const localMessages = await loadLocalGroupMessages(walletAddress, groupId);
    if (localMessages.length > 0) {
      console.log(`📱 Loaded ${localMessages.length} group messages from local cache`);
      setGroupMessages((prev) => {
        const updated = new Map(prev);
        updated.set(groupId, localMessages);
        return updated;
      });
    }

    // Step 2: Fetch from backend to get any messages received while offline
    try {
      const encryptionSig = (window as any).__mukonEncryptionSignature;
      if (!encryptionSig) {
        console.error('No encryption signature available');
        return;
      }

      const signatureB58 = bs58.encode(encryptionSig);
      const url = `${BACKEND_URL}/group-messages/${groupId}?sender=${walletAddress}&signature=${encodeURIComponent(signatureB58)}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to load group messages: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`📜 Loaded ${data.messages.length} group messages from backend`);

      // Parse persisted read timestamps
      const persistedReadTimestamps = new Map<string, number>();
      if (data.readTimestamps && Array.isArray(data.readTimestamps)) {
        data.readTimestamps.forEach((entry: { pubkey: string; timestamp: number }) => {
          persistedReadTimestamps.set(entry.pubkey, entry.timestamp);
        });
      }

      // Step 3: Merge local + backend, deduplicate (ID + encrypted+nonce+sender)
      setGroupMessages(prev => {
        const updated = new Map(prev);
        const currentMessages = updated.get(groupId) || [];

        // Multi-field dedup: matches by ID or by encrypted content (handles temp-ID vs real-ID)
        const isDuplicate = (existing: any[], msg: any) =>
          existing.some((m: any) =>
            m.id === msg.id ||
            (m.encrypted && msg.encrypted &&
             m.encrypted === msg.encrypted &&
             m.nonce === msg.nonce &&
             m.sender === msg.sender)
          );

        // Filter out backend messages already in local cache, and replace temp messages with real ones
        const newFromBackend: any[] = [];
        for (const backendMsg of data.messages) {
          const tempMatch = currentMessages.findIndex((m: any) =>
            m.id !== backendMsg.id &&
            m.encrypted && backendMsg.encrypted &&
            m.encrypted === backendMsg.encrypted &&
            m.nonce === backendMsg.nonce &&
            m.sender === backendMsg.sender
          );
          if (tempMatch >= 0) {
            // Replace temp message with real backend message (preserves real ID)
            currentMessages[tempMatch] = { ...backendMsg, status: currentMessages[tempMatch].status };
          } else if (!isDuplicate(currentMessages, backendMsg)) {
            newFromBackend.push(backendMsg);
          }
        }

        // Apply read status based on persisted timestamps
        const applyReadStatus = (msg: any) => {
          if (msg.sender === walletAddress) {
            const maxReadTimestamp = Math.max(
              0,
              ...Array.from(persistedReadTimestamps.entries())
                .filter(([pubkey]) => pubkey !== walletAddress)
                .map(([_, timestamp]) => timestamp)
            );
            if (maxReadTimestamp > 0 && msg.timestamp <= maxReadTimestamp) {
              return { ...msg, status: 'read' };
            }
            return { ...msg, status: msg.status || 'sent' };
          }
          return msg;
        };

        const merged = [...currentMessages.map(applyReadStatus), ...newFromBackend.map(applyReadStatus)]
          .sort((a, b) => a.timestamp - b.timestamp);

        updated.set(groupId, merged);

        // Persist merged result back to local storage
        saveLocalGroupMessages(walletAddress, groupId, merged);

        return updated;
      });
    } catch (error) {
      console.error('Failed to load group messages from backend:', error);
      // Graceful offline: local cache is already shown
    }
  };

  const joinGroupRoom = (groupId: string) => {
    if (socket && wallet?.publicKey) {
      // Fix 2f: Use separate event for viewing vs joining as member
      socket.emit('join_group_room', { groupId });
      setActiveGroupRoom(groupId);
      // Clear unread count for this group
      setUnreadCounts(prev => {
        const updated = new Map(prev);
        updated.delete(groupId);
        return updated;
      });

      // Request group key if we don't have it (triggers broadcast to room members)
      if (!groupKeysRef.current.has(groupId)) {
        console.log(`🔑 Missing key for group ${groupId.slice(0, 8)}..., requesting from room members`);
        socket.emit('request_group_key', { groupId });
      }

      // Fetch group avatar (Fix 4)
      socket.emit('get_group_avatar', { groupId }, (avatar: string | null) => {
        if (avatar) {
          setGroupAvatars(prev => {
            const updated = new Map(prev);
            updated.set(groupId, avatar);
            return updated;
          });
        }
      });

      // Emit read receipts for latest group message (Feature 5)
      const msgs = groupMessages.get(groupId) || [];
      if (msgs.length > 0) {
        const latestMessage = msgs[msgs.length - 1];
        socket.emit('group_messages_read', {
          groupId,
          readerPubkey: wallet.publicKey.toBase58(),
          latestTimestamp: latestMessage.timestamp,
        });
      }

      console.log('Joining group room:', groupId);
    }
  };

  const leaveGroupRoom = (groupId: string) => {
    if (socket) {
      socket.emit('leave_group_room', { groupId });
      setActiveGroupRoom(null);
      console.log('Leaving group room:', groupId);
    }
  };

  const setGroupAvatarShared = async (groupId: string, emoji: string) => {
    if (!socket || !wallet?.publicKey) return;

    // Save locally
    setGroupAvatars(prev => {
      const updated = new Map(prev);
      updated.set(groupId, emoji);
      return updated;
    });

    // Emit to backend
    socket.emit('set_group_avatar', { groupId, avatar: emoji });
    console.log(`🎨 Setting group avatar for ${groupId.slice(0, 8)}... to ${emoji}`);
  };

  const value: MessengerContextType = {
    connection,
    socket,
    profile,
    contacts,
    messages,
    unreadCounts,
    readTimestamps,
    loading,
    profileChecked,
    encryptionReady,
    register,
    updateProfile,
    closeProfile,
    invite,
    acceptInvitation,
    rejectInvitation,
    deleteContact,
    blockContact,
    unblockContact,
    closeRelationship,
    sendMessage,
    deleteMessage,
    joinConversation,
    leaveConversation,
    decryptConversationMessage,
    loadConversationMessages,
    loadContacts,
    loadProfile,
    // Group methods
    groups,
    groupInvites,
    groupMessages,
    groupKeys,
    createGroup,
    createGroupWithMembers,
    updateGroup,
    inviteToGroup,
    acceptGroupInvite,
    rejectGroupInvite,
    leaveGroup,
    kickMember,
    closeGroup,
    sendGroupMessage,
    loadGroups,
    loadGroupInvites,
    loadGroupMessages,
    joinGroupRoom,
    leaveGroupRoom,
    groupAvatars,
    setGroupAvatarShared,
    connectionStatus,
    wallet,
    // Arcium MPC methods
    verifyContactPrivately,
  };

  return (
    <MessengerContext.Provider value={value}>
      {children}
    </MessengerContext.Provider>
  );
};
