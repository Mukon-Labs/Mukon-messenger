import React from 'react';
import { View, FlatList, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator } from 'react-native';
import { TextInput, IconButton, Text, Avatar, Menu, Dialog, Portal, Button } from 'react-native-paper';
import * as Clipboard from 'expo-clipboard';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { theme } from '../theme';
import { useWallet } from '../contexts/WalletContext';
import { useMessenger } from '../contexts/MessengerContext';
import { getChatHash } from '../utils/encryption';
import { getContactCustomName, getCachedDomain, setContactCustomName } from '../utils/domains';
import ReactionPicker from '../components/ReactionPicker';
import ChatBackground from '../components/ChatBackground';
import ContactProfileModal from '../components/ContactProfileModal';
import AvatarDisplay from '../components/AvatarDisplay';
import { useDarkAlert } from '../components/DarkAlert';
import { useCall } from '../contexts/CallContext';

function formatCallDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export default function ChatScreen({ route, navigation }: any) {
  const { contact } = route.params;
  const { showAlert, DarkAlertComponent } = useDarkAlert();
  const [message, setMessage] = React.useState('');
  const [menuVisible, setMenuVisible] = React.useState<string | null>(null);
  const [deleteMenuVisible, setDeleteMenuVisible] = React.useState<string | null>(null);
  const [displayName, setDisplayName] = React.useState(contact.displayName || contact.pubkey);
  const [originalName, setOriginalName] = React.useState(contact.displayName || contact.pubkey);
  const [renameDialogVisible, setRenameDialogVisible] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [reactionPickerVisible, setReactionPickerVisible] = React.useState(false);
  const [reactingToMessageId, setReactingToMessageId] = React.useState<string | null>(null);
  const [replyToMessage, setReplyToMessage] = React.useState<any>(null);
  const [quickReactVisible, setQuickReactVisible] = React.useState<string | null>(null);
  const [profileModalVisible, setProfileModalVisible] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const wallet = useWallet();
  const messenger = useMessenger();
  const { startCall } = useCall();
  const flatListRef = React.useRef<FlatList>(null);

  // Get conversation ID from the two public keys
  const conversationId = React.useMemo(() => {
    if (!wallet.publicKey) return '';
    const chatHash = getChatHash(wallet.publicKey, new PublicKey(contact.pubkey));
    return Buffer.from(chatHash).toString('hex');
  }, [wallet.publicKey, contact.pubkey]);

  // Join conversation room and load message history when screen mounts
  React.useEffect(() => {
    if (conversationId && messenger.socket) {
      messenger.joinConversation(conversationId);
      messenger.loadConversationMessages(conversationId);

      return () => {
        messenger.leaveConversation(conversationId);
      };
    }
  }, [conversationId, messenger.socket]);

  // Get messages for this conversation
  const conversationMessages = messenger.messages.get(conversationId) || [];

  // Helper to derive message status from both msg.status and readTimestamps (Fix 8)
  const getMessageStatus = (msg: any): 'sending' | 'sent' | 'read' | null => {
    if (msg.sender !== wallet.publicKey?.toBase58()) return null; // Only for outgoing messages
    if (msg.status === 'read') return 'read';
    const readTs = messenger.readTimestamps.get(conversationId);
    if (readTs && new Date(msg.timestamp).getTime() <= readTs) return 'read';
    return msg.status || 'sent';
  };

  const messages = conversationMessages.map((msg: any, idx: number) => {
    const isMe = msg.sender === wallet.publicKey?.toBase58();
    const isSystem = msg.type === 'system';
    let content = msg.content;

    if (msg.reactions && Object.keys(msg.reactions).length > 0) {
      console.log(`💬 Message ${msg.id} has reactions in raw data:`, msg.reactions);
    }

    // System messages are always plaintext
    if (isSystem) {
      return {
        id: msg.id || `${idx}`,
        sender: msg.sender,
        content,
        timestamp: new Date(msg.timestamp || Date.now()),
        isMe: false,
        isSystem: true,
      };
    }

    // Call history entries
    if (msg.type === 'call') {
      return {
        id: msg.id || `${idx}`,
        sender: msg.sender,
        content: msg.content,
        timestamp: new Date(msg.timestamp || Date.now()),
        isMe: false,
        isSystem: false,
        isCall: true,
      };
    }

    // Decrypt if message is encrypted and we don't have plaintext
    if (!content && msg.encrypted && msg.nonce) {
      try {
        const senderPubkey = new PublicKey(msg.sender);
        // Recipient is the OTHER person in conversation (not the sender)
        const recipientPubkey = isMe
          ? new PublicKey(contact.pubkey)  // You sent it → recipient is contact
          : wallet.publicKey!;              // They sent it → recipient is you
        const decrypted = messenger.decryptConversationMessage(
          msg.encrypted,
          msg.nonce,
          senderPubkey,
          recipientPubkey
        );
        content = decrypted || '[Unable to decrypt]';
      } catch (error) {
        console.error('Failed to decrypt message:', error);
        content = '[Decryption failed]';
      }
    }

    // Final fallback
    if (!content) {
      content = '[No content]';
    }

    // Find replied-to message if this is a reply
    let repliedToContent = null;
    if (msg.replyTo) {
      const repliedMsg = conversationMessages.find((m: any) => m.id === msg.replyTo);
      if (repliedMsg) {
        // Decrypt replied message if needed
        if (repliedMsg.content) {
          repliedToContent = repliedMsg.content;
        } else if (repliedMsg.encrypted && repliedMsg.nonce) {
          try {
            const repliedIsMe = repliedMsg.sender === wallet.publicKey?.toBase58();
            const repliedSenderPubkey = new PublicKey(repliedMsg.sender);
            const repliedRecipientPubkey = repliedIsMe
              ? new PublicKey(contact.pubkey)
              : wallet.publicKey!;
            repliedToContent = messenger.decryptConversationMessage(
              repliedMsg.encrypted,
              repliedMsg.nonce,
              repliedSenderPubkey,
              repliedRecipientPubkey
            ) || '[Unable to decrypt]';
          } catch {
            repliedToContent = '[Unable to decrypt]';
          }
        }
      }
    }

    return {
      id: msg.id || `${idx}`,
      sender: msg.sender,
      content,
      timestamp: new Date(msg.timestamp || Date.now()),
      isMe,
      isSystem: false,
      replyTo: msg.replyTo,
      repliedToContent,
      reactions: msg.reactions || {},
      status: getMessageStatus(msg), // Feature 5: sent/read status (Fix 8: with readTimestamps)
    };
  });

  // Load custom/domain name for contact
  React.useEffect(() => {
    const loadContactName = async () => {
      if (!wallet.publicKey) return;
      const pubkey = new PublicKey(contact.pubkey);

      // Determine original name (domain or on-chain, no custom)
      let original = contact.displayName || contact.pubkey;
      const cachedDomain = await getCachedDomain(wallet.publicKey, pubkey);
      if (cachedDomain) {
        original = cachedDomain.endsWith('.sol') || cachedDomain.endsWith('.skr')
          ? cachedDomain
          : `${cachedDomain}.sol`;
      }
      setOriginalName(original);

      // Try custom name first for display
      const customName = await getContactCustomName(wallet.publicKey, pubkey);
      if (customName) {
        setDisplayName(customName);
        return;
      }

      // Use original name for display
      setDisplayName(original);
    };

    loadContactName();
  }, [contact]);

  const handleRename = async () => {
    if (!newName.trim() || !wallet.publicKey) return;

    try {
      const pubkey = new PublicKey(contact.pubkey);
      await setContactCustomName(wallet.publicKey, pubkey, newName);
      setDisplayName(newName);
      setRenameDialogVisible(false);
      setNewName('');
    } catch (error: any) {
      showAlert('Error', 'Failed to rename contact');
    }
  };

  // Contact modal handlers (Fix 1)
  const handleModalRename = async (newName: string) => {
    if (!wallet.publicKey) return;
    try {
      const pubkey = new PublicKey(contact.pubkey);
      await setContactCustomName(wallet.publicKey, pubkey, newName);
      setDisplayName(newName);
    } catch (error: any) {
      showAlert('Error', 'Failed to rename contact');
    }
  };

  const handleResetName = async () => {
    if (!wallet.publicKey) return;
    try {
      const pubkey = new PublicKey(contact.pubkey);
      await setContactCustomName(wallet.publicKey, pubkey, ''); // Clear custom name
      setDisplayName(originalName);
    } catch (error: any) {
      showAlert('Error', 'Failed to reset name');
    }
  };

  // Compute groups in common (Fix 1)
  const groupsInCommon = React.useMemo(() => {
    if (!wallet.publicKey) return [];
    return messenger.groups
      .filter(g => (g.members ?? []).some(m => m.toBase58() === contact.pubkey))
      .map(g => ({
        groupId: Buffer.from(g.groupId).toString('hex'),
        name: g.name ?? '',
        avatar: messenger.groupAvatars.get(Buffer.from(g.groupId).toString('hex')),
      }));
  }, [messenger.groups, messenger.groupAvatars, contact.pubkey, wallet.publicKey]);

  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <TouchableOpacity
          onPress={() => {
            setNewName('');
            setRenameDialogVisible(true);
          }}
        >
          <View style={styles.headerTitle}>
            <AvatarDisplay avatar={contact.avatar} size={32} name={displayName || contact.pubkey} />
            <Text style={styles.headerName}>
              {displayName}
            </Text>
          </View>
        </TouchableOpacity>
      ),
      headerRight: () => (
        <View style={{ flexDirection: 'row' }}>
          <IconButton
            icon="phone"
            size={20}
            iconColor={theme.colors.primary}
            onPress={() => startCall({
              id: contact.pubkey,
              name: displayName,
              avatar: contact.avatar,
              walletAddress: contact.pubkey,
            })}
          />
          <IconButton
            icon="information-outline"
            size={20}
            iconColor={theme.colors.textSecondary}
            onPress={() => setProfileModalVisible(true)}
          />
          <IconButton
            icon="lock"
            size={20}
            iconColor={theme.colors.secondary}
          />
        </View>
      ),
    });
  }, [navigation, displayName]);

  const sendMessage = async () => {
    if (!message.trim() || !wallet.publicKey || isSending) return;

    setIsSending(true);
    try {
      await messenger.sendMessage(
        conversationId,
        message.trim(),
        new PublicKey(contact.pubkey),
        replyToMessage?.id
      );
      setMessage('');
      clearReply();
    } catch (error: any) {
      const msg = error?.message?.includes('insufficient')
        ? 'Insufficient SOL balance'
        : error?.message?.includes('rejected') || error?.message?.includes('declined')
        ? 'Transaction rejected'
        : error?.message || 'Failed to send message';
      showAlert('Error', msg);
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteMessage = (messageId: string, deleteForBoth: boolean) => {
    messenger.deleteMessage(conversationId, messageId, deleteForBoth);
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

    if (!messenger.socket || !wallet.publicKey) {
      console.error('❌ Socket or wallet not ready');
      return;
    }

    messenger.socket.emit('add_reaction', {
      conversationId,
      messageId: reactingToMessageId,
      emoji,
      userId: wallet.publicKey.toBase58(),
    });

    console.log('✅ Full picker reaction emitted to backend');
    setReactingToMessageId(null);
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
    // TODO: Implement pinning functionality
    showAlert('Coming Soon', 'Message pinning will be added soon');
    setMenuVisible(null);
  };

  const handleQuickReact = (messageId: string, emoji: string) => {
    console.log('🎯 Quick react - Emoji:', emoji, 'MessageID:', messageId, 'ConversationID:', conversationId);
    console.log('Socket connected?', messenger.socket?.connected);

    if (!messenger.socket || !wallet.publicKey) {
      console.error('❌ Socket or wallet not ready');
      return;
    }

    // Test: emit with acknowledgement callback
    messenger.socket.emit('add_reaction', {
      conversationId,
      messageId,
      emoji,
      userId: wallet.publicKey.toBase58(),
    }, (response: any) => {
      console.log('📬 Backend acknowledged reaction:', response);
    });

    console.log('✅ Reaction emitted to backend');
    setQuickReactVisible(null);
    setMenuVisible(null);
  };

  const clearReply = () => {
    setReplyToMessage(null);
  };

  const renderMessage = ({ item }: any) => {
    // System messages (invitations, acceptances, etc.)
    if (item.isSystem) {
      return (
        <View style={styles.systemMessageContainer}>
          <Text style={styles.systemMessage}>{item.content}</Text>
          <Text style={styles.systemTimestamp}>
            {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      );
    }

    // Call history entries
    if (item.isCall) {
      try {
        const { callType, duration } = JSON.parse(item.content || '{}');
        const durationStr = duration ? ` · ${formatCallDuration(duration)}` : '';
        const icon = callType === 'missed' || callType === 'declined' ? '📵' : '📞';
        const label = callType === 'missed' ? 'Missed call'
          : callType === 'declined' ? 'Declined call'
          : `Call${durationStr}`;
        return (
          <View style={styles.systemMessageContainer}>
            <Text style={styles.systemMessage}>{icon} {label}</Text>
            <Text style={styles.systemTimestamp}>
              {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        );
      } catch {
        return null;
      }
    }

    // Regular encrypted messages with avatar for incoming messages
    // Always show avatar for incoming messages
    const showAvatar = !item.isMe;

    return (
      <View style={[styles.messageRow, item.isMe ? styles.myMessageRow : styles.theirMessageRow]}>
        {/* Avatar for incoming messages only */}
        {showAvatar && (
          <View style={styles.messageAvatar}>
            <AvatarDisplay avatar={contact.avatar} size={32} name={displayName || contact.pubkey} />
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
              onPress={() => handleDeleteMessage(item.id, false)}
              title="Delete for Me"
              leadingIcon="delete-outline"
            />
            {item.isMe && (
              <Menu.Item
                onPress={() => handleDeleteMessage(item.id, true)}
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
      keyboardVerticalOffset={90}
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
          value={message}
          onChangeText={setMessage}
          placeholder="Message..."
          mode="outlined"
          style={styles.input}
          outlineColor="transparent"
          activeOutlineColor={theme.colors.primary}
          placeholderTextColor={theme.colors.textSecondary}
          right={
            <TextInput.Icon
              icon={isSending
                ? () => <ActivityIndicator size={20} color={theme.colors.primary} />
                : 'send'}
              onPress={sendMessage}
              disabled={isSending || !message.trim()}
              color={message.trim() && !isSending ? theme.colors.primary : theme.colors.textSecondary}
            />
          }
        />
      </View>

      {/* Rename Contact Dialog */}
      <Portal>
        <Dialog visible={renameDialogVisible} onDismiss={() => setRenameDialogVisible(false)} style={{ backgroundColor: theme.colors.surface }}>
          <Dialog.Title style={{ color: theme.colors.textPrimary }}>Rename Contact</Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: theme.colors.textSecondary, marginBottom: 8 }}>
              Current: {displayName}
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
                if (!wallet.publicKey) return;
                const pubkey = new PublicKey(contact.pubkey);
                await setContactCustomName(wallet.publicKey, pubkey, '');
                setDisplayName(originalName);
                setRenameDialogVisible(false);
                setNewName('');
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

      {/* Reaction Picker */}
      <ReactionPicker
        visible={reactionPickerVisible}
        onDismiss={() => setReactionPickerVisible(false)}
        onSelect={handleReaction}
      />

      {/* Contact Profile Modal */}
      <ContactProfileModal
        visible={profileModalVisible}
        onDismiss={() => setProfileModalVisible(false)}
        pubkey={contact.pubkey}
        displayName={displayName}
        originalName={originalName}
        avatar={contact.avatar}
        walletAddress={contact.pubkey}
        isContact={true}
        groupsInCommon={groupsInCommon}
        onRename={handleModalRename}
        onResetName={handleResetName}
        onDeleteContact={() => {
          showAlert(
            'Delete Contact',
            `Remove ${displayName} from your contacts? You can re-add them later.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await messenger.deleteContact(new PublicKey(contact.pubkey));
                    navigation.goBack();
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
            `Block ${displayName}? They won't be able to contact you until unblocked.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Block',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await messenger.blockContact(new PublicKey(contact.pubkey));
                    navigation.goBack();
                  } catch (error: any) {
                    showAlert('Error', error.message);
                  }
                },
              },
            ]
          );
        }}
      />
      {DarkAlertComponent}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  headerTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerAvatar: {
    fontSize: 24,
  },
  headerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.textPrimary,
  },
  headerAvatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAvatarFallbackText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.onPrimary,
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
  systemMessageContainer: {
    alignItems: 'center',
    marginVertical: 8,
    paddingHorizontal: 16,
  },
  systemMessage: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  systemTimestamp: {
    color: theme.colors.textSecondary,
    fontSize: 10,
    marginTop: 4,
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
