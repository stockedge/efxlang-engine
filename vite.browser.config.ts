import path from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(__dirname, "web"),
  resolve: {
    alias: {
      "@core": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist-web"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname)],
    },
  },
});
