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

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText('').then(respond, fallback);
      } else {
        fallback();
      }
    } catch (e) {
      fallback();
    }

    return true; // keep the channel open for the async response
  });
})();
