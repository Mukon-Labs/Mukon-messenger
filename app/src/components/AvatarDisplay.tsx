import React, { useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { theme } from '../theme';
import { fetchNFTImage } from '../utils/nfts';
import { SOLANA_RPC_URL } from '../config';

interface AvatarDisplayProps {
  avatar?: string | null;
  avatarType?: 'Emoji' | 'Nft';
  size: number;
  name?: string;
}

export default function AvatarDisplay({
  avatar,
  avatarType,
  size,
  name,
}: AvatarDisplayProps) {
  const [nftImageUrl, setNftImageUrl] = useState<string | null>(null);

  useEffect(() => {
    if (avatarType === 'Nft' && avatar) {
      fetchNFTImage(SOLANA_RPC_URL, avatar).then(setNftImageUrl);
    }
  }, [avatar, avatarType]);

  const emojiSize = size * 0.625;
  const fallbackFontSize = size * 0.5;
  const borderRadius = size / 2;

  // NFT avatar
  if (avatarType === 'Nft' && avatar) {
    if (nftImageUrl) {
      return (
        <Image
          source={{ uri: nftImageUrl }}
          style={{
            width: size,
            height: size,
            borderRadius,
          }}
        />
      );
    }
    // Loading fallback while NFT image loads
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius,
          backgroundColor: theme.colors.surface,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: fallbackFontSize, color: theme.colors.textSecondary }}>
          {(name || '?')[0].toUpperCase()}
        </Text>
      </View>
    );
  }

  // Emoji avatar
  if (avatar && Array.from(avatar).length === 1) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius,
          backgroundColor: theme.colors.surface,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Text style={{ fontSize: emojiSize }}>{avatar}</Text>
      </View>
    );
  }

  // Fallback: first-letter initial
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius,
        backgroundColor: theme.colors.primary,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Text
        style={{
          fontSize: fallbackFontSize,
          fontWeight: '600',
          color: theme.colors.onPrimary,
        }}
      >
        {(name || '?')[0].toUpperCase()}
      </Text>
    </View>
  );
}
