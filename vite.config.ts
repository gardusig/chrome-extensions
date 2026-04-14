import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const extensionRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "extensions/browser-recorder",
);

export default defineConfig({
  root: extensionRoot,
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(extensionRoot, "popup.html"),
        options: resolve(extensionRoot, "options.html"),
        background: resolve(extensionRoot, "src/background.ts"),
        content: resolve(extensionRoot, "src/content.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["tests/**/*.test.ts", "src/lib/db.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
