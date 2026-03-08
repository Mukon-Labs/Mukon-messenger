import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { toUint8Array } from 'js-base64';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface WalletContextType {
  publicKey: PublicKey | null;
  connected: boolean;
  connecting: boolean;
  isRestoring: boolean;
  encryptionSignature: Uint8Array | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (transaction: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAndSendTransaction: (transaction: Transaction | VersionedTransaction) => Promise<string>;
}

const WalletContext = createContext<WalletContextType | null>(null);

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within WalletProvider');
  }
  return context;
};

const APP_IDENTITY = {
  name: 'Mukon Messenger',
  uri: 'https://mukon.app',
  icon: 'icon.png',
};

export const WalletProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [publicKey, setPublicKey] = useState<PublicKey | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [encryptionSignature, setEncryptionSignature] = useState<Uint8Array | null>(null);
  const connectedRef = useRef(false);

  // Helper to reestablish wallet connection using stored session
  const reestablishConnection = useCallback(async (token: string, pubkey: PublicKey, encryptionSig: Uint8Array): Promise<boolean> => {
    try {
      console.log('🔄 Attempting to reestablish wallet connection...');

      // Try to reauthorize with the stored token
      await transact(async (wallet) => {
        await wallet.reauthorize({
          cluster: 'devnet',
          identity: APP_IDENTITY,
          auth_token: token,
        });
      });

      // If reauthorize succeeds, restore session state
      setAuthToken(token);
      setPublicKey(pubkey);
      setConnected(true);
      connectedRef.current = true;
      setEncryptionSignature(encryptionSig);
      (window as any).__mukonEncryptionSignature = encryptionSig;

      console.log('✅ Wallet session reestablished!');
      return true;
    } catch (error) {
      console.log('⚠️ Reauthorize failed, session may have expired:', error);
      // Session expired - return false so we can fall back to authorize
      return false;
    }
  }, []);

  // Restore wallet session on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        const storedToken = await AsyncStorage.getItem('@mukon_auth_token');
        const storedPubkey = await AsyncStorage.getItem('@mukon_pubkey');
        const storedEncryptionSig = await AsyncStorage.getItem('@mukon_encryption_sig');

        if (storedToken && storedPubkey && storedEncryptionSig) {
          console.log('📱 Found stored wallet session, attempting to restore...');
          const pubkey = new PublicKey(storedPubkey);
          const encryptionSig = Uint8Array.from(JSON.parse(storedEncryptionSig));

          // Try to reestablish connection with stored session
          const success = await reestablishConnection(storedToken, pubkey, encryptionSig);

          if (!success) {
            // Session expired - clear storage and require fresh auth
            console.log('🗑️ Stored session expired, clearing...');
            await AsyncStorage.multiRemove(['@mukon_auth_token', '@mukon_pubkey', '@mukon_encryption_sig']);
            // User will need to reconnect via connect()
          }
        }
      } catch (error) {
        console.error('Failed to restore session:', error);
        await AsyncStorage.multiRemove(['@mukon_auth_token', '@mukon_pubkey', '@mukon_encryption_sig']);
      } finally {
        setIsRestoring(false);
      }
    };

    restoreSession();
  }, [reestablishConnection]);

  const connect = useCallback(async () => {
    if (connectedRef.current) {
      console.log('⏭️ Already connected, skipping connect()');
      return;
    }
    setConnecting(true);
    try {
      const encryptionSignature = await transact(async (wallet) => {
        // Check if we have an existing authToken - use reauthorize if so
        const existingToken = await AsyncStorage.getItem('@mukon_auth_token');

        let authResult;
        if (existingToken) {
          try {
            console.log('🔄 Reauthorizing with existing token (no popup)...');
            authResult = await wallet.reauthorize({
              cluster: 'devnet',
              identity: APP_IDENTITY,
              auth_token: existingToken,
            });
          } catch (reauthError) {
            // Session expired - fall back to fresh authorize
            console.log('⚠️ Reauthorize failed, falling back to fresh authorize...');
            // Clear expired token from storage
            await AsyncStorage.removeItem('@mukon_auth_token');
            authResult = await wallet.authorize({
              cluster: 'devnet',
              identity: APP_IDENTITY,
            });
          }
        } else {
          console.log('🆕 First-time authorization...');
          authResult = await wallet.authorize({
            cluster: 'devnet',
            identity: APP_IDENTITY,
          });
        }

        console.log('Authorization successful!');
        const token = authResult.auth_token;

        // Store auth token
        setAuthToken(token);
        await AsyncStorage.setItem('@mukon_auth_token', token);

        // Get public key
        const base64Address = authResult.accounts[0].address;
        const publicKeyBytes = toUint8Array(base64Address);
        const pubkey = new PublicKey(publicKeyBytes);

        await AsyncStorage.setItem('@mukon_pubkey', pubkey.toBase58());

        // Get encryption signature (only if not already stored)
        const storedEncryptionSig = await AsyncStorage.getItem('@mukon_encryption_sig');
        let encryptionSig;

        if (storedEncryptionSig) {
          console.log('📂 Using stored encryption signature');
          encryptionSig = Uint8Array.from(JSON.parse(storedEncryptionSig));
        } else {
          console.log('🔐 Deriving encryption keypair (one-time)...');
          const message = Buffer.from('Sign this message to derive your encryption keys for Mukon Messenger', 'utf8');
          const signedMessages = await wallet.signMessages({
            addresses: [authResult.accounts[0].address],
            payloads: [message],
          });
          encryptionSig = signedMessages[0];

          // Store encryption signature
          await AsyncStorage.setItem('@mukon_encryption_sig', JSON.stringify(Array.from(encryptionSig)));
          console.log('✅ Encryption signature stored');
        }

        // Store signature in memory
        setEncryptionSignature(encryptionSig);
        (window as any).__mukonEncryptionSignature = encryptionSig;

        // Set state
        setPublicKey(pubkey);
        setConnected(true);
        connectedRef.current = true;
        console.log('Wallet connected:', pubkey.toBase58());

        return encryptionSig;
      });

      console.log('✅ Connection complete');
    } catch (error) {
      console.error('Failed to connect wallet:', error);
      throw error;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await transact(async (wallet) => {
        await wallet.deauthorize({ auth_token: authToken ?? undefined });
      });
    } catch (error) {
      console.error('Failed to disconnect:', error);
    } finally {
      setPublicKey(null);
      setConnected(false);
      connectedRef.current = false;
      setAuthToken(null);
      setEncryptionSignature(null);
      (window as any).__mukonEncryptionSignature = null;

      // Clear AsyncStorage
      await AsyncStorage.multiRemove(['@mukon_auth_token', '@mukon_pubkey', '@mukon_encryption_sig']);
      console.log('🗑️ Session cleared from storage');
    }
  }, [authToken]);

  const signMessage = useCallback(async (message: Uint8Array): Promise<Uint8Array> => {
    if (!publicKey) throw new Error('Wallet not connected');
    if (!authToken) throw new Error('No auth token available');

    return await transact(async (wallet) => {
      try {
        // Try reauthorize first
        const authResult = await wallet.reauthorize({
          cluster: 'devnet',
          identity: APP_IDENTITY,
          auth_token: authToken,
        });

        const signedMessages = await wallet.signMessages({
          addresses: [authResult.accounts[0].address],
          payloads: [message],
        });

        return signedMessages[0];
      } catch (error) {
        // Session expired - clear state and throw error
        console.error('Session expired during signMessage:', error);
        setPublicKey(null);
        setConnected(false);
        setAuthToken(null);
        await AsyncStorage.multiRemove(['@mukon_auth_token', '@mukon_pubkey', '@mukon_encryption_sig']);
        throw new Error('Wallet session expired. Please reconnect your wallet.');
      }
    });
  }, [publicKey, authToken]);

  const signTransaction = useCallback(async (
    transaction: Transaction | VersionedTransaction
  ): Promise<Transaction | VersionedTransaction> => {
    if (!publicKey) throw new Error('Wallet not connected');
    if (!authToken) throw new Error('No auth token available');

    return await transact(async (wallet) => {
      try {
        // Try reauthorize first
        await wallet.reauthorize({
          cluster: 'devnet',
          identity: APP_IDENTITY,
          auth_token: authToken,
        });

        // Pass the transaction object directly to signTransactions
        const signedTxs = await wallet.signTransactions({
          transactions: [transaction],
        });

        // wallet.signTransactions returns the signed transactions
        return signedTxs[0];
      } catch (error) {
        // Session expired - clear state and throw error
        console.error('Session expired during signTransaction:', error);
        setPublicKey(null);
        setConnected(false);
        setAuthToken(null);
        await AsyncStorage.multiRemove(['@mukon_auth_token', '@mukon_pubkey', '@mukon_encryption_sig']);
        throw new Error('Wallet session expired. Please reconnect your wallet.');
      }
    });
  }, [publicKey, authToken]);

  const signAndSendTransaction = useCallback(async (
    transaction: Transaction | VersionedTransaction
  ): Promise<string> => {
    console.log('signAndSendTransaction called with:', transaction);
    console.log('Transaction type:', transaction?.constructor?.name);

    if (!publicKey) throw new Error('Wallet not connected');
    if (!authToken) throw new Error('No auth token available');

    // CRITICAL: Serialize BEFORE passing to transact() to preserve methods
    const serialized = transaction instanceof VersionedTransaction
      ? transaction.serialize()
      : transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });

    console.log('Serialized transaction, length:', serialized.length);

    return await transact(async (wallet) => {
      // Use reauthorize to avoid popup
      await wallet.reauthorize({
        cluster: 'devnet',
        identity: APP_IDENTITY,
        auth_token: authToken,
      });

      console.log('Sending transaction to wallet...');
      const result = await wallet.signAndSendTransactions({
        transactions: [serialized],
      });

      console.log('Transaction result:', result);
      return result.signatures[0];
    });
  }, [publicKey, authToken]);

  const value: WalletContextType = {
    publicKey,
    connected,
    connecting,
    isRestoring,
    encryptionSignature,
    connect,
    disconnect,
    signMessage,
    signTransaction,
    signAndSendTransaction,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
};
