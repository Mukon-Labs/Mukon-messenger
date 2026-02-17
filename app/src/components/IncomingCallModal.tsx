import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Modal, Animated } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCall, Contact } from '../contexts/CallContext';
import Avatar from './Avatar';

interface IncomingCallModalProps {
  visible: boolean;
  caller: Contact | null;
  onAccept: () => void;
  onDecline: () => void;
}

export default function IncomingCallModal({ visible, caller, onAccept, onDecline }: IncomingCallModalProps) {
  const [ringAnim] = useState(new Animated.Value(1));

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(ringAnim, { toValue: 1.1, duration: 500, useNativeDriver: true }),
        Animated.timing(ringAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    ).start();
    return () => ringAnim.stopAnimation();
  }, []);

  if (!caller) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.container}>
        <View style={styles.content}>
          <Animated.View style={[styles.avatarContainer, { transform: [{ scale: ringAnim }] }]}>
            <Avatar name={caller.name} size="xlarge" showBorder />
          </Animated.View>

          <Text style={styles.callerName}>{caller.name}</Text>
          <Text style={styles.callingText}>incoming call...</Text>

          <View style={styles.actions}>
            <Button
              mode="contained"
              onPress={onDecline}
              style={[styles.declineButton, { backgroundColor: '#EF4444' }]}
              labelStyle={styles.buttonLabel}
            >
              <MaterialCommunityIcons name="phone-hangup" size={24} color="#fff" />
            </Button>

            <Button
              mode="contained"
              onPress={onAccept}
              style={[styles.acceptButton, { backgroundColor: '#22C55E' }]}
              labelStyle={styles.buttonLabel}
            >
              <MaterialCommunityIcons name="phone" size={24} color="#fff" />
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  avatarContainer: {
    marginBottom: 30,
  },
  callerName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  callingText: {
    fontSize: 16,
    color: '#9CA3AF',
    marginBottom: 60,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
  },
  declineButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
  },
  acceptButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
  },
  buttonLabel: {
    margin: 0,
  },
});
