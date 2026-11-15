import { defineConfig } from "vite";

// base 用相對路徑：GitHub Pages 的子路徑（/earthquake-risk-app/）與本機都能直接開
export default defineConfig({
  base: "./",
  server: { host: true },
});
