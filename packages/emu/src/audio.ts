// Audio output: an AudioWorklet that plays the emulator's samples and reports how many it has
// consumed, which is what paces the emulator (see worker.ts). The worklet source is inlined
// and loaded from a Blob URL so it needs no bundler support.

const WORKLET_SOURCE = /* js */ `
class EmuOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];      // Float32Array chunks, interleaved stereo
    this.offset = 0;      // read position in queue[0], in floats
    this.consumed = 0;    // frames played since the last report
    this.emu = null;
    this.port.onmessage = ({ data }) => {
      this.emu = data;
      this.emu.onmessage = ({ data }) => {
        this.queue.push(data.samples);
        // Never let latency grow past ~0.25 s (sampleRate * 0.5 interleaved floats), e.g. after
        // the tab was in the background.
        let queued = -this.offset;
        for (const c of this.queue) queued += c.length;
        while (queued > sampleRate * 0.5 && this.queue.length > 1) {
          queued -= this.queue[0].length - this.offset;
          this.queue.shift();
          this.offset = 0;
        }
      };
    };
  }
  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    for (let i = 0; i < left.length; i++) {
      const chunk = this.queue[0];
      if (chunk) {
        left[i] = chunk[this.offset];
        right[i] = chunk[this.offset + 1];
        this.offset += 2;
        if (this.offset >= chunk.length) { this.queue.shift(); this.offset = 0; }
      } else {
        left[i] = right[i] = 0;
      }
    }
    this.consumed += left.length;
    if (this.emu && this.consumed >= 512) {
      this.emu.postMessage({ consumed: this.consumed });
      this.consumed = 0;
    }
    return true;
  }
}
registerProcessor("pokehd-emu-output", EmuOutput);
`;

/**
 * Starts audio on `context` and returns the port the emulator worker should send samples to.
 * Call after a user gesture has resumed the context.
 */
export async function createAudioOutput(context: AudioContext): Promise<{ port: MessagePort; node: AudioWorkletNode }> {
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const node = new AudioWorkletNode(context, "pokehd-emu-output", { outputChannelCount: [2] });
  node.connect(context.destination);
  const channel = new MessageChannel();
  node.port.postMessage(channel.port1, [channel.port1]);
  return { port: channel.port2, node };
}
