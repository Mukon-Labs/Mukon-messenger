import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Button, IconButton } from 'react-native-paper';
import QRCode from 'react-native-qrcode-svg';
import { theme } from '../theme';
import { useWallet } from '../contexts/WalletContext';
import { useDarkAlert } from '../components/DarkAlert';
import * as Clipboard from 'expo-clipboard';

export default function QRCodeDisplayScreen({ navigation }: any) {
  const { publicKey } = useWallet();
  const { showAlert, DarkAlertComponent } = useDarkAlert();
  
  const walletAddress = publicKey?.toBase58() || '';

  const handleCopyAddress = async () => {
    if (!walletAddress) return;
    await Clipboard.setStringAsync(walletAddress);
    showAlert('Copied!', 'Wallet address copied to clipboard');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Your Wallet QR Code</Text>
        <Text style={styles.subtitle}>
          Share this QR code so others can send you tokens or add you as a contact
        </Text>
      </View>

      <View style={styles.qrContainer}>
        {walletAddress ? (
          <QRCode
            value={walletAddress}
            size={250}
            backgroundColor="white"
            color="black"
          />
        ) : (
          <Text style={styles.noWallet}>No wallet connected</Text>
        )}
      </View>

      <View style={styles.addressContainer}>
        <Text style={styles.addressLabel}>Wallet Address</Text>
        <View style={styles.addressRow}>
          <Text style={styles.address} numberOfLines={2}>
            {walletAddress}
          </Text>
          <IconButton
            icon="content-copy"
            size={20}
            iconColor={theme.colors.primary}
            onPress={handleCopyAddress}
          />
        </View>
      </View>

      <Button
        mode="contained"
        onPress={handleCopyAddress}
        style={styles.button}
        buttonColor={theme.colors.primary}
        icon="content-copy"
      >
        Copy Address
      </Button>

      <Text style={styles.hint}>
        This QR code contains your wallet address. Anyone can scan it to see your address or add you as a contact in Mukon Messenger.
      </Text>

      {DarkAlertComponent}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'white',
    borderRadius: 16,
    marginBottom: 24,
  },
  noWallet: {
    fontSize: 16,
    color: theme.colors.textSecondary,
  },
  addressContainer: {
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  addressLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 8,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  address: {
    fontSize: 14,
    color: theme.colors.textPrimary,
    flex: 1,
    fontFamily: 'monospace',
  },
  button: {
    marginBottom: 16,
  },
  hint: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
  },
});
