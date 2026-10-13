// With ?broadcast, the stream page sends itself (picture and sound, as the tab shows and plays
// them) to viewers over WebRTC, so the run can be watched from another device with sound. The QA
// harness opens the page with Chrome's --auto-accept-this-tab-capture, which grants the capture
// without a prompt. Signalling goes through the bus (apps/qa/src/bus.ts): viewers' offers arrive
// on /rtc/broadcaster and answers go back to /rtc/answer, with all ICE candidates in the SDP.
import { useEffect } from "react";

/** Bits per second for the video to each viewer. */
const MAX_BITRATE = 8_000_000;

export function useBroadcast(bus: string, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const root = bus.replace(/\/$/, "");
    let disposed = false;
    let stream: MediaStream | null = null;
    let events: EventSource | null = null;
    const peers = new Set<RTCPeerConnection>();

    const answer = async (id: number, sdp: string) => {
      if (!stream) return;
      const pc = new RTCPeerConnection();
      peers.add(pc);
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          peers.delete(pc);
          pc.close();
        }
      };
      for (const track of stream.getTracks()) {
        const sender = pc.addTrack(track, stream);
        if (track.kind !== "video") continue;
        // WebRTC starts low and ramps up; let it reach a clean 1080p picture on the local network.
        const params = sender.getParameters();
        for (const encoding of params.encodings ?? []) encoding.maxBitrate = MAX_BITRATE;
        void sender.setParameters(params).catch(() => {});
      }
      await pc.setRemoteDescription({ type: "offer", sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        pc.addEventListener("icegatheringstatechange", () => pc.iceGatheringState === "complete" && resolve());
        setTimeout(resolve, 3000);
      });
      await fetch(`${root}/rtc/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, sdp: pc.localDescription!.sdp }) });
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          // A retina window would otherwise capture at twice its size (3200×1780 on the Mac).
          video: { frameRate: 30, width: { max: 1920 }, height: { max: 1080 } },
          audio: true,
          preferCurrentTab: true,
          selfBrowserSurface: "include",
        } as DisplayMediaStreamOptions);
      } catch (error) {
        console.warn("Broadcast: no tab capture", error);
        return;
      }
      if (disposed) return stream.getTracks().forEach((t) => t.stop());
      events = new EventSource(`${root}/rtc/broadcaster`);
      events.onmessage = (m: MessageEvent<string>) => {
        const { id, sdp } = JSON.parse(m.data) as { id: number; sdp: string };
        answer(id, sdp).catch((error: unknown) => console.warn("Broadcast: answer failed", error));
      };
    })();

    return () => {
      disposed = true;
      events?.close();
      for (const pc of peers) pc.close();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [bus, enabled]);
}
