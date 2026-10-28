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

export { isFirefox };
