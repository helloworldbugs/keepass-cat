import { isVisible, parseUrl } from '@/lib/utils.js';
/* 
Inject script

- Invoked when Keepass Cat popup 'autofill' action is selected.
- Background will attempt to inject this script into the page, and the script will listen for a user/pass combo from background.
*/
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
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
    filler.fillPassword(message.u, message.p);
  }

  if (message.m == 'fillTotpAtCursor') {
    filler.fillTotpAtCursor(message.code);
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
});

var filler = (function () {
  'use strict';

  var userPasswordPairs = [];
  var lonelyPasswords = []; //passwords without usernames
  var priorityPair = null; //most likely pair of fields.

  function identifyPasswordFields() {
    //identify user/password pairs
    userPasswordPairs = [];
    lonelyPasswords = [];
    priorityPair = null;
    var inputPattern =
      "input[type='text'], input[type='email'], input[type='password'], input:not([type])";
    var inputList = Array.from(document.getElementsByTagName('INPUT'));

    // Method 1 - based on focused field (the thing your cursor is in)
    var activeElem = document.activeElement;
    var focusedIndex = inputList.indexOf(activeElem);
    if (inputList.length && focusedIndex >= 0) {
      var pair = {},
        focusedPassword = false;
      if (isPasswordField(activeElem)) {
        pair.p = activeElem;
        focusedPassword = true;
      } else {
        pair.u = activeElem;
      }

      // Assumption:
      // * username will always come before password
      // * username and password will always be adjacent
      if (focusedIndex >= 0) {
        if (focusedPassword && focusedIndex > 0) {
          //field before the password is the username
          //skip over hidden/invisible inputs to find the real username
          for (var j = focusedIndex - 1; j >= 0; j--) {
            var candidate = inputList[j];
            if (!isPasswordField(candidate) && isElementInViewport(candidate) && isVisible(candidate)) {
              pair.u = candidate;
              break;
            }
          }
        } else if (!focusedPassword && focusedIndex < inputList.length - 1) {
          //field after the username is the password
          //skip over hidden/invisible inputs to find the real password field
          for (var j = focusedIndex + 1; j < inputList.length; j++) {
            var candidate = inputList[j];
            if (isPasswordField(candidate) && isElementInViewport(candidate) && isVisible(candidate)) {
              pair.p = candidate;
              break;
            }
            //stop searching if we encounter another visible non-password field (likely next form section)
            if (!isPasswordField(candidate) && isElementInViewport(candidate) && isVisible(candidate)) {
              break;
            }
          }
        }
      }
      if (pair.u && pair.p) priorityPair = pair;
    }

    // Methods 2 - based on types of fields and visibility
    var possibleUserName;
    var lastFieldWasPassword = false; //used to detect registration forms which have 2 password fields, one after the other
    inputList.forEach((field) => {
      if (isElementInViewport(field) && isVisible(field)) {
        if (isPasswordField(field)) {
          if (possibleUserName) {
            userPasswordPairs.push({
              u: possibleUserName,
              p: field,
            });
            possibleUserName = null;
            lastFieldWasPassword = true;
          } else if (lastFieldWasPassword) {
            //special case - two passwords in a row means it is a registration form, so remove last-added pair
            userPasswordPairs.pop();
            lastFieldWasPassword = false;
          } else {
            //special case = password by itself
            lonelyPasswords.push(field);
          }
        } else {
          possibleUserName = field;
          lastFieldWasPassword = false;
        }
      }
    });
  }

  function isPasswordField(field) {
    let type_attr = field.getAttribute('type');
    if (type_attr && type_attr.toLowerCase() == 'password') return true;
    return false;
  }

  function fillPassword(username, password) {
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
          isVisible(pair.p) && password != null
        ) {
          filled = fillField(pair.p, password);
          if (isVisible(pair.u) && username != null) {
            //sometimes the username is invisible, i.e. google login
            fillField(pair.u, username);
          }
        }
      }
    }

    if (!filled) {
      for (var i = 0; i < lonelyPasswords.length; i++) {
        var lonelyPassword = lonelyPasswords[i];
        if (!filled && isElementInViewport(lonelyPassword) && isVisible(lonelyPassword)) {
          filled = fillField(lonelyPassword, password);
        }
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

  /**
   * function to determine if element is in the part of the screen on the monitor
   */
  function isElementInViewport(el) {
    var rect = el.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <=
        (window.innerHeight || document.documentElement.clientHeight) /*or $(window).height() */ &&
      rect.right <=
        (window.innerWidth || document.documentElement.clientWidth) /*or $(window).width() */
    );
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
