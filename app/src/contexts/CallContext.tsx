import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

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
  acceptCall: (contact: Contact) => void;
  declineCall: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  resetCallState: () => void;
  setRinging: (contact: Contact) => void;
}

const initialState: CallState = {
  status: 'idle',
  partner: null,
  startTime: null,
  isMuted: false,
  isSpeakerOn: false,
};

const CallContext = createContext<CallContextType | undefined>(undefined);

export function CallProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CallState>(initialState);

  const startCall = useCallback((contact: Contact) => {
    setState(prev => ({
      ...prev,
      status: 'calling',
      partner: contact,
      startTime: null,
    }));
  }, []);

  const setRinging = useCallback((contact: Contact) => {
    setState(prev => ({
      ...prev,
      status: 'ringing',
      partner: contact,
      startTime: null,
    }));
  }, []);

  const acceptCall = useCallback((contact: Contact) => {
    setState(prev => ({
      ...prev,
      status: 'active',
      partner: contact,
      startTime: Date.now(),
    }));
  }, []);

  const declineCall = useCallback(() => {
    setState(prev => ({
      ...prev,
      status: 'ended',
    }));
    setTimeout(() => {
      setState(initialState);
    }, 1000);
  }, []);

  const endCall = useCallback(() => {
    setState(prev => ({
      ...prev,
      status: 'ended',
    }));
    setTimeout(() => {
      setState(initialState);
    }, 1000);
  }, []);

  const toggleMute = useCallback(() => {
    setState(prev => ({
      ...prev,
      isMuted: !prev.isMuted,
    }));
  }, []);

  const toggleSpeaker = useCallback(() => {
    setState(prev => ({
      ...prev,
      isSpeakerOn: !prev.isSpeakerOn,
    }));
  }, []);

  const resetCallState = useCallback(() => {
    setState(initialState);
  }, []);

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
        setRinging,
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
