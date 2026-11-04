// Scans the visible part of the active tab for QR codes and returns every
// otpauth:// URL it can read.
//
// Why a screenshot instead of reading the page's DOM: QR codes are frequently
// served as cross-origin <img>, drawn into <canvas>, or used as CSS backgrounds,
// and a content script cannot read pixels from any of those (canvas tainting).
// tabs.captureVisibleTab hands us a same-origin data: URL we can decode freely.
//
// Strategy, cheapest first:
//  1. BarcodeDetector (native, macOS/Android Chrome): one pass over the frame
//     and it returns every code at once.
//  2. DOM candidates: the content script reports square-ish visible elements
//     (img/canvas/svg/video/background), so jsQR runs on a few small crops
//     instead of a multi-megapixel screen. jsQR returns one code per frame, so
//     this is also what makes several QRs on one page findable.
//  3. Full frame, downsampled: a last resort for unusual pages and for when the
//     content script cannot be reached (extension just reloaded, ...).
import jsQR from 'jsqr';
import { Otp } from '@/lib/otp.js';

// One full-frame decode is only the fallback; capping its width keeps it cheap.
const MAX_FALLBACK_WIDTH = 1600;
// A crop smaller than this is upscaled so jsQR has enough module pixels.
const MIN_CROP = 160;
const MAX_CANDIDATES = 12;

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0]);
    });
  });
}

function captureVisibleTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      const err = chrome.runtime.lastError;
      if (err || !dataUrl) {
        reject(new Error(err ? err.message : 'capture failed'));
        return;
      }
      resolve(dataUrl);
    });
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load capture'));
    img.src = src;
  });
}

// Ask the page's content script where the QR codes probably are. Any failure
// (no content script, frame gone, old extension context) just means we fall
// back to decoding the whole screenshot. The timeout keeps a silent frame from
// leaving the spinner running forever.
function requestCandidates(tabId) {
  return new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = (value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    if (typeof tabId !== 'number' || !chrome.tabs || !chrome.tabs.sendMessage) {
      finish(null);
      return;
    }
    timer = setTimeout(() => finish(null), 2000);
    try {
      chrome.tabs.sendMessage(
        tabId,
        { m: 'findQrCandidates' },
        { frameId: 0 },
        (response) => {
          if (chrome.runtime.lastError) {
            finish(null);
            return;
          }
          finish(response && Array.isArray(response.rects) ? response : null);
        }
      );
    } catch (e) {
      finish(null);
    }
  });
}

// Draw a region of the capture into a canvas and hand back its pixels.
function regionToImageData(img, sx, sy, sw, sh, scale) {
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  if (width < 1 || height < 1) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Upscaling must not blur module edges.
  ctx.imageSmoothingEnabled = scale <= 1;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

// jsQR returns the single clearest code in a frame.
function decodeFrame(frame) {
  if (!frame || frame.width < 24 || frame.height < 24) return null;
  const found = jsQR(frame.data, frame.width, frame.height, {
    inversionAttempts: 'attemptBoth',
  });
  return found && found.data ? String(found.data).trim() : null;
}

// Native fast path. Returns null when the API is missing, unsupported, or
// refuses the frame, so the jsQR path still runs.
async function detectWithBarcodeDetector(img) {
  if (typeof BarcodeDetector === 'undefined') return null;
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    if (!formats || formats.indexOf('qr_code') === -1) return null;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const results = await detector.detect(canvas);
    return (results || [])
      .map((result) => String(result.rawValue || '').trim())
      .filter(Boolean);
  } catch (e) {
    return null;
  }
}

/**
 * @returns {Promise<{urls?: string[], reason?: 'no-qr'|'not-otpauth'|'invalid-otpauth'}>}
 * Resolves with every distinct otpauth:// URL on the page (`urls`), or a
 * reason when there is none. Rejects only when the capture itself failed
 * (wrong page type, permission, ...), so the caller can tell the two apart.
 */
export async function scanVisibleTabForOtpUrls() {
  const tab = await getActiveTab();
  if (!tab || typeof tab.windowId !== 'number') throw new Error('no active tab');

  // Ask for candidates while the capture is in flight; both are independent.
  const candidatesPromise = requestCandidates(tab.id);
  const img = await loadImage(await captureVisibleTab(tab.windowId));
  const candidates = await candidatesPromise;

  const urls = [];
  const seen = Object.create(null);
  const state = { other: false, invalid: false };

  function add(value) {
    const url = String(value || '').trim();
    if (!url) return;
    if (!/^otpauth:\/\//i.test(url)) {
      state.other = true;
      return;
    }
    try {
      Otp.parseUrl(url);
    } catch (e) {
      state.invalid = true;
      return;
    }
    const key = url.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    urls.push(url);
  }

  const nativeValues = await detectWithBarcodeDetector(img);
  if (nativeValues) nativeValues.forEach(add);

  if (!urls.length && candidates && candidates.rects.length) {
    // Screenshot pixels vs CSS pixels differ on scaled displays; derive the
    // factor from the frame size the content script reported.
    const scaleX = img.naturalWidth / (candidates.vw || img.naturalWidth);
    const scaleY = img.naturalHeight / (candidates.vh || img.naturalHeight);
    for (let i = 0; i < candidates.rects.length && i < MAX_CANDIDATES; i++) {
      const rect = candidates.rects[i];
      const pad = 8;
      const x = Math.max(0, Math.floor((rect.x - pad) * scaleX));
      const y = Math.max(0, Math.floor((rect.y - pad) * scaleY));
      const right = Math.min(
        img.naturalWidth,
        Math.ceil((rect.x + rect.w + pad) * scaleX)
      );
      const bottom = Math.min(
        img.naturalHeight,
        Math.ceil((rect.y + rect.h + pad) * scaleY)
      );
      const width = right - x;
      const height = bottom - y;
      if (width < 24 || height < 24) continue;
      const scale = Math.max(width, height) < MIN_CROP ? 2 : 1;
      add(decodeFrame(regionToImageData(img, x, y, width, height, scale)));
    }
  }

  if (!urls.length) {
    // One pass over the whole frame, downsampled for speed. Also the only path
    // when the page could not report candidates.
    const scale = Math.min(1, MAX_FALLBACK_WIDTH / img.naturalWidth);
    add(
      decodeFrame(
        regionToImageData(img, 0, 0, img.naturalWidth, img.naturalHeight, scale)
      )
    );
  }

  if (urls.length) return { urls };
  if (state.invalid) return { reason: 'invalid-otpauth' };
  return { reason: state.other ? 'not-otpauth' : 'no-qr' };
}
