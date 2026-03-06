import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { useMessenger } from './MessengerContext';
import { WebRTCCall } from '../utils/webrtc';

// Types
export type CallStatus = 'idle' | 'calling' | 'ringing' | 'active' | 'ended';

export interface Contact {
  id: string;
  name: string;
  avatar?: string;
  walletAddress?: string;
  status?: 'online' | 'offline' | 'away';
  lastSeen?: string;
}

export interface CallState {
  status: CallStatus;
  partner: Contact | null;
  startTime: number | null;
  isMuted: boolean;
  isSpeakerOn: boolean;
}

interface CallContextType extends CallState {
  startCall: (contact: Contact) => void;
  endCall: () => void;
  acceptCall: () => void;
  declineCall: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  resetCallState: () => void;
}

const initialState: CallState = {
  status: 'idle',
  partner: null,
  startTime: null,
  isMuted: false,
  isSpeakerOn: false,
};

const CallContext = createContext<CallContextType | undefined>(undefined);

function generateCallId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Microphone Permission',
        message: 'Mukon needs access to your microphone for voice calls.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }
  return true; // iOS handles via Info.plist
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { socket, contacts } = useMessenger();
  const [state, setState] = useState<CallState>(initialState);

  const webrtcRef = useRef<WebRTCCall | null>(null);
  const callIdRef = useRef<string | null>(null);
  const partnerPubkeyRef = useRef<string | null>(null);
  const pendingOfferRef = useRef<any>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<CallState>(initialState);

  // Keep stateRef in sync
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const cleanup = useCallback(() => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (webrtcRef.current) {
      webrtcRef.current.cleanup();
      webrtcRef.current = null;
    }
    callIdRef.current = null;
    partnerPubkeyRef.current = null;
    pendingOfferRef.current = null;
  }, []);

  const resetToIdle = useCallback(() => {
    cleanup();
    setState(initialState);
  }, [cleanup]);

  const endWithStatus = useCallback(() => {
    cleanup();
    setState(prev => ({ ...prev, status: 'ended' }));
    setTimeout(() => setState(initialState), 1500);
  }, [cleanup]);

  // ========== OUTGOING CALL ==========
  const startCall = useCallback(async (contact: Contact) => {
    if (stateRef.current.status !== 'idle') return;
    if (!socket) return;

    const hasMic = await requestMicPermission();
    if (!hasMic) return;

    const callId = generateCallId();
    callIdRef.current = callId;
    partnerPubkeyRef.current = contact.walletAddress || contact.id;

    setState({
      status: 'calling',
      partner: contact,
      startTime: null,
      isMuted: false,
      isSpeakerOn: false,
    });

    try {
      const rtc = new WebRTCCall({
        onIceCandidate: (candidate) => {
          socket.emit('call_ice_candidate', {
            callId,
            targetPubkey: partnerPubkeyRef.current,
            candidate,
          });
        },
        onRemoteStream: (_stream) => {
          // Audio plays automatically via WebRTC
        },
        onConnectionStateChange: (connState) => {
          if (connState === 'failed' || connState === 'disconnected') {
            console.log('📞 WebRTC connection lost:', connState);
            endWithStatus();
          }
        },
      });

      await rtc.init();
      webrtcRef.current = rtc;

      const offer = await rtc.createOffer();
      socket.emit('call_offer', {
        callId,
        targetPubkey: partnerPubkeyRef.current,
        sdp: offer,
      });

      // 30s ring timeout
      ringTimeoutRef.current = setTimeout(() => {
        if (stateRef.current.status === 'calling') {
          socket.emit('call_end', {
            callId: callIdRef.current,
            targetPubkey: partnerPubkeyRef.current,
          });
          endWithStatus();
        }
      }, 30000);
    } catch (err) {
      console.error('📞 Failed to start call:', err);
      resetToIdle();
    }
  }, [socket, endWithStatus, resetToIdle]);

  // ========== ACCEPT INCOMING CALL ==========
  const acceptCall = useCallback(async () => {
    if (stateRef.current.status !== 'ringing' || !socket) return;

    const hasMic = await requestMicPermission();
    if (!hasMic) {
      // Decline if no mic permission
      if (callIdRef.current && partnerPubkeyRef.current) {
        socket.emit('call_decline', {
          callId: callIdRef.current,
          targetPubkey: partnerPubkeyRef.current,
        });
      }
      resetToIdle();
      return;
    }

    try {
      const rtc = new WebRTCCall({
        onIceCandidate: (candidate) => {
          socket.emit('call_ice_candidate', {
            callId: callIdRef.current,
            targetPubkey: partnerPubkeyRef.current,
            candidate,
          });
        },
        onRemoteStream: (_stream) => {
          // Audio plays automatically
        },
        onConnectionStateChange: (connState) => {
          if (connState === 'failed' || connState === 'disconnected') {
            console.log('📞 WebRTC connection lost:', connState);
            endWithStatus();
          }
        },
      });

      await rtc.init();
      webrtcRef.current = rtc;

      const answer = await rtc.handleOffer(pendingOfferRef.current);
      socket.emit('call_answer', {
        callId: callIdRef.current,
        targetPubkey: partnerPubkeyRef.current,
        sdp: answer,
      });

      setState(prev => ({
        ...prev,
        status: 'active',
        startTime: Date.now(),
      }));
    } catch (err) {
      console.error('📞 Failed to accept call:', err);
      resetToIdle();
    }
  }, [socket, endWithStatus, resetToIdle]);

  // ========== DECLINE ==========
  const declineCall = useCallback(() => {
    if (socket && callIdRef.current && partnerPubkeyRef.current) {
      socket.emit('call_decline', {
        callId: callIdRef.current,
        targetPubkey: partnerPubkeyRef.current,
      });
    }
    endWithStatus();
  }, [socket, endWithStatus]);

  // ========== END CALL ==========
  const endCall = useCallback(() => {
    if (socket && callIdRef.current && partnerPubkeyRef.current) {
      socket.emit('call_end', {
        callId: callIdRef.current,
        targetPubkey: partnerPubkeyRef.current,
      });
    }
    endWithStatus();
  }, [socket, endWithStatus]);

  // ========== MUTE / SPEAKER ==========
  const toggleMute = useCallback(() => {
    setState(prev => {
      const newMuted = !prev.isMuted;
      webrtcRef.current?.setMuted(newMuted);
      return { ...prev, isMuted: newMuted };
    });
  }, []);

  const toggleSpeaker = useCallback(() => {
    setState(prev => {
      const newSpeaker = !prev.isSpeakerOn;
      webrtcRef.current?.setSpeaker(newSpeaker);
      return { ...prev, isSpeakerOn: newSpeaker };
    });
  }, []);

  const resetCallState = useCallback(() => {
    resetToIdle();
  }, [resetToIdle]);

  // ========== SOCKET LISTENERS ==========
  useEffect(() => {
    if (!socket) return;

    // Incoming call offer
    const handleOffer = ({ callId, callerPubkey, sdp }: any) => {
      // Already in a call — respond busy
      if (stateRef.current.status !== 'idle') {
        socket.emit('call_busy', { callId, targetPubkey: callerPubkey });
        return;
      }

      callIdRef.current = callId;
      partnerPubkeyRef.current = callerPubkey;
      pendingOfferRef.current = sdp;

      // Look up caller display name from contacts
      const callerContact = contacts.find(
        (c) => c.publicKey.toBase58() === callerPubkey
      );
      const displayName = callerContact?.displayName || callerPubkey.slice(0, 8) + '...';
      const avatar = callerContact?.avatarUrl;

      setState({
        status: 'ringing',
        partner: {
          id: callerPubkey,
          name: displayName,
          avatar,
          walletAddress: callerPubkey,
        },
        startTime: null,
        isMuted: false,
        isSpeakerOn: false,
      });
    };

    // Call answered by callee
    const handleAnswer = async ({ callId, sdp }: any) => {
      if (callId !== callIdRef.current) return;
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
      try {
        await webrtcRef.current?.handleAnswer(sdp);
        setState(prev => ({
          ...prev,
          status: 'active',
          startTime: Date.now(),
        }));
      } catch (err) {
        console.error('📞 Failed to handle answer:', err);
      }
    };

    // ICE candidate relay
    const handleIce = async ({ callId, candidate }: any) => {
      if (callId !== callIdRef.current) return;
      try {
        await webrtcRef.current?.addIceCandidate(candidate);
      } catch (err) {
        console.error('📞 Failed to add ICE candidate:', err);
      }
    };

    // Call declined by callee
    const handleDecline = ({ callId }: any) => {
      if (callId !== callIdRef.current) return;
      console.log('📞 Call declined');
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
      cleanup();
      setState(prev => ({ ...prev, status: 'ended' }));
      setTimeout(() => setState(initialState), 1500);
    };

    // Call ended by other side
    const handleEnd = ({ callId }: any) => {
      if (callId !== callIdRef.current) return;
      console.log('📞 Call ended by remote');
      cleanup();
      setState(prev => ({ ...prev, status: 'ended' }));
      setTimeout(() => setState(initialState), 1500);
    };

    // Target busy or offline
    const handleBusy = ({ callId }: any) => {
      if (callId !== callIdRef.current) return;
      console.log('📞 Call target busy/offline');
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
      cleanup();
      setState(prev => ({ ...prev, status: 'ended' }));
      setTimeout(() => setState(initialState), 1500);
    };

    socket.on('call_offer', handleOffer);
    socket.on('call_answer', handleAnswer);
    socket.on('call_ice_candidate', handleIce);
    socket.on('call_decline', handleDecline);
    socket.on('call_end', handleEnd);
    socket.on('call_busy', handleBusy);

    return () => {
      socket.off('call_offer', handleOffer);
      socket.off('call_answer', handleAnswer);
      socket.off('call_ice_candidate', handleIce);
      socket.off('call_decline', handleDecline);
      socket.off('call_end', handleEnd);
      socket.off('call_busy', handleBusy);
    };
  }, [socket, contacts, cleanup]);

  return (
    <CallContext.Provider
      value={{
        ...state,
        startCall,
        endCall,
        acceptCall,
        declineCall,
        toggleMute,
        toggleSpeaker,
        resetCallState,
      }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const context = useContext(CallContext);
  if (context === undefined) {
    throw new Error('useCall must be used within a CallProvider');
  }
  return context;
}
