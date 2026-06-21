import { describe, expect, it } from 'vitest';
import packageJson from './package.json' with { type: 'json' };
import packageLock from './package-lock.json' with { type: 'json' };

describe('package build config', () => {
  it('packages app-side lib modules required by server.js', () => {
    expect(packageJson.build.files).toContain('lib/**/*.js');
  });

  it('packages BidKing table data required to name monitor reveal types', () => {
    expect(packageJson.build.extraResources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'Archive/BidKing/BidKing_Data/StreamingAssets/Tables/Item.txt',
        to: 'runtime/Archive/BidKing/BidKing_Data/StreamingAssets/Tables/Item.txt',
      }),
      expect.objectContaining({
        from: 'Archive/BidKing/BidKing_Data/StreamingAssets/Tables/Item_Type.txt',
        to: 'runtime/Archive/BidKing/BidKing_Data/StreamingAssets/Tables/Item_Type.txt',
      }),
    ]));
  });

  it('requires administrator privileges for Windows monitor capture', () => {
    expect(packageJson.build.win.requestedExecutionLevel).toBe('requireAdministrator');
    expect(packageJson.build.win.signAndEditExecutable).toBe(true);
  });

  it('routes pack through the custom unpacked app-dir wrapper script', () => {
    expect(packageJson.scripts.pack).toBe('node scripts/pack-win-dir.mjs');
  });

  it('keeps the codegraph darwin-x64 optional package concrete and avoids a malformed nested stub', () => {
    expect(packageLock.packages['node_modules/@colbymchenry/codegraph-darwin-x64']).toEqual(expect.objectContaining({
      version: '1.0.1',
      optional: true,
    }));
    expect(
      packageLock.packages['node_modules/@colbymchenry/codegraph/node_modules/@colbymchenry/codegraph-darwin-x64'],
    ).toBeUndefined();
  });
});
