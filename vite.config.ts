import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    // Allow phone access via Tailscale MagicDNS names (e.g. my-mac.tailnet-123.ts.net) and .local names
    allowedHosts: ['.ts.net', '.local'],
  },
});