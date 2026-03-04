import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { DrawerContentScrollView } from '@react-navigation/drawer';
import { Avatar, Text, Divider, List } from 'react-native-paper';
import { theme } from '../theme';
import { useWallet } from '../contexts/WalletContext';
import { useMessenger } from '../contexts/MessengerContext';
import { truncateAddress } from '../utils/encryption';
import AvatarDisplay from './AvatarDisplay';

export default function CustomDrawer({ navigation }: any) {
  const wallet = useWallet();
  const messenger = useMessenger();

  const avatarUrl = messenger.profile?.avatarUrl;
  const displayName = messenger.profile?.displayName;

  return (
    <DrawerContentScrollView style={styles.container}>
      {/* Profile Section */}
      <TouchableOpacity
        style={styles.profileSection}
        onPress={() => navigation.navigate('Profile')}
      >
        <AvatarDisplay avatar={avatarUrl} size={64} name={displayName} />
        {displayName && (
          <Text style={styles.displayName}>{displayName}</Text>
        )}
        <Text style={styles.walletAddress}>
          {wallet.publicKey ? truncateAddress(wallet.publicKey.toBase58(), 6) : 'Not connected'}
        </Text>
      </TouchableOpacity>

      <Divider style={styles.divider} />

      {/* Navigation Items */}
      <List.Item
        title="Chats"
        left={(props) => <List.Icon {...props} icon="message-text" color={theme.colors.primary} />}
        onPress={() => navigation.navigate('Contacts')}
        titleStyle={styles.menuItem}
      />

      <List.Item
        title="Contacts"
        left={(props) => <List.Icon {...props} icon="account-multiple" color={theme.colors.primary} />}
        onPress={() => navigation.navigate('ContactsList')}
        titleStyle={styles.menuItem}
      />

      <List.Item
        title="New Group"
        left={(props) => <List.Icon {...props} icon="account-group-outline" color={theme.colors.secondary} />}
        onPress={() => navigation.navigate('CreateGroup')}
        titleStyle={styles.menuItem}
      />

      <List.Item
        title="Saved Messages"
        left={(props) => <List.Icon {...props} icon="bookmark" color={theme.colors.primary} />}
        onPress={() => {
          // TODO: Navigate to saved messages
          navigation.closeDrawer();
        }}
        titleStyle={styles.menuItem}
      />

      <Divider style={styles.divider} />

      <List.Item
        title="Settings"
        left={(props) => <List.Icon {...props} icon="cog" color={theme.colors.textSecondary} />}
        onPress={() => {
          navigation.navigate('Settings');
          navigation.closeDrawer();
        }}
        titleStyle={styles.menuItem}
      />

      <List.Item
        title="Add Contact"
        left={(props) => <List.Icon {...props} icon="account-plus" color={theme.colors.textSecondary} />}
        onPress={() => {
          navigation.navigate('AddContact');
          navigation.closeDrawer();
        }}
        titleStyle={styles.menuItem}
      />

      <Divider style={styles.divider} />

      <List.Item
        title="Logout"
        left={(props) => <List.Icon {...props} icon="logout" color={theme.colors.error} />}
        onPress={() => {
          wallet.disconnect();
          navigation.closeDrawer();
        }}
        titleStyle={[styles.menuItem, { color: theme.colors.error }]}
      />
    </DrawerContentScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.background,
  },
  profileSection: {
    padding: 24,
    alignItems: 'center',
  },
  avatar: {
    backgroundColor: theme.colors.primary,
    marginBottom: 12,
  },
  emojiAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  emojiAvatarText: {
    fontSize: 40,
  },
  displayName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  walletAddress: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
  divider: {
    backgroundColor: theme.colors.surface,
    marginVertical: 8,
  },
  menuItem: {
    color: theme.colors.textPrimary,
    fontSize: 16,
  },
});
