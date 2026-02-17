import React, { useMemo } from 'react';
import { View, SectionList, StyleSheet, TouchableOpacity } from 'react-native';
import { Searchbar, List, Avatar, Text, Button, Divider, IconButton } from 'react-native-paper';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { theme } from '../theme';
import { useWallet } from '../contexts/WalletContext';
import { useMessenger } from '../contexts/MessengerContext';
import { useContactNames } from '../hooks/useContactNames';
import { getChatHash } from '../utils/encryption';
import { useCall } from '../contexts/CallContext';

export default function ContactsListScreen({ navigation }: any) {
  const wallet = useWallet();
  const messenger = useMessenger();
  const { startCall } = useCall();
  const [searchQuery, setSearchQuery] = React.useState('');
  const displayNames = useContactNames(wallet.publicKey, messenger.contacts);

  // Filter and sort contacts
  const acceptedContacts = messenger.contacts.filter(c => c.state === 'Accepted');

  // Get display names and sort alphabetically
  const sortedContacts = useMemo(() => {
    return acceptedContacts
      .map(contact => {
        const pubkeyStr = contact.publicKey.toBase58();
        const displayInfo = displayNames.get(pubkeyStr);
        const displayName = displayInfo?.displayName || contact.displayName || pubkeyStr;
        return {
          pubkey: pubkeyStr,
          displayName,
          avatar: contact.avatarUrl || '',
          publicKeyObj: contact.publicKey,
        };
      })
      .filter(contact => {
        if (!searchQuery.trim()) return true;
        return contact.displayName.toLowerCase().includes(searchQuery.toLowerCase());
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [acceptedContacts, displayNames, searchQuery]);

  // Group contacts by first letter
  const sections = useMemo(() => {
    const grouped = new Map<string, typeof sortedContacts>();

    sortedContacts.forEach(contact => {
      const firstLetter = contact.displayName[0]?.toUpperCase() || '#';
      const letter = /[A-Z]/.test(firstLetter) ? firstLetter : '#';

      if (!grouped.has(letter)) {
        grouped.set(letter, []);
      }
      grouped.get(letter)!.push(contact);
    });

    return Array.from(grouped.entries())
      .sort((a, b) => {
        // '#' goes last
        if (a[0] === '#') return 1;
        if (b[0] === '#') return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([letter, data]) => ({
        title: letter,
        data,
      }));
  }, [sortedContacts]);

  const handleContactPress = (contact: any) => {
    const conversationId = wallet.publicKey
      ? Buffer.from(getChatHash(wallet.publicKey, contact.publicKeyObj)).toString('hex')
      : '';

    navigation.navigate('Chat', {
      contact: {
        pubkey: contact.pubkey,
        displayName: contact.displayName,
        avatar: contact.avatar,
      },
      conversationId,
    });
  };

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <Searchbar
        placeholder="Search contacts..."
        onChangeText={setSearchQuery}
        value={searchQuery}
        style={styles.searchbar}
      />

      {/* Action Buttons */}
      <View style={styles.actionsContainer}>
        <Button
          mode="contained"
          icon="account-plus"
          onPress={() => navigation.navigate('AddContact')}
          style={styles.actionButton}
        >
          Add Contact
        </Button>
        <Button
          mode="outlined"
          icon="account-group"
          onPress={() => navigation.navigate('CreateGroup')}
          style={styles.actionButton}
        >
          New Group
        </Button>
      </View>

      <Divider style={styles.divider} />

      {/* Contacts List */}
      {sortedContacts.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No contacts found</Text>
          <Button
            mode="contained"
            onPress={() => navigation.navigate('AddContact')}
            style={styles.addFirstContactButton}
          >
            Add Your First Contact
          </Button>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.pubkey}
          renderItem={({ item }) => {
            // Show only name OR address (not both)
            // If displayName is different from pubkey, it's a real name - show only name
            // Otherwise show only the truncated address
            const isRealName = item.displayName !== item.pubkey;
            const displayText = isRealName ? item.displayName : `${item.pubkey.slice(0, 8)}...${item.pubkey.slice(-8)}`;

            return (
              <TouchableOpacity onPress={() => handleContactPress(item)}>
                <List.Item
                  title={displayText}
                  description={undefined}
                  left={(props) => (
                  item.avatar && Array.from(item.avatar).length === 1 ? (
                    <View style={styles.avatarContainer}>
                      <Text style={styles.avatarEmoji}>{item.avatar}</Text>
                    </View>
                  ) : (
                    <Avatar.Text
                      {...props}
                      size={48}
                      label={item.displayName[0]?.toUpperCase() || '?'}
                      style={{ backgroundColor: theme.colors.primary }}
                    />
                  )
                )}
                right={() => (
                    <IconButton
                      icon="phone"
                      iconColor={theme.colors.primary}
                      size={24}
                      onPress={() => startCall({
                        id: item.pubkey,
                        name: item.displayName,
                        walletAddress: item.pubkey,
                      })}
                    />
                  )}
                style={styles.contactItem}
              />
            </TouchableOpacity>
            );
          }}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{title}</Text>
            </View>
          )}
          stickySectionHeadersEnabled
          style={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  searchbar: {
    margin: 12,
    elevation: 0,
    backgroundColor: theme.colors.surface,
  },
  actionsContainer: {
    flexDirection: 'column',
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 12,
  },
  actionButton: {
    width: '100%',
  },
  divider: {
    backgroundColor: theme.colors.surfaceVariant,
  },
  list: {
    flex: 1,
  },
  sectionHeader: {
    backgroundColor: theme.colors.surface,
    paddingVertical: 4,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surfaceVariant,
  },
  sectionHeaderText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.primary,
  },
  contactItem: {
    backgroundColor: theme.colors.background,
  },
  avatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  avatarEmoji: {
    fontSize: 32,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    marginBottom: 16,
    textAlign: 'center',
  },
  addFirstContactButton: {
    marginTop: 8,
  },
});
