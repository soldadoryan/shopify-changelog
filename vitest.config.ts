import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        // `server-only` throws outside a React Server Component; in tests it is a no-op.
        find: /^server-only$/,
        replacement: fileURLToPath(
          new URL("./node_modules/server-only/empty.js", import.meta.url),
        ),
      },
      { find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    // Node 26 + vitest 5: the default worker pools crash before the first test.
    pool: "vmThreads",
    include: ["tests/**/*.test.ts"],
    passWithNoTests: true,
  },
});
