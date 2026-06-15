const path = require('path');
const { defineConfig } = require('vite');
const vue = require('@vitejs/plugin-vue');

module.exports = defineConfig({
  plugins: [vue()],
  root: path.resolve(__dirname, 'src/home'),
  base: '/home/',
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'public/home'),
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/home/index.html'),
    },
  },
});
