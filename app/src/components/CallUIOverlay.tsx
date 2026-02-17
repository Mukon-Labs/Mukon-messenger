import React from 'react';
import { View, StyleSheet, Modal } from 'react-native';
import { useCall } from '../contexts/CallContext';
import IncomingCallModal from '../components/IncomingCallModal';
import ActiveCallScreen from '../screens/ActiveCallScreen';

export default function CallUIOverlay() {
  const { status, partner, acceptCall, declineCall } = useCall();

  // Show incoming call modal
  const showIncomingCall = status === 'ringing' && partner;

  // Show active call screen
  const showActiveCall = status === 'active' || status === 'calling';

  return (
    <>
      <IncomingCallModal
        visible={showIncomingCall}
        caller={partner}
        onAccept={() => partner && acceptCall(partner)}
        onDecline={declineCall}
      />
      <ActiveCallScreen visible={showActiveCall} />
    </>
  );
}
