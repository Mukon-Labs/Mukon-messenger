import React, { useState } from 'react';
import { View, StyleSheet, Modal, ScrollView } from 'react-native';
import { Text, IconButton, Divider, Button, TextInput } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import { theme } from '../theme';
import SendCryptoModal from './SendCryptoModal';
import AvatarDisplay from './AvatarDisplay';

interface GroupInCommon {
  name: string;
  avatar?: string;
  groupId: string;
}

interface ContactProfileModalProps {
  visible: boolean;
  onDismiss: () => void;
  pubkey: string;
  displayName: string;
  originalName: string;       // Domain/on-chain name for reset
  avatar?: string;
  walletAddress: string;
  isContact: boolean;
  groupsInCommon?: GroupInCommon[];
  onRename?: (newName: string) => void;
  onResetName?: () => void;
  onAddContact?: () => void;
  onDeleteContact?: () => void;
  onBlockContact?: () => void;
}

export default function ContactProfileModal({
  visible,
  onDismiss,
  pubkey,
  displayName,
  originalName,
  avatar,
  walletAddress,
  isContact,
  groupsInCommon = [],
  onRename,
  onResetName,
  onAddContact,
  onDeleteContact,
  onBlockContact,
}: ContactProfileModalProps) {
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(displayName);
  const [sendCryptoVisible, setSendCryptoVisible] = useState(false);

  const handleCopyAddress = async () => {
    await Clipboard.setStringAsync(walletAddress);
    // TODO: Show toast/snackbar
  };

  const handleStartEdit = () => {
    setTempName(displayName);
    setEditingName(true);
  };

  const handleSaveName = () => {
    if (onRename && tempName.trim()) {
      onRename(tempName.trim());
    }
    setEditingName(false);
  };

  const handleCancelEdit = () => {
    setTempName(displayName);
    setEditingName(false);
  };

  const hasCustomName = displayName !== originalName;

  return (
    <Modal
      visible={visible}
      onRequestClose={onDismiss}
      animationType="slide"
      transparent={false}
    >
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Avatar */}
          <View style={styles.avatarContainer}>
            <AvatarDisplay avatar={avatar} size={96} name={displayName} />
          </View>

          {/* Display Name with Edit */}
          <View style={styles.nameRow}>
            {editingName ? (
              <View style={styles.nameEditContainer}>
                <TextInput
                  value={tempName}
                  onChangeText={setTempName}
                  style={styles.nameInput}
                  mode="outlined"
                  autoFocus
                  dense
                />
                <View style={styles.nameEditButtons}>
                  <Button mode="text" onPress={handleCancelEdit} compact>
                    Cancel
                  </Button>
                  <Button mode="contained" onPress={handleSaveName} compact>
                    Save
                  </Button>
                </View>
              </View>
            ) : (
              <>
                <Text style={styles.displayName}>{displayName}</Text>
                {onRename && (
                  <IconButton
                    icon="pencil"
                    size={20}
                    iconColor={theme.colors.primary}
                    onPress={handleStartEdit}
                  />
                )}
              </>
            )}
          </View>

          {/* Reset to original name */}
          {hasCustomName && onResetName && !editingName && (
            <Button
              mode="text"
              onPress={onResetName}
              compact
              style={styles.resetButton}
            >
              Reset to "{originalName}"
            </Button>
          )}

          {/* Wallet Address with Copy Button */}
          <View style={styles.addressRow}>
            <Text style={styles.address} numberOfLines={1} ellipsizeMode="middle">
              {walletAddress}
            </Text>
            <IconButton
              icon="content-copy"
              size={16}
              iconColor={theme.colors.textSecondary}
              onPress={handleCopyAddress}
            />
          </View>

          <Divider style={styles.divider} />

          {/* Groups in Common */}
          {groupsInCommon.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Groups in Common</Text>
              <View style={styles.groupsContainer}>
                {groupsInCommon.map((group) => (
                  <View key={group.groupId} style={styles.groupItem}>
                    {group.avatar ? (
                      <Text style={styles.groupAvatar}>{group.avatar}</Text>
                    ) : (
                      <View style={styles.groupAvatarFallback}>
                        <Text style={styles.groupAvatarFallbackText}>
                          {group.name[0]?.toUpperCase() || 'G'}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.groupName} numberOfLines={1}>
                      {group.name}
                    </Text>
                  </View>
                ))}
              </View>
              <Divider style={styles.divider} />
            </>
          )}

          {/* Send Crypto */}
          <Button
            mode="outlined"
            onPress={() => setSendCryptoVisible(true)}
            style={styles.actionButton}
            contentStyle={styles.actionButtonContent}
          >
            Send Crypto
          </Button>
          <SendCryptoModal
            visible={sendCryptoVisible}
            onDismiss={() => setSendCryptoVisible(false)}
            recipientPubkey={walletAddress}
            recipientName={displayName}
          />

          <Divider style={styles.divider} />

          {/* Add Contact (when not a contact) */}
          {!isContact && onAddContact && (
            <Button
              mode="contained"
              onPress={() => {
                onDismiss();
                onAddContact();
              }}
              style={styles.actionButton}
              buttonColor={theme.colors.primary}
            >
              Add Contact
            </Button>
          )}

          {/* Delete Contact */}
          {isContact && onDeleteContact && (
            <Button
              mode="text"
              onPress={() => {
                onDismiss();
                onDeleteContact();
              }}
              style={styles.actionButton}
              labelStyle={styles.destructiveButtonLabel}
            >
              Delete Contact
            </Button>
          )}

          {/* Block Contact */}
          {isContact && onBlockContact && (
            <Button
              mode="text"
              onPress={() => {
                onDismiss();
                onBlockContact();
              }}
              style={styles.actionButton}
              labelStyle={styles.destructiveButtonLabel}
            >
              Block Contact
            </Button>
          )}

          <Divider style={styles.divider} />

          {/* Close Button */}
          <Button
            mode="contained"
            onPress={onDismiss}
            style={styles.closeButton}
            buttonColor={theme.colors.primary}
          >
            Close
          </Button>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  avatarContainer: {
    marginBottom: 16,
  },
  avatarEmoji: {
    fontSize: 96,
  },
  avatarFallback: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarFallbackText: {
    fontSize: 48,
    fontWeight: '600',
    color: theme.colors.onPrimary,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  nameEditContainer: {
    width: '100%',
    alignItems: 'center',
  },
  nameInput: {
    width: '100%',
    marginBottom: 8,
    backgroundColor: theme.colors.surface,
  },
  nameEditButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  displayName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
  },
  resetButton: {
    marginBottom: 8,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    marginBottom: 16,
  },
  address: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: theme.colors.textSecondary,
    flex: 1,
  },
  divider: {
    width: '100%',
    marginVertical: 12,
    backgroundColor: theme.colors.surfaceVariant,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  groupsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
    width: '100%',
  },
  groupItem: {
    alignItems: 'center',
    width: 80,
  },
  groupAvatar: {
    fontSize: 32,
    marginBottom: 4,
  },
  groupAvatarFallback: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  groupAvatarFallbackText: {
    fontSize: 20,
    fontWeight: '600',
    color: theme.colors.onSecondary,
  },
  groupName: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  actionButton: {
    width: '100%',
    marginVertical: 4,
  },
  actionButtonContent: {
    paddingVertical: 4,
  },
  disabledButtonLabel: {
    color: theme.colors.textSecondary,
  },
  destructiveButtonLabel: {
    color: theme.colors.error,
  },
  closeButton: {
    width: '100%',
    marginTop: 8,
  },
});
