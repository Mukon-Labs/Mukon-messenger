import React, { useState, useEffect } from 'react';
import { Dialog, Portal, Button, Text } from 'react-native-paper';
import { theme } from '../theme';

export interface DarkAlertButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface DarkAlertProps {
  visible: boolean;
  title: string;
  message: string;
  buttons?: DarkAlertButton[];
  onDismiss?: () => void;
}

/**
 * Dark-themed replacement for Alert.alert()
 *
 * Usage:
 * ```typescript
 * const [alertConfig, setAlertConfig] = useState<DarkAlertProps | null>(null);
 *
 * // Show alert
 * setAlertConfig({
 *   visible: true,
 *   title: 'Delete Message',
 *   message: 'Are you sure?',
 *   buttons: [
 *     { text: 'Cancel', style: 'cancel' },
 *     { text: 'Delete', style: 'destructive', onPress: () => handleDelete() }
 *   ]
 * });
 *
 * // Render
 * <DarkAlert {...alertConfig} onDismiss={() => setAlertConfig(null)} />
 * ```
 */
export default function DarkAlert({
  visible,
  title,
  message,
  buttons = [{ text: 'OK' }],
  onDismiss
}: DarkAlertProps) {
  const handleButtonPress = (button: DarkAlertButton) => {
    button.onPress?.();
    onDismiss?.();
  };

  const handleDismiss = () => {
    // Find cancel button and call its onPress if exists
    const cancelButton = buttons.find(b => b.style === 'cancel');
    cancelButton?.onPress?.();
    onDismiss?.();
  };

  return (
    <Portal>
      <Dialog
        visible={visible}
        onDismiss={handleDismiss}
        style={{ backgroundColor: theme.colors.surface }}
      >
        <Dialog.Title style={{ color: theme.colors.textPrimary }}>
          {title}
        </Dialog.Title>
        <Dialog.Content>
          <Text style={{ color: theme.colors.textPrimary }}>
            {message}
          </Text>
        </Dialog.Content>
        <Dialog.Actions>
          {buttons.map((button, index) => (
            <Button
              key={index}
              onPress={() => handleButtonPress(button)}
              textColor={
                button.style === 'destructive'
                  ? theme.colors.error
                  : button.style === 'cancel'
                  ? theme.colors.textSecondary
                  : theme.colors.primary
              }
            >
              {button.text}
            </Button>
          ))}
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

/**
 * Hook version for easier usage
 *
 * Usage:
 * ```typescript
 * const { showAlert, DarkAlertComponent } = useDarkAlert();
 *
 * showAlert(
 *   'Delete Message',
 *   'Are you sure?',
 *   [
 *     { text: 'Cancel', style: 'cancel' },
 *     { text: 'Delete', style: 'destructive', onPress: () => handleDelete() }
 *   ]
 * );
 *
 * return (
 *   <View>
 *     <YourContent />
 *     {DarkAlertComponent}
 *   </View>
 * );
 * ```
 */
export function useDarkAlert() {
  const [alertConfig, setAlertConfig] = useState<DarkAlertProps | null>(null);

  const showAlert = (
    title: string,
    message: string,
    buttons?: DarkAlertButton[]
  ) => {
    setAlertConfig({
      visible: true,
      title,
      message,
      buttons,
      onDismiss: () => setAlertConfig(null),
    });
  };

  const DarkAlertComponent = alertConfig ? (
    <DarkAlert
      {...alertConfig}
      onDismiss={() => setAlertConfig(null)}
    />
  ) : null;

  return { showAlert, DarkAlertComponent };
}
