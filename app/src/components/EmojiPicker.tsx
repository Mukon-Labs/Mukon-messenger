import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Image, ActivityIndicator } from 'react-native';
import { Dialog, Portal, Button } from 'react-native-paper';
import { theme } from '../theme';
import { useWallet } from '../contexts/WalletContext';
import { fetchWalletNFTs, NFTAsset } from '../utils/nfts';
import { SOLANA_RPC_URL } from '../config';

export type AvatarSelection =
  | { type: 'emoji'; value: string }
  | { type: 'nft'; mint: string; imageUrl: string };

interface EmojiPickerProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (emoji: string) => void;
  onSelectAvatar?: (selection: AvatarSelection) => void;
}

// Curated emoji list for avatars
const AVATAR_EMOJIS = [
  // Faces
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
  '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
  '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔',
  '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
  '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮',
  '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓',

  // Animals
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
  '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆',
  '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋',
  '🐌', '🐞', '🐜', '🦟', '🦗', '🕷', '🦂', '🐢', '🐍', '🦎',
  '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟',
  '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧',

  // Objects & Symbols
  '⚽️', '🏀', '🏈', '⚾️', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸',
  '🥊', '🥋', '🥅', '⛳️', '⛸', '🎣', '🤿', '🎽', '🎿', '🛷',
  '🥌', '🎯', '🪀', '🪁', '🎱', '🔮', '🪄', '🧿', '🎮', '🕹',
  '🎰', '🎲', '🧩', '🧸', '🪅', '🪆', '♠️', '♥️', '♦️', '♣️',

  // Food
  '🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒',
  '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬',
  '🥒', '🌶', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠',
  '🍞', '🥐', '🥖', '🫓', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖',

  // Misc Fun
  '🎃', '🎄', '🎆', '🎇', '🧨', '✨', '🎈', '🎉', '🎊', '🎋',
  '🎍', '🎎', '🎏', '🎐', '🎑', '🧧', '🎀', '🎁', '🎗', '🎟',
  '🎫', '🎖', '🏆', '🏅', '🥇', '🥈', '🥉', '⚽️', '🏀', '🏈',
  '💎', '💍', '💄', '👑', '🎩', '🎓', '👒', '🧢', '⛑', '📿',
  '💼', '🎒', '👝', '👛', '👜', '💰', '🪙', '💴', '💵', '💶',
  '🚀', '🛸', '🛰', '💺', '🚁', '🛩', '✈️', '🛫', '🛬', '🪂',
];

export default function EmojiPicker({ visible, onDismiss, onSelect, onSelectAvatar }: EmojiPickerProps) {
  const [tab, setTab] = useState<'emoji' | 'nft'>('emoji');
  const [nfts, setNfts] = useState<NFTAsset[]>([]);
  const [loadingNfts, setLoadingNfts] = useState(false);
  const [nftsLoaded, setNftsLoaded] = useState(false);
  const wallet = useWallet();

  useEffect(() => {
    if (tab === 'nft' && !nftsLoaded && wallet.publicKey) {
      setLoadingNfts(true);
      fetchWalletNFTs(SOLANA_RPC_URL, wallet.publicKey.toBase58())
        .then((result) => {
          setNfts(result);
          setNftsLoaded(true);
        })
        .finally(() => setLoadingNfts(false));
    }
  }, [tab, nftsLoaded, wallet.publicKey]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!visible) {
      setTab('emoji');
      setNftsLoaded(false);
    }
  }, [visible]);

  const handleEmojiSelect = (emoji: string) => {
    onSelect(emoji);
    onSelectAvatar?.({ type: 'emoji', value: emoji });
    onDismiss();
  };

  const handleNftSelect = (nft: NFTAsset) => {
    onSelectAvatar?.({ type: 'nft', mint: nft.mint, imageUrl: nft.imageUrl });
    onDismiss();
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={[styles.dialog, { backgroundColor: theme.colors.surface }]}>
        <Dialog.Title style={{ color: theme.colors.textPrimary }}>Choose Avatar</Dialog.Title>

        {/* Tab Bar */}
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, tab === 'emoji' && styles.tabActive]}
            onPress={() => setTab('emoji')}
          >
            <Text style={[styles.tabText, tab === 'emoji' && styles.tabTextActive]}>Emoji</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'nft' && styles.tabActive]}
            onPress={() => setTab('nft')}
          >
            <Text style={[styles.tabText, tab === 'nft' && styles.tabTextActive]}>NFT</Text>
          </TouchableOpacity>
        </View>

        <Dialog.ScrollArea style={styles.scrollArea}>
          {tab === 'emoji' ? (
            <ScrollView contentContainerStyle={styles.emojiGrid}>
              {AVATAR_EMOJIS.map((emoji, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.emojiButton}
                  onPress={() => handleEmojiSelect(emoji)}
                >
                  <Text style={styles.emoji}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.nftGrid}>
              {loadingNfts ? (
                <View style={styles.nftLoading}>
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                  <Text style={styles.nftLoadingText}>Loading NFTs...</Text>
                </View>
              ) : nfts.length === 0 ? (
                <View style={styles.nftLoading}>
                  <Text style={styles.nftLoadingText}>No NFTs found in wallet</Text>
                </View>
              ) : (
                nfts.map((nft) => (
                  <TouchableOpacity
                    key={nft.mint}
                    style={styles.nftButton}
                    onPress={() => handleNftSelect(nft)}
                  >
                    <Image source={{ uri: nft.imageUrl }} style={styles.nftImage} />
                    <Text style={styles.nftName} numberOfLines={1}>{nft.name}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          )}
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={onDismiss}>Cancel</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: {
    maxHeight: '80%',
  },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.background,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  tabTextActive: {
    color: theme.colors.onPrimary,
  },
  scrollArea: {
    maxHeight: 400,
    paddingHorizontal: 0,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
    justifyContent: 'center',
  },
  emojiButton: {
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 4,
    borderRadius: 8,
    backgroundColor: theme.colors.surface,
  },
  emoji: {
    fontSize: 28,
  },
  nftGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 8,
    justifyContent: 'center',
  },
  nftButton: {
    width: 100,
    alignItems: 'center',
    margin: 6,
  },
  nftImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: theme.colors.background,
  },
  nftName: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
    maxWidth: 80,
  },
  nftLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    width: '100%',
  },
  nftLoadingText: {
    color: theme.colors.textSecondary,
    marginTop: 12,
  },
});
