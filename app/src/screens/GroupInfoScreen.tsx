import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { List, Button, Text, Divider, Avatar, Dialog, Portal, TextInput, IconButton } from 'react-native-paper';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useMessenger } from '../contexts/MessengerContext';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { theme } from '../theme';
import EmojiPicker from '../components/EmojiPicker';
import ContactProfileModal from '../components/ContactProfileModal';
import AvatarDisplay from '../components/AvatarDisplay';
import { getGroupAvatar, setGroupAvatar, getGroupLocalName, setGroupLocalName, getContactCustomName, getCachedDomain, setContactCustomName } from '../utils/domains';
import { getUserProfilePDA } from '../utils/transactions';
import { useDarkAlert } from '../components/DarkAlert';

export default function GroupInfoScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { groupId, groupName: routeGroupName } = route.params as { groupId: string; groupName?: string };

  const messenger = useMessenger();
  const { groups, leaveGroup, kickMember, updateGroup, wallet, loading, connection } = messenger;
  const { showAlert, DarkAlertComponent } = useDarkAlert();

  const [group, setGroup] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [renameDialogVisible, setRenameDialogVisible] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [emojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const [groupAvatar, setGroupAvatarState] = useState<string | null>(null);
  const [localGroupName, setLocalGroupNameState] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<any>(null);
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  const [memberProfiles, setMemberProfiles] = useState<Map<string, { name: string; avatar: string }>>(new Map());
  // Fix 4: Dark confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState<{ visible: boolean; title: string; message: string; onConfirm: () => void } | null>(null);

  useEffect(() => {
    // Find group in loaded groups
    const foundGroup = groups.find(g => Buffer.from(g.groupId).toString('hex') === groupId);
    setGroup(foundGroup);

    if (foundGroup && wallet?.publicKey) {
      setIsAdmin(foundGroup.creator.equals(wallet.publicKey));
      setIsMember(foundGroup.members.some((m: PublicKey) => m.equals(wallet.publicKey)));
    }

    // Load group avatar and local name
    const loadLocalData = async () => {
      if (!wallet?.publicKey) return;

      // Use shared avatar from messenger context first (Fix 4)
      const sharedAvatar = messenger.groupAvatars.get(groupId);
      if (sharedAvatar) {
        setGroupAvatarState(sharedAvatar);
      } else {
        // Fallback to local storage
        const avatar = await getGroupAvatar(wallet.publicKey, groupId);
        setGroupAvatarState(avatar);
      }

      const localName = await getGroupLocalName(wallet.publicKey, groupId);
      setLocalGroupNameState(localName);
    };
    loadLocalData();
  }, [groups, groupId, wallet]);

  // Load member profiles (Fix 3)
  useEffect(() => {
    const loadMemberProfiles = async () => {
      if (!group || !wallet?.publicKey) return;

      const profiles = new Map<string, { name: string; avatar: string }>();

      for (const member of group.members) {
        const memberPubkey = member.toBase58();

        try {
          // Try to get custom name first
          const customName = await getContactCustomName(wallet.publicKey, member);
          if (customName) {
            profiles.set(memberPubkey, { name: customName, avatar: '' });
            continue;
          }

          // Try cached domain
          const cachedDomain = await getCachedDomain(wallet.publicKey, member);
          if (cachedDomain) {
            profiles.set(memberPubkey, { name: cachedDomain, avatar: '' });
            continue;
          }

          // Fetch from on-chain
          const profilePDA = getUserProfilePDA(member);
          const accountInfo = await connection.getAccountInfo(profilePDA);

          if (accountInfo) {
            const data = accountInfo.data;
            let offset = 8 + 32; // Skip discriminator + owner

            // Read display name
            const nameLength = data.readUInt32LE(offset);
            offset += 4;
            const nameBytes = data.slice(offset, offset + nameLength);
            const name = new TextDecoder().decode(nameBytes);
            offset += nameLength;

            // Read avatar
            const avatarType = data.readUInt8(offset);
            offset += 1;
            const avatarLength = data.readUInt32LE(offset);
            offset += 4;
            const avatarBytes = data.slice(offset, offset + avatarLength);
            const avatar = new TextDecoder().decode(avatarBytes);

            profiles.set(memberPubkey, { name: name || memberPubkey, avatar: avatarType === 0 ? avatar : '' });
          } else {
            profiles.set(memberPubkey, { name: memberPubkey, avatar: '' });
          }
        } catch (error) {
          console.error(`Failed to load profile for ${memberPubkey}:`, error);
          profiles.set(memberPubkey, { name: memberPubkey, avatar: '' });
        }
      }

      setMemberProfiles(profiles);
    };

    loadMemberProfiles();
  }, [group, wallet]);

  // Display name priority: local custom name > route groupName > on-chain name > default
  const displayName = localGroupName || routeGroupName || group?.name || 'Group';

  const handleInviteMember = () => {
    navigation.navigate('InviteMember' as never, { groupId, groupName: displayName } as never);
  };

  const handleLeaveGroup = () => {
    setConfirmDialog({
      visible: true,
      title: 'Leave Group',
      message: 'Are you sure you want to leave this group?',
      onConfirm: async () => {
        try {
          await leaveGroup(Buffer.from(groupId, 'hex'));
          navigation.goBack();
          navigation.goBack(); // Go back to conversations list
        } catch (error) {
          showAlert('Error', `Failed to leave group: ${error.message}`);
        }
      },
    });
  };

  const handleKickMember = (memberPubkey: PublicKey) => {
    setConfirmDialog({
      visible: true,
      title: 'Kick Member',
      message: 'Are you sure you want to remove this member?',
      onConfirm: async () => {
        try {
          await kickMember(Buffer.from(groupId, 'hex'), memberPubkey);
          // Reload group info
        } catch (error) {
          showAlert('Error', `Failed to kick member: ${error.message}`);
        }
      },
    });
  };

  const handleRename = async () => {
    if (!newGroupName.trim() || !wallet?.publicKey) return;

    try {
      if (isAdmin) {
        // Admin: Update on-chain
        const groupIdBytes = new Uint8Array(Buffer.from(groupId, 'hex'));
        await updateGroup(groupIdBytes, newGroupName.trim());

        // Update route params so header shows new name
        navigation.setParams({ groupName: newGroupName.trim() } as never);
      } else {
        // Non-admin: Save locally only
        await setGroupLocalName(wallet.publicKey, groupId, newGroupName.trim());
        setLocalGroupNameState(newGroupName.trim());
      }

      setRenameDialogVisible(false);
      setNewGroupName('');
    } catch (error: any) {
      showAlert('Error', `Failed to rename group: ${error.message}`);
    }
  };

  const handleEmojiSelect = async (emoji: string) => {
    if (!wallet?.publicKey) return;
    try {
      await messenger.setGroupAvatarShared(groupId, emoji);
      setGroupAvatarState(emoji);
      setEmojiPickerVisible(false);
    } catch (error: any) {
      showAlert('Error', 'Failed to set group avatar');
    }
  };

  // Member contact modal helpers (Fix 3)
  const handleMemberRename = async (memberPubkey: string, newName: string) => {
    if (!wallet.publicKey) return;
    try {
      await setContactCustomName(wallet.publicKey, new PublicKey(memberPubkey), newName);
      // Reload member profiles
      const profile = memberProfiles.get(memberPubkey);
      if (profile) {
        setMemberProfiles(prev => {
          const updated = new Map(prev);
          updated.set(memberPubkey, { ...profile, name: newName });
          return updated;
        });
      }
    } catch (error: any) {
      showAlert('Error', 'Failed to rename member');
    }
  };

  const handleMemberResetName = async (memberPubkey: string) => {
    if (!wallet.publicKey) return;
    try {
      await setContactCustomName(wallet.publicKey, new PublicKey(memberPubkey), ''); // Clear custom name
      // Reload member profiles
      // Would need to fetch on-chain name again, for now just keep existing
    } catch (error: any) {
      showAlert('Error', 'Failed to reset name');
    }
  };

  const selectedMemberContact = messenger.contacts.find(
    c => selectedMember && c.publicKey.toBase58() === selectedMember.pubkey
  );
  const selectedMemberIsContact = !!selectedMemberContact;

  const selectedMemberOriginalName = selectedMember
    ? (memberProfiles.get(selectedMember.pubkey)?.name || selectedMember.pubkey)
    : '';

  const selectedMemberGroupsInCommon = React.useMemo(() => {
    if (!selectedMember || !wallet?.publicKey) return [];
    return messenger.groups
      .filter(g => g.members.some(m => m.toBase58() === selectedMember.pubkey))
      .map(g => ({
        groupId: Buffer.from(g.groupId).toString('hex'),
        name: g.name,
        avatar: messenger.groupAvatars.get(Buffer.from(g.groupId).toString('hex')),
      }));
  }, [messenger.groups, messenger.groupAvatars, selectedMember, wallet.publicKey]);

  if (!group) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading group info...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => isMember && setEmojiPickerVisible(true)}
          disabled={!isMember}
        >
          <AvatarDisplay avatar={groupAvatar} size={80} name={displayName || 'GR'} />
          {isMember && (
            <Text style={styles.avatarHint}>Tap to change</Text>
          )}
        </TouchableOpacity>
        <View style={styles.nameRow}>
          <Text variant="headlineSmall" style={styles.groupName}>
            {displayName}
          </Text>
          {isMember && (
            <IconButton
              icon="pencil"
              size={20}
              iconColor={theme.colors.textSecondary}
              onPress={() => {
                setNewGroupName(displayName);
                setRenameDialogVisible(true);
              }}
            />
          )}
        </View>
        <Text variant="bodyMedium" style={styles.memberCount}>
          {group.members.length} members
        </Text>
      </View>

      <Divider style={styles.divider} />

      <List.Section>
        <List.Subheader style={styles.subheader}>Group Info</List.Subheader>

        <List.Item
          title="Created by"
          description={group.creator.toBase58().slice(0, 16) + '...'}
          left={(props) => <List.Icon {...props} icon="account-star" />}
        />

        <List.Item
          title="Created"
          description={new Date(Number(group.createdAt) * 1000).toLocaleDateString()}
          left={(props) => <List.Icon {...props} icon="calendar" />}
        />

        {group.tokenGate && (
          <List.Item
            title="Token Gated"
            description={`Min balance: ${group.tokenGate.minBalance.toString()}`}
            left={(props) => <List.Icon {...props} icon="lock" />}
          />
        )}
      </List.Section>

      <Divider style={styles.divider} />

      <List.Section>
        <List.Subheader style={styles.subheader}>
          Members ({group.members.length})
        </List.Subheader>

        {group.members.map((member: PublicKey, index: number) => {
          const memberPubkey = member.toBase58();
          const isSelf = wallet?.publicKey?.equals(member);
          const isCreator = group.creator.equals(member);
          const profile = memberProfiles.get(memberPubkey);
          const memberName = profile?.name || memberPubkey.slice(0, 16) + '...';
          const memberAvatar = profile?.avatar;

          return (
            <List.Item
              key={memberPubkey}
              title={memberName}
              description={isCreator ? 'Admin' : 'Member'}
              onPress={() => {
                setSelectedMember({
                  pubkey: memberPubkey,
                  displayName: memberName,
                  avatar: memberAvatar,
                });
                setProfileModalVisible(true);
              }}
              left={() => (
                <View style={{ justifyContent: 'center', marginLeft: 8 }}>
                  <AvatarDisplay avatar={memberAvatar} size={40} name={memberName} />
                </View>
              )}
              right={
                isAdmin && !isSelf && !isCreator
                  ? (props) => (
                      <Button
                        {...props}
                        mode="text"
                        textColor="#ff4444"
                        onPress={() => handleKickMember(member)}
                      >
                        Kick
                      </Button>
                    )
                  : undefined
              }
            />
          );
        })}
      </List.Section>

      <View style={styles.actions}>
        {isMember && (
          <Button
            mode="contained"
            icon="account-plus"
            onPress={handleInviteMember}
            style={styles.actionButton}
          >
            Invite Members
          </Button>
        )}

        {isMember && !isAdmin && (
          <Button
            mode="outlined"
            icon="exit-to-app"
            onPress={handleLeaveGroup}
            style={styles.actionButton}
            textColor="#ff4444"
          >
            Leave Group
          </Button>
        )}
      </View>

      {/* Rename Group Dialog */}
      <Portal>
        <Dialog visible={renameDialogVisible} onDismiss={() => setRenameDialogVisible(false)} style={{ backgroundColor: theme.colors.surface }}>
          <Dialog.Title style={{ color: theme.colors.textPrimary }}>Rename Group {!isAdmin && '(Local)'}</Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: theme.colors.textSecondary, marginBottom: 8 }}>
              Current: {displayName}
            </Text>
            {!isAdmin && (
              <Text style={{ color: theme.colors.textSecondary, marginBottom: 12, fontSize: 12 }}>
                Local names are only visible to you
              </Text>
            )}
            <TextInput
              label="New Group Name"
              value={newGroupName}
              onChangeText={setNewGroupName}
              mode="outlined"
              placeholder="Enter new group name"
              style={{ backgroundColor: theme.colors.surface }}
              outlineColor={theme.colors.surface}
              activeOutlineColor={theme.colors.primary}
              autoFocus
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setRenameDialogVisible(false)}>Cancel</Button>
            <Button
              onPress={handleRename}
              mode="contained"
              buttonColor={theme.colors.primary}
              disabled={!newGroupName.trim()}
            >
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      {/* Emoji Picker */}
      <EmojiPicker
        visible={emojiPickerVisible}
        onDismiss={() => setEmojiPickerVisible(false)}
        onSelect={handleEmojiSelect}
      />

      {/* Member Contact Profile Modal (Fix 3) */}
      {selectedMember && (
        <ContactProfileModal
          visible={profileModalVisible}
          onDismiss={() => {
            setProfileModalVisible(false);
            setSelectedMember(null);
          }}
          pubkey={selectedMember.pubkey}
          displayName={selectedMember.displayName}
          originalName={selectedMemberOriginalName}
          avatar={selectedMember.avatar}
          walletAddress={selectedMember.pubkey}
          isContact={selectedMemberIsContact}
          groupsInCommon={selectedMemberGroupsInCommon}
          onRename={(newName) => handleMemberRename(selectedMember.pubkey, newName)}
          onResetName={() => handleMemberResetName(selectedMember.pubkey)}
          onAddContact={async () => {
            try {
              await messenger.invite(new PublicKey(selectedMember.pubkey));
              showAlert('Success', 'Contact invitation sent');
              setProfileModalVisible(false);
            } catch (error: any) {
              showAlert('Error', 'Failed to send invitation');
            }
          }}
          onDeleteContact={async () => {
            showAlert(
              'Delete Contact',
              `Remove ${selectedMember.displayName} from your contacts?`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await messenger.deleteContact(new PublicKey(selectedMember.pubkey));
                      showAlert('Success', 'Contact deleted');
                      setProfileModalVisible(false);
                    } catch (error: any) {
                      showAlert('Error', error.message);
                    }
                  },
                },
              ]
            );
          }}
          onBlockContact={async () => {
            showAlert(
              'Block Contact',
              `Block ${selectedMember.displayName}?`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Block',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await messenger.blockContact(new PublicKey(selectedMember.pubkey));
                      showAlert('Success', 'Contact blocked');
                      setProfileModalVisible(false);
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

      {/* Fix 4: Dark confirmation dialog */}
      <Portal>
        <Dialog
          visible={confirmDialog?.visible || false}
          onDismiss={() => setConfirmDialog(null)}
          style={{ backgroundColor: theme.colors.surface }}
        >
          <Dialog.Title style={{ color: theme.colors.textPrimary }}>
            {confirmDialog?.title}
          </Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: theme.colors.textPrimary }}>
              {confirmDialog?.message}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirmDialog(null)}>Cancel</Button>
            <Button
              onPress={() => {
                confirmDialog?.onConfirm();
                setConfirmDialog(null);
              }}
              textColor={theme.colors.error}
            >
              Confirm
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      {DarkAlertComponent}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  loadingText: {
    color: '#888',
    textAlign: 'center',
    marginTop: 32,
  },
  header: {
    alignItems: 'center',
    padding: 24,
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarEmoji: {
    fontSize: 48,
  },
  avatarHint: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  groupName: {
    color: '#ffffff',
  },
  memberCount: {
    color: '#888',
    marginTop: 4,
  },
  divider: {
    backgroundColor: '#333',
  },
  subheader: {
    color: '#888',
  },
  actions: {
    padding: 16,
    paddingBottom: 32,
  },
  actionButton: {
    marginBottom: 12,
  },
});
