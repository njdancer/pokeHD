// How many tokens a piece of text costs Haiku: the same one-line prompt with and without it,
// through Claude Code on the subscription token, compared by the input tokens each reports.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const tokenFile = join(homedir(), ".config", "pokehd", "claude-oauth-token");
if (!process.env["CLAUDE_CODE_OAUTH_TOKEN"] && existsSync(tokenFile)) process.env["CLAUDE_CODE_OAUTH_TOKEN"] = readFileSync(tokenFile, "utf8").trim();
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k === "CLAUDE_CODE_OAUTH_TOKEN" || !/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDECODE$)/.test(k))), CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "pokehd-tok-")) };

export async function inputTokens(text: string): Promise<number> {
  const q = query({ prompt: `Reply with just OK.\n\n${text}`, options: { model: "claude-haiku-5-5", systemPrompt: "Reply OK.", tools: [], settingSources: [], strictMcpConfig: true, permissionMode: "dontAsk", cwd: mkdtempSync(join(tmpdir(), "pokehd-tok-")), env, maxTurns: 1 } });
  let n = 0;
  for await (const m of q) if (m.type === "assistant" && !m.parent_tool_use_id) n = m.message.usage.input_tokens + (m.message.usage.cache_read_input_tokens ?? 0) + (m.message.usage.cache_creation_input_tokens ?? 0);
  return n;
}

const samples: Record<string, string> = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const empty = await inputTokens("");
for (const [name, text] of Object.entries(samples)) console.log(`${name}: ${(await inputTokens(text)) - empty} tokens for ${text.length} characters`);
