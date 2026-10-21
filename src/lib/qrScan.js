// Scans the visible part of the active tab for a QR code and returns the
// otpauth:// URL it contains.
//
// Why a screenshot instead of reading the page's DOM: QR codes are frequently
// served as cross-origin <img>, drawn into <canvas>, or used as CSS backgrounds,
// and a content script cannot read pixels from any of those (canvas tainting).
// tabs.captureVisibleTab hands us a same-origin data: URL we can decode freely.
import jsQR from 'jsqr';
import { Otp } from '@/lib/otp.js';

// Decoding a very large frame is slow; above this width the capture is used as-is
// instead of being upscaled.
const MAX_DECODE_WIDTH = 3200;

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

function decodeAtScale(img, scale) {
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  if (width < 32 || height < 32 || width > MAX_DECODE_WIDTH) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const frame = ctx.getImageData(0, 0, width, height);
  return jsQR(frame.data, width, height, { inversionAttempts: 'attemptBoth' });
}

/**
 * @returns {Promise<{url?: string, reason?: 'no-qr'|'not-otpauth'|'invalid-otpauth'}>}
 * Resolves with `url` on success. Rejects only when the capture itself failed
 * (wrong page type, permission, ...), so the caller can tell the two apart.
 */
export async function scanVisibleTabForOtpUrl() {
  const tab = await getActiveTab();
  if (!tab || typeof tab.windowId !== 'number') throw new Error('no active tab');

  const img = await loadImage(await captureVisibleTab(tab.windowId));

  // Pages rendered small (zoomed out) need upscaling before the modules become
  // resolvable, so try the capture as-is and then doubled.
  const scales = img.naturalWidth < 1600 ? [1, 2] : [1];
  let sawOtherQr = false;
  let sawInvalidOtp = false;

  for (const scale of scales) {
    const found = decodeAtScale(img, scale);
    if (!found || !found.data) continue;

    const value = String(found.data).trim();
    if (!/^otpauth:\/\//i.test(value)) {
      sawOtherQr = true;
      continue;
    }
    try {
      Otp.parseUrl(value);
      return { url: value };
    } catch (e) {
      sawInvalidOtp = true;
    }
  }

  if (sawInvalidOtp) return { reason: 'invalid-otpauth' };
  return { reason: sawOtherQr ? 'not-otpauth' : 'no-qr' };
}
