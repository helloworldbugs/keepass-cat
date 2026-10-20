// Offscreen document used by the Chrome MV3 service worker to clear the
// clipboard. The service worker has no DOM, so it delegates the actual write
// to this page (reason: CLIPBOARD).
(function () {
  'use strict';

  function emptyClipboardFallback() {
    try {
      var textarea = document.createElement('textarea');
      // A collapsed (empty) selection makes the copy command a no-op, so the
      // clipboard kept its previous contents. Copying a zero-width space
      // replaces the clipboard with something that pastes as nothing; a truly
      // empty clipboard cannot be written from an unfocused document.
      textarea.value = '\u200B';
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok === true;
    } catch (e) {
      // Silent: clearing the clipboard is best-effort.
      return false;
    }
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.m !== 'clearClipboard') return;

    var done = false;
    function respond(ok) {
      if (done) return;
      done = true;
      try {
        sendResponse({ ok: ok === true });
      } catch (e) {
        // The caller may already be gone; ignore.
      }
    }

    function fallback() {
      respond(emptyClipboardFallback());
    }

    // `navigator.clipboard` is unavailable in offscreen documents: the async
    // Clipboard API requires a focused document and an offscreen page can never
    // be focused (crbug 40276502). The deprecated execCommand path is the
    // documented way to write the clipboard from here, so use it directly.
    fallback();

    return true; // keep the channel open for the async response
  });
})();
