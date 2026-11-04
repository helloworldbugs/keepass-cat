import { isVisible, parseUrl } from '@/lib/utils.js';
import { initInlineIcon } from './icon.js';
import {
  collectFields,
  qualifiesForUsernameOnly,
  hasVisibleFillablePasswordField,
  isElementInViewport,
} from './fieldDetect.js';
/* 
Inject script

- Invoked when Keepass Cat popup 'autofill' action is selected.
- Background will attempt to inject this script into the page, and the script will listen for a user/pass combo from background.
*/
// A fresh copy of this script is injected on every autofill, and each copy would
// register its own chrome.runtime.onMessage listener, so one trigger could run
// that many fill passes. Keep the live listener on the content script's own
// window (the isolated world) and detach the previous one before installing the
// new one. We only ever remove - never skip registration - because after an
// extension reload a stale flag must not leave the frame with no live listener.
try {
  if (window.__keepassCatMessageListener) {
    chrome.runtime.onMessage.removeListener(window.__keepassCatMessageListener);
  }
} catch (e) {}

window.__keepassCatMessageListener = function (message, sender, sendResponse) {
  'use strict';

  if (!message || !message.m) return; //unrecognized message format

  //whitelist some known iframe origin mismatches
  var whiteListedHostnameMismatches = [
    { documentOrigin: 'onlinebanking.usbank.com', expectedOrigin: 'www.usbank.com' },
  ];

  if (message.m == 'ping') {
    // ping, to check if we're injected already
    sendResponse({ message: 'hi' });
    return;
  }

  if (message.m == 'fillPassword') {
    //user has selected to fill the password

    //first check the origins.  This is necessary because we support iframes, and
    //this script is injected into all, some of which may be malicious.  So we
    //limit ourselves to the same origin.  Protocol (http vs https) is allowed to
    //mismatch, but in that case we will only fill the password on the https.
    var documentOrigin = parseUrl(document.URL);
    var expectedOrigin = parseUrl(message.o);
    var whiteListed = !!whiteListedHostnameMismatches.filter(function (item) {
      return (
        item.documentOrigin === documentOrigin.hostname &&
        item.expectedOrigin === expectedOrigin.hostname
      );
    }).length;

    if (
      (documentOrigin.hostname !== expectedOrigin.hostname && !whiteListed) ||
      (documentOrigin.protocol !== expectedOrigin.protocol && documentOrigin.protocol !== 'https:')
    )
      return;

    //passed the origin check - go ahead and fill the password
    filler.fillPassword(message.u, message.p, message.force);
  }

  if (message.m == 'fillTotpAtCursor') {
    filler.fillTotpAtCursor(message.code);
  }

  if (message.m == 'findQrCandidates') {
    // The popup captured the tab and wants to know where the QR codes probably
    // are, so it can decode a few small crops instead of the whole screen.
    sendResponse(collectQrCandidates());
    return;
  }

  if (message.m == 'copyToClipboard') {
    // Content script has a document, so it writes the clipboard on behalf of the
    // background-only shortcut path (extension already has clipboardWrite).
    // Any failure is silent and must not affect the password fill.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(message.code).catch(function () {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = message.code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }
};

chrome.runtime.onMessage.addListener(window.__keepassCatMessageListener);

/*
 * Candidate rectangles for the OTP scanner, in CSS pixels relative to this
 * frame's viewport.
 *
 * The popup captures the visible tab itself (cross-origin images and canvases
 * cannot be read from here), so the only job here is geometry. Walking
 * getBoundingClientRect is cheap and needs no pixel access; the popup crops
 * each rectangle out of the screenshot and runs jsQR on a small image instead
 * of a multi-megapixel screen.
 */
function collectQrCandidates() {
  'use strict';

  var vw = window.innerWidth || document.documentElement.clientWidth || 0;
  var vh = window.innerHeight || document.documentElement.clientHeight || 0;
  if (!vw || !vh) return { rects: [], vw: vw, vh: vh };

  var minSide = 40; // smaller than this cannot hold readable modules
  var maxSide = Math.min(vw, vh) * 0.9; // larger is a backdrop, not a code
  var rects = [];

  function overlapRatio(a, b) {
    var w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (w <= 0 || h <= 0) return 0;
    return (w * h) / Math.min(a.w * a.h, b.w * b.h);
  }

  function consider(el) {
    if (!el || !el.getBoundingClientRect) return;
    var r = el.getBoundingClientRect();
    var w = r.width;
    var h = r.height;
    if (w < minSide || h < minSide || w > maxSide || h > maxSide) return;
    // A QR is square; allow some padding/frame around it.
    var ratio = w / h;
    if (ratio < 0.66 || ratio > 1.5) return;
    // Only the visible part is in the screenshot.
    var left = Math.max(r.left, 0);
    var top = Math.max(r.top, 0);
    var right = Math.min(r.right, vw);
    var bottom = Math.min(r.bottom, vh);
    if (right - left < minSide || bottom - top < minSide) return;
    var rect = { x: left, y: top, w: right - left, h: bottom - top };
    for (var i = 0; i < rects.length; i++) {
      // An image and its wrapper both match; keep the outer one.
      if (overlapRatio(rects[i], rect) > 0.7) return;
    }
    rects.push(rect);
  }

  // `[class*=qr]` / `[id*=qr]` catch the usual wrappers (qrcode, qr-code, ...);
  // inline background styles catch QR codes painted as CSS backgrounds. A code
  // set from a stylesheet is missed here - the popup's full-frame fallback
  // still finds it.
  var nodes = document.querySelectorAll(
    'img, canvas, svg, video, iframe, [style*="background"], [class*="qr" i], [id*="qr" i]'
  );
  for (var i = 0; i < nodes.length && i < 400; i++) consider(nodes[i]);

  rects.sort(function (a, b) {
    return b.w * b.h - a.w * a.h;
  });
  if (rects.length > 12) rects.length = 12;
  return { rects: rects, vw: vw, vh: vh };
}

var filler = (function () {
  'use strict';

  var userPasswordPairs = [];
  var lonelyPasswords = []; //passwords without usernames
  var priorityPair = null; //most likely pair of fields.
  var usernameCandidates = []; //visible, credential-signalled username fields (for the username-only path)

  function identifyPasswordFields() {
    var fields = collectFields(document, window);
    userPasswordPairs = fields.userPasswordPairs;
    lonelyPasswords = fields.lonelyPasswords;
    usernameCandidates = fields.usernameCandidates;
    priorityPair = fields.priorityPair;
  }

  // Field helpers live in fieldDetect.js (shared with the inline icon).

  // `force` is set only when the user picked an entry from the inline list. The
  // username-only fallback below refuses to overwrite typed text by design (the
  // shortcut must not clobber what you are in the middle of typing), but choosing
  // an entry *is* the instruction to replace it.
  function fillPassword(username, password, force) {
    identifyPasswordFields();
    var filled = false;

    if (priorityPair) {
      //don't bother with the others, this is the one
      if (priorityPair.u && isVisible(priorityPair.u) && username != null) fillField(priorityPair.u, username);

      if (priorityPair.p && isVisible(priorityPair.p) && password != null) fillField(priorityPair.p, password);

      return;
    }

    if (userPasswordPairs.length > 0) {
      //we have found some possible username/passwords.  Check if the are visible:
      for (var i = 0; i < userPasswordPairs.length; i++) {
        var pair = userPasswordPairs[i];
        if (
          !filled &&
          isElementInViewport(pair.u) &&
          isElementInViewport(pair.p) &&
          isVisible(pair.p) &&
          (username != null || password != null)
        ) {
          // Username first, password second — the same order the focused-field
          // path above uses. Some login pages reset their form when the username
          // changes, which clears the password field and erases a password
          // written just before it. Writing the password last leaves nothing
          // running after it to undo the write.
          //
          // Either half may be missing (an entry that holds only a username, or
          // only a password): fill what exists and leave the other field as it is.
          if (isVisible(pair.u) && username != null) {
            //sometimes the username is invisible, i.e. google login
            filled = fillField(pair.u, username);
          }
          if (password != null) {
            filled = fillField(pair.p, password);
          }
        }
      }
    }

    if (!filled && password != null) {
      for (var i = 0; i < lonelyPasswords.length; i++) {
        var lonelyPassword = lonelyPasswords[i];
        if (!filled && isElementInViewport(lonelyPassword) && isVisible(lonelyPassword)) {
          filled = fillField(lonelyPassword, password);
        }
      }
    }

    // No visible fillable password field on this step (e.g. a two-step login
    // whose password input is still hidden or not yet rendered). Consider only
    // the candidates with enough evidence (see qualifiesForUsernameOnly) and fill
    // just the username when exactly one qualifies. Two or more means we cannot
    // know which is the login field, so fill nothing. Unlike the pair path, never
    // overwrite typed text.
    var qualifyingCandidates = usernameCandidates.filter(qualifiesForUsernameOnly);
    if (
      !filled &&
      userPasswordPairs.length === 0 &&
      lonelyPasswords.length === 0 &&
      !hasVisibleFillablePasswordField() &&
      qualifyingCandidates.length === 1 &&
      username != null
    ) {
      var candidate = qualifyingCandidates[0];
      if (force || candidate.value === '') {
        fillField(candidate, username);
      }
    }
  }

  function fillField(field, val) {
    // Focus first. Focusing after the write looks harmless, but login pages
    // routinely do work in their own focus handler (state updates, re-renders),
    // and a re-render re-applies the controlled `value` prop from the page's
    // state, silently overwriting the value we just wrote. Focusing before the
    // write lets that render land on the old value instead.
    field.focus();

    // Use the native value setter to bypass React/Vue value trackers (which
    // override the instance `value` property and would otherwise revert our
    // assignment on the next re-render).
    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    if (nativeSetter) {
      nativeSetter.call(field, val);
    } else {
      field.value = val;
    }

    // React records the last value it saw on the node itself (`_valueTracker`).
    // If that record already holds the value we just wrote, React treats our
    // input event as "no change": onChange never fires, the page's state keeps
    // its old value, and the next render writes that stale value back over
    // ours. Poison the record so the change is always observed — React reports
    // event values from the DOM, so the sentinel itself never surfaces.
    if (field._valueTracker) {
      field._valueTracker.setValue('');
    }

    var filled = field.value === val;
    sendKeyEvent(field);
    return filled;
  }

  function sendKeyEvent(field) {
    // Dispatch synchronously — React's onChange only updates state when the
    // input event fires in the same tick as the value assignment; a deferred
    // (setTimeout) dispatch gets reverted on the next render.
    var eventsToFire = ['input', 'keydown', 'keyup', 'change'];

    for (var i = 0; i < eventsToFire.length; i++) {
      try {
        var evt;
        if (eventsToFire[i] === 'keydown' || eventsToFire[i] === 'keyup') {
          evt = new KeyboardEvent(eventsToFire[i], { bubbles: true });
        } else {
          evt = new Event(eventsToFire[i], { bubbles: true });
        }
        field.dispatchEvent(evt);
      } catch (e) {}
    }
  }

  function fillTotpAtCursor(code) {
    var activeElem = document.activeElement;
    if (activeElem && activeElem.tagName === 'INPUT' && isVisible(activeElem)) {
      fillField(activeElem, code);
    }
  }

  return {
    fillPassword: fillPassword,
    fillTotpAtCursor: fillTotpAtCursor,
  };
})();

// The inline icon lives in this same bundle (see icon.js). initInlineIcon() is a
// no-op on the re-injections performed by the autofill path.
initInlineIcon();
