import { describe, expect, it } from "vitest";
import { createDeviceRecovery, type GpuEvent } from "./gpu-recovery.ts";

/** A fake GPU: `restore` fails while `down` and counts its attempts. */
function setup(options: { down?: number; maxLosses?: number } = {}) {
  let t = 0;
  let down = options.down ?? 0;
  const events: GpuEvent[] = [];
  const slept: number[] = [];
  const fake = { attempts: 0, restored: 0, onRestore: () => {} };
  const recovery = createDeviceRecovery({
    async restore() {
      fake.attempts++;
      if (down > 0) {
        down--;
        throw new Error("no adapter");
      }
      fake.onRestore();
      fake.restored++;
    },
    onEvent: (e) => events.push(e),
    retryDelays: [0, 10, 20],
    maxLosses: options.maxLosses ?? 3,
    windowMs: 60_000,
    now: () => t,
    sleep: async (ms) => {
      slept.push(ms);
      t += ms;
    },
  });
  return { recovery, events, slept, fake, advance: (ms: number) => (t += ms) };
}

describe("GPU device recovery", () => {
  it("makes a new device after a loss", async () => {
    const { recovery, events, fake } = setup();
    recovery.lost("GPU process restarted");
    expect(recovery.state).toBe("recovering");
    await recovery.settled;
    expect(fake.restored).toBe(1);
    expect(recovery.state).toBe("ok");
    expect(events.map((e) => e.state)).toEqual(["lost", "restored"]);
  });

  it("retries while there's no adapter yet, waiting longer each time", async () => {
    const { recovery, fake, slept } = setup({ down: 2 });
    recovery.lost("gone");
    await recovery.settled;
    expect(fake.attempts).toBe(3);
    expect(slept).toEqual([0, 10, 20]);
    expect(recovery.state).toBe("ok");
  });

  it("gives up when every attempt fails", async () => {
    const { recovery, events } = setup({ down: 99 });
    recovery.lost("gone");
    await recovery.settled;
    expect(recovery.state).toBe("failed");
    expect(events.at(-1)?.state).toBe("failed");
    recovery.lost("again"); // nothing more happens once failed
    expect(events.length).toBe(2);
  });

  it("restores again when the new device is lost while restoring", async () => {
    const { recovery, fake } = setup();
    fake.onRestore = () => {
      if (fake.restored === 0) recovery.lost("lost again mid-restore");
    };
    recovery.lost("gone");
    await recovery.settled;
    expect(fake.restored).toBe(2);
    expect(recovery.state).toBe("ok");
  });

  it("gives up when losses keep coming, but not for ones spread out", async () => {
    const { recovery, advance } = setup({ maxLosses: 2 });
    for (let i = 0; i < 4; i++) {
      recovery.lost(`loss ${i}`);
      await recovery.settled;
      advance(61_000);
    }
    expect(recovery.state).toBe("ok");
    for (let i = 0; i < 3; i++) {
      recovery.lost(`burst ${i}`);
      await recovery.settled;
    }
    expect(recovery.state).toBe("failed");
  });

  it("stops after dispose", async () => {
    const { recovery, fake } = setup();
    recovery.lost("gone");
    recovery.dispose();
    await recovery.settled;
    expect(fake.restored).toBe(0);
  });
});
