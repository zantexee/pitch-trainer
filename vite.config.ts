/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

// BASE_PATH is set by the GitHub Pages workflow ("/pitch-trainer/").
// Locally and on hosts that serve from the domain root it stays "/".
const base = process.env.BASE_PATH ?? '/';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig(({ mode }) => ({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
  },
  plugins: [
    react(),
    // `npm run dev:https` → self-signed HTTPS so an iPhone on the same Wi-Fi can use the mic.
    ...(mode === 'https' ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png', 'icon.svg'],
      manifest: {
        name: 'Pitch Trainer',
        short_name: 'Pitch',
        description: 'Singing pitch and ear training.',
        theme_color: '#0e1014',
        background_color: '#0e1014',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    host: true,
    // Allow quick tunnels (cloudflared / ngrok) to reach the dev server.
    allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
}));
