import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  getApplicationRoot,
  getRuntimeLogDir,
  projectRoot,
} = require('./runtime-paths.js');

describe('runtime paths', () => {
  it('uses the project root log directory by default in development', () => {
    expect(getApplicationRoot({ env: {}, versions: {}, execPath: '/usr/bin/node' }))
      .toBe(projectRoot);
    expect(getRuntimeLogDir({ env: {}, versions: {}, execPath: '/usr/bin/node' }))
      .toBe(path.join(projectRoot, 'log'));
  });

  it('uses the Electron app root log directory when configured by main process', () => {
    const appRoot = 'C:\\Tools\\BidKing\\dist\\win-unpacked';

    expect(getApplicationRoot({
      env: { BIDKING_APP_ROOT: appRoot },
      versions: { electron: '37.10.3' },
      execPath: path.win32.join(appRoot, 'BKToolBox.exe'),
    })).toBe(path.resolve(appRoot));
    expect(getRuntimeLogDir({
      env: { BIDKING_APP_ROOT: appRoot },
      versions: { electron: '37.10.3' },
      execPath: path.win32.join(appRoot, 'BKToolBox.exe'),
    })).toBe(path.join(path.resolve(appRoot), 'log'));
  });
});
