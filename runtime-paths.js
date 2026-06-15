const path = require('path');

const projectRoot = __dirname;

function getRuntimeRoot() {
    if (process.env.BIDKING_RUNTIME_ROOT) {
        return path.resolve(process.env.BIDKING_RUNTIME_ROOT);
    }

    return projectRoot;
}

function getRuntimePath(...parts) {
    return path.join(getRuntimeRoot(), ...parts);
}

function getApplicationRoot(options = {}) {
    const env = options.env || process.env;
    if (env.BIDKING_APP_ROOT) {
        return path.resolve(env.BIDKING_APP_ROOT);
    }

    return projectRoot;
}

function getRuntimeLogDir(options = {}) {
    return path.join(getApplicationRoot(options), 'log');
}

function getDocumentsDir(options = {}) {
    const env = options.env || process.env;
    if (env.BIDKING_DOCUMENTS_DIR) {
        return path.resolve(env.BIDKING_DOCUMENTS_DIR);
    }

    return path.join(require('os').homedir(), 'Documents');
}

module.exports = {
    projectRoot,
    getApplicationRoot,
    getRuntimeRoot,
    getRuntimePath,
    getRuntimeLogDir,
    getDocumentsDir
};
