const { defineConfig } = require('vitest/config');
const vue = require('@vitejs/plugin-vue');

module.exports = defineConfig({
  plugins: [vue()],
  test: {
    testTimeout: 15000,
    environment: 'node',
    include: [
      '*.test.mjs',
      'src/**/*.test.js',
      'lib/**/*.test.{js,mjs}',
      'public/**/*.test.mjs',
      'electron/**/*.test.mjs',
      'scripts/**/*.test.mjs',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'server.js',
        'runtime-paths.js',
        'lib/**/*.js',
        'electron/desktop-utils.js',
        'public/page-state.js',
        'public/theme.js',
        'public/number-pad.js',
        'public/ahmed/*.js',
        'src/**/*.{js,vue}',
      ],
      exclude: ['src/**/main.js', 'src/**/*.test.js'],
      thresholds: {
        statements: 60,
        branches: 55,
        functions: 60,
        lines: 65,
      },
    },
  },
});
