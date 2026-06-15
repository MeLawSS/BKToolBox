function formatLogPart(value) {
    if (value instanceof Error) {
        return value.stack || value.message;
    }

    if (typeof value === 'string') {
        return value;
    }

    try {
        return JSON.stringify(value);
    } catch (_error) {
        return String(value);
    }
}

function imageToDataUrl(image) {
    if (!image || image.isEmpty()) {
        return null;
    }

    return image.toDataURL();
}

function getLatestScreenshotPayload(latestScreenshot, withDataUrl = true) {
    if (!latestScreenshot) {
        return null;
    }

    const payload = {
        capturedAt: latestScreenshot.capturedAt,
        displayId: latestScreenshot.displayId,
        sourceId: latestScreenshot.sourceId,
        hotkey: latestScreenshot.hotkey,
        captureMode: latestScreenshot.captureMode || 'full-screen',
        width: latestScreenshot.width,
        height: latestScreenshot.height,
        byteLength: latestScreenshot.pngBuffer.length,
        mimeType: 'image/png'
    };

    if (withDataUrl) {
        payload.dataUrl = `data:image/png;base64,${latestScreenshot.pngBuffer.toString('base64')}`;
    }

    return payload;
}

function getLatestScreenshotKey(latestScreenshot) {
    if (!latestScreenshot) {
        return null;
    }

    return `${latestScreenshot.capturedAt}:${latestScreenshot.pngBuffer.length}`;
}

function isAhmedPathname(pathname) {
    return pathname === '/Ahmed' || pathname === '/ahmed';
}

function isEthanPathname(pathname) {
    return pathname === '/Ethan' || pathname === '/ethan';
}

function isAhmedUrl(targetUrl) {
    if (typeof targetUrl !== 'string' || !targetUrl) {
        return false;
    }

    try {
        return isAhmedPathname(new URL(targetUrl).pathname);
    } catch (_error) {
        return false;
    }
}

function isEthanUrl(targetUrl) {
    if (typeof targetUrl !== 'string' || !targetUrl) {
        return false;
    }

    try {
        return isEthanPathname(new URL(targetUrl).pathname);
    } catch (_error) {
        return false;
    }
}

function createScreenshotErrorPayload(error, extra = {}, capturedAt = new Date().toISOString()) {
    return {
        capturedAt,
        message: error instanceof Error ? error.message : String(error),
        ...extra
    };
}

function buildLatestScreenshotPayload({
    image,
    displayId,
    sourceId,
    hotkey,
    captureMode = 'full-screen',
    capturedAt = new Date().toISOString()
}) {
    const pngBuffer = image.toPNG();
    const screenshotSize = image.getSize();

    return {
        capturedAt,
        displayId,
        sourceId,
        hotkey,
        captureMode,
        width: screenshotSize.width,
        height: screenshotSize.height,
        pngBuffer
    };
}

module.exports = {
    buildLatestScreenshotPayload,
    createScreenshotErrorPayload,
    formatLogPart,
    getLatestScreenshotKey,
    getLatestScreenshotPayload,
    imageToDataUrl,
    isAhmedPathname,
    isAhmedUrl,
    isEthanPathname,
    isEthanUrl,
};
