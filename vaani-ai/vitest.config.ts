import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // tests/** = guides 02,03,05,06,07,08,09,10 suites
    // src/**   = guide 04 suites (src/lib/dograh.test.ts, dograhWebhook, vobiz)
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
});
