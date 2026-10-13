// The always-on picture for broadcasting (/dev/watch): OBS shows this page, and this page shows
// the stream page's live video and sound (WebRTC through the QA bus, see broadcast.ts), or a
// "be right back" screen while the harness, its browser or the player restarts. It reconnects by
// itself, so restarting anything behind it never drops the Twitch or YouTube stream.
// ?bus=http://127.0.0.1:4545 as for the stream page; ?muted for a silent preview.
import { useEffect, useRef, useState } from "react";
import { BUS, useFit, useFonts } from "./stage.ts";
import "./stream.css";

const RETRY_MS = 3000;

export function WatchPage() {
  useFonts();
  const scale = useFit();
  const video = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const root = BUS.replace(/\/$/, "");
    let disposed = false;
    let pc: RTCPeerConnection | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const retry = () => {
      pc?.close();
      pc = null;
      setLive(false);
      if (!disposed) timer = setTimeout(() => void connect(), RETRY_MS);
    };

    async function connect() {
      const peer = new RTCPeerConnection();
      pc = peer;
      peer.addTransceiver("video", { direction: "recvonly" });
      peer.addTransceiver("audio", { direction: "recvonly" });
      const stream = new MediaStream();
      peer.ontrack = (e) => {
        stream.addTrack(e.track);
        if (video.current) {
          video.current.srcObject = stream;
          void video.current.play().catch(() => {});
        }
        // A track that ends (the stream page reloading) means start over.
        e.track.addEventListener("ended", () => pc === peer && retry());
      };
      peer.onconnectionstatechange = () => {
        if (pc !== peer) return;
        if (peer.connectionState === "connected") setLive(true);
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected" || peer.connectionState === "closed") retry();
      };
      try {
        await peer.setLocalDescription(await peer.createOffer());
        await new Promise<void>((resolve) => {
          if (peer.iceGatheringState === "complete") return resolve();
          peer.addEventListener("icegatheringstatechange", () => peer.iceGatheringState === "complete" && resolve());
          setTimeout(resolve, 2000);
        });
        const res = await fetch(`${root}/rtc/offer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sdp: peer.localDescription!.sdp }) });
        if (!res.ok) throw new Error(`offer ${res.status}`);
        const { sdp } = (await res.json()) as { sdp: string };
        if (pc === peer) await peer.setRemoteDescription({ type: "answer", sdp });
      } catch {
        if (pc === peer) retry();
      }
    }

    void connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      pc?.close();
    };
  }, []);

  return (
    <div className="qs-shell">
      <video ref={video} className="qs-watch-video" playsInline autoPlay muted={new URLSearchParams(location.search).has("muted")} hidden={!live} />
      {!live && (
        <div className="qs-fit" style={{ transform: `translate(-50%,-50%) scale(${scale})` }}>
          <div className="qs qs-brb">
            <div className="qs-brb-ball" />
            <div className="qs-brb-title qs-display">
              Claude QA's <b>pokeHD</b>
            </div>
            <div className="qs-brb-sub">Be right back: restarting the game</div>
          </div>
        </div>
      )}
    </div>
  );
}
