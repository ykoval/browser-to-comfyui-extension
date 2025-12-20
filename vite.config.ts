import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        popup: resolve(__dirname, 'src/popup.ts'),
        options: resolve(__dirname, 'src/options.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        format: 'es',
      },
    },
  },
});
