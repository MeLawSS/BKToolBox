const path = require('path');
const { defineConfig } = require('vite');
const vue = require('@vitejs/plugin-vue');

module.exports = defineConfig({
  plugins: [vue()],
  root: path.resolve(__dirname, 'src/ahmed'),
  base: '/ahmed/',
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'public', 'ahmed'),
    emptyOutDir: false,
    assetsDir: 'assets',
    minify: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/ahmed/index.html'),
    },
  },
});
