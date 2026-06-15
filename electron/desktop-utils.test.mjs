import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
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
} = require('./desktop-utils.js');

function createImageStub() {
  return {
    isEmpty: () => false,
    toDataURL: () => 'data:image/png;base64,abc',
    toPNG: () => Buffer.from('png-data'),
    getSize: () => ({ width: 320, height: 180 }),
  };
}

describe('desktop utils', () => {
  it('formats log parts without throwing on non-serializable values', () => {
    const circular = {};
    circular.self = circular;

    expect(formatLogPart('ready')).toBe('ready');
    expect(formatLogPart(new Error('boom'))).toContain('boom');
    expect(formatLogPart({ ok: true })).toBe('{"ok":true}');
    expect(formatLogPart(circular)).toBe('[object Object]');
  });

  it('extracts image data URLs only from non-empty images', () => {
    expect(imageToDataUrl(null)).toBeNull();
    expect(imageToDataUrl({ isEmpty: () => true })).toBeNull();
    expect(imageToDataUrl(createImageStub())).toBe('data:image/png;base64,abc');
  });

  it('builds and serializes latest screenshot payloads', () => {
    const screenshot = buildLatestScreenshotPayload({
      image: createImageStub(),
      displayId: 1,
      sourceId: 'screen:1',
      hotkey: 'Ctrl+Shift+A',
      capturedAt: '2026-05-20T00:00:00.000Z',
    });

    expect(screenshot).toMatchObject({
      capturedAt: '2026-05-20T00:00:00.000Z',
      displayId: 1,
      sourceId: 'screen:1',
      hotkey: 'Ctrl+Shift+A',
      captureMode: 'full-screen',
      width: 320,
      height: 180,
    });
    expect(screenshot.pngBuffer.equals(Buffer.from('png-data'))).toBe(true);
    expect(getLatestScreenshotKey(screenshot)).toBe('2026-05-20T00:00:00.000Z:8');

    expect(getLatestScreenshotPayload(screenshot, false)).toEqual({
      capturedAt: '2026-05-20T00:00:00.000Z',
      displayId: 1,
      sourceId: 'screen:1',
      hotkey: 'Ctrl+Shift+A',
      captureMode: 'full-screen',
      width: 320,
      height: 180,
      byteLength: 8,
      mimeType: 'image/png',
    });
    expect(getLatestScreenshotPayload(screenshot, true).dataUrl).toBe('data:image/png;base64,cG5nLWRhdGE=');
    expect(getLatestScreenshotPayload(null)).toBeNull();
    expect(getLatestScreenshotKey(null)).toBeNull();
  });

  it('detects Ahmed and Ethan URLs without throwing on invalid input', () => {
    expect(isAhmedPathname('/Ahmed')).toBe(true);
    expect(isAhmedPathname('/ahmed')).toBe(true);
    expect(isAhmedPathname('/Ethan')).toBe(false);
    expect(isEthanPathname('/Ethan')).toBe(true);
    expect(isEthanPathname('/ethan')).toBe(true);
    expect(isEthanPathname('/Ahmed')).toBe(false);

    expect(isAhmedUrl('http://127.0.0.1:3000/Ahmed')).toBe(true);
    expect(isAhmedUrl('http://127.0.0.1:3000/ahmed?x=1')).toBe(true);
    expect(isAhmedUrl('not a url')).toBe(false);
    expect(isAhmedUrl(null)).toBe(false);
    expect(isEthanUrl('http://127.0.0.1:3000/Ethan')).toBe(true);
    expect(isEthanUrl('http://127.0.0.1:3000/elsa')).toBe(false);
  });

  it('creates screenshot error payloads with extra context', () => {
    expect(createScreenshotErrorPayload(
      new Error('capture failed'),
      { hotkey: 'F2', captureMode: 'region' },
      '2026-05-20T00:00:00.000Z'
    )).toEqual({
      capturedAt: '2026-05-20T00:00:00.000Z',
      hotkey: 'F2',
      captureMode: 'region',
      message: 'capture failed',
    });

    expect(createScreenshotErrorPayload('plain error', {}, 'now')).toEqual({
      capturedAt: 'now',
      message: 'plain error',
    });
  });
});
