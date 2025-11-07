import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import * as esbuild from 'esbuild';
import builtinModules from 'builtin-modules';
import fs from 'fs';

const EXTERNAL_MODULES = ['express'];

// Custom plugin to bundle the server
function bundleServer() {
  return {
    name: 'bundle-server',
    async closeBundle() {
      console.log('Building server...');
      await esbuild.build({
        entryPoints: ['server.mjs'],
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'esm',
        outfile: 'dist/server.mjs', 
        minify: false,
        sourcemap: false,
        external: [...builtinModules, ...EXTERNAL_MODULES]
      });

      // record unbundled deb to be installed in container 
      fs.writeFileSync(
        'dist/server-deps.txt',
        EXTERNAL_MODULES.join(' ')
      );

      console.log('Server built successfully');
    },
  };
}

export default defineConfig({
  plugins: [react(), bundleServer()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
