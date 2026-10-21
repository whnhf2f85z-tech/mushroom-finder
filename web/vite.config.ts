import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const DAY = 24 * 60 * 60;

// GitHub Pages serves the site at /mushroom-finder/.
export default defineConfig({
  base: '/mushroom-finder/',
  server: { port: Number(process.env.PORT) || 5173, fs: { allow: ['..'] } },
  define: { 'import.meta.env.VITE_BUILD': JSON.stringify(new Date().toISOString().slice(0, 10)) },
  plugins: [
    VitePWA({
      // New versions install themselves; the next start of the app uses them.
      registerType: 'autoUpdate',
      manifest: {
        name: 'Mushroom Finder – Zürich & Schwyz',
        short_name: 'Mushrooms',
        description: 'How likely you are to find edible mushrooms right now in Zürich and Schwyz.',
        lang: 'en',
        start_url: '/mushroom-finder/',
        scope: '/mushroom-finder/',
        display: 'standalone',
        background_color: '#f7f5ef',
        theme_color: '#2f5d3a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The app itself (HTML, JS, CSS, icons, species photos) is stored on install.
        globPatterns: ['**/*.{js,css,html,png,jpg}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Latest scores: always try the network first, fall back to the saved copy offline.
            urlPattern: ({ url }) => url.pathname.endsWith('/data/latest.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mf-latest',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 2 },
            },
          },
          {
            // The 14 days (+ forecast) of grid scores, fetched in the background after the map loads.
            urlPattern: ({ url }) => /\/data\/grid\/\d{4}-\d{2}-\d{2}\.json$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mf-grid-days',
              networkTimeoutSeconds: 6,
              expiration: { maxEntries: 40, maxAgeSeconds: 35 * DAY },
            },
          },
          {
            // The reserve outlines (the largest file, ~280 KB): rarely change, so re-check at most once a day.
            urlPattern: ({ url }) => url.pathname.endsWith('/data/static/reserves.geojson'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'mf-reserves',
              expiration: { maxEntries: 1, maxAgeSeconds: DAY },
            },
          },
          {
            // grid.json, habitat.json: rarely change; show the saved copy, update in the background.
            urlPattern: ({ url }) => url.pathname.includes('/data/static/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'mf-static', expiration: { maxEntries: 10 } },
          },
          {
            // Map tiles you have already looked at (swisstopo), for use in the forest without reception.
            urlPattern: ({ url }) => url.hostname === 'wmts.geo.admin.ch',
            handler: 'CacheFirst',
            options: {
              cacheName: 'mf-tiles',
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * DAY, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
