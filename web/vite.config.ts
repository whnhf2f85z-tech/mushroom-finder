import { defineConfig } from 'vite';

// GitHub Pages serves the site at /mushroom-finder/.
export default defineConfig({
  base: '/mushroom-finder/',
  server: { port: Number(process.env.PORT) || 5173, fs: { allow: ['..'] } },
});
