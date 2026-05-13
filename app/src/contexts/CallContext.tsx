import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMessenger } from './MessengerContext';
import { WebRTCCall } from '../utils/webrtc';
import notifee from '@notifee/react-native';
import { sendCallNotification } from '../utils/notifications';
import { getChatHash } from '../utils/encryption';

// Types
export type CallStatus = 'idle' | 'calling' | 'ringing' | 'active' | 'ended' | 'unavailable' | 'declined';

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
  const { socket, contacts, wallet } = useMessenger();
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

  // Emits a call history event so both parties see it in the chat thread.
  // Only call from the ACTIVE side (endCall/declineCall/ring timeout) — never from passive handlers.
  const emitCallEvent = useCallback((callType: 'ended' | 'declined' | 'missed', duration?: number | null) => {
    if (!socket || !partnerPubkeyRef.current || !wallet?.publicKey) return;
    try {
      const chatHash = getChatHash(wallet.publicKey, new PublicKey(partnerPubkeyRef.current));
      const conversationId = Buffer.from(chatHash).toString('hex');
      socket.emit('call_event', {
        targetPubkey: partnerPubkeyRef.current,
        conversationId,
        callType,
        duration: duration ?? null,
      });
    } catch (e) {
      console.warn('📞 Failed to emit call_event:', e);
    }
  }, [socket, wallet]);

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

      // 30s ring timeout — no answer
      ringTimeoutRef.current = setTimeout(() => {
        if (stateRef.current.status === 'calling') {
          socket.emit('call_end', {
            callId: callIdRef.current,
            targetPubkey: partnerPubkeyRef.current,
          });
          emitCallEvent('missed');
          cleanup();
          setState(prev => ({ ...prev, status: 'unavailable' }));
        }
      }, 30000);
    } catch (err) {
      console.error('📞 Failed to start call:', err);
      resetToIdle();
    }
  }, [socket, emitCallEvent, endWithStatus, resetToIdle]);

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
    emitCallEvent('declined');
    endWithStatus();
  }, [socket, emitCallEvent, endWithStatus]);

  // ========== END CALL ==========
  const endCall = useCallback(() => {
    const duration = stateRef.current.startTime ? Date.now() - stateRef.current.startTime : null;
    if (socket && callIdRef.current && partnerPubkeyRef.current) {
      socket.emit('call_end', {
        callId: callIdRef.current,
        targetPubkey: partnerPubkeyRef.current,
      });
    }
    emitCallEvent('ended', duration);
    endWithStatus();
  }, [socket, emitCallEvent, endWithStatus]);

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
      console.log('📞 Incoming call_offer received from:', callerPubkey, 'status:', stateRef.current.status);
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

      // Fire local notification so user sees call even if app is backgrounded
      sendCallNotification(displayName, callerPubkey);

      // Safety net: if call_end/decline never arrives (caller cancelled while callee was
      // backgrounded and missed the event), auto-dismiss after 35s
      ringTimeoutRef.current = setTimeout(() => {
        if (stateRef.current.status === 'ringing' && callIdRef.current === callId) {
          console.log('📞 Callee ring timeout — auto-dismissing stale call UI');
          notifee.cancelNotification('incoming-call');
          cleanup();
          setState(initialState);
        }
      }, 35000);

      // If user tapped Decline from the notification while app was backgrounded,
      // process it now that the socket is live
      AsyncStorage.getItem('@mukon_pending_decline').then((val) => {
        if (val) {
          AsyncStorage.removeItem('@mukon_pending_decline');
          if (socket && callIdRef.current && partnerPubkeyRef.current) {
            socket.emit('call_decline', { callId: callIdRef.current, targetPubkey: partnerPubkeyRef.current });
          }
          emitCallEvent('declined');
          endWithStatus();
        }
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
      setState(prev => ({ ...prev, status: 'declined' }));
    };

    // Call ended by other side
    const handleEnd = ({ callId }: any) => {
      if (callId !== callIdRef.current) return;
      console.log('📞 Call ended by remote');
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
      cleanup();
      setState(prev => ({ ...prev, status: 'ended' }));
    };

    // Target busy — only act if actually busy (in another call), not offline
    // If offline, let the 30s ring timeout handle it naturally
    const handleBusy = ({ callId, reason }: any) => {
      if (callId !== callIdRef.current) return;
      if (reason === 'offline') {
        console.log('📞 Target offline — ringing until timeout');
        return;
      }
      console.log('📞 Target busy:', reason);
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
      cleanup();
      setState(prev => ({ ...prev, status: 'unavailable' }));
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
  }, [socket, contacts, cleanup, emitCallEvent, endWithStatus]);

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
