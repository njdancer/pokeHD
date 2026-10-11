// Prints the game's crash reports (/admin/errors) for agents: `pnpm errors` lists the problems,
// `pnpm errors <n>` shows problem n in full with its recent occurrences.
// Needs POKEHD_DEV_ROM_TOKEN (cloud sandboxes; read-only here), POKEHD_ADMIN_TOKEN, or
// ~/.config/pokehd/admin-token on Nick's Mac. Never print either.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const base = `${process.env.POKEHD_URL ?? "https://pokehd.dncr.me"}/api/admin/errors`;
const token = process.env.POKEHD_ADMIN_TOKEN ?? readToken() ?? process.env.POKEHD_DEV_ROM_TOKEN;
if (!token) {
  console.error("Set POKEHD_DEV_ROM_TOKEN or POKEHD_ADMIN_TOKEN.");
  process.exit(1);
}

function readToken(): string | undefined {
  try {
    return readFileSync(`${homedir()}/.config/pokehd/admin-token`, "utf8").trim();
  } catch {
    return undefined;
  }
}

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

interface Report {
  kind: string;
  message: string;
  stack?: string;
  componentStack?: string;
  page: string;
  build: string;
  uptime: number;
  log?: string[];
  device: Record<string, unknown>;
  at: number;
  player: { name: string } | null;
}

interface Group {
  fingerprint: string;
  count: number;
  visits: number;
  firstAt: number;
  lastAt: number;
  players: string[];
  builds: string[];
  latest: Report;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const { groups } = await get<{ groups: Group[] }>(base);
const pick = process.argv[2] ? Number(process.argv[2]) : null;

if (pick === null) {
  if (!groups.length) console.log("No crash reports.");
  groups.forEach((g, i) => {
    console.log(`${i + 1}. [${g.latest.kind}] ${g.latest.message.slice(0, 160)}`);
    console.log(`   ${g.count}x in ${g.visits} visits, last ${iso(g.lastAt)}, ${g.players.join(", ")}, build ${g.builds.join(" | ")}`);
  });
} else {
  const g = groups[pick - 1];
  if (!g) throw new Error(`No problem ${pick}; there are ${groups.length}.`);
  const r = g.latest;
  console.log(`[${r.kind}] ${r.message}`);
  console.log(`${g.count}x in ${g.visits} visits, ${iso(g.firstAt)} to ${iso(g.lastAt)}, ${g.players.join(", ")}`);
  console.log(`Latest: ${iso(r.at)}, ${r.player?.name ?? "signed out"}, page ${r.page}, build ${r.build}, ${Math.round(r.uptime / 1000)} s in`);
  console.log(`Device: ${JSON.stringify(r.device)}`);
  if (r.stack) console.log(`\nStack:\n${r.stack}`);
  if (r.componentStack) console.log(`\nComponents:${r.componentStack}`);
  if (r.log?.length) console.log(`\nConsole before it:\n${r.log.join("\n")}`);
  const { reports } = await get<{ reports: Report[] }>(`${base}/reports?fp=${encodeURIComponent(g.fingerprint)}`);
  console.log("\nRecent occurrences:");
  for (const o of reports) console.log(`  ${iso(o.at)} ${o.player?.name ?? "signed out"} ${o.page} ${o.build}`);
}
