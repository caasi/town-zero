import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    root: ".",
    passWithNoTests: true,
    // Tests must never call the real Jev API, even when the shell has a key.
    env: { TYPESAFE_API_KEY: "" },
  },
});
