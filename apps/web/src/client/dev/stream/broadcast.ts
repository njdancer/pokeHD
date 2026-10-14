// With ?broadcast, the stream page sends itself (picture and sound, as the tab shows and plays
// them) to viewers over WebRTC, so the run can be watched from another device with sound. The QA
// harness opens the page with Chrome's --auto-accept-this-tab-capture, which grants the capture
// without a prompt. Signalling goes through the bus (apps/qa/src/bus.ts): viewers' offers arrive
// on /rtc/broadcaster and answers go back to /rtc/answer, with all ICE candidates in the SDP.
import { useEffect } from "react";

/** Bits per second for the video to each viewer. */
const MAX_BITRATE = 8_000_000;
/** And for the sound: WebRTC's default Opus (about 32 kbit/s, mono) muddies chiptune tones. */
const AUDIO_BITRATE = 256_000;

/**
 * The viewer's offer, asking for stereo Opus at full rate without silence suppression. The
 * sending side (this page) configures its encoder from these parameters of the offer.
 */
export function musicOffer(sdp: string): string {
  const opus = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp)?.[1];
  if (!opus) return sdp;
  return sdp.replace(new RegExp(`a=fmtp:${opus} ([^\\r\\n]*)`), (_, params: string) => {
    const kept = params.split(";").filter((p) => !/^(stereo|sprop-stereo|maxaveragebitrate|usedtx)=/.test(p.trim()));
    return `a=fmtp:${opus} ${[...kept, "stereo=1", "sprop-stereo=1", `maxaveragebitrate=${AUDIO_BITRATE}`, "usedtx=0"].join(";")}`;
  });
}

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
        if (track.kind === "audio") {
          track.contentHint = "music";
          const params = sender.getParameters();
          for (const encoding of params.encodings ?? []) encoding.maxBitrate = AUDIO_BITRATE;
          void sender.setParameters(params).catch(() => {});
          continue;
        }
        // WebRTC starts low and ramps up; let it reach a clean picture on the local network.
        const params = sender.getParameters();
        for (const encoding of params.encodings ?? []) encoding.maxBitrate = MAX_BITRATE;
        // A screen share keeps its sharpness and sheds frames when the CPU is short (under one a
        // second at 1080p on a starved Mac); "maintain-framerate" went the other way and sank to
        // 320×180. Balanced gives a little of each.
        params.degradationPreference = "balanced";
        void sender.setParameters(params).catch(() => {});
      }
      await pc.setRemoteDescription({ type: "offer", sdp: musicOffer(sdp) });
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
          // 720p is what OBS sends on, and a retina window would otherwise capture at twice its
          // size. Encoding 1080p cost the busy Mac its frame rate.
          video: { frameRate: 30, width: { max: 1280 }, height: { max: 720 } },
          // The game's sound as it plays: no call-style echo cancelling, denoising or gain riding.
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
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
