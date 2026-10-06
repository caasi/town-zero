import { defineConfig } from "vite";

// index.html shows %VITE_COMMIT% so a player can name the build in a bug
// report. CI passes the full SHA (Dockerfile build arg); a local build shows "dev".
process.env.VITE_COMMIT = (process.env.VITE_COMMIT || "dev").slice(0, 7);

export default defineConfig({
  root: ".",
  server: { port: 3000 },
});
