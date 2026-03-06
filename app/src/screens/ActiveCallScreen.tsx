import React, { useState, useEffect } from 'react';
import { View, StyleSheet, SafeAreaView } from 'react-native';
import { Text, IconButton, useTheme } from 'react-native-paper';
import { useCall } from '../contexts/CallContext';
import Avatar from '../components/Avatar';

interface ActiveCallScreenProps {
  visible: boolean;
}

export default function ActiveCallScreen({ visible }: ActiveCallScreenProps) {
  const theme = useTheme();
  const { status, partner, startTime, isMuted, isSpeakerOn, toggleMute, toggleSpeaker, endCall } = useCall();
  const [callDuration, setCallDuration] = useState('00:00');

  useEffect(() => {
    if (!startTime) {
      setCallDuration(status === 'calling' ? 'Calling...' : '00:00');
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const seconds = (elapsed % 60).toString().padStart(2, '0');
      setCallDuration(`${minutes}:${seconds}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime, status]);

  if (!visible || !partner) return null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.partnerName}>{partner.name}</Text>
        <Text style={styles.callStatus}>{callDuration}</Text>
      </View>

      <View style={styles.avatarContainer}>
        <Avatar name={partner.name} size="xlarge" />
      </View>

      <View style={styles.infoContainer}>
        <Text style={styles.callType}>Voice Call</Text>
      </View>

      <View style={styles.actionsContainer}>
        <View style={styles.actionButton}>
          <IconButton
            icon={isMuted ? 'microphone-off' : 'microphone'}
            iconColor={isMuted ? '#EF4444' : '#fff'}
            size={28}
            onPress={toggleMute}
            style={[styles.iconButton, isMuted && styles.iconButtonActive]}
          />
          <Text style={styles.actionLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
        </View>

        <View style={styles.actionButton}>
          <IconButton
            icon={isSpeakerOn ? 'volume-high' : 'volume-off'}
            iconColor={isSpeakerOn ? theme.colors.primary : '#fff'}
            size={28}
            onPress={toggleSpeaker}
            style={[styles.iconButton, isSpeakerOn && styles.iconButtonActive]}
          />
          <Text style={styles.actionLabel}>{isSpeakerOn ? 'Speaker On' : 'Speaker'}</Text>
        </View>
      </View>

      <View style={styles.hangupContainer}>
        <IconButton
          icon="phone-hangup"
          iconColor="#fff"
          size={36}
          onPress={endCall}
          style={styles.hangupButton}
        />
        <Text style={styles.hangupLabel}>End Call</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F2937',
  },
  header: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 40,
  },
  partnerName: {
    fontSize: 24,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  callStatus: {
    fontSize: 16,
    color: '#9CA3AF',
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  infoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  callType: {
    fontSize: 14,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 60,
    marginBottom: 40,
  },
  actionButton: {
    alignItems: 'center',
  },
  iconButton: {
    backgroundColor: '#374151',
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  iconButtonActive: {
    backgroundColor: '#4B5563',
  },
  actionLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 4,
  },
  hangupContainer: {
    alignItems: 'center',
    marginTop: 'auto',
    paddingBottom: 40,
  },
  hangupButton: {
    backgroundColor: '#EF4444',
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  hangupLabel: {
    color: '#EF4444',
    fontSize: 12,
    marginTop: 4,
  },
});
