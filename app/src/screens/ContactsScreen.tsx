import React from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { List, FAB, Searchbar, Avatar, Badge, Text, Button, Menu, Dialog, Portal, TextInput, Chip } from 'react-native-paper';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme';
import { truncateAddress, getChatHash } from '../utils/encryption';
import { useWallet } from '../contexts/WalletContext';
import { useMessenger } from '../contexts/MessengerContext';
import { useContactNames } from '../hooks/useContactNames';
import { setContactCustomName, getContactCustomName, getCachedDomain, getGroupAvatar } from '../utils/domains';
import ContactProfileModal from '../components/ContactProfileModal';
import ChatBackground from '../components/ChatBackground';
import { useDarkAlert } from '../components/DarkAlert';

type FilterType = 'All' | 'DMs' | 'Groups' | 'Unread' | 'Invites';

export default function ContactsScreen({ navigation }: any) {
  const wallet = useWallet();
  const messenger = useMessenger();
  const { showAlert, DarkAlertComponent } = useDarkAlert();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [registering, setRegistering] = React.useState(false);
  const [menuVisible, setMenuVisible] = React.useState<string | null>(null);
  const [groupMenuVisible, setGroupMenuVisible] = React.useState<string | null>(null);
  const [renameDialogVisible, setRenameDialogVisible] = React.useState(false);
  const [renamingContact, setRenamingContact] = React.useState<{ pubkey: string; currentName: string } | null>(null);
  const [newName, setNewName] = React.useState('');
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [filter, setFilter] = React.useState<FilterType>('All');
  const [selectedContactForProfile, setSelectedContactForProfile] = React.useState<any>(null);
  const [profileModalVisible, setProfileModalVisible] = React.useState(false);
  const displayNames = useContactNames(wallet.publicKey, messenger.contacts, refreshKey);

  // Compute values for selected contact modal (must be before early returns)
  const selectedContactOriginalName = React.useMemo(() => {
    if (!selectedContactForProfile) return '';
    const contact = messenger.contacts.find(c => c.publicKey.toBase58() === selectedContactForProfile.pubkey);
    return contact?.displayName || selectedContactForProfile.pubkey;
  }, [selectedContactForProfile, messenger.contacts]);

  const selectedContactGroupsInCommon = React.useMemo(() => {
    if (!selectedContactForProfile || !wallet.publicKey) return [];
    return messenger.groups
      .filter(g => g.members.some(m => m.toBase58() === selectedContactForProfile.pubkey))
      .map(g => ({
        groupId: Buffer.from(g.groupId).toString('hex'),
        name: g.name,
        avatar: messenger.groupAvatars.get(Buffer.from(g.groupId).toString('hex')),
      }));
  }, [messenger.groups, messenger.groupAvatars, selectedContactForProfile, wallet.publicKey]);

  // Refresh display names when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      setRefreshKey(prev => prev + 1);
    }, [])
  );

  // Register user if not already registered
  const handleRegister = async () => {
    setRegistering(true);
    try {
      await messenger.register(''); // Empty display name for now
      showAlert('Success', 'Registration complete! You can now add contacts.');
      await messenger.loadProfile();
    } catch (error: any) {
      console.error('Registration failed:', error);
      showAlert('Error', 'Registration failed. Please try again.');
    } finally {
      setRegistering(false);
    }
  };

  // Show registration screen if not registered
  if (messenger.profile === null && !messenger.loading && wallet.connected) {
    return (
      <View style={styles.registrationContainer}>
        <Avatar.Icon
          size={120}
          icon="account-plus"
          style={styles.registrationIcon}
        />
        <Text style={styles.registrationTitle}>Welcome to Mukon!</Text>
        <Text style={styles.registrationText}>
          Register to start adding contacts and sending encrypted messages.
        </Text>
        <Button
          mode="contained"
          onPress={handleRegister}
          loading={registering}
          disabled={registering}
          style={styles.registrationButton}
          buttonColor={theme.colors.primary}
        >
          Register Now
        </Button>
      </View>
    );
  }

  const contacts = messenger.contacts.map((contact, index) => {
    // Calculate conversation ID for this contact
    const conversationId = wallet.publicKey
      ? Buffer.from(getChatHash(wallet.publicKey, contact.publicKey)).toString('hex')
      : '';

    // Get unread count for this conversation
    const unread = messenger.unreadCounts.get(conversationId) || 0;

    // Get last message from this conversation
    const conversationMessages = messenger.messages.get(conversationId) || [];
    const lastMessage = conversationMessages.length > 0
      ? conversationMessages[conversationMessages.length - 1]
      : null;

    // Decrypt last message if encrypted
    let lastMessageText = '';
    if (lastMessage) {
      const isMe = lastMessage.sender === wallet.publicKey?.toBase58();

      // If it's our message OR it has plaintext content, use that
      if (lastMessage.content) {
        lastMessageText = lastMessage.content;
      } else if (lastMessage.encrypted && lastMessage.nonce) {
        // Decrypt any encrypted message (both incoming and our own)
        try {
          const senderPubkey = new PublicKey(lastMessage.sender);
          const recipientPubkey = contact.publicKey; // The contact is the other person
          const decrypted = messenger.decryptConversationMessage(
            lastMessage.encrypted,
            lastMessage.nonce,
            senderPubkey,
            recipientPubkey
          );
          lastMessageText = decrypted || '[Encrypted]';
        } catch (error) {
          lastMessageText = '[Encrypted]';
        }
      } else {
        lastMessageText = '[Encrypted]';
      }
    }

    // Get display name from hook (custom name > domain > on-chain name > pubkey)
    const pubkeyStr = contact.publicKey.toBase58();
    const displayInfo = displayNames.get(pubkeyStr);
    const displayName = displayInfo?.displayName || contact.displayName || truncateAddress(pubkeyStr, 4);

    return {
      id: pubkeyStr,
      displayName,
      pubkey: pubkeyStr,
      state: contact.state, // Invited, Requested, Accepted, Rejected, Blocked
      lastMessage: lastMessageText,
      timestamp: lastMessage ? new Date(lastMessage.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      unread,
      avatar: contact.avatarUrl || '', // Emoji avatar if set
    };
  });

  const renderContact = ({ item }: any) => {
    // Handle groups differently
    if (item.type === 'group') {
      const group = item.group;
      const isCreator = wallet.publicKey?.equals(group.creator);

      return (
        <Menu
          visible={groupMenuVisible === item.id}
          onDismiss={() => setGroupMenuVisible(null)}
          anchor={
            <TouchableOpacity
              onPress={() => navigation.navigate('GroupChat', {
                groupId: item.id,
                groupName: item.displayName,
              })}
              onLongPress={() => setGroupMenuVisible(item.id)}
            >
              <List.Item
                title={item.displayName}
                description={item.lastMessage || `${group.members.length} members`}
                left={(props) => {
                  const avatar = messenger.groupAvatars.get(item.id);
                  return avatar ? (
                    <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.surface, justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ fontSize: 32 }}>{avatar}</Text>
                    </View>
                  ) : (
                    <Avatar.Icon
                      {...props}
                      size={48}
                      icon="account-group"
                      style={{ backgroundColor: theme.colors.secondary }}
                    />
                  );
                }}
                right={(props) => (
                  <View style={styles.rightContainer}>
                    {item.timestamp && <Text style={styles.timestamp}>{item.timestamp}</Text>}
                    {item.unread > 0 && (
                      <Badge style={styles.badge}>{item.unread}</Badge>
                    )}
                  </View>
                )}
                style={styles.contactItem}
              />
            </TouchableOpacity>
          }
        >
          <Menu.Item
            onPress={() => {
              setGroupMenuVisible(null);
              navigation.navigate('GroupInfo', {
                groupId: item.id,
                groupName: item.displayName
              });
            }}
            title="View Info"
            leadingIcon="information"
          />
          {!isCreator && (
            <Menu.Item
              onPress={() => {
                setGroupMenuVisible(null);
                showAlert(
                  'Leave Group',
                  `Leave "${item.displayName}"? You can be re-invited later.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Leave',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await messenger.leaveGroup(group.groupId);
                          showAlert('Left', `You left "${item.displayName}"`);
                        } catch (error: any) {
                          showAlert('Error', error.message);
                        }
                      },
                    },
                  ]
                );
              }}
              title="Leave Group"
              leadingIcon="exit-to-app"
            />
          )}
          {isCreator && (
            <Menu.Item
              onPress={() => {
                setGroupMenuVisible(null);
                showAlert(
                  'Delete Group',
                  `Delete "${item.displayName}"? This will remove the group for all members.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await messenger.closeGroup(group.groupId);
                          showAlert('Deleted', `"${item.displayName}" has been deleted`);
                        } catch (error: any) {
                          showAlert('Error', error.message);
                        }
                      },
                    },
                  ]
                );
              }}
              title="Delete Group"
              leadingIcon="delete"
            />
          )}
        </Menu>
      );
    }

    // Show different UI based on peer state
    if (item.state === 'Requested') {
      // They invited you - show Accept/Decline buttons
      return (
        <List.Item
          title={item.displayName || truncateAddress(item.pubkey, 4)}
          description="Wants to connect with you"
          left={(props) => (
            item.avatar && Array.from(item.avatar).length === 1 ? (
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.surface, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontSize: 32 }}>{item.avatar}</Text>
              </View>
            ) : (
              <Avatar.Text
                {...props}
                size={48}
                label={item.displayName ? item.displayName[0].toUpperCase() : '?'}
                style={{ backgroundColor: theme.colors.accent }}
              />
            )
          )}
          right={() => (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                mode="contained"
                compact
                onPress={async () => {
                  try {
                    await messenger.acceptInvitation(new PublicKey(item.pubkey));
                    showAlert('Success', 'Invitation accepted!');
                  } catch (error: any) {
                    showAlert('Error', error.message);
                  }
                }}
                style={{ backgroundColor: theme.colors.secondary }}
              >
                Accept
              </Button>
              <Button
                mode="outlined"
                compact
                onPress={async () => {
                  try {
                    await messenger.rejectInvitation(new PublicKey(item.pubkey));
                    showAlert('Declined', 'Invitation declined');
                  } catch (error: any) {
                    showAlert('Error', error.message);
                  }
                }}
              >
                Decline
              </Button>
            </View>
          )}
          style={styles.contactItem}
        />
      );
    }

    if (item.state === 'Invited') {
      // You invited them - show pending with cancel option
      return (
        <List.Item
          title={item.displayName || truncateAddress(item.pubkey, 4)}
          description="Invitation pending..."
          left={(props) => (
            item.avatar && Array.from(item.avatar).length === 1 ? (
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.surface, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontSize: 32 }}>{item.avatar}</Text>
              </View>
            ) : (
              <Avatar.Text
                {...props}
                size={48}
                label={item.displayName ? item.displayName[0].toUpperCase() : '?'}
                style={{ backgroundColor: theme.colors.textSecondary }}
              />
            )
          )}
          right={(props) => (
            <View style={{ justifyContent: 'center', paddingRight: 8 }}>
              <Button
                mode="text"
                onPress={async () => {
                  showAlert(
                    'Cancel Invitation',
                    `Cancel invitation to ${item.displayName || truncateAddress(item.pubkey, 4)}?`,
                    [
                      { text: 'No', style: 'cancel' },
                      {
                        text: 'Yes, Cancel',
                        onPress: async () => {
                          try {
                            await messenger.deleteContact(new PublicKey(item.pubkey));
                            showAlert('Cancelled', 'Invitation cancelled');
                          } catch (error: any) {
                            showAlert('Error', error.message);
                          }
                        },
                      },
                    ]
                  );
                }}
                textColor={theme.colors.error}
              >
                Cancel
              </Button>
            </View>
          )}
          style={styles.contactItem}
        />
      );
    }

    // Blocked contact - show unblock option
    if (item.state === 'Blocked') {
      return (
        <List.Item
          title={item.displayName || truncateAddress(item.pubkey, 4)}
          description="Blocked"
          left={(props) => (
            item.avatar && Array.from(item.avatar).length === 1 ? (
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.surface, justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ fontSize: 32 }}>{item.avatar}</Text>
              </View>
            ) : (
              <Avatar.Text
                {...props}
                size={48}
                label={item.displayName ? item.displayName[0].toUpperCase() : '?'}
                style={{ backgroundColor: '#888' }}
              />
            )
          )}
          right={() => (
            <Button
              mode="outlined"
              onPress={async () => {
                showAlert(
                  'Unblock Contact',
                  `Unblock ${item.displayName || truncateAddress(item.pubkey, 4)}?`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Unblock',
                      onPress: async () => {
                        try {
                          await messenger.unblockContact(new PublicKey(item.pubkey));
                          showAlert('Unblocked', 'Contact unblocked. You can now accept invitations from them.');
                        } catch (error: any) {
                          showAlert('Error', error.message);
                        }
                      },
                    },
                  ]
                );
              }}
            >
              Unblock
            </Button>
          )}
          style={styles.contactItem}
        />
      );
    }

    // Accepted - normal contact with long-press menu
    return (
      <Menu
        visible={menuVisible === item.id}
        onDismiss={() => setMenuVisible(null)}
        anchor={
          <TouchableOpacity
            onPress={() => navigation.navigate('Chat', { contact: item })}
            onLongPress={() => setMenuVisible(item.id)}
          >
            <List.Item
              title={item.displayName || truncateAddress(item.pubkey, 4)}
              description={item.lastMessage}
              left={(props) => (
                item.avatar && Array.from(item.avatar).length === 1 ? (
                  <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: theme.colors.surface, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ fontSize: 32 }}>{item.avatar}</Text>
                  </View>
                ) : (
                  <Avatar.Text
                    {...props}
                    size={48}
                    label={item.displayName ? item.displayName[0].toUpperCase() : '?'}
                    style={{ backgroundColor: theme.colors.primary }}
                  />
                )
              )}
              right={(props) => (
                <View style={styles.rightContainer}>
                  <Text style={styles.timestamp}>{item.timestamp}</Text>
                  {item.unread > 0 && (
                    <Badge style={styles.badge}>{item.unread}</Badge>
                  )}
                </View>
              )}
              style={styles.contactItem}
            />
          </TouchableOpacity>
        }
      >
        <Menu.Item
          onPress={() => {
            setMenuVisible(null);
            setSelectedContactForProfile(item);
            setProfileModalVisible(true);
          }}
          title="View Profile"
          leadingIcon="account-circle"
        />
        <Menu.Item
          onPress={() => {
            setMenuVisible(null);
            setRenamingContact({ pubkey: item.pubkey, currentName: item.displayName });
            setNewName('');
            setRenameDialogVisible(true);
          }}
          title="Rename Contact"
          leadingIcon="pencil"
        />
        <Menu.Item
          onPress={async () => {
            setMenuVisible(null);
            showAlert(
              'Delete Contact',
              `Remove ${item.displayName || truncateAddress(item.pubkey, 4)} from your contacts? You can re-add them later.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await messenger.rejectInvitation(new PublicKey(item.pubkey));
                      showAlert('Deleted', 'Contact removed');
                    } catch (error: any) {
                      showAlert('Error', error.message);
                    }
                  },
                },
              ]
            );
          }}
          title="Delete Contact"
        />
        <Menu.Item
          onPress={async () => {
            setMenuVisible(null);
            showAlert(
              'Block Contact',
              `Block ${item.displayName || truncateAddress(item.pubkey, 4)}? They won't be able to contact you until unblocked.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Block',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await messenger.blockContact(new PublicKey(item.pubkey));
                      showAlert('Blocked', 'Contact blocked. You can unblock them later.');
                    } catch (error: any) {
                      showAlert('Error', error.message);
                    }
                  },
                },
              ]
            );
          }}
          title="Block Contact"
        />
      </Menu>
    );
  };

  const handleRename = async () => {
    if (!renamingContact || !wallet.publicKey) return;

    try {
      const pubkey = new PublicKey(renamingContact.pubkey);
      await setContactCustomName(wallet.publicKey, pubkey, newName);
      setRenameDialogVisible(false);
      setRenamingContact(null);
      setNewName('');

      // Force re-render by updating refresh key
      setRefreshKey(prev => prev + 1);
    } catch (error: any) {
      showAlert('Error', 'Failed to rename contact');
    }
  };

  // Combine DMs and Groups into unified list
  const allConversations = [
    ...contacts.map(c => ({ ...c, type: 'dm' as const })),
    ...messenger.groups.map(g => ({
      id: Buffer.from(g.groupId).toString('hex'),
      displayName: g.name,
      pubkey: '',
      type: 'group' as const,
      state: 'Accepted',
      lastMessage: '', // TODO: Get last group message
      timestamp: '',
      unread: messenger.unreadCounts.get(Buffer.from(g.groupId).toString('hex')) || 0,
      avatar: '', // TODO: Group emoji avatar
      group: g,
    })),
  ];

  // Apply filter
  const filteredConversations = allConversations.filter(item => {
    if (filter === 'DMs') return item.type === 'dm' && item.state === 'Accepted';
    if (filter === 'Groups') return item.type === 'group';
    if (filter === 'Unread') return item.unread > 0;
    if (filter === 'Invites') return item.state === 'Requested' || item.state === 'Invited';
    return true; // 'All'
  });

  // Contact profile modal helpers (Fix 1)
  const handleContactRename = async (contactPubkey: string, newName: string) => {
    if (!wallet.publicKey) return;
    try {
      await setContactCustomName(wallet.publicKey, new PublicKey(contactPubkey), newName);
      setRefreshKey(prev => prev + 1); // Trigger refresh
      // Update the modal's displayed name
      if (selectedContactForProfile && selectedContactForProfile.pubkey === contactPubkey) {
        setSelectedContactForProfile({
          ...selectedContactForProfile,
          displayName: newName,
        });
      }
    } catch (error: any) {
      showAlert('Error', 'Failed to rename contact');
    }
  };

  const handleContactResetName = async (contactPubkey: string) => {
    if (!wallet.publicKey) return;
    try {
      await setContactCustomName(wallet.publicKey, new PublicKey(contactPubkey), ''); // Clear custom name
      setRefreshKey(prev => prev + 1); // Trigger refresh
      // Update selectedContactForProfile to show original name immediately (Fix 1)
      if (selectedContactForProfile && selectedContactForProfile.pubkey === contactPubkey) {
        setSelectedContactForProfile((prev: any) => ({
          ...prev,
          displayName: prev.originalName || contactPubkey,
        }));
      }
    } catch (error: any) {
      showAlert('Error', 'Failed to reset name');
    }
  };

  return (
    <View style={styles.container}>
      <ChatBackground />
      <Searchbar
        placeholder="Search conversations..."
        onChangeText={setSearchQuery}
        value={searchQuery}
        style={styles.searchbar}
        iconColor={theme.colors.textSecondary}
        placeholderTextColor={theme.colors.textSecondary}
      />

      {/* Filter Chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScrollView}
        contentContainerStyle={styles.chipContainer}
      >
        <Chip
          selected={filter === 'All'}
          onPress={() => setFilter('All')}
          style={styles.chip}
          textStyle={filter === 'All' ? styles.chipTextSelected : styles.chipText}
        >
          All
        </Chip>
        <Chip
          selected={filter === 'DMs'}
          onPress={() => setFilter('DMs')}
          style={styles.chip}
          textStyle={filter === 'DMs' ? styles.chipTextSelected : styles.chipText}
        >
          DMs
        </Chip>
        <Chip
          selected={filter === 'Groups'}
          onPress={() => setFilter('Groups')}
          style={styles.chip}
          textStyle={filter === 'Groups' ? styles.chipTextSelected : styles.chipText}
        >
          Groups
        </Chip>
        <Chip
          selected={filter === 'Unread'}
          onPress={() => setFilter('Unread')}
          style={styles.chip}
          textStyle={filter === 'Unread' ? styles.chipTextSelected : styles.chipText}
        >
          Unread
        </Chip>
        <Chip
          selected={filter === 'Invites'}
          onPress={() => setFilter('Invites')}
          style={styles.chip}
          textStyle={filter === 'Invites' ? styles.chipTextSelected : styles.chipText}
        >
          Invites
        </Chip>
      </ScrollView>

      {/* Group Invites Section */}
      {messenger.groupInvites.length > 0 && (
        <View style={styles.invitesSection}>
          <Text style={styles.invitesHeader}>Group Invitations ({messenger.groupInvites.length})</Text>
          {messenger.groupInvites.map((invite) => {
            // Fetch group info to display name
            const group = messenger.groups.find(g =>
              Buffer.from(g.groupId).toString('hex') === Buffer.from(invite.groupId).toString('hex')
            );
            const inviter = messenger.contacts.find(c => c.publicKey.equals(invite.inviter));
            const groupIdHex = Buffer.from(invite.groupId).toString('hex');

            return (
              <List.Item
                key={groupIdHex}
                title={group?.name || 'Group Invite'}
                description={inviter ? `Invited by ${inviter.displayName || truncateAddress(invite.inviter.toBase58(), 4)}` : 'Group invitation'}
                left={(props) => (
                  <Avatar.Icon
                    {...props}
                    size={48}
                    icon="account-group"
                    style={{ backgroundColor: theme.colors.accent }}
                  />
                )}
                right={() => (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Button
                      mode="contained"
                      compact
                      onPress={async () => {
                        try {
                          await messenger.acceptGroupInvite(invite.groupId);
                          showAlert('Success', 'Group invitation accepted!');
                        } catch (error: any) {
                          showAlert('Error', error.message);
                        }
                      }}
                      style={{ backgroundColor: theme.colors.secondary }}
                    >
                      Accept
                    </Button>
                    <Button
                      mode="outlined"
                      compact
                      onPress={async () => {
                        try {
                          await messenger.rejectGroupInvite(invite.groupId);
                          showAlert('Declined', 'Group invitation declined');
                        } catch (error: any) {
                          showAlert('Error', error.message);
                        }
                      }}
                    >
                      Decline
                    </Button>
                  </View>
                )}
                style={styles.contactItem}
              />
            );
          })}
        </View>
      )}

      <FlatList
        data={filteredConversations}
        renderItem={renderContact}
        keyExtractor={(item) => item.id}
        style={styles.list}
      />

      {/* Single green chat FAB - opens contacts list */}
      <FAB
        icon="message"
        style={styles.fab}
        onPress={() => navigation.navigate('ContactsList')}
        color={theme.colors.onPrimary}
      />

      {/* Rename Contact Dialog */}
      <Portal>
        <Dialog visible={renameDialogVisible} onDismiss={() => setRenameDialogVisible(false)} style={{ backgroundColor: theme.colors.surface }}>
          <Dialog.Title style={{ color: theme.colors.textPrimary }}>Rename Contact</Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: theme.colors.textSecondary, marginBottom: 8 }}>
              Current: {renamingContact?.currentName}
            </Text>
            <TextInput
              label="New Name"
              value={newName}
              onChangeText={setNewName}
              mode="outlined"
              placeholder="Enter custom name"
              style={{ backgroundColor: theme.colors.surface }}
              outlineColor={theme.colors.surface}
              activeOutlineColor={theme.colors.primary}
              autoFocus
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRenameDialogVisible(false)}>Cancel</Button>
            <Button
              onPress={async () => {
                if (!renamingContact || !wallet.publicKey) return;
                const pubkey = new PublicKey(renamingContact.pubkey);
                await setContactCustomName(wallet.publicKey, pubkey, '');
                setRenameDialogVisible(false);
                setRenamingContact(null);
                setNewName('');
                setRefreshKey(prev => prev + 1);
              }}
              textColor={theme.colors.textSecondary}
            >
              Reset
            </Button>
            <Button
              onPress={handleRename}
              mode="contained"
              buttonColor={theme.colors.primary}
              disabled={!newName.trim()}
            >
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Contact Profile Modal */}
      {selectedContactForProfile && (
        <ContactProfileModal
          visible={profileModalVisible}
          onDismiss={() => {
            setProfileModalVisible(false);
            setSelectedContactForProfile(null);
          }}
          pubkey={selectedContactForProfile.pubkey}
          displayName={selectedContactForProfile.displayName}
          originalName={selectedContactOriginalName}
          avatar={selectedContactForProfile.avatar}
          walletAddress={selectedContactForProfile.pubkey}
          isContact={true}
          groupsInCommon={selectedContactGroupsInCommon}
          onRename={(newName) => handleContactRename(selectedContactForProfile.pubkey, newName)}
          onResetName={() => handleContactResetName(selectedContactForProfile.pubkey)}
          onDeleteContact={() => {
            showAlert(
              'Delete Contact',
              `Remove ${selectedContactForProfile.displayName} from your contacts? You can re-add them later.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await messenger.rejectInvitation(new PublicKey(selectedContactForProfile.pubkey));
                      showAlert('Deleted', 'Contact removed');
                      setProfileModalVisible(false);
                      setSelectedContactForProfile(null);
                    } catch (error: any) {
                      showAlert('Error', error.message);
                    }
                  },
                },
              ]
            );
          }}
          onBlockContact={() => {
            showAlert(
              'Block Contact',
              `Block ${selectedContactForProfile.displayName}? They won't be able to contact you until unblocked.`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Block',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await messenger.blockContact(new PublicKey(selectedContactForProfile.pubkey));
                      showAlert('Blocked', 'Contact blocked. You can unblock them later.');
                      setProfileModalVisible(false);
                      setSelectedContactForProfile(null);
                    } catch (error: any) {
                      showAlert('Error', error.message);
                    }
                  },
                },
              ]
            );
          }}
        />
      )}
      {DarkAlertComponent}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  searchbar: {
    margin: 16,
    marginBottom: 8,
    backgroundColor: theme.colors.surface,
  },
  chipScrollView: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chipContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    marginRight: 8,
    height: 32,
  },
  chipText: {
    color: theme.colors.textSecondary,
  },
  chipTextSelected: {
    color: theme.colors.primary,
  },
  list: {
    flex: 1,
  },
  contactItem: {
    backgroundColor: theme.colors.surface,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 8,
  },
  rightContainer: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  rightTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timestamp: {
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  badge: {
    backgroundColor: theme.colors.accent,
    marginTop: 4,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    backgroundColor: theme.colors.primary, // Purple/blue chat button
  },
  registrationContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: theme.colors.background,
  },
  registrationIcon: {
    backgroundColor: theme.colors.primary,
    marginBottom: 24,
  },
  registrationTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
    marginBottom: 12,
  },
  registrationText: {
    fontSize: 16,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
  },
  registrationButton: {
    width: '100%',
    maxWidth: 300,
  },
  invitesSection: {
    backgroundColor: theme.colors.surface,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    padding: 8,
  },
  invitesHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.accent,
    marginBottom: 4,
    marginLeft: 8,
  },
});
