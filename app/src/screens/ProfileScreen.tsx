import React from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { TextInput, Button, Text, Avatar, List, IconButton } from 'react-native-paper';
import { theme } from '../theme';
import { truncateAddress } from '../utils/encryption';
import { useWallet } from '../contexts/WalletContext';
import { useMessenger } from '../contexts/MessengerContext';
import EmojiPicker from '../components/EmojiPicker';
import { useDarkAlert } from '../components/DarkAlert';
import { useNavigation } from '@react-navigation/native';

export default function ProfileScreen() {
  const { publicKey, disconnect } = useWallet();
  const messenger = useMessenger();
  const navigation = useNavigation();
  const { showAlert, DarkAlertComponent } = useDarkAlert();
  const [displayName, setDisplayName] = React.useState('');
  const [emojiPickerVisible, setEmojiPickerVisible] = React.useState(false);
  const [selectedEmoji, setSelectedEmoji] = React.useState<string | null>(null);
  const [initialName, setInitialName] = React.useState('');
  const [initialEmoji, setInitialEmoji] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (messenger.profile) {
      const name = messenger.profile.displayName || '';
      const emoji = messenger.profile.avatarUrl || null;
      setDisplayName(name);
      setSelectedEmoji(emoji);
      setInitialName(name);
      setInitialEmoji(emoji);
    }
  }, [messenger.profile]);

  const hasUnsavedChanges = displayName !== initialName || selectedEmoji !== initialEmoji;

  const handleEmojiSelect = (emoji: string) => {
    setSelectedEmoji(emoji);
    // No transaction here - save on button press
  };

  const saveProfile = async () => {
    if (!hasUnsavedChanges) return;

    try {
      await messenger.updateProfile(displayName.trim(), 'Emoji', selectedEmoji || undefined);
      setInitialName(displayName.trim());
      setInitialEmoji(selectedEmoji);
      showAlert('Success', 'Profile updated!');
    } catch (error: any) {
      showAlert('Error', 'Failed to update profile');
      console.error('Failed to update profile:', error);
    }
  };

  const handleDisconnect = () => {
    showAlert(
      'Disconnect Wallet',
      'Are you sure you want to disconnect your wallet?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await disconnect();
          },
        },
      ]
    );
  };

  const walletAddress = publicKey?.toBase58() || '';

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setEmojiPickerVisible(true)}>
          {selectedEmoji ? (
            <View style={styles.emojiAvatar}>
              <Text style={styles.emojiAvatarText}>{selectedEmoji}</Text>
            </View>
          ) : (
            <Avatar.Text
              size={96}
              label={displayName ? displayName[0].toUpperCase() : walletAddress ? walletAddress[0].toUpperCase() : '?'}
              style={styles.avatar}
            />
          )}
          <Text style={styles.changeAvatarText}>Tap to change avatar</Text>
        </TouchableOpacity>

        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          mode="outlined"
          placeholder="Enter display name"
          label="Username"
          style={styles.nameInput}
          outlineColor={theme.colors.surface}
          activeOutlineColor={theme.colors.primary}
        />
        <Text style={styles.pubkey}>{truncateAddress(walletAddress, 6)}</Text>
        <Text style={styles.skrHint}>
          {/* TODO: Add .skr reverse lookup on mainnet */}
          Your .skr domain will show here on mainnet
        </Text>
      </View>

      <List.Section style={styles.section}>
        <List.Subheader style={styles.subheader}>Wallet</List.Subheader>
        <List.Item
          title="Address"
          description={walletAddress}
          left={(props) => <List.Icon {...props} icon="wallet" />}
          right={(props) => (
            <IconButton
              {...props}
              icon="qrcode"
              iconColor={theme.colors.primary}
              onPress={() => navigation.navigate('QRCodeDisplay' as never)}
            />
          )}
          style={styles.listItem}
        />
      </List.Section>

      <List.Section style={styles.section}>
        <List.Subheader style={styles.subheader}>Privacy</List.Subheader>
        <List.Item
          title="End-to-End Encryption"
          description="All messages are encrypted"
          left={(props) => <List.Icon {...props} icon="lock" color={theme.colors.secondary} />}
          style={styles.listItem}
        />
        <List.Item
          title="On-Chain Contacts"
          description="Contact list stored on Solana"
          left={(props) => <List.Icon {...props} icon="shield-check" color={theme.colors.secondary} />}
          style={styles.listItem}
        />
      </List.Section>

      <Button
        mode="contained"
        onPress={saveProfile}
        style={styles.button}
        buttonColor={theme.colors.primary}
        disabled={!hasUnsavedChanges}
      >
        Update Profile
      </Button>

      <Button
        mode="outlined"
        onPress={handleDisconnect}
        style={styles.button}
        textColor={theme.colors.accent}
      >
        Disconnect Wallet
      </Button>

      <Text style={styles.version}>Mukon Messenger v1.0.0-alpha</Text>

      <EmojiPicker
        visible={emojiPickerVisible}
        onDismiss={() => setEmojiPickerVisible(false)}
        onSelect={handleEmojiSelect}
      />
      {DarkAlertComponent}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    alignItems: 'center',
    padding: 24,
  },
  avatar: {
    backgroundColor: theme.colors.primary,
    marginBottom: 8,
  },
  emojiAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  emojiAvatarText: {
    fontSize: 60,
  },
  changeAvatarText: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    marginBottom: 12,
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  nameInput: {
    width: '80%',
    marginBottom: 12,
    marginTop: 8,
    backgroundColor: theme.colors.surface,
  },
  pubkey: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: 4,
  },
  skrHint: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    fontStyle: 'italic',
  },
  section: {
    marginTop: 16,
  },
  subheader: {
    color: theme.colors.textSecondary,
  },
  listItem: {
    backgroundColor: theme.colors.surface,
    marginHorizontal: 16,
    marginVertical: 2,
    borderRadius: 8,
  },
  button: {
    margin: 16,
  },
  version: {
    textAlign: 'center',
    color: theme.colors.textSecondary,
    fontSize: 12,
    marginVertical: 24,
  },
});
