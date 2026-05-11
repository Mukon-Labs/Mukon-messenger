import React from 'react';
import { Modal } from 'react-native';
import { useCall } from '../contexts/CallContext';
import IncomingCallModal from '../components/IncomingCallModal';
import ActiveCallScreen from '../screens/ActiveCallScreen';

export default function CallUIOverlay() {
  const { status, partner, acceptCall, declineCall } = useCall();

  // Show incoming call modal
  const showIncomingCall = status === 'ringing' && partner;

  // Show active call screen (calling, active, or terminal states until user dismisses)
  const showActiveCall = status === 'active' || status === 'calling' || status === 'ended' || status === 'unavailable' || status === 'declined';

  return (
    <>
      <IncomingCallModal
        visible={!!showIncomingCall}
        caller={partner}
        onAccept={acceptCall}
        onDecline={declineCall}
      />
      <Modal
        visible={showActiveCall}
        animationType="slide"
        transparent={false}
        onRequestClose={() => {}}
      >
        <ActiveCallScreen visible={showActiveCall} />
      </Modal>
    </>
  );
}
