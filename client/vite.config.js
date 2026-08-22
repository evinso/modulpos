import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) return 'react-vendor';
          if (id.includes('node_modules/recharts')) return 'charts';
          if (id.includes('node_modules/lucide-react')) return 'icons';
        }
      }
    },
    chunkSizeWarningLimit: 600,
  }
})
