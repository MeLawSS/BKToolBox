import { describe, expect, it } from 'vitest';
import packageJson from './package.json' with { type: 'json' };
import packageLock from './package-lock.json' with { type: 'json' };

describe('package build config', () => {
  const codegraphPackage = packageLock.packages['node_modules/@colbymchenry/codegraph'];
  const expectedCodegraphDarwinX64Version =
    codegraphPackage.optionalDependencies['@colbymchenry/codegraph-darwin-x64'];

  it('packages app-side lib modules required by server.js', () => {
    expect(packageJson.build.files).toContain('lib/**/*.js');
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
      version: expectedCodegraphDarwinX64Version,
      optional: true,
      resolved: expect.any(String),
      integrity: expect.any(String),
    }));
    expect(
      packageLock.packages['node_modules/@colbymchenry/codegraph/node_modules/@colbymchenry/codegraph-darwin-x64'],
    ).toBeUndefined();
  });
});
