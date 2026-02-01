import React from 'react';
import { View, StyleSheet } from 'react-native';
import { TextInput, Button, Text, IconButton } from 'react-native-paper';
import { Connection, PublicKey } from '@solana/web3.js';
import { theme } from '../theme';
import { useWallet } from '../contexts/WalletContext';
import { useMessenger } from '../contexts/MessengerContext';
import { resolveDomain, isDomain, cacheResolvedDomain } from '../utils/domains';
import { useDarkAlert } from '../components/DarkAlert';

export default function AddContactScreen({ navigation }: any) {
  const wallet = useWallet();
  const messenger = useMessenger();
  const { showAlert, DarkAlertComponent } = useDarkAlert();
  const [address, setAddress] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const sendInvitation = async () => {
    if (!address.trim()) return;

    setLoading(true);
    try {
      let contactPubkey: PublicKey;
      let resolvedDomain: string | undefined;

      // Check if input is a domain name
      if (isDomain(address)) {
        console.log('Resolving domain:', address);

        // Create connection for domain resolution (domains are on mainnet!)
        const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');

        // Resolve domain to pubkey
        const resolved = await resolveDomain(address, connection);

        if (!resolved) {
          showAlert(
            'Domain Not Found',
            `Could not resolve ${address}. Please check the domain name and try again.`
          );
          setLoading(false);
          return;
        }

        contactPubkey = resolved.publicKey;
        resolvedDomain = resolved.domain;

        // Cache the domain for later display
        if (wallet.publicKey) {
          await cacheResolvedDomain(wallet.publicKey, contactPubkey, resolvedDomain);
        }

        console.log(`Resolved ${address} to ${contactPubkey.toBase58()}`);
      } else {
        // Direct public key input
        contactPubkey = new PublicKey(address.trim());
      }

      // Check if already in contacts
      const existingContact = messenger.contacts.find(
        c => c.publicKey.toBase58() === contactPubkey.toBase58()
      );

      if (existingContact) {
        const displayName = resolvedDomain
          ? `${resolvedDomain}.sol`
          : `${contactPubkey.toBase58().slice(0, 8)}...`;

        let message = '';
        let action = '';

        switch (existingContact.state) {
          case 'Invited':
            message = `You already sent an invitation to ${displayName}. Waiting for them to accept.`;
            break;
          case 'Requested':
            message = `${displayName} already invited you! Go to your contacts to accept.`;
            break;
          case 'Accepted':
            message = `${displayName} is already in your contacts.`;
            break;
          case 'Rejected':
            message = `You previously deleted ${displayName}. Do you want to re-invite them?`;
            action = 'Re-invite';
            break;
          case 'Blocked':
            message = `${displayName} is blocked. Unblock them first from your contacts.`;
            break;
        }

        if (action === 'Re-invite') {
          showAlert('Contact Previously Deleted', message, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Re-invite',
              onPress: async () => {
                try {
                  const tx = await messenger.invite(contactPubkey);
                  showAlert('Invitation Sent!', `Re-invited ${displayName}`, [
                    {
                      text: 'OK',
                      onPress: () => {
                        messenger.loadContacts();
                        navigation.goBack();
                      },
                    },
                  ]);
                } catch (err: any) {
                  showAlert('Error', err.message);
                }
                setLoading(false);
              },
            },
          ]);
          return;
        } else {
          showAlert('Already in Contacts', message);
          setLoading(false);
          return;
        }
      }

      // Send invitation on-chain
      const tx = await messenger.invite(contactPubkey);

      const displayName = resolvedDomain
        ? `${resolvedDomain}.sol`
        : `${contactPubkey.toBase58().slice(0, 8)}...`;

      showAlert(
        'Invitation Sent!',
        `Invitation sent to ${displayName}\n\nTransaction: ${tx.slice(0, 8)}...`,
        [
          {
            text: 'OK',
            onPress: () => {
              // Refresh contacts and navigate back
              messenger.loadContacts();
              navigation.goBack();
            },
          },
        ]
      );
    } catch (error: any) {
      console.error('Failed to send invitation:', error);

      // Parse error message for better UX
      let errorMsg = 'Failed to send invitation.';
      if (error.message?.includes('AlreadyInvited')) {
        errorMsg = 'This contact is already in your list. Check your contacts or pending invitations.';
      } else if (error.message) {
        errorMsg = error.message;
      }

      showAlert('Error', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Enter wallet address, .sol or .skr domain</Text>
      <TextInput
        value={address}
        onChangeText={setAddress}
        placeholder="alice.sol or 7xKp..."
        mode="outlined"
        style={styles.input}
        outlineColor={theme.colors.surface}
        activeOutlineColor={theme.colors.primary}
        placeholderTextColor={theme.colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>Or scan QR code</Text>
        <View style={styles.dividerLine} />
      </View>

      <View style={styles.qrRow}>
        <View style={styles.qrContainer}>
          <IconButton
            icon="qrcode-scan"
            size={48}
            iconColor={theme.colors.textSecondary}
            onPress={() => {
              // TODO: Implement QR scanner
              console.log('Open QR scanner');
            }}
          />
          <Text style={styles.qrText}>Scan QR</Text>
        </View>

        <View style={styles.qrContainer}>
          <IconButton
            icon="qrcode"
            size={48}
            iconColor={theme.colors.primary}
            onPress={() => {
              // TODO: Implement show my QR
              showAlert(
                'Show My QR',
                `Your wallet address:\n${wallet.publicKey?.toBase58()}\n\n(QR display coming soon)`
              );
            }}
          />
          <Text style={styles.qrText}>Show My QR</Text>
        </View>
      </View>

      <Button
        mode="contained"
        onPress={sendInvitation}
        loading={loading}
        disabled={!address.trim() || loading}
        style={styles.button}
        buttonColor={theme.colors.primary}
      >
        Send Invitation
      </Button>
      {DarkAlertComponent}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: theme.colors.background,
  },
  label: {
    fontSize: 16,
    color: theme.colors.textPrimary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: theme.colors.surface,
    marginBottom: 24,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.colors.surface,
  },
  dividerText: {
    marginHorizontal: 16,
    color: theme.colors.textSecondary,
  },
  qrRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  qrContainer: {
    flex: 1,
    alignItems: 'center',
    padding: 24,
    backgroundColor: theme.colors.surface,
    borderRadius: 8,
  },
  qrText: {
    color: theme.colors.textSecondary,
    marginTop: 8,
  },
  button: {
    marginTop: 'auto',
  },
});
