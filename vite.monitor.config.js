const path = require('path');
const { defineConfig } = require('vite');
const vue = require('@vitejs/plugin-vue');

module.exports = defineConfig({
  plugins: [vue()],
  root: path.resolve(__dirname, 'src/monitor'),
  base: '/monitor/',
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'public', 'monitor'),
    emptyOutDir: false,
    assetsDir: 'assets',
    rollupOptions: {
      input: path.resolve(__dirname, 'src/monitor/index.html'),
    },
  },
});
