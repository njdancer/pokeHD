import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Dev server only: serves the local gitignored ROM (and recorded states) so the app loads it with no clicks. */
function devRom(): Plugin {
  const romPath = new URL("../../rom/pokeblue.gb", import.meta.url);
  return {
    name: "pokehd-dev-rom",
    apply: "serve",
    configureServer(server) {
      // Emulator states recorded by tools/record-battles.ts, for the battle dev page.
      server.middlewares.use("/__dev/fixture", async (req, res) => {
        const name = (req.url ?? "").replace(/^\//, "");
        if (!/^[\w-]+\.state$/.test(name)) {
          res.statusCode = 400;
          return res.end();
        }
        try {
          res.setHeader("content-type", "application/octet-stream");
          res.end(await readFile(new URL(`fixtures/${name}`, romPath)));
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
      server.middlewares.use("/__dev/rom", async (_req, res) => {
        try {
          const rom = await readFile(romPath);
          res.setHeader("content-type", "application/octet-stream");
          res.end(rom);
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}

/** Dev server only: dev pages POST renders here so agents can grab full-resolution PNGs. */
function devShots(): Plugin {
  const dir = new URL("../../shots/", import.meta.url);
  return {
    name: "pokehd-dev-shots",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev/shot", async (req, res) => {
        const name = new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "";
        if (req.method !== "POST" || !/^[\w-]+$/.test(name)) {
          res.statusCode = 400;
          return res.end();
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        await mkdir(dir, { recursive: true });
        await writeFile(new URL(`${name}.png`, dir), Buffer.concat(chunks));
        res.end();
      });
    },
  };
}

export default defineConfig({
  plugins: [devRom(), devShots(), react(), cloudflare()],
  environments: {
    // The Worker reaches valibot through @pokehd/protocol (workspace source, which Vite doesn't
    // scan), so it found it on the first request and re-bundled mid-request: a 500 from /api/me
    // on every fresh dev-server start. Bundle it up front.
    pokehd: { optimizeDeps: { include: ["@pokehd/protocol > valibot"] } },
  },
});
