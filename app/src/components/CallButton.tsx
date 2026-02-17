import React from 'react';
import { StyleSheet } from 'react-native';
import { IconButton, useTheme } from 'react-native-paper';
import { useCall, Contact } from '../contexts/CallContext';

interface CallButtonProps {
  contact: Contact;
  size?: number;
}

export default function CallButton({ contact, size = 24 }: CallButtonProps) {
  const theme = useTheme();
  const { startCall } = useCall();

  const handleCall = () => {
    startCall(contact);
  };

  return (
    <IconButton
      icon="phone"
      iconColor={theme.colors.primary}
      size={size}
      onPress={handleCall}
      style={styles.button}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    margin: 0,
  },
});
