/*
 * Field detection, shared by the autofill filler (inject.js) and the inline icon
 * (icon.js).
 *
 * Everything here was moved out of inject.js unchanged: which inputs count as a
 * username/password pair, which are never filled, and which username fields are
 * strong enough to fill on a two-step login where the password field does not
 * exist yet. The icon needs the same answers to know where to put itself, and a
 * second copy would drift from this one the first time a site shape changes.
 */
import { isVisible } from '@/lib/utils.js';

// Parse autocomplete as a whitespace-separated, lowercased token list so e.g.
// "section-x shipping username webauthn" still matches "username".
function autocompleteTokens(field) {
  var raw = field.getAttribute('autocomplete');
  if (!raw) return [];
  return raw.toLowerCase().split(/\s+/).filter(Boolean);
}

// A password input the page did NOT mark new-password is a genuine
// current-password declaration. Its presence means the page really is a
// change-password/registration shape, so new-password must be honoured. When
// every password input is new-password (or there is only one), the page is far
// more likely a login that mislabels its fields — some sites mark every input
// new-password to defeat browser password managers — so new-password is
// treated as usable. Document-wide by design, like the email-ish evidence
// check below.
export function hasGenuineCurrentPasswordField(doc) {
  var inputs = (doc || document).getElementsByTagName('INPUT');
  for (var i = 0; i < inputs.length; i++) {
    var field = inputs[i];
    if ((field.getAttribute('type') || '').toLowerCase() !== 'password') continue;
    if (autocompleteTokens(field).indexOf('new-password') >= 0) continue;
    return true;
  }
  return false;
}

// Fields the page marks as not-our-credentials: never a fill target and never
// usable as the password half of a pair. one-time-code is unconditional;
// new-password is only an exclusion when a genuine current-password field also
// exists (the change-password shape), so a page whose every password input is
// new-password stays fillable.
function isNeverFill(field, doc) {
  var tokens = autocompleteTokens(field);
  if (tokens.indexOf('one-time-code') >= 0) return true;
  if (tokens.indexOf('new-password') >= 0) return hasGenuineCurrentPasswordField(doc);
  return false;
}

// Obvious non-credential text inputs (search/newsletter/comment boxes etc.)
// that must never be filled on any path.
function isExcludedField(field) {
  var type = (field.getAttribute('type') || '').toLowerCase();
  if (type === 'search' || type === 'hidden' || type === 'number') return true;
  if (field.disabled || field.readOnly) return true;
  var nameId = ((field.getAttribute('name') || '') + ' ' + (field.id || '')).toLowerCase();
  return /search|query|keyword|newsletter|subscribe|comment|message|captcha/.test(nameId);
}

export function isFillableField(field, doc) {
  return !isExcludedField(field) && !isNeverFill(field, doc);
}

// A visible password the fill paths could target means the page is already at
// (or may be at) the password step, so the username-only path must stay out.
// It exists for two-step logins whose password input is hidden or not yet
// rendered; sign-up/registration steps have a visible one and must not get the
// username filled.
export function hasVisibleFillablePasswordField(doc) {
  var inputs = (doc || document).getElementsByTagName('INPUT');
  for (var i = 0; i < inputs.length; i++) {
    var field = inputs[i];
    if ((field.getAttribute('type') || '').toLowerCase() !== 'password') continue;
    if (isFillableField(field, doc) && isVisible(field)) return true;
  }
  return false;
}

// Current password comes from the page's own declaration. new-password only
// means "not current" when a genuine current-password field also exists; when
// every password input on the page is new-password it is a mislabelled login,
// so a real password input still counts (the token must never turn a text
// username into a password).
function isCurrentPasswordField(field, doc) {
  var tokens = autocompleteTokens(field);
  if (tokens.indexOf('current-password') >= 0) return true;
  var isPasswordType = (field.getAttribute('type') || '').toLowerCase() === 'password';
  if (tokens.indexOf('new-password') >= 0) {
    return isPasswordType && !hasGenuineCurrentPasswordField(doc);
  }
  return isPasswordType;
}

// Username-ish fields. An autocomplete value that carries no credential token
// (absent, "off", "on", "false", "section-x shipping", ...) falls back to the
// name/id allowlist, because real pages commonly pair autocomplete="off" with
// name="username". Never-fill and denylist checks run before this and win.
export function isUsernameCandidate(field) {
  var tokens = autocompleteTokens(field);
  if (tokens.indexOf('username') >= 0 || tokens.indexOf('email') >= 0) return true;
  if ((field.getAttribute('type') || '').toLowerCase() === 'email') return true;
  var nameId = (field.getAttribute('name') || '') + ' ' + (field.id || '');
  return /user|login|email|account|uname|uid/i.test(nameId);
}

// Two tiers of evidence for the username-only path. An explicit
// autocomplete="username" is a decisive page declaration, so it is strong no
// matter what else the field looks like. Email-ish signals are not
// login-specific (newsletter/contact boxes use them too), so an email-ish
// field that is not declared username is weak evidence: it only qualifies when
// its own form also holds a password input, visible or not. Everything else is
// login-specific and strong. `type="email"` alone is not login-specific, but an
// explicit autocomplete="username" declaration is decisive, so it is checked
// before the email-ish classification — this keeps Google's sign-in identifier
// field (`type="email" autocomplete="username"` with no password) filling.
export function qualifiesForUsernameOnly(field) {
  var tokens = autocompleteTokens(field);
  if (tokens.indexOf('username') >= 0) return true;

  var nameId = ((field.getAttribute('name') || '') + ' ' + (field.id || '')).toLowerCase();
  var emailIsh =
    tokens.indexOf('email') >= 0 ||
    (field.getAttribute('type') || '').toLowerCase() === 'email' ||
    nameId.indexOf('email') >= 0;

  if (emailIsh) {
    return !!(field.form && field.form.querySelector('input[type="password"]'));
  }
  return /user|login|account|uname|uid/i.test(nameId);
}

/**
 * function to determine if element is in the part of the screen on the monitor
 */
export function isElementInViewport(el, win) {
  var w = win || window;
  var rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (w.innerHeight || w.document.documentElement.clientHeight) &&
    rect.right <= (w.innerWidth || w.document.documentElement.clientWidth)
  );
}

/*
 * The one pass over the page both callers use.
 *
 * Returns the pairs, the passwords that have no username, the focused pair when
 * the user's cursor is in a credential field, and the username candidates that
 * the username-only path may use.
 */
export function collectFields(doc, win) {
  var document_ = doc || document;
  var window_ = win || window;
  var userPasswordPairs = [];
  var lonelyPasswords = [];
  var priorityPair = null;
  var usernameCandidates = [];

  var inputList = Array.from(document_.getElementsByTagName('INPUT'));

  // Method 1 - based on focused field (the thing your cursor is in)
  var activeElem = document_.activeElement;
  var focusedIndex = inputList.indexOf(activeElem);
  if (inputList.length && focusedIndex >= 0 && isFillableField(activeElem, document_)) {
    var pair = {},
      focusedPassword = false;
    if (isCurrentPasswordField(activeElem, document_)) {
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
          if (
            isFillableField(candidate, document_) &&
            !isCurrentPasswordField(candidate, document_) &&
            isElementInViewport(candidate, window_) &&
            isVisible(candidate)
          ) {
            pair.u = candidate;
            break;
          }
        }
      } else if (!focusedPassword && focusedIndex < inputList.length - 1) {
        //field after the username is the password
        //skip over hidden/invisible inputs to find the real password field
        for (var j = focusedIndex + 1; j < inputList.length; j++) {
          var candidate = inputList[j];
          if (
            isFillableField(candidate, document_) &&
            isCurrentPasswordField(candidate, document_) &&
            isElementInViewport(candidate, window_) &&
            isVisible(candidate)
          ) {
            pair.p = candidate;
            break;
          }
          //stop searching if we encounter another visible non-password field (likely next form section)
          if (
            isFillableField(candidate, document_) &&
            !isCurrentPasswordField(candidate, document_) &&
            isElementInViewport(candidate, window_) &&
            isVisible(candidate)
          ) {
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
  inputList.forEach(function (field) {
    if (!isFillableField(field, document_)) return;
    if (isElementInViewport(field, window_) && isVisible(field)) {
      if (isCurrentPasswordField(field, document_)) {
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
        if (isUsernameCandidate(field)) usernameCandidates.push(field);
      }
    }
  });

  return {
    userPasswordPairs: userPasswordPairs,
    lonelyPasswords: lonelyPasswords,
    priorityPair: priorityPair,
    usernameCandidates: usernameCandidates,
  };
}
