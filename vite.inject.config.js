const path = require('path');
const { defineConfig } = require('vite');
const vue = require('@vitejs/plugin-vue');

module.exports = defineConfig({
  plugins: [vue()],
  root: path.resolve(__dirname, 'src/inject'),
  base: '/inject/',
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'public', 'inject'),
    emptyOutDir: false,
    assetsDir: 'assets',
    rollupOptions: {
      input: path.resolve(__dirname, 'src/inject/index.html'),
    },
  },
});
