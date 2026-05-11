import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import { METERED_API_KEY, METERED_APP } from '../config';

const FALLBACK_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

let cachedIceServers: any[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

async function getIceServers(): Promise<any[]> {
  if (cachedIceServers && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedIceServers;
  }
  try {
    const res = await fetch(
      `https://${METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`
    );
    const servers = await res.json();
    if (Array.isArray(servers) && servers.length > 0) {
      cachedIceServers = servers;
      cacheTime = Date.now();
      return servers;
    }
  } catch (e) {
    console.warn('⚠️ Failed to fetch TURN credentials, falling back to STUN only:', e);
  }
  return FALLBACK_ICE_SERVERS;
}

export interface WebRTCCallbacks {
  onIceCandidate: (candidate: any) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionStateChange: (state: string) => void;
}

export class WebRTCCall {
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteDescriptionSet = false;
  private pendingCandidates: RTCIceCandidate[] = [];
  private callbacks: WebRTCCallbacks;

  constructor(callbacks: WebRTCCallbacks) {
    this.callbacks = callbacks;
  }

  async init(): Promise<void> {
    // Get audio-only local stream
    this.localStream = await mediaDevices.getUserMedia({
      audio: true,
      video: false,
    }) as MediaStream;

    const iceServers = await getIceServers();
    this.pc = new RTCPeerConnection({ iceServers });

    // Add local tracks
    this.localStream.getTracks().forEach((track: any) => {
      this.pc!.addTrack(track, this.localStream!);
    });

    // ICE candidate handler
    this.pc.onicecandidate = (event: any) => {
      if (event.candidate) {
        this.callbacks.onIceCandidate(event.candidate.toJSON());
      }
    };

    // Remote stream handler
    this.pc.ontrack = (event: any) => {
      if (event.streams && event.streams[0]) {
        this.callbacks.onRemoteStream(event.streams[0]);
      }
    };

    // Connection state monitoring
    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState || 'closed';
      this.callbacks.onConnectionStateChange(state);
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc?.iceConnectionState || 'closed';
      // Map ICE states to connection-like states for monitoring
      if (state === 'failed' || state === 'disconnected') {
        this.callbacks.onConnectionStateChange(state);
      }
    };
  }

  async createOffer(): Promise<RTCSessionDescription> {
    if (!this.pc) throw new Error('PeerConnection not initialized');
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    await this.pc.setLocalDescription(offer);
    return offer as RTCSessionDescription;
  }

  async handleOffer(offer: any): Promise<RTCSessionDescription> {
    if (!this.pc) throw new Error('PeerConnection not initialized');
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer as RTCSessionDescription;
  }

  async handleAnswer(answer: any): Promise<void> {
    if (!this.pc) throw new Error('PeerConnection not initialized');
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    this.remoteDescriptionSet = true;
    await this.flushPendingCandidates();
  }

  async addIceCandidate(candidate: any): Promise<void> {
    if (!this.pc) return;
    const iceCandidate = new RTCIceCandidate(candidate);
    if (this.remoteDescriptionSet) {
      await this.pc.addIceCandidate(iceCandidate);
    } else {
      this.pendingCandidates.push(iceCandidate);
    }
  }

  private async flushPendingCandidates(): Promise<void> {
    for (const candidate of this.pendingCandidates) {
      await this.pc?.addIceCandidate(candidate);
    }
    this.pendingCandidates = [];
  }

  setMuted(muted: boolean): void {
    if (!this.localStream) return;
    this.localStream.getAudioTracks().forEach((track: any) => {
      track.enabled = !muted;
    });
  }

  setSpeaker(_enabled: boolean): void {
    // Speaker routing is handled by react-native-webrtc's InCallManager
    // or system audio routing. No-op for now — audio defaults to earpiece.
  }

  cleanup(): void {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track: any) => track.stop());
      this.localStream = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.remoteDescriptionSet = false;
    this.pendingCandidates = [];
  }
}
