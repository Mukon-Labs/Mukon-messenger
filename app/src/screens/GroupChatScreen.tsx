import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import { TextInput, IconButton, Text, Menu, Dialog, Portal, Button, Avatar } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useMessenger } from '../contexts/MessengerContext';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { Buffer } from 'buffer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { theme } from '../theme';
import ReactionPicker from '../components/ReactionPicker';
import ChatBackground from '../components/ChatBackground';
import { getUserProfilePDA, createStoreGroupKeyInstruction, buildTransaction } from '../utils/transactions';
import { getGroupAvatar } from '../utils/domains';
import { useDarkAlert } from '../components/DarkAlert';

export default function GroupChatScreen() {
  const route = useRoute();
  const navigation = useNavigation();
  const { groupId, groupName } = route.params as { groupId: string; groupName: string };

  const {
    groupMessages,
    groupKeys,
    groups,
    groupAvatars,
    sendGroupMessage,
    loadGroupMessages,
    joinGroupRoom,
    leaveGroupRoom,
    wallet,
    socket,
    connection,
    updateGroup,
    readTimestamps,
  } = useMessenger();

  const { showAlert, DarkAlertComponent } = useDarkAlert();
  const [messageText, setMessageText] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [menuVisible, setMenuVisible] = useState<string | null>(null);
  const [deleteMenuVisible, setDeleteMenuVisible] = useState<string | null>(null);
  const [reactionPickerVisible, setReactionPickerVisible] = useState(false);
  const [reactingToMessageId, setReactingToMessageId] = useState<string | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<any>(null);
  const [quickReactVisible, setQuickReactVisible] = useState<string | null>(null);
  const [memberProfiles, setMemberProfiles] = useState<Map<string, { name: string; avatar: string }>>(new Map());
  const [renameDialogVisible, setRenameDialogVisible] = useState(false);
  const [newName, setNewName] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const hasAttemptedBackup = useRef<Set<string>>(new Set());

  // Get current group
  const currentGroup = useMemo(() => {
    return groups.find(g => Buffer.from(g.groupId).toString('hex') === groupId);
  }, [groups, groupId]);

  // Get group avatar from groupAvatars Map (loaded by MessengerContext from backend)
  const groupAvatar = groupAvatars.get(groupId) || null;

  // Set header title with avatar
  useEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <TouchableOpacity
          onPress={() => {
            setNewName('');
            setRenameDialogVisible(true);
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {groupAvatar ? (
              <Text style={{ fontSize: 24 }}>{groupAvatar}</Text>
            ) : (
              <Avatar.Icon size={32} icon="account-group" style={{ backgroundColor: theme.colors.secondary }} />
            )}
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: theme.colors.textPrimary }}>
              {groupName}
            </Text>
          </View>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row' }}>
          <IconButton
            icon="information-outline"
            size={20}
            iconColor={theme.colors.textSecondary}
            onPress={() => navigation.navigate('GroupInfo' as never, { groupId, groupName } as never)}
          />
          <IconButton
            icon="lock"
            size={20}
            iconColor={theme.colors.secondary}
          />
        </View>
      ),
    });
  }, [groupName, groupId, groupAvatar, groupAvatars]);

  // Load member profiles
  useEffect(() => {
    if (!currentGroup || !connection) return;

    const loadMemberProfiles = async () => {
      const profiles = new Map<string, { name: string; avatar: string }>();

      for (const memberPubkey of currentGroup.members) {
        try {
          const profilePDA = getUserProfilePDA(memberPubkey);
          const accountInfo = await connection.getAccountInfo(profilePDA);

          if (accountInfo) {
            const data = accountInfo.data;
            let offset = 8 + 32; // Skip discriminator + owner

            // Read display name
            const displayNameLength = data.readUInt32LE(offset);
            offset += 4;
            const displayName = data.slice(offset, offset + displayNameLength).toString('utf-8');
            offset += displayNameLength;

            // Read avatar type
            const avatarType = data.readUInt8(offset);
            offset += 1;

            // Read avatar data
            const avatarDataLength = data.readUInt32LE(offset);
            offset += 4;
            const avatarData = data.slice(offset, offset + avatarDataLength).toString('utf-8');

            profiles.set(memberPubkey.toBase58(), {
              name: displayName || memberPubkey.toBase58().slice(0, 8),
              avatar: avatarData || '👤',
            });
          }
        } catch (error) {
          console.error('Failed to load member profile:', error);
        }
      }

      setMemberProfiles(profiles);
    };

    loadMemberProfiles();
  }, [currentGroup, connection]);

  // Lazy on-chain key storage (Fix for Feature 1)
  useEffect(() => {
    if (!wallet?.publicKey || !wallet.signTransaction) return;

    const storeGroupKeyOnChain = async () => {
      // Session-level guard to prevent re-runs
      if (hasAttemptedBackup.current.has(groupId)) return;
      hasAttemptedBackup.current.add(groupId);

      try {
        // Check if we have the group key locally
        const groupKey = groupKeys.get(groupId);
        if (!groupKey) {
          console.log('⚠️ No local group key found, skipping on-chain storage');
          return;
        }

        // Check if already backed up
        const backupKey = `groupKeyBackedUp_${wallet.publicKey.toBase58()}_${groupId}`;
        const alreadyBackedUp = await AsyncStorage.getItem(backupKey);
        if (alreadyBackedUp === 'true') {
          return; // Already backed up
        }

        console.log('💾 Storing group key on-chain for recovery...');

        // Get encryption keys from messenger context
        const encryptionSig = (window as any).__mukonEncryptionSignature;
        if (!encryptionSig) {
          console.warn('⚠️ No encryption signature available');
          return;
        }

        // Derive encryption keypair
        const { deriveEncryptionKeypair } = await import('../utils/encryption');
        const encryptionKeys = deriveEncryptionKeypair(encryptionSig);

        // Encrypt key with own pubkey
        const nonce = nacl.randomBytes(nacl.box.nonceLength);
        const encryptedKey = nacl.box(
          groupKey,
          nonce,
          encryptionKeys.publicKey,
          encryptionKeys.secretKey
        );

        // Create instruction
        const groupIdBytes = Buffer.from(groupId, 'hex');
        const storeKeyIx = createStoreGroupKeyInstruction(
          wallet.publicKey,
          groupIdBytes,
          encryptedKey,
          nonce
        );

        // Build, sign, and send transaction
        const tx = await buildTransaction(connection, wallet.publicKey, [storeKeyIx]);
        const signedTx = await wallet.signTransaction(tx);
        const sig = await connection.sendTransaction(signedTx);
        await connection.confirmTransaction(sig, 'confirmed');

        // Mark as backed up
        await AsyncStorage.setItem(backupKey, 'true');
        console.log('✅ Group key stored on-chain successfully');
      } catch (error) {
        console.error('Failed to store group key on-chain:', error);
        // Non-fatal - local key still works
      }
    };

    // Fix 3: Delay backup by 10 seconds to avoid back-to-back wallet prompts
    const backupTimeout = setTimeout(() => {
      storeGroupKeyOnChain();
    }, 10000);

    return () => clearTimeout(backupTimeout);
  }, [groupId]);

  // Load messages and join room on mount
  useFocusEffect(
    React.useCallback(() => {
      loadGroupMessages(groupId);
      joinGroupRoom(groupId);

      return () => {
        leaveGroupRoom(groupId);
      };
    }, [groupId])
  );

  // Subscribe to group messages and decrypt
  useEffect(() => {
    const msgs = groupMessages.get(groupId) || [];
    const groupKey = groupKeys.get(groupId);

    // Helper to derive message status from both msg.status and readTimestamps (Fix 8)
    const getMessageStatus = (msg: any): 'sending' | 'sent' | 'read' | null => {
      if (msg.sender !== wallet?.publicKey?.toBase58()) return null; // Only for outgoing messages
      if (msg.status === 'read') return 'read';
      const readTs = readTimestamps.get(groupId);
      if (readTs && new Date(msg.timestamp).getTime() <= readTs) return 'read';
      return msg.status || 'sent';
    };

    // Decrypt messages
    const decryptedMessages = msgs.map((msg, idx) => {
      const isMe = msg.sender === wallet?.publicKey?.toBase58();
      let content = msg.content;

      // Decrypt if encrypted and we have the key
      if (!content && msg.encrypted && msg.nonce && groupKey) {
        try {
          const encryptedBytes = Buffer.from(msg.encrypted, 'base64');
          const nonceBytes = Buffer.from(msg.nonce, 'base64');

          const decrypted = nacl.secretbox.open(encryptedBytes, nonceBytes, groupKey);

          if (decrypted) {
            content = new TextDecoder().decode(decrypted);
          } else {
            content = '[Unable to decrypt]';
          }
        } catch (error) {
          console.error('Failed to decrypt group message:', error);
          content = '[Decryption failed]';
        }
      } else if (!content && msg.encrypted) {
        // Show placeholder if key is missing
        content = '[Encrypted]';
      }

      // Find replied-to message if this is a reply
      let repliedToContent = null;
      if (msg.replyTo) {
        const repliedMsg = msgs.find((m: any) => m.id === msg.replyTo);
        if (repliedMsg) {
          if (repliedMsg.content) {
            repliedToContent = repliedMsg.content;
          } else if (repliedMsg.encrypted && repliedMsg.nonce && groupKey) {
            try {
              const encryptedBytes = Buffer.from(repliedMsg.encrypted, 'base64');
              const nonceBytes = Buffer.from(repliedMsg.nonce, 'base64');
              const decrypted = nacl.secretbox.open(encryptedBytes, nonceBytes, groupKey);
              repliedToContent = decrypted ? new TextDecoder().decode(decrypted) : '[Unable to decrypt]';
            } catch {
              repliedToContent = '[Unable to decrypt]';
            }
          }
        }
      }

      return {
        id: msg.id || `${idx}`,
        sender: msg.sender,
        content: content || '[No content]',
        timestamp: new Date(msg.timestamp || Date.now()),
        isMe,
        replyTo: msg.replyTo,
        repliedToContent,
        reactions: msg.reactions || {},
        status: getMessageStatus(msg), // Feature 5: sent/read status (Fix 8: with readTimestamps)
      };
    });

    setMessages(decryptedMessages);
  }, [groupMessages, groupId, groupKeys, wallet?.publicKey]);

  const handleSend = async () => {
    if (!messageText.trim()) return;

    try {
      await sendGroupMessage(groupId, messageText.trim());
      setMessageText('');
      clearReply();

      // Scroll to bottom
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);
    } catch (error) {
      console.error('Failed to send message:', error);
      showAlert('Error', 'Failed to send message');
    }
  };

  const handleDeleteMessage = (messageId: string, deleteForBoth: boolean) => {
    if (!socket) {
      console.error('Socket not connected');
      return;
    }

    if (deleteForBoth) {
      // Delete for everyone
      socket.emit('delete_group_message', { groupId, messageId, deleteForBoth: true });
      console.log('🗑️ Deleting group message for everyone:', messageId);
    } else {
      // Delete for self only - remove from local state
      setMessages((prev) => prev.filter(m => m.id !== messageId));
      console.log('🗑️ Deleted group message locally:', messageId);
    }

    setMenuVisible(null);
    setDeleteMenuVisible(null);
    setQuickReactVisible(null);
  };

  const handleReaction = (emoji: string) => {
    console.log('🎯 Full picker react - Emoji:', emoji, 'MessageID:', reactingToMessageId);

    if (!reactingToMessageId) {
      console.error('❌ No reactingToMessageId set');
      return;
    }

    if (!socket || !wallet?.publicKey) {
      console.error('❌ Socket or wallet not ready');
      return;
    }

    socket.emit('add_group_reaction', {
      groupId,
      messageId: reactingToMessageId,
      emoji,
      userId: wallet.publicKey.toBase58(),
    });

    console.log('✅ Full picker group reaction emitted to backend');
    setReactingToMessageId(null);
  };

  const handleQuickReact = (messageId: string, emoji: string) => {
    console.log('🎯 Quick react - Emoji:', emoji, 'MessageID:', messageId, 'GroupID:', groupId);

    if (!socket || !wallet?.publicKey) {
      console.error('❌ Socket or wallet not ready');
      return;
    }

    socket.emit('add_group_reaction', {
      groupId,
      messageId,
      emoji,
      userId: wallet.publicKey.toBase58(),
    }, (response: any) => {
      console.log('📬 Backend acknowledged group reaction:', response);
    });

    console.log('✅ Group reaction emitted to backend');
    setQuickReactVisible(null);
    setMenuVisible(null);
  };

  const handleReply = (messageToReply: any) => {
    setReplyToMessage(messageToReply);
    setMenuVisible(null);
  };

  const handleCopyMessage = async (content: string) => {
    await Clipboard.setStringAsync(content);
    showAlert('Copied', 'Message copied to clipboard');
    setMenuVisible(null);
  };

  const handlePinMessage = (messageId: string) => {
    showAlert('Coming Soon', 'Message pinning will be added soon');
    setMenuVisible(null);
  };

  const clearReply = () => {
    setReplyToMessage(null);
  };

  const handleRename = async () => {
    if (!newName.trim() || !currentGroup || !wallet?.publicKey) return;

    try {
      const isCreator = wallet.publicKey.equals(currentGroup.creator);

      if (isCreator) {
        // On-chain rename via updateGroup
        await updateGroup(currentGroup.groupId, newName);
        showAlert('Success', 'Group renamed successfully');
      } else {
        // Local rename only (AsyncStorage)
        const { setGroupLocalName } = await import('../utils/domains');
        await setGroupLocalName(wallet.publicKey, groupId, newName);
        showAlert('Success', 'Group renamed locally');
      }

      setRenameDialogVisible(false);
      setNewName('');
      navigation.setParams({ groupName: newName } as never);
    } catch (error: any) {
      showAlert('Error', 'Failed to rename group');
    }
  };

  const renderMessage = ({ item }: { item: any }) => {
    // Get member profile
    const memberProfile = memberProfiles.get(item.sender);
    const senderName = memberProfile?.name || item.sender.slice(0, 8);
    const senderAvatar = memberProfile?.avatar || '👤';
    const showAvatar = !item.isMe;

    return (
      <View style={[styles.messageRow, item.isMe ? styles.myMessageRow : styles.theirMessageRow]}>
        {/* Avatar for incoming messages only */}
        {showAvatar && (
          <View style={styles.messageAvatar}>
            {senderAvatar && Array.from(senderAvatar).length === 1 ? (
              <Text style={styles.messageAvatarEmoji}>{senderAvatar}</Text>
            ) : (
              <Text style={styles.messageAvatarFallback}>
                {senderName[0].toUpperCase()}
              </Text>
            )}
          </View>
        )}

        <View style={{ flex: 1 }}>
          {/* Quick React Row - ONLY on short press */}
          {quickReactVisible === item.id && !menuVisible && (
            <TouchableOpacity
              style={styles.quickReactBarContainer}
              activeOpacity={1}
              onPress={() => setQuickReactVisible(null)}
            >
              <View style={styles.quickReactBar}>
                {['❤️', '🔥', '💯', '😂', '👍', '👎'].map((emoji) => (
                  <TouchableOpacity
                    key={emoji}
                    style={styles.quickReactButton}
                    onPress={() => handleQuickReact(item.id, emoji)}
                  >
                    <Text style={styles.quickReactEmoji}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          )}

          <Menu
            visible={menuVisible === item.id}
            onDismiss={() => {
              setMenuVisible(null);
              setQuickReactVisible(null);
            }}
            anchor={
              <View>
                <TouchableOpacity
                  onPress={() => {
                    // Short press - show ONLY emoji chip
                    setQuickReactVisible(item.id);
                    setMenuVisible(null);
                  }}
                  onLongPress={() => {
                    // Long press - show ONLY menu
                    setMenuVisible(item.id);
                    setQuickReactVisible(null);
                  }}
                  style={[
                    styles.messageBubble,
                    item.isMe ? styles.myMessage : styles.theirMessage,
                  ]}
                >
                  {/* Sender name for incoming messages */}
                  {!item.isMe && (
                    <Text style={styles.senderName}>{senderName}</Text>
                  )}

                  {/* Replied message preview */}
                  {item.repliedToContent && (
                    <View style={styles.repliedMessage}>
                      <View style={styles.replyBar} />
                      <Text style={styles.repliedText} numberOfLines={2}>
                        {item.repliedToContent}
                      </Text>
                    </View>
                  )}

                  <Text style={styles.messageText}>{item.content}</Text>

                  <View style={styles.messageFooter}>
                    <Text style={styles.messageTime}>
                      {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    {/* Feature 5: Read/sent indicators for outgoing messages (Fix 6: corrected tick colors) */}
                    {item.isMe && item.status && (
                      <MaterialCommunityIcons
                        name={item.status === 'read' ? 'check-all' : 'check'}
                        size={12}
                        color={item.status === 'read' ? theme.colors.secondary : theme.colors.textSecondary}
                        style={{ marginLeft: 4, opacity: item.status === 'read' ? 1 : 0.5 }}
                      />
                    )}
                  </View>
                </TouchableOpacity>

                {/* Reactions display - BELOW the message bubble */}
                {(() => {
                  const hasReactions = item.reactions && Object.keys(item.reactions).length > 0;
                  if (hasReactions) {
                    console.log(`Message ${item.id} has reactions:`, item.reactions);
                  }
                  return hasReactions ? (
                    <View style={styles.reactionsContainer}>
                      {Object.entries(item.reactions).map(([emoji, users]: [string, any]) => (
                        users && users.length > 0 ? (
                          <View key={emoji} style={styles.reactionBubble}>
                            <Text style={styles.reactionEmoji}>{emoji}</Text>
                            {users.length > 1 && (
                              <Text style={styles.reactionCount}>{users.length}</Text>
                            )}
                          </View>
                        ) : null
                      ))}
                    </View>
                  ) : null;
                })()}
              </View>
            }
          >
            <Menu.Item
              onPress={() => {
                setReactingToMessageId(item.id);
                setReactionPickerVisible(true);
                setMenuVisible(null);
                setQuickReactVisible(null);
              }}
              title="React"
              leadingIcon="emoticon-happy-outline"
            />
            <Menu.Item
              onPress={() => handleReply(item)}
              title="Reply"
              leadingIcon="reply"
            />
            <Menu.Item
              onPress={() => handleCopyMessage(item.content)}
              title="Copy Message"
              leadingIcon="content-copy"
            />
            <Menu.Item
              onPress={() => handlePinMessage(item.id)}
              title="Pin Message"
              leadingIcon="pin"
            />
            <Menu.Item
              onPress={() => {
                setMenuVisible(null);
                setQuickReactVisible(null);
                setDeleteMenuVisible(item.id);
              }}
              title="Delete"
              leadingIcon="delete"
            />
          </Menu>

          {/* Delete Submenu */}
          <Menu
            visible={deleteMenuVisible === item.id}
            onDismiss={() => setDeleteMenuVisible(null)}
            anchor={<View />}
          >
            <Menu.Item
              onPress={() => {
                handleDeleteMessage(item.id, false);
                setDeleteMenuVisible(null);
              }}
              title="Delete for Me"
              leadingIcon="delete-outline"
            />
            {item.isMe && (
              <Menu.Item
                onPress={() => {
                  handleDeleteMessage(item.id, true);
                  setDeleteMenuVisible(null);
                }}
                title="Delete for Everyone"
                leadingIcon="delete-forever"
              />
            )}
          </Menu>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ChatBackground />
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
      />

      <View style={styles.inputContainer}>
        {/* Reply preview */}
        {replyToMessage && (
          <View style={styles.replyPreview}>
            <View style={styles.replyContent}>
              <Text style={styles.replyLabel}>Replying to</Text>
              <Text style={styles.replyText} numberOfLines={1}>
                {replyToMessage.content}
              </Text>
            </View>
            <IconButton
              icon="close"
              size={20}
              onPress={clearReply}
              iconColor={theme.colors.textSecondary}
            />
          </View>
        )}

        <TextInput
          value={messageText}
          onChangeText={setMessageText}
          placeholder="Message..."
          mode="outlined"
          style={styles.input}
          outlineColor="transparent"
          activeOutlineColor={theme.colors.primary}
          placeholderTextColor={theme.colors.textSecondary}
          right={
            <TextInput.Icon
              icon="send"
              onPress={handleSend}
              color={messageText.trim() ? theme.colors.primary : theme.colors.textSecondary}
            />
          }
        />
      </View>

      {/* Reaction Picker */}
      <ReactionPicker
        visible={reactionPickerVisible}
        onDismiss={() => setReactionPickerVisible(false)}
        onSelect={handleReaction}
      />

      {/* Rename Group Dialog */}
      <Portal>
        <Dialog visible={renameDialogVisible} onDismiss={() => setRenameDialogVisible(false)} style={{ backgroundColor: theme.colors.surface }}>
          <Dialog.Title style={{ color: theme.colors.textPrimary }}>Rename Group</Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: theme.colors.textSecondary, marginBottom: 8 }}>
              Current: {groupName}
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 8 }}>
              {currentGroup && wallet?.publicKey?.equals(currentGroup.creator)
                ? 'You are the admin. Rename will update on-chain for everyone.'
                : 'You are not the admin. Rename will be local only (your device).'}
            </Text>
            <TextInput
              label="New Name"
              value={newName}
              onChangeText={setNewName}
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
              disabled={!newName.trim()}
            >
              Save
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
      {DarkAlertComponent}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  messagesList: {
    padding: 16,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginVertical: 4,
    maxWidth: '80%',
  },
  myMessageRow: {
    alignSelf: 'flex-end',
    justifyContent: 'flex-end',
  },
  theirMessageRow: {
    alignSelf: 'flex-start',
    justifyContent: 'flex-start',
  },
  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    marginBottom: 4,
  },
  messageAvatarEmoji: {
    fontSize: 20,
  },
  messageAvatarFallback: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  messageBubble: {
    maxWidth: '100%',
    padding: 12,
    borderRadius: 16,
  },
  myMessage: {
    backgroundColor: theme.colors.primary,
  },
  theirMessage: {
    backgroundColor: theme.colors.surface,
  },
  senderName: {
    fontSize: 12,
    color: theme.colors.secondary,
    marginBottom: 4,
    fontWeight: '600',
  },
  messageText: {
    color: theme.colors.textPrimary,
    fontSize: 16,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  messageTime: {
    color: theme.colors.textSecondary,
    fontSize: 10,
  },
  inputContainer: {
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.background,
  },
  input: {
    backgroundColor: theme.colors.background,
  },
  replyPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
  },
  replyContent: {
    flex: 1,
  },
  replyLabel: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  replyText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    marginTop: 2,
  },
  repliedMessage: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.secondary,
    paddingLeft: 8,
    paddingVertical: 4,
    marginBottom: 8,
    borderRadius: 4,
  },
  replyBar: {
    width: 3,
    backgroundColor: theme.colors.secondary,
    marginRight: 8,
  },
  repliedText: {
    flex: 1,
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontStyle: 'italic',
  },
  reactionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: -4,
    marginLeft: 8,
    marginBottom: 4,
  },
  reactionBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    gap: 2,
  },
  reactionEmoji: {
    fontSize: 16,
  },
  reactionCount: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontWeight: '600',
  },
  quickReactBarContainer: {
    position: 'absolute',
    top: -60,
    left: 0,
    right: 0,
    zIndex: 1000,
    alignItems: 'center',
  },
  quickReactBar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: 30,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    minWidth: 280,
    justifyContent: 'space-evenly',
  },
  quickReactButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  quickReactEmoji: {
    fontSize: 28,
  },
});
