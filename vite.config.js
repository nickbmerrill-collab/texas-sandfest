import { defineConfig } from "vite";
import { resolve } from "node:path";

// On GitHub Pages we live at /<repo>/, on a custom domain (api.heyelab.com / sandfest.heyelab.com)
// we live at the root. The DEPLOY_BASE env var lets the workflow pin this.
const base = process.env.DEPLOY_BASE || "/";

export default defineConfig({
  base,
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // Visitor site + isolated ops console (enterprise bundle split).
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html")
      }
    }
  }
});
