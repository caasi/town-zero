import { defineConfig } from "vite";

process.env.VITE_COMMIT = (process.env.VITE_COMMIT || "dev").slice(0, 7);

export default defineConfig({
  root: ".",
  server: { port: 3000 },
});
