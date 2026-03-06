import { Buffer } from 'buffer';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput as RNTextInput,
} from 'react-native';
import { Text, Button, IconButton, Divider } from 'react-native-paper';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { theme } from '../theme';
import { useMessenger } from '../contexts/MessengerContext';
import { useWallet } from '../contexts/WalletContext';
import { buildTransaction } from '../utils/transactions';
import {
  fetchSOLBalance,
  fetchTokenAccounts,
  createSOLTransferInstruction,
  createSPLTransferInstructions,
  TokenBalance,
} from '../utils/tokens';

type ModalState = 'loading' | 'select' | 'amount' | 'confirm' | 'sending' | 'result';

interface SendCryptoModalProps {
  visible: boolean;
  onDismiss: () => void;
  recipientPubkey: string;
  recipientName: string;
}

export default function SendCryptoModal({
  visible,
  onDismiss,
  recipientPubkey,
  recipientName,
}: SendCryptoModalProps) {
  const { connection } = useMessenger();
  const wallet = useWallet();
  const [state, setState] = useState<ModalState>('loading');
  const [solBalance, setSolBalance] = useState(0);
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [selectedToken, setSelectedToken] = useState<'SOL' | TokenBalance | null>(null);
  const [amount, setAmount] = useState('');
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadBalances = useCallback(async () => {
    if (!wallet.publicKey) return;
    setState('loading');
    try {
      const [sol, tokenAccounts] = await Promise.all([
        fetchSOLBalance(connection, wallet.publicKey),
        fetchTokenAccounts(connection, wallet.publicKey),
      ]);
      setSolBalance(sol);
      setTokens(tokenAccounts);
      setState('select');
    } catch (err: any) {
      console.error('Failed to load balances:', err);
      setError('Failed to load wallet balances');
      setState('result');
    }
  }, [connection, wallet.publicKey]);

  useEffect(() => {
    if (visible) {
      setAmount('');
      setSelectedToken(null);
      setTxSignature(null);
      setError(null);
      loadBalances();
    }
  }, [visible, loadBalances]);

  const handleSelectToken = (token: 'SOL' | TokenBalance) => {
    setSelectedToken(token);
    setAmount('');
    setState('amount');
  };

  const getMaxAmount = () => {
    if (selectedToken === 'SOL') {
      // Reserve 0.005 SOL for tx fees
      return Math.max(0, solBalance - 0.005);
    }
    if (selectedToken && typeof selectedToken !== 'string') {
      return selectedToken.balance;
    }
    return 0;
  };

  const handleMax = () => {
    setAmount(getMaxAmount().toString());
  };

  const handleContinue = () => {
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) return;
    if (num > getMaxAmount()) return;
    setState('confirm');
  };

  const handleSend = async () => {
    if (!wallet.publicKey || !selectedToken) return;
    setState('sending');

    try {
      const recipient = new PublicKey(recipientPubkey);
      const num = parseFloat(amount);

      let instructions;
      if (selectedToken === 'SOL') {
        const lamports = Math.round(num * LAMPORTS_PER_SOL);
        instructions = [createSOLTransferInstruction(wallet.publicKey, recipient, lamports)];
      } else {
        const rawAmount = BigInt(Math.round(num * Math.pow(10, selectedToken.decimals)));
        instructions = await createSPLTransferInstructions(
          connection,
          wallet.publicKey,
          recipient,
          new PublicKey(selectedToken.mint),
          rawAmount,
        );
      }

      const tx = await buildTransaction(connection, wallet.publicKey, instructions);
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig, 'confirmed');

      setTxSignature(sig);
      setError(null);
      setState('result');
    } catch (err: any) {
      console.error('Send crypto failed:', err);
      setError(err.message || 'Transaction failed');
      setState('result');
    }
  };

  const tokenLabel = selectedToken === 'SOL' ? 'SOL' : selectedToken?.mint.slice(0, 8) + '...';

  const renderContent = () => {
    switch (state) {
      case 'loading':
        return (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.loadingText}>Loading balances...</Text>
          </View>
        );

      case 'select':
        return (
          <>
            <Text style={styles.sectionTitle}>Select Token</Text>
            <TouchableOpacity style={styles.tokenRow} onPress={() => handleSelectToken('SOL')}>
              <Text style={styles.tokenIcon}>◎</Text>
              <View style={styles.tokenInfo}>
                <Text style={styles.tokenName}>SOL</Text>
                <Text style={styles.tokenBalance}>{solBalance.toFixed(4)}</Text>
              </View>
              <IconButton icon="chevron-right" size={20} iconColor={theme.colors.textSecondary} />
            </TouchableOpacity>
            <Divider style={styles.divider} />
            {tokens.map((token) => (
              <TouchableOpacity
                key={token.mint}
                style={styles.tokenRow}
                onPress={() => handleSelectToken(token)}
              >
                <Text style={styles.tokenIcon}>🪙</Text>
                <View style={styles.tokenInfo}>
                  <Text style={styles.tokenName} numberOfLines={1}>
                    {token.mint.slice(0, 8)}...
                  </Text>
                  <Text style={styles.tokenBalance}>{token.balance.toFixed(token.decimals > 4 ? 4 : token.decimals)}</Text>
                </View>
                <IconButton icon="chevron-right" size={20} iconColor={theme.colors.textSecondary} />
              </TouchableOpacity>
            ))}
            {tokens.length === 0 && (
              <Text style={styles.emptyText}>No SPL tokens found</Text>
            )}
          </>
        );

      case 'amount':
        return (
          <>
            <Text style={styles.sectionTitle}>Send {tokenLabel}</Text>
            <Text style={styles.subtitle}>
              Available: {selectedToken === 'SOL' ? solBalance.toFixed(4) : (selectedToken as TokenBalance).balance.toFixed(4)}
            </Text>
            <View style={styles.amountRow}>
              <RNTextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={theme.colors.textSecondary}
                keyboardType="decimal-pad"
                autoFocus
              />
              <Button mode="outlined" onPress={handleMax} compact style={styles.maxButton}>
                MAX
              </Button>
            </View>
            <Button
              mode="contained"
              onPress={handleContinue}
              disabled={!amount || parseFloat(amount) <= 0 || parseFloat(amount) > getMaxAmount()}
              style={styles.actionButton}
              buttonColor={theme.colors.primary}
            >
              Continue
            </Button>
          </>
        );

      case 'confirm':
        return (
          <>
            <Text style={styles.sectionTitle}>Confirm Transfer</Text>
            <View style={styles.confirmBox}>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>Token</Text>
                <Text style={styles.confirmValue}>{tokenLabel}</Text>
              </View>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>Amount</Text>
                <Text style={styles.confirmValue}>{amount}</Text>
              </View>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>To</Text>
                <Text style={styles.confirmValue} numberOfLines={1}>
                  {recipientName}
                </Text>
              </View>
              <View style={styles.confirmRow}>
                <Text style={styles.confirmLabel}>Address</Text>
                <Text style={styles.confirmValueSmall} numberOfLines={1}>
                  {recipientPubkey.slice(0, 16)}...
                </Text>
              </View>
            </View>
            <Button
              mode="contained"
              onPress={handleSend}
              style={styles.actionButton}
              buttonColor={theme.colors.primary}
            >
              Send {amount} {tokenLabel}
            </Button>
          </>
        );

      case 'sending':
        return (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.loadingText}>Sending transaction...</Text>
            <Text style={styles.subtitle}>Approve in your wallet</Text>
          </View>
        );

      case 'result':
        return (
          <View style={styles.centered}>
            {txSignature ? (
              <>
                <Text style={styles.successIcon}>✅</Text>
                <Text style={styles.sectionTitle}>Sent!</Text>
                <Text style={styles.subtitle}>
                  {amount} {tokenLabel} sent to {recipientName}
                </Text>
                <Text style={styles.txSig} numberOfLines={1}>
                  Tx: {txSignature.slice(0, 20)}...
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.successIcon}>❌</Text>
                <Text style={styles.sectionTitle}>Failed</Text>
                <Text style={styles.errorText}>{error}</Text>
              </>
            )}
          </View>
        );
    }
  };

  return (
    <Modal visible={visible} onRequestClose={onDismiss} animationType="slide" transparent={false}>
      <View style={styles.container}>
        <View style={styles.header}>
          <IconButton icon="arrow-left" size={24} iconColor={theme.colors.textPrimary} onPress={onDismiss} />
          <Text style={styles.headerTitle}>Send Crypto</Text>
          <View style={{ width: 48 }} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>{renderContent()}</ScrollView>
        {(state === 'select' || state === 'amount' || state === 'result') && (
          <Button mode="text" onPress={onDismiss} style={styles.closeButton}>
            {state === 'result' ? 'Done' : 'Cancel'}
          </Button>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surface,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  content: {
    padding: 20,
    flexGrow: 1,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    color: theme.colors.textSecondary,
    marginTop: 16,
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: 16,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    marginBottom: 8,
  },
  tokenIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  tokenInfo: {
    flex: 1,
  },
  tokenName: {
    fontSize: 16,
    fontWeight: '500',
    color: theme.colors.textPrimary,
  },
  tokenBalance: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
  emptyText: {
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 20,
  },
  divider: {
    marginVertical: 4,
    backgroundColor: 'transparent',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    padding: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    marginRight: 12,
  },
  maxButton: {
    borderColor: theme.colors.primary,
  },
  actionButton: {
    marginTop: 16,
  },
  confirmBox: {
    backgroundColor: theme.colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  confirmLabel: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
  confirmValue: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    maxWidth: '60%',
  },
  confirmValueSmall: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontFamily: 'monospace',
    maxWidth: '60%',
  },
  successIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  txSig: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: theme.colors.textSecondary,
    marginTop: 12,
  },
  errorText: {
    color: theme.colors.error,
    textAlign: 'center',
    marginTop: 8,
  },
  closeButton: {
    margin: 16,
  },
});
