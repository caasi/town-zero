import { configDefaults, defineConfig } from "vitest/config";

// Property tests (*.property.test.ts, fast-check) take seconds each, so the
// everyday `pnpm run test` skips them; `pnpm run test:props` runs only them.
// CI runs both.
const props = process.env.PROPS === "1";

export default defineConfig({
  test: {
    globals: true,
    root: ".",
    passWithNoTests: true,
    // Tests must never call the real Jev API, even when the shell has a key.
    env: { TYPESAFE_API_KEY: "" },
    include: props ? ["**/*.property.test.ts"] : configDefaults.include,
    exclude: props ? configDefaults.exclude : [...configDefaults.exclude, "**/*.property.test.ts"],
    testTimeout: props ? 120_000 : configDefaults.testTimeout,
  },
});
