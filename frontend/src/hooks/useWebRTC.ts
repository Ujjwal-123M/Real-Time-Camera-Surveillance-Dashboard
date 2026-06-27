import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * useWebRTC — creates a browser-side RTCPeerConnection for a single camera,
 * sends an SDP offer via the signaling WebSocket, waits for the SDP answer
 * relayed back from the Python worker, and returns the remote MediaStream
 * to be rendered in a <video> element.
 *
 * The hook only negotiates while `active` is true (i.e. camera is live).
 */

interface UseWebRTCOptions {
  cameraId: string;
  /** Whether to attempt WebRTC connection (true when camera status is 'live') */
  active: boolean;
  /** Function to send signaling messages through the WebSocket */
  sendSignal: (cameraId: string, kind: string, data: unknown) => void;
}

interface UseWebRTCResult {
  stream: MediaStream | null;
  connectionState: string;
  /** Call this to feed incoming SDP answers / ICE candidates from the worker */
  handleSignal: (kind: string, data: unknown) => Promise<void>;
}

export function useWebRTC({ cameraId, active, sendSignal }: UseWebRTCOptions): UseWebRTCResult {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] = useState<string>('new');

  /** Create a new peer connection, send offer, wait for remote track */
  const negotiate = useCallback(async () => {
    // Clean up any previous connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    pcRef.current = pc;

    // Listen for the remote video track from the worker
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setStream(event.streams[0]);
      } else {
        const ms = new MediaStream([event.track]);
        setStream(ms);
      }
    };

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(cameraId, 'ice', {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        });
      }
    };

    // We want to receive video — add a transceiver in recvonly mode
    pc.addTransceiver('video', { direction: 'recvonly' });

    // Create SDP offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Send the offer to the worker via the signaling WebSocket
    sendSignal(cameraId, 'offer', {
      sdp: offer.sdp,
      type: offer.type,
    });
  }, [cameraId, sendSignal]);

  /** Handle incoming signaling messages (called by the parent via ref) */
  const handleSignal = useCallback(async (kind: string, data: unknown) => {
    const pc = pcRef.current;
    if (!pc) return;

    try {
      if (kind === 'answer') {
        const answer = data as RTCSessionDescriptionInit;
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } else if (kind === 'ice') {
        const candidate = data as RTCIceCandidateInit;
        if (candidate && candidate.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      }
    } catch (err) {
      console.error(`[WebRTC] Signal handling error for ${cameraId}:`, err);
    }
  }, [cameraId]);

  // Start/stop negotiation based on active flag
  useEffect(() => {
    if (active) {
      negotiate().catch((err) => {
        console.error(`[WebRTC] Negotiation failed for ${cameraId}:`, err);
        setConnectionState('failed');
      });
    } else {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      setStream(null);
      setConnectionState('new');
    }

    return () => {
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    };
  }, [active, negotiate, cameraId]);

  return { stream, connectionState, handleSignal };
}
