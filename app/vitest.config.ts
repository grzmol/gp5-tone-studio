import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve("src/renderer/src"), "@shared": resolve("src/shared") } },
  test: {
    environment: "jsdom",
    setupFiles: ["src/renderer/src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
