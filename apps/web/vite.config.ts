import { readFile } from "node:fs/promises";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Dev server only: serves the local gitignored ROM so the app loads it with no clicks. */
function devRom(): Plugin {
  const romPath = new URL("../../rom/pokeblue.gb", import.meta.url);
  return {
    name: "pokehd-dev-rom",
    apply: "serve",
    configureServer(server) {
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

export default defineConfig({
  plugins: [devRom(), react(), cloudflare()],
});
