import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    // Allow phone access via Tailscale names (*.ts.net), .local names, and GitHub Codespaces URLs (*.app.github.dev)
    allowedHosts: ['.ts.net', '.local', '.app.github.dev'],
  },
});