import { configDefaults, defineConfig } from "vitest/config";

const props = process.env.PROPS === "1";

export default defineConfig({
  test: {
    globals: true,
    root: ".",
    passWithNoTests: true,
    env: { TYPESAFE_API_KEY: "" },
    include: props ? ["**/*.property.test.ts"] : configDefaults.include,
    exclude: props ? configDefaults.exclude : [...configDefaults.exclude, "**/*.property.test.ts"],
    testTimeout: props ? 120_000 : configDefaults.testTimeout,
  },
});
