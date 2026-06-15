import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AppInfo } = require('app-builder-lib/out/appInfo.js');

function loadPackageJson() {
    const packagePath = path.join(process.cwd(), 'package.json');
    return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
}

function createAppInfo(metadata) {
    return new AppInfo({
        metadata,
        config: metadata.build || {},
        devMetadata: null,
        framework: {
            defaultAppIdPrefix: 'com.electron.'
        }
    }, metadata.version, metadata.build?.win || null);
}

describe('windows build metadata', () => {
    it('derives the Windows company name from package author metadata', () => {
        const packageJson = loadPackageJson();
        const appInfo = createAppInfo(packageJson);

        expect(appInfo.companyName).toBe('melo');
    });
});
