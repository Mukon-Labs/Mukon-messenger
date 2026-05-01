import { useState, useEffect, useMemo, useRef } from 'react';
import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';
import io, { Socket } from 'socket.io-client';
import { encryptMessage, decryptMessage, getChatHash, truncateAddress, deriveEncryptionKeypair } from '../utils/encryption';
import {
  createRegisterInstruction,
  createInviteInstruction,
  createAcceptInstruction,
  createRejectInstruction,
  buildTransaction,
  getWalletDescriptorPDA,
  getUserProfilePDA,
} from '../utils/transactions';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';
import bs58 from 'bs58';

const PROGRAM_ID = new PublicKey('54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy');
// For physical device via ADB/WiFi, use host machine's actual IP on local network
// Find host IP with: ifconfig | grep "inet " | grep -v 127.0.0.1
const BACKEND_URL = 'http://10.206.4.164:3001';

interface Wallet {
  publicKey: PublicKey | null;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (transaction: VersionedTransaction) => Promise<VersionedTransaction>;
}

export function useMukonMessenger(wallet: Wallet | null, cluster: string = 'devnet') {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Map<string, any[]>>(new Map());
  const [contacts, setContacts] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [encryptionKeys, setEncryptionKeys] = useState<nacl.BoxKeyPair | null>(null);
  const [encryptionReady, setEncryptionReady] = useState(false);
  const derivingKeys = useRef(false);

  // Initialize connection
  const connection = useMemo(
    () => new Connection(
      cluster === 'devnet'
        ? 'https://api.devnet.solana.com'
        : 'http://localhost:8899',
      'confirmed'
    ),
    [cluster]
  );

  // No Anchor program needed - we build transactions manually

  // Derive encryption keys from signature obtained during wallet connect
  useEffect(() => {
    if (!wallet?.publicKey) return;
    if (encryptionKeys) return; // Already have keys

    // Check for signature from WalletProvider's connect()
    const signature = (window as any).__mukonEncryptionSignature;
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

      // DON'T delete signature - other screen instances need it
      // The signature is deterministic anyway (same wallet = same keys)
    } catch (error) {
      console.error('❌ Failed to derive encryption keys:', error);
    }
  }, [wallet?.publicKey, encryptionKeys]);

  // Initialize socket connection (separate from encryption)
  useEffect(() => {
    if (!wallet?.publicKey) return;

    console.log('🔌 Connecting to backend:', BACKEND_URL);

    // Test basic HTTP connectivity first
    fetch(`${BACKEND_URL}/health`)
      .then(res => res.json())
      .then(data => console.log('✅ Backend HTTP reachable:', data))
      .catch(err => console.error('❌ Backend HTTP unreachable:', err.message));

    const newSocket = io(BACKEND_URL, {
      path: '/socket.io',
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 3,
      reconnectionDelay: 1000,
      timeout: 20000,
      forceNew: true,
      upgrade: false, // Don't try to upgrade to websocket
      rememberUpgrade: false,
    });

    newSocket.on('connect', async () => {
      console.log('✅ Connected to backend');

      try {
        const message = `Authenticate ${newSocket.id}`;
        const signature = await wallet.signMessage(Buffer.from(message, 'utf8'));

        newSocket.emit('authenticate', {
          publicKey: wallet.publicKey.toBase58(),
          signature: bs58.encode(signature), // Backend expects bs58, not base64
        });
      } catch (error) {
        console.error('❌ Failed to authenticate:', error);
      }
    });

    newSocket.on('connect_error', (error) => {
      console.error('❌ Socket connection error:', error.message);
    });

    newSocket.on('disconnect', (reason) => {
      console.log('⚠️  Disconnected from backend:', reason);
    });

    newSocket.on('authenticated', (data: any) => {
      if (data.success) {
        console.log('Authenticated with backend');
      } else {
        console.error('Authentication failed:', data.error);
      }
    });

    newSocket.on('new_message', (message: any) => {
      console.log('Received new_message event:', message);
      // Message format: { id, conversationId, sender, content, timestamp }
      if (message.conversationId) {
        setMessages((prev) => {
          const updated = new Map(prev);
          const conversationMessages = updated.get(message.conversationId) || [];

          // Check if message already exists (avoid duplicates from optimistic update)
          const exists = conversationMessages.some(
            (msg: any) =>
              msg.id === message.id || // Same real ID
              (msg.encrypted && message.encrypted &&
               msg.encrypted === message.encrypted &&
               msg.nonce === message.nonce &&
               msg.sender === message.sender) || // Same encrypted message
              (msg.content && message.content &&
               msg.content === message.content &&
               Math.abs(msg.timestamp - message.timestamp) < 5000) // Same plaintext within 5s
          );

          if (!exists) {
            updated.set(message.conversationId, [...conversationMessages, message]);

            // Increment unread count if not from current user and not in active conversation
            setActiveConversation((activeConv) => {
              setUnreadCounts((prevUnread) => {
                if (message.sender !== wallet?.publicKey?.toBase58() &&
                    message.conversationId !== activeConv) {
                  const newUnread = new Map(prevUnread);
                  newUnread.set(
                    message.conversationId,
                    (newUnread.get(message.conversationId) || 0) + 1
                  );
                  return newUnread;
                }
                return prevUnread;
              });
              return activeConv;
            });
          }

          return updated;
        });
      }
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [wallet?.publicKey]);

  /**
   * Register a new user with display name
   */
  const register = async (displayName: string) => {
    if (!wallet?.publicKey || !wallet.signTransaction || !wallet.signMessage) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      // Check if already registered first
      const userProfile = getUserProfilePDA(wallet.publicKey);
      const accountInfo = await connection.getAccountInfo(userProfile);

      if (accountInfo) {
        console.log('User already registered');
        // Profile will be loaded by useEffect once encryption keys are ready
        return null; // Already registered
      }

      // Use encryption keys already derived during connect
      if (!encryptionKeys) {
        throw new Error('Encryption keys not available - please reconnect wallet');
      }
      console.log('Using existing encryption keys for registration');

      console.log('Creating register instruction for:', displayName);
      const instruction = createRegisterInstruction(
        wallet.publicKey,
        displayName,
        '',
        encryptionKeys.publicKey
      );

      console.log('Building transaction...');
      const transaction = await buildTransaction(connection, wallet.publicKey, [instruction]);
      console.log('Transaction built');

      console.log('Signing transaction with wallet...');
      const signedTransaction = await wallet.signTransaction(transaction);
      console.log('Transaction signed');

      console.log('Sending transaction...');
      const txSignature = await connection.sendTransaction(signedTransaction);
      console.log('Transaction sent, signature:', txSignature);

      console.log('Confirming transaction...');
      await connection.confirmTransaction(txSignature, 'confirmed');

      console.log('Registered user:', displayName, 'TX:', txSignature);

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

  /**
   * Update user profile
   * TODO: Implement updateProfile instruction builder
   */
  const updateProfile = async (displayName?: string, avatarUrl?: string) => {
    if (!wallet?.publicKey) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      // TODO: Create updateProfile instruction and send transaction
      console.warn('updateProfile not yet implemented with manual transactions');

      if (displayName) {
        setProfile((prev: any) => ({ ...prev, displayName }));
      }

      return 'placeholder-signature';
    } catch (error) {
      console.error('Failed to update profile:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Invite a contact
   */
  const invite = async (contactPubkey: PublicKey) => {
    if (!wallet?.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const chatHash = getChatHash(wallet.publicKey, contactPubkey);
      const instruction = createInviteInstruction(wallet.publicKey, contactPubkey, chatHash);
      const transaction = await buildTransaction(connection, wallet.publicKey, [instruction]);

      const signedTransaction = await wallet.signTransaction(transaction);
      const signature = await connection.sendTransaction(signedTransaction);
      await connection.confirmTransaction(signature, 'confirmed');

      console.log('Sent invitation to:', contactPubkey.toBase58(), 'TX:', signature);
      return signature;
    } catch (error) {
      console.error('Failed to invite:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Accept an invitation
   */
  const acceptInvitation = async (peerPubkey: PublicKey) => {
    if (!wallet?.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const instruction = createAcceptInstruction(wallet.publicKey, peerPubkey);
      const transaction = await buildTransaction(connection, wallet.publicKey, [instruction]);

      const signedTransaction = await wallet.signTransaction(transaction);
      const signature = await connection.sendTransaction(signedTransaction);
      await connection.confirmTransaction(signature, 'confirmed');

      console.log('Accepted invitation from:', peerPubkey.toBase58(), 'TX:', signature);
      await loadContacts(); // Refresh contacts
      return signature;
    } catch (error) {
      console.error('Failed to accept invitation:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Reject an invitation
   */
  const rejectInvitation = async (peerPubkey: PublicKey) => {
    if (!wallet?.publicKey || !wallet.signTransaction) throw new Error('Wallet not connected');

    setLoading(true);
    try {
      const instruction = createRejectInstruction(wallet.publicKey, peerPubkey);
      const transaction = await buildTransaction(connection, wallet.publicKey, [instruction]);

      const signedTransaction = await wallet.signTransaction(transaction);
      const signature = await connection.sendTransaction(signedTransaction);
      await connection.confirmTransaction(signature, 'confirmed');

      console.log('Rejected invitation from:', peerPubkey.toBase58(), 'TX:', signature);
      await loadContacts();
      return signature;
    } catch (error) {
      console.error('Failed to reject invitation:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Delete a contact (same as reject)
   */
  const deleteContact = async (peerPubkey: PublicKey) => {
    return rejectInvitation(peerPubkey);
  };

  /**
   * Join a conversation room
   */
  const joinConversation = (conversationId: string) => {
    if (!socket) {
      console.warn('Socket not ready, cannot join conversation');
      return;
    }

    console.log('Joining conversation:', conversationId);
    socket.emit('join_conversation', { conversationId });

    // Set as active conversation and mark all messages as read
    setActiveConversation(conversationId);
    setUnreadCounts((prev) => {
      const updated = new Map(prev);
      updated.set(conversationId, 0);
      return updated;
    });
  };

  /**
   * Leave a conversation room
   */
  const leaveConversation = (conversationId: string) => {
    if (!socket) return;

    console.log('Leaving conversation:', conversationId);
    socket.emit('leave_conversation', { conversationId });

    // Clear active conversation
    setActiveConversation(null);
  };

  /**
   * Send an encrypted message using NaCl box
   */
  const sendMessage = async (
    conversationId: string,
    content: string,
    recipientPubkey: PublicKey
  ) => {
    if (!wallet?.publicKey || !socket) throw new Error('Not ready');
    if (!encryptionKeys) throw new Error('Encryption keys not available');

    try {
      // Find recipient's encryption public key from contacts
      const recipient = contacts.find(c => c.publicKey.equals(recipientPubkey));
      if (!recipient?.encryptionPublicKey) {
        throw new Error('Recipient encryption key not found - they may need to re-register');
      }

      console.log('🔒 Encrypting message with NaCl box...');

      // Encrypt message using NaCl box (asymmetric encryption)
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
      });

      console.log('✅ Encrypted message sent via socket');

      // Add message optimistically so sender sees it immediately
      // Store both plaintext (for displaying our own messages) and encrypted (for backend)
      setMessages((prev) => {
        const updated = new Map(prev);
        const conversationMessages = updated.get(conversationId) || [];
        updated.set(conversationId, [
          ...conversationMessages,
          {
            id: `temp-${timestamp}`,
            conversationId,
            sender: wallet.publicKey!.toBase58(),
            content,  // Store plaintext for our own messages
            encrypted: encryptedBase64,
            nonce: nonceBase64,
            timestamp,
          },
        ]);
        return updated;
      });
    } catch (error) {
      console.error('Failed to send message:', error);
      throw error;
    }
  };

  /**
   * Load contacts from chain (with encryption public keys)
   */
  const loadContacts = async () => {
    if (!wallet?.publicKey) return;

    setLoading(true);
    try {
      const walletDescriptor = getWalletDescriptorPDA(wallet.publicKey);
      const accountInfo = await connection.getAccountInfo(walletDescriptor);

      if (!accountInfo) {
        console.log('No wallet descriptor found');
        setContacts([]);
        return;
      }

      // Manual Borsh deserialization
      const data = accountInfo.data;
      let offset = 8; // Skip discriminator

      // Read owner pubkey (32 bytes)
      offset += 32;

      // Read peers Vec length (4 bytes, little endian)
      const peersLength = data.readUInt32LE(offset);
      offset += 4;

      console.log('Found', peersLength, 'peers');

      const peers = [];
      for (let i = 0; i < peersLength; i++) {
        // Read peer wallet pubkey (32 bytes)
        const peerPubkey = new PublicKey(data.slice(offset, offset + 32));
        offset += 32;

        // Read peer state (1 byte: 0=Invited, 1=Requested, 2=Accepted, 3=Rejected)
        const state = data[offset];
        offset += 1;

        // Fetch peer's UserProfile to get their encryption public key
        let peerEncryptionKey: Uint8Array | null = null;
        let peerDisplayName = peerPubkey.toBase58().slice(0, 8) + '...';

        try {
          const peerProfilePDA = getUserProfilePDA(peerPubkey);
          const peerProfileInfo = await connection.getAccountInfo(peerProfilePDA);

          if (peerProfileInfo) {
            const peerData = peerProfileInfo.data;
            let peerOffset = 8; // Skip discriminator

            // Skip owner pubkey (32 bytes)
            peerOffset += 32;

            // Read display_name
            const displayNameLen = peerData.readUInt32LE(peerOffset);
            peerOffset += 4;
            const displayNameBytes = peerData.slice(peerOffset, peerOffset + displayNameLen);
            peerDisplayName = Buffer.from(displayNameBytes).toString('utf8') || peerDisplayName;
            peerOffset += displayNameLen;

            // Skip avatar_url
            const avatarUrlLen = peerData.readUInt32LE(peerOffset);
            peerOffset += 4;
            peerOffset += avatarUrlLen;

            // Read encryption_public_key (32 bytes)
            peerEncryptionKey = peerData.slice(peerOffset, peerOffset + 32);

            console.log(`Loaded encryption key for ${peerDisplayName}:`, Buffer.from(peerEncryptionKey).toString('hex').slice(0, 16) + '...');
          }
        } catch (error) {
          console.warn(`Failed to load profile for peer ${peerPubkey.toBase58()}:`, error);
        }

        peers.push({
          publicKey: peerPubkey,
          state: state === 0 ? 'Invited' : state === 1 ? 'Requested' : state === 2 ? 'Accepted' : 'Rejected',
          displayName: peerDisplayName,
          encryptionPublicKey: peerEncryptionKey,
        });
      }

      console.log('Loaded peers with encryption keys:', peers.length);
      setContacts(peers);
    } catch (error) {
      console.error('Failed to load contacts:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Decrypt a message using NaCl box.open
   * For 1:1 conversations, we always use the OTHER person's encryption public key
   */
  const decryptConversationMessage = (
    encrypted: string,
    nonce: string,
    senderPubkey: PublicKey,
    recipientPubkey: PublicKey
  ): string | null => {
    if (!wallet?.publicKey || !encryptionKeys) return null;

    try {
      // In a 1:1 conversation, determine who the OTHER person is
      const otherPersonPubkey = senderPubkey.equals(wallet.publicKey)
        ? recipientPubkey  // If I sent it, the other person is the recipient
        : senderPubkey;     // If they sent it, the other person is the sender

      // Find the other person's encryption key
      const otherPerson = contacts.find(c => c.publicKey.equals(otherPersonPubkey));
      if (!otherPerson?.encryptionPublicKey) {
        console.error('Conversation partner encryption key not found in contacts');
        return '[Encryption key not found]';
      }

      // Decrypt using NaCl box.open (asymmetric decryption)
      // Always use: other person's encryption public key + my secret key
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
      return '[Decryption error]';
    }
  };

  /**
   * Load user profile
   */
  const loadProfile = async () => {
    if (!wallet?.publicKey || !wallet.signMessage) return;

    try {
      const userProfile = getUserProfilePDA(wallet.publicKey);

      // Check if account exists on-chain
      const accountInfo = await connection.getAccountInfo(userProfile);

      if (!accountInfo) {
        // Account doesn't exist - user needs to register
        console.log('No profile found, user needs to register');
        setProfile(null);
        return;
      }

      // Encryption keys needed for decrypting peer info
      if (!encryptionKeys) {
        console.warn('⚠️ Encryption keys not yet available, will retry when ready');
        setProfile(null);
        return;
      }

      // Deserialize UserProfile account
      const data = accountInfo.data;
      let offset = 8; // Skip discriminator

      // Read owner pubkey (32 bytes)
      const ownerBytes = data.slice(offset, offset + 32);
      offset += 32;

      // Read display_name (String = 4 bytes length + UTF-8 bytes)
      const displayNameLength = data.readUInt32LE(offset);
      offset += 4;
      const displayNameBytes = data.slice(offset, offset + displayNameLength);
      const displayName = Buffer.from(displayNameBytes).toString('utf8');
      offset += displayNameLength;

      // Read avatar_url (String = 4 bytes length + UTF-8 bytes)
      const avatarUrlLength = data.readUInt32LE(offset);
      offset += 4;
      const avatarUrlBytes = data.slice(offset, offset + avatarUrlLength);
      const avatarUrl = Buffer.from(avatarUrlBytes).toString('utf8');
      offset += avatarUrlLength;

      // Read encryption_public_key (32 bytes, no length prefix for fixed array)
      const encryptionPublicKey = data.slice(offset, offset + 32);

      console.log('Profile loaded:', { displayName, avatarUrl, encryptionPublicKey: Buffer.from(encryptionPublicKey).toString('hex') });

      setProfile({
        displayName: displayName || wallet.publicKey.toBase58().slice(0, 8) + '...',
        avatarUrl: avatarUrl || null,
        publicKey: wallet.publicKey,
        encryptionPublicKey,
      });
    } catch (error) {
      console.error('Failed to load profile:', error);
      setProfile(null);
    }
  };

  // Load profile and contacts when encryption keys are available
  useEffect(() => {
    if (wallet?.publicKey && encryptionKeys) {
      loadProfile();
      loadContacts();
    }
  }, [wallet?.publicKey, encryptionKeys]);

  /**
   * Load conversation message history from backend
   */
  const loadConversationMessages = async (conversationId: string) => {
    if (!wallet?.publicKey || !wallet.signMessage) return;

    try {
      // Sign request to authenticate
      const message = `Get messages from ${conversationId}`;
      const signature = await wallet.signMessage(Buffer.from(message, 'utf8'));
      const signatureB58 = bs58.encode(signature);

      const url = `${BACKEND_URL}/messages/${conversationId}?sender=${wallet.publicKey.toBase58()}&signature=${encodeURIComponent(signatureB58)}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to load messages: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`📜 Loaded ${data.messages.length} messages from backend`);

      // Add messages to state
      setMessages((prev) => {
        const updated = new Map(prev);
        updated.set(conversationId, data.messages);
        return updated;
      });
    } catch (error) {
      console.error('Failed to load conversation messages:', error);
    }
  };

  return {
    connection,
    wallet,
    socket,
    profile,
    contacts,
    messages,
    unreadCounts,
    loading,
    encryptionReady,
    register,
    updateProfile,
    invite,
    acceptInvitation,
    rejectInvitation,
    deleteContact,
    sendMessage,
    joinConversation,
    leaveConversation,
    decryptConversationMessage,
    loadConversationMessages,
    loadContacts,
    loadProfile,
  };
}
