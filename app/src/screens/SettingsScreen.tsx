import React, { useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { List, Text, Button, Portal, Dialog, Divider } from 'react-native-paper';
import { theme } from '../theme';
import { useMessenger } from '../contexts/MessengerContext';
import { useWallet } from '../contexts/WalletContext';
import { useNavigation } from '@react-navigation/native';
import { useDarkAlert } from '../components/DarkAlert';

export default function SettingsScreen() {
  const messenger = useMessenger();
  const wallet = useWallet();
  const navigation = useNavigation();
  const { showAlert, DarkAlertComponent } = useDarkAlert();
  const [deleteDialogVisible, setDeleteDialogVisible] = useState(false);

  const handleCloseProfile = () => {
    showAlert(
      '⚠️ Warning: Destructive Action',
      'This will permanently delete your profile account and return the rent to your wallet.\n\n' +
      'You will need to re-register to use Mukon again.\n\n' +
      'This is ONLY for testing during development. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close Profile',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeleteDialogVisible(true);
              await messenger.closeProfile();
              setDeleteDialogVisible(false);

              showAlert(
                'Profile Closed',
                'Your profile has been deleted and rent returned to your wallet. You can now re-register with updated account schema.',
                [
                  {
                    text: 'OK',
                    onPress: () => {
                      // Navigate back to main screen (will show registration prompt)
                      navigation.navigate('Main' as never);
                    },
                  },
                ]
              );
            } catch (error: any) {
              setDeleteDialogVisible(false);
              showAlert('Error', `Failed to close profile: ${error.message}`);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      <List.Section>
        <List.Subheader style={styles.subheader}>Account</List.Subheader>

        <List.Item
          title="Profile"
          description="Edit your display name and avatar"
          left={(props) => <List.Icon {...props} icon="account-edit" />}
          onPress={() => navigation.navigate('Profile' as never)}
          style={styles.listItem}
        />

        <List.Item
          title="Wallet"
          description={wallet.publicKey?.toBase58().slice(0, 16) + '...' || 'Not connected'}
          left={(props) => <List.Icon {...props} icon="wallet" />}
          style={styles.listItem}
        />
      </List.Section>

      <Divider style={styles.divider} />

      <List.Section>
        <List.Subheader style={styles.subheader}>Privacy</List.Subheader>

        <List.Item
          title="Blocked Contacts"
          description="Manage blocked users"
          left={(props) => <List.Icon {...props} icon="account-cancel" />}
          onPress={() => {
            // TODO: Navigate to blocked contacts screen
            showAlert('Coming Soon', 'Blocked contacts management');
          }}
          style={styles.listItem}
        />

        <List.Item
          title="Encryption Keys"
          description="Derived from wallet signature"
          left={(props) => <List.Icon {...props} icon="lock" />}
          right={() => (
            <Text style={styles.statusText}>
              {messenger.encryptionReady ? 'Active' : 'Not Ready'}
            </Text>
          )}
          style={styles.listItem}
        />
      </List.Section>

      <Divider style={styles.divider} />

      <List.Section>
        <List.Subheader style={styles.subheader}>About</List.Subheader>

        <List.Item
          title="Version"
          description="Mukon Messenger v0.1.0 (Devnet)"
          left={(props) => <List.Icon {...props} icon="information" />}
          style={styles.listItem}
        />

        <List.Item
          title="Program ID"
          description="54QTyrUR...bf359d"
          left={(props) => <List.Icon {...props} icon="code-braces" />}
          onPress={() => {
            showAlert(
              'Program ID',
              '54QTyrURUpcwjxbQyeC75xS8vg73pFNnuqhiFtNgGcqy\n\nRunning on Solana Devnet'
            );
          }}
          style={styles.listItem}
        />
      </List.Section>

      <Divider style={styles.divider} />

      <List.Section>
        <List.Subheader style={[styles.subheader, styles.dangerSubheader]}>
          Danger Zone
        </List.Subheader>

        <List.Item
          title="Close Profile Account"
          description="Delete profile & return rent (for testing)"
          left={(props) => <List.Icon {...props} icon="delete-forever" color={theme.colors.error} />}
          titleStyle={styles.dangerText}
          descriptionStyle={styles.dangerDescription}
          onPress={handleCloseProfile}
          style={[styles.listItem, styles.dangerItem]}
        />
      </List.Section>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          ⚠️ Development Build
        </Text>
        <Text style={styles.footerSubtext}>
          "Close Profile Account" is only for testing during development.{'\n'}
          It will be removed/restricted before mainnet launch.
        </Text>
      </View>

      <Portal>
        <Dialog visible={deleteDialogVisible} dismissable={false} style={{ backgroundColor: theme.colors.surface }}>
          <Dialog.Title style={{ color: theme.colors.textPrimary }}>Closing Profile...</Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: theme.colors.textPrimary }}>Please confirm the transaction in your wallet.</Text>
          </Dialog.Content>
        </Dialog>
      </Portal>
      {DarkAlertComponent}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  subheader: {
    color: theme.colors.textSecondary,
  },
  dangerSubheader: {
    color: theme.colors.error,
  },
  listItem: {
    backgroundColor: theme.colors.surface,
    marginHorizontal: 16,
    marginVertical: 2,
    borderRadius: 8,
  },
  dangerItem: {
    borderWidth: 1,
    borderColor: theme.colors.error + '40',
  },
  dangerText: {
    color: theme.colors.error,
  },
  dangerDescription: {
    color: theme.colors.error + 'AA',
  },
  divider: {
    backgroundColor: theme.colors.surface,
    marginVertical: 16,
  },
  statusText: {
    color: theme.colors.textSecondary,
    alignSelf: 'center',
  },
  footer: {
    padding: 24,
    marginTop: 16,
  },
  footerText: {
    color: theme.colors.error,
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
  },
  footerSubtext: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
