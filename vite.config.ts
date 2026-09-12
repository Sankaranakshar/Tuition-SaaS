import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Keep the class-name helpers (clsx + tailwind-merge, ~8KB gzip)
          // in their own stable chunk. They are pulled in by `cn()` in every
          // kit primitive; without this, Rollup hoists them into the main
          // entry chunk as soon as enough primitives share them, inflating
          // the entry the bundle-size gate watches (design/kit-primitives).
          manualChunks: {
            classnames: ['clsx', 'tailwind-merge'],
          },
        },
      },
    },
  };
});
