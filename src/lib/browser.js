/**
 * Cross-browser API compatibility shim.
 * Maps Chrome MV3 APIs to Firefox MV2 equivalents.
 */
var isFirefox = typeof browser !== 'undefined' && !!browser.runtime;
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

/**
 * Execute a script in a tab. Firefox MV2 uses chrome.tabs.executeScript with
 * {code: string}, Chrome MV3 uses chrome.scripting.executeScript with {func}.
 */
export function executeScriptInline(tabId, func, args) {
  if (isFirefox) {
    // Firefox MV2: convert func+args to a code string
    var argStr = JSON.stringify(args || []);
    var code = '(' + func.toString() + ').apply(null, ' + argStr + ');';
    // @ts-ignore
    return new Promise(function (resolve, reject) {
      chrome.tabs.executeScript(tabId, { code: code }, function () {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  } else {
    return chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: func,
      args: args || [],
    }).catch(function () {});
  }
}

export { isFirefox };
