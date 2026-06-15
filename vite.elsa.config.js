const path = require('path');
const { defineConfig } = require('vite');
const vue = require('@vitejs/plugin-vue');

module.exports = defineConfig({
  plugins: [vue()],
  root: path.resolve(__dirname, 'src/elsa'),
  base: '/',
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'public'),
    emptyOutDir: false,
    assetsDir: 'elsa/assets',
    rollupOptions: {
      input: path.resolve(__dirname, 'src/elsa/index.html'),
    },
  },
});
