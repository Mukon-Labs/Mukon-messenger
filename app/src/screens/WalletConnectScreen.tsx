import React from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { theme } from '../theme';
import { useWallet } from '../contexts/WalletContext';

export default function WalletConnectScreen() {
  const { connect, connecting } = useWallet();

  const handleConnect = async () => {
    try {
      await connect();
    } catch (error) {
      console.error('Connection failed:', error);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Image
          source={require('../../assets/logo-onboard.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>&lt;encrypted&gt; Messenger</Text>
        <Text style={styles.subtitle}>
          Private wallet-to-wallet messaging on Solana
        </Text>

        <View style={styles.features}>
          <Text style={styles.feature}>🔒 End-to-end encrypted messages</Text>
          <Text style={styles.feature}>🔐 Encrypted contact list (Arcium MPC)</Text>
          <Text style={styles.feature}>💸 Free messaging (off-chain)</Text>
          <Text style={styles.feature}>🎯 Your wallet = your identity</Text>
        </View>

        <Button
          mode="contained"
          onPress={handleConnect}
          loading={connecting}
          disabled={connecting}
          style={styles.connectButton}
          labelStyle={styles.connectButtonLabel}
        >
          {connecting ? 'Connecting...' : 'Connect Wallet'}
        </Button>

        <Text style={styles.helpText}>
          This will open your Solana wallet (Phantom, Solflare, etc.)
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 320,
    height: 80,
    marginBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  features: {
    width: '100%',
    marginBottom: 48,
  },
  feature: {
    fontSize: 16,
    color: theme.colors.textPrimary,
    marginBottom: 12,
    paddingLeft: 8,
  },
  connectButton: {
    width: '100%',
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
  },
  connectButtonLabel: {
    fontSize: 18,
    color: theme.colors.onPrimary,
  },
  helpText: {
    marginTop: 16,
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
});
