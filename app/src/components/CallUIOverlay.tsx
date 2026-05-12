import React, { useEffect } from 'react';
import { Modal } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import { useCall } from '../contexts/CallContext';
import IncomingCallModal from '../components/IncomingCallModal';
import ActiveCallScreen from '../screens/ActiveCallScreen';

export default function CallUIOverlay() {
  const { status, partner, acceptCall, declineCall } = useCall();

  // Handle Accept/Decline action button presses from the notification while app is foregrounded
  useEffect(() => {
    return notifee.onForegroundEvent(({ type, detail }) => {
      if (detail.notification?.id !== 'incoming-call') return;
      if (type === EventType.ACTION_PRESS) {
        if (detail.pressAction?.id === 'accept') {
          acceptCall();
        } else if (detail.pressAction?.id === 'decline') {
          declineCall();
        }
        notifee.cancelNotification('incoming-call');
      }
    });
  }, [acceptCall, declineCall]);

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
