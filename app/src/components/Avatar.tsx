import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface AvatarProps {
  name: string;
  imageUrl?: string;
  size?: 'small' | 'medium' | 'large' | 'xlarge';
  showBorder?: boolean;
}

const SIZES = {
  small: 40,
  medium: 60,
  large: 120,
  xlarge: 180,
};

const FONT_SIZES = {
  small: 16,
  medium: 24,
  large: 48,
  xlarge: 72,
};

export default function Avatar({ name, imageUrl, size = 'medium', showBorder = false }: AvatarProps) {
  const theme = useTheme();
  const dimension = SIZES[size];
  const fontSize = FONT_SIZES[size];

  const getInitial = () => {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const getColor = () => {
    const colors = [
      '#6366F1', '#8B5CF6', '#EC4899', '#EF4444', '#F97316',
      '#EAB308', '#22C55E', '#14B8A6', '#06B6D4', '#3B82F6',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <View
      style={[
        styles.container,
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
          backgroundColor: getColor(),
          borderWidth: showBorder ? 3 : 0,
          borderColor: theme.colors.primary,
        },
      ]}
    >
      {imageUrl ? (
        <MaterialCommunityIcons name="account" size={dimension * 0.6} color="#fff" />
      ) : (
        <Text style={[styles.initial, { fontSize }]}>{getInitial()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  initial: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
