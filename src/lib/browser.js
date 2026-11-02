/**
 * Cross-browser API compatibility shim.
 * Maps Chrome MV3 APIs to Firefox MV2 equivalents.
 */
var isFirefox = navigator.userAgent.includes('Firefox');
var actionApi = (typeof chrome !== 'undefined' && (chrome.action || chrome.browserAction)) || {};

export function openPopup() {
  (actionApi).openPopup?.();
}

export function setBadgeText(details) {
  actionApi.setBadgeText?.(details);
}

export function setBadgeBackgroundColor(details) {
  actionApi.setBadgeBackgroundColor?.(details);
}

// Chrome 110+ / Firefox 63+ allow colouring the badge text, which is what makes a
// transparent badge (text only) possible. Callers fall back to a coloured
// background where it is missing.
export const canSetBadgeTextColor = typeof actionApi.setBadgeTextColor === 'function';

export function setBadgeTextColor(details) {
  actionApi.setBadgeTextColor?.(details);
}

export { isFirefox };
