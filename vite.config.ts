import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

export default defineConfig({
  plugins: [vue()],
  root: ".",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true
  },
  resolve: {
    alias: {
      "@services": path.resolve(__dirname, "src/services"),
      "@domain": path.resolve(__dirname, "src/domain"),
      "@main": path.resolve(__dirname, "src/main"),
      "@renderer": path.resolve(__dirname, "src/renderer")
    }
  }
});
