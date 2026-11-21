import type { CastApi } from './types';

/**
 * WebRTC cast controller.
 *
 *  - `pc-screen` / `pc-audio`: the host offers a display capture. Electron's
 *    `setDisplayMediaRequestHandler` supplies the primary screen and, on
 *    Windows, the system audio loopback track, so the phone gets real PC sound.
 *  - `phone-camera`: the phone offers its camera; we answer and render it here
 *    (OBS/Teams can capture this window as a webcam source).
 *
 * Signalling is relayed through the encrypted WebSocket; no STUN/TURN is used
 * because both peers are on the same LAN (host candidates only).
 */

type Signal = {
  t: 'rtc.signal';
  kind: 'offer' | 'answer' | 'ice';
  stream: 'pc-screen' | 'pc-audio' | 'phone-camera';
  sdp?: string;
  candidate?: string;
};

export interface CastDeps {
  send: (signal: Omit<Signal, 't'>) => void;
  notify: (message: string, kind?: 'ok' | 'err') => void;
}

export interface CastController extends CastApi {
  handleSignal(signal: Signal): Promise<void>;
}

export function createCast(deps: CastDeps): CastController {
  const listeners = new Set<() => void>();
  let pc: RTCPeerConnection | null = null;
  let localStream: MediaStream | null = null;
  let videoEl: HTMLVideoElement | null = null;
  let remoteStream: MediaStream | null = null;
  let pendingCandidates: RTCIceCandidateInit[] = [];

  const api: CastApi = {
    state: { active: false, stream: null, error: null },
    async start(stream) {
      api.stop();
      try {
        const media = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio: true,
        });
        localStream = media;
        pc = new RTCPeerConnection({ iceServers: [] });
        bindPeer(pc, stream);

        const audio = media.getAudioTracks();
        const video = media.getVideoTracks();
        if (stream === 'pc-audio') {
          audio.forEach((track) => pc!.addTrack(track, media));
          // Keep the display track alive (Electron requires a video source) but
          // do not send it.
          video.forEach((track) => (track.enabled = false));
        } else {
          video.forEach((track) => pc!.addTrack(track, media));
          audio.forEach((track) => pc!.addTrack(track, media));
        }

        if (videoEl) videoEl.srcObject = media;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        deps.send({ kind: 'offer', stream, sdp: offer.sdp });
        api.state = { active: true, stream, error: null };
        emit();
      } catch (err) {
        api.state = { active: false, stream: null, error: (err as Error).message };
        emit();
        throw err;
      }
    },
    stop() {
      localStream?.getTracks().forEach((track) => track.stop());
      localStream = null;
      pc?.close();
      pc = null;
      remoteStream = null;
      pendingCandidates = [];
      if (videoEl) videoEl.srcObject = null;
      if (api.state.active || api.state.stream) {
        api.state = { active: false, stream: null, error: null };
        emit();
      }
    },
    attach(video) {
      videoEl = video;
      if (remoteStream) video.srcObject = remoteStream;
      else if (localStream) video.srcObject = localStream;
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };

  function emit(): void {
    for (const cb of listeners) cb();
  }

  function bindPeer(peer: RTCPeerConnection, stream: CastApi['state']['stream']): void {
    peer.onicecandidate = (event) => {
      if (event.candidate && stream) {
        deps.send({ kind: 'ice', stream, candidate: JSON.stringify(event.candidate) });
      }
    };
    peer.ontrack = (event) => {
      remoteStream = event.streams[0] ?? new MediaStream([event.track]);
      if (videoEl) {
        videoEl.srcObject = remoteStream;
        void videoEl.play().catch(() => undefined);
      }
      api.state = { active: true, stream: 'phone-camera', error: null };
      emit();
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        deps.notify(`WebRTC: ${peer.connectionState}`, 'err');
      }
    };
  }

  return {
    get state() {
      return api.state;
    },
    start: api.start.bind(api),
    stop: api.stop.bind(api),
    attach: api.attach.bind(api),
    subscribe: api.subscribe.bind(api),
    async handleSignal(signal: Signal): Promise<void> {
      if (signal.kind === 'ice' && signal.candidate) {
        const candidate = JSON.parse(signal.candidate) as RTCIceCandidateInit;
        if (pc?.remoteDescription) await pc.addIceCandidate(candidate).catch(() => undefined);
        else pendingCandidates.push(candidate);
        return;
      }
      if (signal.kind === 'offer' && signal.stream === 'phone-camera') {
        pc?.close();
        pc = new RTCPeerConnection({ iceServers: [] });
        bindPeer(pc, 'phone-camera');
        await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp ?? '' });
        for (const candidate of pendingCandidates) {
          await pc.addIceCandidate(candidate).catch(() => undefined);
        }
        pendingCandidates = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        deps.send({ kind: 'answer', stream: 'phone-camera', sdp: answer.sdp });
        api.state = { active: true, stream: 'phone-camera', error: null };
        emit();
        return;
      }
      if (signal.kind === 'answer' && pc) {
        await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp ?? '' });
        for (const candidate of pendingCandidates) {
          await pc.addIceCandidate(candidate).catch(() => undefined);
        }
        pendingCandidates = [];
      }
    },
  };
}
