import type { RtcStream } from '../../../shared/protocol';
import type { LinkClient } from './link';

/**
 * WebRTC on the phone.
 *  - Receives `pc-screen` / `pc-audio` offers from the host (screen + loopback
 *    system audio) and answers with playback-only peers.
 *  - Offers `phone-camera` with getUserMedia for the "wireless webcam" mode.
 */
export interface RtcState {
  receiving: RtcStream | null;
  sending: RtcStream | null;
  error: string | null;
}

export class PhoneRtc {
  state: RtcState = { receiving: null, sending: null, error: null };
  private receivePeer: RTCPeerConnection | null = null;
  private sendPeer: RTCPeerConnection | null = null;
  private media: HTMLVideoElement | null = null;
  private localStream: MediaStream | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly link: LinkClient) {}

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  attach(video: HTMLVideoElement): void {
    this.media = video;
    if (this.receivePeer) {
      const stream = this.receivePeer.getReceivers()[0]?.track;
      if (stream) video.srcObject = new MediaStream([stream]);
    }
  }

  detach(): void {
    this.media = null;
  }

  async handleSignal(signal: {
    kind: 'offer' | 'answer' | 'ice';
    stream: RtcStream;
    sdp?: string;
    candidate?: string;
  }): Promise<void> {
    if (signal.kind === 'offer' && (signal.stream === 'pc-screen' || signal.stream === 'pc-audio')) {
      await this.answer(signal.stream, signal.sdp ?? '');
      return;
    }
    if (signal.kind === 'ice' && this.receivePeer) {
      try {
        await this.receivePeer.addIceCandidate(JSON.parse(signal.candidate ?? '{}'));
      } catch {
        /* candidate may arrive before the remote description */
      }
    }
  }

  private async answer(stream: RtcStream, sdp: string): Promise<void> {
    this.receivePeer?.close();
    const peer = new RTCPeerConnection({ iceServers: [] });
    this.receivePeer = peer;
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        void this.link.send({
          t: 'rtc.signal',
          kind: 'ice',
          stream,
          candidate: JSON.stringify(event.candidate),
        });
      }
    };
    peer.ontrack = (event) => {
      const remote = event.streams[0] ?? new MediaStream([event.track]);
      if (this.media) {
        this.media.srcObject = remote;
        void this.media.play().catch(() => undefined);
      }
      this.state = { ...this.state, receiving: stream, error: null };
      this.emit();
    };
    await peer.setRemoteDescription({ type: 'offer', sdp });
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await this.link.send({ t: 'rtc.signal', kind: 'answer', stream, sdp: answer.sdp ?? '' });
    this.state = { ...this.state, receiving: stream, error: null };
    this.emit();
  }

  /** Stream the phone camera to the PC (wireless webcam). */
  async startCamera(): Promise<void> {
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      this.localStream = media;
      const peer = new RTCPeerConnection({ iceServers: [] });
      this.sendPeer = peer;
      media.getTracks().forEach((track) => peer.addTrack(track, media));
      peer.onicecandidate = (event) => {
        if (event.candidate) {
          void this.link.send({
            t: 'rtc.signal',
            kind: 'ice',
            stream: 'phone-camera',
            candidate: JSON.stringify(event.candidate),
          });
        }
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await this.link.send({ t: 'rtc.signal', kind: 'offer', stream: 'phone-camera', sdp: offer.sdp ?? '' });
      if (this.media) this.media.srcObject = media;
      this.state = { receiving: 'phone-camera', sending: 'phone-camera', error: null };
      this.emit();
    } catch (err) {
      this.state = { ...this.state, error: (err as Error).message };
      this.emit();
      throw err;
    }
  }

  stopCamera(): void {
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.sendPeer?.close();
    this.sendPeer = null;
    if (this.state.sending === 'phone-camera') {
      this.state = { ...this.state, receiving: null, sending: null };
      this.emit();
    }
  }

  stop(): void {
    this.stopCamera();
    this.receivePeer?.close();
    this.receivePeer = null;
    this.state = { receiving: null, sending: null, error: null };
    this.emit();
  }
}
