// Issue cards: a flag as plain text Nick can paste to the ops agent in any thread, complete on its
// own (which run, which sample, where, what's wrong, and a link straight back to it).
import type { LabFlag } from "@pokehd/protocol";

export function labLink(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
  return `${location.origin}/admin/lab?${q}`;
}

export function issueCard(f: LabFlag, runTitle?: string): string {
  const lines = [
    `Relief lab issue (${f.kind}), flagged ${f.created.slice(0, 16).replace("T", " ")} UTC`,
    f.run && `Run: ${f.run}${runTitle ? ` (${runTitle})` : ""}`,
    f.dataset && `Dataset: ${f.dataset}`,
    f.stage && `Stage: ${f.stage}`,
    f.sample && `Sample: ${f.sample.id} in lab/${f.sample.manifest}${f.sample.layer ? `, layer "${f.sample.layer}"` : ""}`,
    f.box && `Box: x ${f.box[0]}, y ${f.box[1]}, ${f.box[2]}×${f.box[3]} px`,
    `What's wrong: ${f.note}`,
    `Flag file: lab/flags/${f.id}.json`,
    `Look: ${labLink({ tab: f.sample ? "samples" : "runs", run: f.run, set: f.sample?.manifest, sample: f.sample?.id })}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
