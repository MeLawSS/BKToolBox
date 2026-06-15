const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.resolve(projectRoot, process.argv[2] || 'dist');
const iconPath = path.join(projectRoot, 'build', 'icon.ico');
const rceditPath = path.join(projectRoot, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');

function isWsl() {
    return process.platform === 'linux' && os.release().toLowerCase().includes('microsoft');
}

function resolveInputPath(targetPath) {
    return path.resolve(targetPath);
}

function toWindowsPath(targetPath) {
    if (process.platform === 'win32') {
        return path.win32.resolve(targetPath);
    }

    if (!isWsl()) {
        return targetPath;
    }

    const parsed = path.resolve(targetPath);
    const driveMatch = parsed.match(/^\/mnt\/([a-z])\/(.*)$/i);
    if (!driveMatch) {
        return parsed;
    }

    const [, drive, rest] = driveMatch;
    return `${drive.toUpperCase()}:\\${rest.replace(/\//g, '\\')}`;
}

function canRunRcedit() {
    return process.platform === 'win32' || isWsl();
}

function resolveExecutableTargets(inputDir) {
    const resolved = resolveInputPath(inputDir);
    const isDistRoot = path.basename(resolved).toLowerCase() === 'dist';

    if (isDistRoot) {
        const topLevelExecutables = fs.existsSync(resolved)
            ? fs.readdirSync(resolved)
                .filter((entryName) => entryName.toLowerCase().endsWith('.exe'))
                .sort((left, right) => left.localeCompare(right))
                .map((entryName) => path.join(resolved, entryName))
            : [];

        return [
            ...topLevelExecutables,
            path.join(resolved, 'win-unpacked', 'BKToolBox.exe')
        ];
    }
    return [
        path.join(resolved, 'BKToolBox.exe')
    ];
}

function patchExecutable(targetPath) {
    const result = spawnSync(rceditPath, [
        toWindowsPath(targetPath),
        '--set-icon',
        toWindowsPath(iconPath)
    ], {
        encoding: 'utf8'
    });

    if (result.status !== 0) {
        const stderr = result.stderr?.trim();
        const stdout = result.stdout?.trim();
        const message = stderr || stdout || result.error?.message || `rcedit exited with code ${result.status}`;
        console.warn(`[patch-win-icons] Skip ${targetPath}: ${message}`);
        return;
    }
}

function main() {
    if (!canRunRcedit()) {
        console.warn('[patch-win-icons] Skip: icon patching requires Windows or WSL interop.');
        return;
    }

    if (!fs.existsSync(iconPath)) {
        throw new Error(`Icon file not found: ${iconPath}`);
    }

    if (!fs.existsSync(rceditPath)) {
        throw new Error(`rcedit executable not found: ${rceditPath}`);
    }

    const targets = resolveExecutableTargets(outputDir).filter((targetPath) => fs.existsSync(targetPath));

    if (targets.length === 0) {
        console.warn(`[patch-win-icons] Skip: no Windows executables found under ${outputDir}`);
        return;
    }

    for (const targetPath of targets) {
        patchExecutable(targetPath);
        console.log(`[patch-win-icons] patched ${targetPath}`);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    resolveExecutableTargets
};
