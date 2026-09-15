import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useApp } from "./app-context";
import { apiFetch } from "./api";

// Real voice/video/screen-share call over the office mesh. Ports the proven
// "perfect negotiation" logic from the legacy frontend (backend/socket.js
// call_* events) into a React context so a call persists across view switches.

export interface CallParticipant {
  id: string;
  name: string;
  self: boolean;
  stream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
}

interface IncomingCall {
  id: string;
  username: string;
}

interface CallContextValue {
  inCall: boolean;
  micOn: boolean;
  camOn: boolean;
  sharing: boolean;
  participants: CallParticipant[];
  roster: string[];
  incoming: IncomingCall | null;
  join: (withCamera?: boolean) => Promise<boolean>;
  leave: () => void;
  toggleMic: () => void;
  toggleCamera: () => Promise<void>;
  toggleShare: () => Promise<void>;
  ring: (targets: "all" | string[]) => void;
  accept: () => Promise<void>;
  decline: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

const FALLBACK_ICE: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

interface PeerEntry {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
  micOn: boolean;
  camOn: boolean;
  stream: MediaStream | null;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { socket, currentUser, users } = useApp();

  const [inCall, setInCall] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [roster, setRoster] = useState<string[]>([]);
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const iceRef = useRef<RTCIceServer[]>(FALLBACK_ICE);
  const inCallRef = useRef(false);
  const micOnRef = useRef(true);
  const camOnRef = useRef(false);

  const getUserName = useCallback(
    (id: string) => users.find((u) => u.id === id)?.name || "Teammate",
    [users],
  );

  // Fetch the server's ICE/TURN config once we're connected.
  useEffect(() => {
    if (!socket) return;
    apiFetch<{ iceServers: RTCIceServer[] }>("/api/rtc-config")
      .then((c) => {
        if (Array.isArray(c.iceServers) && c.iceServers.length) iceRef.current = c.iceServers;
      })
      .catch(() => {});
  }, [socket]);

  const broadcastState = useCallback(() => {
    if (socket && inCallRef.current) socket.emit("call_state", { cam: camOnRef.current, mic: micOnRef.current });
  }, [socket]);

  const syncParticipants = useCallback(() => rerender(), [rerender]);

  const getPeer = useCallback(
    (peerId: string): PeerEntry => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;
      if (!socket || !currentUser) throw new Error("no socket");

      const pc = new RTCPeerConnection({ iceServers: iceRef.current });
      const entry: PeerEntry = {
        pc,
        makingOffer: false,
        ignoreOffer: false,
        polite: currentUser.id < peerId,
        micOn: true,
        camOn: false,
        stream: null,
      };
      peersRef.current.set(peerId, entry);

      if (localStreamRef.current)
        localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));

      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          socket.emit("call_signal", { target_id: peerId, data: { description: pc.localDescription } });
        } catch (err) {
          console.error("[call] negotiation error", err);
        } finally {
          entry.makingOffer = false;
        }
      };
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) socket.emit("call_signal", { target_id: peerId, data: { candidate } });
      };
      pc.ontrack = (e) => {
        entry.stream = e.streams[0];
        syncParticipants();
      };
      return entry;
    },
    [socket, currentUser, syncParticipants],
  );

  const handleSignal = useCallback(
    async (senderId: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) => {
      const entry = getPeer(senderId);
      const pc = entry.pc;
      try {
        if (data.description) {
          const offerCollision =
            data.description.type === "offer" && (entry.makingOffer || pc.signalingState !== "stable");
          entry.ignoreOffer = !entry.polite && offerCollision;
          if (entry.ignoreOffer) return;
          await pc.setRemoteDescription(data.description);
          if (data.description.type === "offer") {
            await pc.setLocalDescription();
            socket?.emit("call_signal", { target_id: senderId, data: { description: pc.localDescription } });
          }
        } else if (data.candidate) {
          try {
            await pc.addIceCandidate(data.candidate);
          } catch (err) {
            if (!entry.ignoreOffer) console.error("[call] addIceCandidate", err);
          }
        }
      } catch (err) {
        console.error("[call] handleSignal", err);
      }
    },
    [getPeer, socket],
  );

  const join = useCallback(
    async (withCamera = false): Promise<boolean> => {
      if (inCallRef.current) return true;
      if (!socket) return false;
      try {
        localStreamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: AUDIO_CONSTRAINTS,
          video: false,
        });
      } catch {
        alert("Could not access your microphone. Check permissions.");
        return false;
      }
      micOnRef.current = true;
      camOnRef.current = false;
      inCallRef.current = true;
      setMicOn(true);
      setCamOn(false);
      setInCall(true);
      socket.emit("call_join");
      broadcastState();
      syncParticipants();
      if (withCamera) await toggleCameraInternal(true);
      return true;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [socket, broadcastState, syncParticipants],
  );

  const leave = useCallback(() => {
    if (!inCallRef.current) return;
    inCallRef.current = false;
    setInCall(false);
    socket?.emit("call_leave");
    peersRef.current.forEach((p) => {
      try {
        p.pc.close();
      } catch {}
    });
    peersRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    camOnRef.current = false;
    micOnRef.current = true;
    setCamOn(false);
    setMicOn(true);
    setSharing(false);
    syncParticipants();
  }, [socket, syncParticipants]);

  const toggleMic = useCallback(() => {
    if (!localStreamRef.current) return;
    const next = !micOnRef.current;
    micOnRef.current = next;
    localStreamRef.current.getAudioTracks().forEach((t) => (t.enabled = next));
    setMicOn(next);
    broadcastState();
  }, [broadcastState]);

  // Shared camera/screen track plumbing.
  const addVideoTrack = useCallback(
    (track: MediaStreamTrack) => {
      const ls = localStreamRef.current!;
      ls.addTrack(track);
      peersRef.current.forEach(({ pc }) => pc.addTrack(track, ls));
    },
    [],
  );
  const removeVideoTracks = useCallback(() => {
    const ls = localStreamRef.current;
    if (!ls) return;
    ls.getVideoTracks().forEach((track) => {
      track.stop();
      ls.removeTrack(track);
      peersRef.current.forEach(({ pc }) => {
        const sender = pc.getSenders().find((s) => s.track === track);
        if (sender) pc.removeTrack(sender);
      });
    });
  }, []);

  async function toggleCameraInternal(on: boolean) {
    if (!inCallRef.current || !localStreamRef.current) return;
    if (on) {
      let cam: MediaStream;
      try {
        cam = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      } catch {
        alert("Could not access your camera.");
        return;
      }
      removeVideoTracks();
      addVideoTrack(cam.getVideoTracks()[0]);
      camOnRef.current = true;
      setCamOn(true);
      setSharing(false);
    } else {
      removeVideoTracks();
      camOnRef.current = false;
      setCamOn(false);
    }
    broadcastState();
    syncParticipants();
  }
  const toggleCamera = useCallback(async () => {
    await toggleCameraInternal(!camOnRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleShare = useCallback(async () => {
    if (!inCallRef.current || !localStreamRef.current) return;
    if (sharing) {
      removeVideoTracks();
      setSharing(false);
      camOnRef.current = false;
      setCamOn(false);
      broadcastState();
      syncParticipants();
      return;
    }
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    } catch {
      return;
    }
    removeVideoTracks();
    const track = display.getVideoTracks()[0];
    track.onended = () => {
      // User stopped sharing via the browser UI.
      removeVideoTracks();
      setSharing(false);
      camOnRef.current = false;
      setCamOn(false);
      broadcastState();
      syncParticipants();
    };
    addVideoTrack(track);
    setSharing(true);
    camOnRef.current = true;
    setCamOn(true);
    broadcastState();
    syncParticipants();
  }, [sharing, addVideoTrack, removeVideoTracks, broadcastState, syncParticipants]);

  const ring = useCallback(
    (targets: "all" | string[]) => {
      socket?.emit("call_start", { targets });
    },
    [socket],
  );

  const accept = useCallback(async () => {
    setIncoming(null);
    await join(false);
  }, [join]);

  const decline = useCallback(() => {
    if (incoming) socket?.emit("call_decline", { target_id: incoming.id });
    setIncoming(null);
  }, [incoming, socket]);

  // ---- socket wiring -------------------------------------------------------
  useEffect(() => {
    if (!socket) return;

    const onRinging = (data: { from: IncomingCall }) => {
      if (inCallRef.current) return;
      setIncoming(data.from);
    };
    const onPeers = (data: { peers: string[] | number[] }) =>
      (data.peers || []).forEach((pid) => getPeer(String(pid)));
    const onPeerJoined = (data: { id: number | string }) => {
      if (!inCallRef.current) return;
      getPeer(String(data.id));
      broadcastState();
    };
    const onPeerLeft = (data: { id: number | string }) => {
      const id = String(data.id);
      const entry = peersRef.current.get(id);
      if (entry) {
        try {
          entry.pc.close();
        } catch {}
        peersRef.current.delete(id);
      }
      syncParticipants();
    };
    const onSignal = (data: { sender_id: number | string; data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) => {
      if (!inCallRef.current) return;
      handleSignal(String(data.sender_id), data.data);
    };
    const onState = (data: { sender_id: number | string; cam: boolean; mic: boolean }) => {
      const entry = peersRef.current.get(String(data.sender_id));
      if (entry) {
        entry.camOn = !!data.cam;
        entry.micOn = !!data.mic;
        syncParticipants();
      }
    };
    const onRoster = (data: { roster: (number | string)[] }) =>
      setRoster((data.roster || []).map(String));

    socket.on("call_ringing", onRinging);
    socket.on("call_peers", onPeers);
    socket.on("call_peer_joined", onPeerJoined);
    socket.on("call_peer_left", onPeerLeft);
    socket.on("call_signal", onSignal);
    socket.on("call_state", onState);
    socket.on("call_roster", onRoster);

    return () => {
      socket.off("call_ringing", onRinging);
      socket.off("call_peers", onPeers);
      socket.off("call_peer_joined", onPeerJoined);
      socket.off("call_peer_left", onPeerLeft);
      socket.off("call_signal", onSignal);
      socket.off("call_state", onState);
      socket.off("call_roster", onRoster);
    };
  }, [socket, getPeer, handleSignal, broadcastState, syncParticipants]);

  // Build the participants list for rendering (self first, then peers).
  const participants: CallParticipant[] = [];
  if (inCall && currentUser) {
    participants.push({
      id: currentUser.id,
      name: currentUser.name,
      self: true,
      stream: localStreamRef.current,
      micOn,
      camOn,
    });
    peersRef.current.forEach((entry, id) => {
      participants.push({
        id,
        name: getUserName(id),
        self: false,
        stream: entry.stream,
        micOn: entry.micOn,
        camOn: entry.camOn,
      });
    });
  }

  const value: CallContextValue = {
    inCall,
    micOn,
    camOn,
    sharing,
    participants,
    roster,
    incoming,
    join,
    leave,
    toggleMic,
    toggleCamera,
    toggleShare,
    ring,
    accept,
    decline,
  };

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}
