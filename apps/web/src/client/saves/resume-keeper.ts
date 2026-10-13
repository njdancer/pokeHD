// Keeps a game's resume point current while it plays (QA bug #7).
//
// A reload, a crash or a closed tab resumes from the newest point stored, so that point has to
// be recent when the page goes, and nothing may write an older point over a newer one. Asking
// the emulator for a point when the page is already going doesn't work: the answer comes back
// from its worker, and the page (and worker) are gone before it does. So points are taken
// every couple of seconds of play and stored straight away; a reload loses at most that much.
//
// Every point goes through the save slot's write queue, after any save the game handed over
// before it. Points are therefore stored in the order they were taken, and never before the
// save they hold: if the page goes between the two writes, the stored point holds the old save
// (or the new save has no point yet), and starting up uses the save, not a mismatched pair.
import { prepareResumePoint, type PreparedPoint, writeResumePoint } from "./resume-store.ts";

export interface ResumeKeeperOptions {
  /** The slot's key (resume-store). */
  key: string;
  /** Asks the emulator for a point (EmulatorHost.resumePoint): null when now isn't a moment for one. */
  take: () => Promise<Uint8Array | null>;
  /** The newest save the emulator has handed over (SaveSlot.latest). */
  save: () => Uint8Array | undefined;
  /** The slot's write queue (SaveSlot.enqueue), so a point lands after the save it holds. */
  enqueue: <T>(op: () => Promise<T>) => Promise<T>;
  /** Sends a point to the cloud; false once the player is known to be signed out. */
  upload?: (state: Uint8Array, save: Uint8Array, keepalive: boolean) => Promise<boolean>;
  /** Stores a point (tests swap it out). */
  write?: (key: string, point: PreparedPoint) => Promise<void>;
  now?: () => number;
}

export class ResumeKeeper {
  readonly #options: ResumeKeeperOptions;
  readonly #write: (key: string, point: PreparedPoint) => Promise<void>;
  #chain: Promise<unknown> = Promise.resolve();
  #latest: PreparedPoint | null = null;
  #uploaded: PreparedPoint | null = null;
  #upload = true;

  constructor(options: ResumeKeeperOptions) {
    this.#options = options;
    this.#write = options.write ?? writeResumePoint;
  }

  /** The newest point taken and stored (or being stored). */
  get latest(): PreparedPoint | null {
    return this.#latest;
  }

  /**
   * Takes a point and stores it. Calls take turns: one made while another is under way takes
   * its point after that one is stored, so a slower, older point never lands over a newer one.
   * Resolves with the point, or null if the emulator turned the moment down.
   */
  take(): Promise<PreparedPoint | null> {
    const next = this.#chain.then(() => this.#takeNow());
    this.#chain = next.catch(() => {});
    return next;
  }

  /** Sends the newest point to the cloud, if it hasn't been and it holds a save. */
  async upload(keepalive = false): Promise<void> {
    const point = this.#latest;
    const { upload } = this.#options;
    if (!upload || !this.#upload || !point?.save || point === this.#uploaded) return;
    this.#uploaded = point;
    this.#upload = await upload(point.state, point.save, keepalive).catch(() => true);
  }

  async #takeNow(): Promise<PreparedPoint | null> {
    const takenAt = (this.#options.now ?? Date.now)();
    const state = await this.#options.take();
    if (!state) return null;
    // Read once the state is here: the worker hands over any newer save first, so this is the
    // save the state holds.
    const point = await prepareResumePoint(state, this.#options.save(), takenAt);
    this.#latest = point;
    await this.#options.enqueue(() => this.#write(this.#options.key, point));
    return point;
  }
}
