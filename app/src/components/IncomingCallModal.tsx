import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Modal, Animated, TouchableOpacity, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AvatarDisplay from './AvatarDisplay';
import { Contact } from '../contexts/CallContext';

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
            <AvatarDisplay avatar={caller.avatar} size={180} name={caller.name} />
          </Animated.View>

          <Text style={styles.callerName}>{caller.name}</Text>
          <Text style={styles.callingText}>incoming call...</Text>

          <View style={styles.actions}>
            <TouchableOpacity onPress={onDecline} style={[styles.callButton, styles.declineButton]}>
              <MaterialCommunityIcons name="phone-hangup" size={30} color="#fff" />
              <Text style={styles.buttonLabel}>Decline</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onAccept} style={[styles.callButton, styles.acceptButton]}>
              <MaterialCommunityIcons name="phone" size={30} color="#fff" />
              <Text style={styles.buttonLabel}>Accept</Text>
            </TouchableOpacity>
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
    gap: 50,
  },
  callButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineButton: {
    backgroundColor: '#EF4444',
  },
  acceptButton: {
    backgroundColor: '#22C55E',
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
});
