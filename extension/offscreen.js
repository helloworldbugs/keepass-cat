// Offscreen document used by the Chrome MV3 service worker to clear the
// clipboard. The service worker has no DOM, so it delegates the actual write
// to this page (reason: CLIPBOARD).
(function () {
  'use strict';

  function emptyClipboardFallback() {
    try {
      var textarea = document.createElement('textarea');
      textarea.value = '';
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (e) {
      // Silent: clearing the clipboard is best-effort.
    }
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.m !== 'clearClipboard') return;

    var done = false;
    function respond() {
      if (done) return;
      done = true;
      try {
        sendResponse({ ok: true });
      } catch (e) {
        // The caller may already be gone; ignore.
      }
    }

    function fallback() {
      emptyClipboardFallback();
      respond();
    }

    // `navigator.clipboard` is unavailable in offscreen documents: the async
    // Clipboard API requires a focused document and an offscreen page can never
    // be focused (crbug 40276502). The deprecated execCommand path is the
    // documented way to write the clipboard from here, so use it directly.
    fallback();

    return true; // keep the channel open for the async response
  });
})();
