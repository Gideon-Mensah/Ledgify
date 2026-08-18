import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "pdf", test: /node_modules\/(jspdf|jspdf-autotable|html2canvas)/ },
            { name: "charts", test: /node_modules\/recharts/ },
            { name: "react-vendor", test: /node_modules\/(react|react-dom|react-router-dom)/ },
          ],
        },
      },
    },
  },
})
