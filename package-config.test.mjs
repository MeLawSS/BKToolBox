import { describe, expect, it } from 'vitest';
import packageJson from './package.json' with { type: 'json' };
import packageLock from './package-lock.json' with { type: 'json' };

describe('package build config', () => {
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

  it('keeps tooling-only native helpers out of the packaged app dependency tree', () => {
    expect(packageJson.dependencies?.['@colbymchenry/codegraph']).toBeUndefined();
    expect(packageJson.optionalDependencies?.['@rolldown/binding-linux-x64-gnu']).toBeUndefined();

    expect(packageLock.packages[''].dependencies?.['@colbymchenry/codegraph']).toBeUndefined();
    expect(packageLock.packages[''].optionalDependencies?.['@rolldown/binding-linux-x64-gnu']).toBeUndefined();
    expect(packageLock.packages['node_modules/@colbymchenry/codegraph']).toBeUndefined();
  });
});
