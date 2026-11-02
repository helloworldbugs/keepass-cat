/*
 * Inline autofill icon.
 *
 * A small button sits at the right edge of the username field of every login form
 * on the page (or of the password field when a page has no username input). Clicking it fills the matching entry; when the site matches more than one
 * entry, it opens a list first. Nothing is drawn while the vault is locked or when
 * no entry matches the page, so a random page never shows a dead control.
 *
 * This file is bundled into the same content script as inject.js (see
 * vite.config.content.mts), which the manifest now runs on every http(s) page.
 * inject.js is also re-injected on every autofill, so init() guards against
 * running twice.
 *
 * The content script never holds a password: it asks the background which entries
 * match the page (titles and usernames only) and, on a click, asks it to fill one
 * by id. Filling reuses the existing performAutofill() path, so the field-finding
 * and React/Vue-safe writes stay in one place.
 */

import { collectFields, hasVisibleFillablePasswordField, qualifiesForUsernameOnly } from './fieldDetect.js';

const ICON_SIZE = 26;
const ICON_INSET = 5;
const MIN_FIELD_WIDTH = 90;
const SCAN_DEBOUNCE_MS = 250;
// A focus event re-asks the background once the cached answer is this old, so
// locking the vault (or unlocking it in the popup) is reflected without a reload.
const MATCH_TTL_MS = 1500;
const Z = '2147483647';
const LIST_ATTR = 'data-keepass-cat-list';

export function initInlineIcon() {
  if (window.__keepassCatInline) return;
  window.__keepassCatInline = true;

  /** @type {Array<{id: string, title: string, userName: string}>|null} */
  let matches = null;
  let matchesAt = 0;
  let labels = { autofill: 'Keepass Cat' };
  let pending = null;

  /** @type {Map<HTMLInputElement, HTMLElement>} */
  const icons = new Map();
  /** @type {{host: HTMLElement, input: HTMLInputElement}|null} */
  let openList = null;

  let scanTimer = 0;
  let frame = 0;

  /* ------------------------------------------------------------- messaging */

  function send(message) {
    return new Promise(function (resolve) {
      let settled = false;
      const done = function (value) {
        if (settled) return;
        settled = true;
        resolve(value || null);
      };
      try {
        const maybe = chrome.runtime.sendMessage(message, done);
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(done).catch(function () { done(null); });
        }
      } catch (e) {
        done(null);
      }
    });
  }

  // Ask the background for the entries matching this page. Cached for a moment so
  // focus/blur ping-pong does not turn into a message per keystroke.
  function loadMatches(force) {
    const fresh = matches !== null && Date.now() - matchesAt < MATCH_TTL_MS;
    if (!force && fresh) return Promise.resolve(matches);
    if (pending) return pending;
    pending = send({ m: 'inlineMatches' }).then(function (res) {
      pending = null;
      if (res && Array.isArray(res.matches)) {
        matches = res.matches;
        matchesAt = Date.now();
        if (res.labels && res.labels.autofill) labels = res.labels;
      } else if (res === null) {
        // The background did not answer (extension reloading, message channel
        // closed). Keep whatever we had instead of dropping the icons.
        matchesAt = Date.now();
      } else {
        matches = [];
        matchesAt = Date.now();
      }
      return matches;
    });
    return pending;
  }

  /* -------------------------------------------------------- field discovery */

  // The icon belongs where typing starts: the username field. The detection is
  // the same pass inject.js fills from (fieldDetect.js), so an input that gets an
  // icon is one the filler would also target.
  function anchorFields() {
    const fields = collectFields(document, window);
    const anchors = [];
    const seen = new Set();

    const add = function (field) {
      if (!field || seen.has(field) || !field.isConnected) return;
      seen.add(field);
      anchors.push(field);
    };

    if (fields.priorityPair && fields.priorityPair.u) add(fields.priorityPair.u);
    fields.userPasswordPairs.forEach(function (pair) {
      add(pair.u);
    });

    // Two-step login: the password input is not rendered yet, so the username
    // candidates are the only anchor there is. On a page that already has a
    // visible password, the candidates belong to a sign-up form and are ignored
    // (same rule the filler applies before filling a username alone).
    if (!fields.userPasswordPairs.length && !hasVisibleFillablePasswordField(document)) {
      fields.usernameCandidates.filter(qualifiesForUsernameOnly).forEach(add);
    }

    // Password-only step: no username on screen, so keep the icon on the
    // password field instead of losing the feature.
    if (!anchors.length) {
      if (fields.priorityPair && fields.priorityPair.p) add(fields.priorityPair.p);
      fields.userPasswordPairs.forEach(function (pair) {
        add(pair.p);
      });
      fields.lonelyPasswords.forEach(add);
    }

    return anchors;
  }

  /* ---------------------------------------------------------------- placing */

  function placeIcon(host, field) {
    const rect = field.getBoundingClientRect();
    const inside =
      rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    if (!inside || rect.width < MIN_FIELD_WIDTH) {
      host.style.setProperty('display', 'none', 'important');
      return;
    }
    host.style.setProperty('display', 'block', 'important');
    const top = Math.round(rect.top + (rect.height - ICON_SIZE) / 2);
    const left = Math.round(rect.right - ICON_SIZE - ICON_INSET);
    host.style.setProperty('top', top + 'px', 'important');
    host.style.setProperty('left', left + 'px', 'important');
  }

  function reposition() {
    frame = 0;
    icons.forEach(function (host, field) {
      if (!field.isConnected) {
        host.remove();
        icons.delete(field);
        return;
      }
      placeIcon(host, field);
    });
    if (openList && !openList.input.isConnected) {
      closeList();
    } else if (openList) {
      placeList(openList.host, openList.input);
    }
  }

  function scheduleReposition() {
    if (frame) return;
    frame = requestAnimationFrame(reposition);
  }

  /* ------------------------------------------------------------------ icons */

  function makeHost(width, height) {
    const host = document.createElement('div');
    host.setAttribute('data-keepass-cat', '');
    host.style.cssText =
      'all: initial !important; position: fixed !important; display: block !important;' +
      ' width: ' + width + 'px !important;' +
      (height ? ' height: ' + height + 'px !important;' : '') +
      ' z-index: ' + Z + ' !important;';
    return host;
  }

  const ICON_MARKUP =
    '<style>' +
    ':host{all:initial}' +
    'button{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;' +
    'width:' + ICON_SIZE + 'px;height:' + ICON_SIZE + 'px;border-radius:50%;cursor:pointer;' +
    'background:rgba(255,255,255,.96);border:1px solid rgba(0,0,0,.14);' +
    'box-shadow:0 1px 4px rgba(0,0,0,.26);opacity:.8;' +
    'transition:opacity .12s,box-shadow .12s,transform .12s}' +
    'button:hover,button:focus-visible{opacity:1;box-shadow:0 2px 8px rgba(0,0,0,.32);transform:scale(1.06)}' +
    'svg{width:14px;height:14px;display:block;fill:none;stroke:#0089ec;' +
    'stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}' +
    '@media (prefers-color-scheme: dark){' +
    'button{background:rgba(45,45,45,.96);border-color:rgba(255,255,255,.18)}' +
    'svg{stroke:#4da3ff}}' +
    '</style>' +
    '<button type="button" tabindex="-1">' +
    '<svg viewBox="0 0 16 16" aria-hidden="true">' +
    '<circle cx="5.4" cy="6.4" r="2.9"/>' +
    '<path d="M7.5 8.5 12.7 13.7"/>' +
    '<path d="M9.7 10.7 11.2 9.2"/>' +
    '<path d="M11.4 12.4 12.9 10.9"/>' +
    '</svg></button>';

  function createIcon(field) {
    const host = makeHost(ICON_SIZE, ICON_SIZE);
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = ICON_MARKUP;
    const button = shadow.querySelector('button');
    button.setAttribute('title', labels.autofill);
    button.setAttribute('aria-label', labels.autofill);

    // Never let the icon take focus from the field, and never let the page see the
    // click: stopPropagation inside the shadow keeps it from reaching document
    // listeners (modals, "click outside to close" handlers).
    const swallow = function (event) {
      event.preventDefault();
      event.stopPropagation();
    };
    button.addEventListener('mousedown', swallow);
    button.addEventListener('pointerdown', swallow);
    button.addEventListener('click', function (event) {
      swallow(event);
      onIconClick(field);
    });

    document.documentElement.appendChild(host);
    placeIcon(host, field);
    return host;
  }

  // One list at a time, determined from the DOM rather than from a variable: a
  // second open used to leave the first list on the page with nothing pointing at
  // it, so clicking a row closed a list the user was not looking at.
  let listOpening = false;

  function allLists() {
    return Array.prototype.slice.call(document.querySelectorAll('[' + LIST_ATTR + ']'));
  }

  function hasList() {
    return allLists().length > 0;
  }

  function onIconClick(field) {
    if (hasList()) {
      closeList();
      return;
    }
    // The match list arrives asynchronously; a second click in that window must
    // not start a second open.
    if (listOpening) return;
    listOpening = true;
    loadMatches(true).then(function (list) {
      listOpening = false;
      if (!list || !list.length) {
        matches = [];
        removeAllIcons();
        return;
      }
      if (list.length === 1) {
        fillEntry(list[0]);
        return;
      }
      openListFor(list, field);
    }, function () {
      listOpening = false;
    });
  }

  function openListFor(list, field) {
    closeList();
    const host = makeList(list);
    host.setAttribute(LIST_ATTR, '');
    openList = { host: host, input: field };
    placeList(host, field);
  }

  function removeAllIcons() {
    icons.forEach(function (host) { host.remove(); });
    icons.clear();
  }

  /* ------------------------------------------------------------------- list */

  const LIST_WIDTH = 260;
  const LIST_MAX_HEIGHT = 240;

  function makeList(list) {
    const host = makeHost(LIST_WIDTH, null);
    host.style.setProperty('width', LIST_WIDTH + 'px', 'important');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent =
      ':host{all:initial}' +
      'ul{all:unset;display:block;box-sizing:border-box;max-height:' + LIST_MAX_HEIGHT + 'px;' +
      'overflow-y:auto;margin:0;padding:4px;background:#fff;color:#2c3e50;' +
      'border-radius:6px;border:1px solid rgba(0,0,0,.1);' +
      'box-shadow:0 6px 24px rgba(0,0,0,.24);' +
      'font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}' +
      'li{all:unset;display:block}' +
      'button{all:unset;box-sizing:border-box;display:block;width:100%;padding:6px 8px;' +
      'border-radius:4px;cursor:pointer}' +
      'button:hover,button:focus-visible{background:#eef0f2}' +
      'b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      'span{display:block;font-size:12px;color:#6b7280;white-space:nowrap;overflow:hidden;' +
      'text-overflow:ellipsis}' +
      // Follow the same prefers-color-scheme switch the extension UI uses; the
      // page's own theme is irrelevant here because the list lives in a shadow root.
      '@media (prefers-color-scheme: dark){' +
      'ul{background:#2d2d2d;color:#e0e0e0;border-color:#404040;box-shadow:0 6px 24px rgba(0,0,0,.55)}' +
      'button:hover,button:focus-visible{background:#3a3a3a}' +
      'b{color:#e6e6e6}' +
      'span{color:#9aa0a6}}';
    shadow.appendChild(style);

    const ul = document.createElement('ul');
    ul.setAttribute('role', 'listbox');
    list.forEach(function (entry) {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'option');
      const title = document.createElement('b');
      title.textContent = entry.title || entry.userName || '—';
      button.appendChild(title);
      if (entry.userName) {
        const user = document.createElement('span');
        user.textContent = entry.userName;
        button.appendChild(user);
      }
      // Activate on pointer events, not only on click: a page that cancels
      // pointerdown (or a stray preventDefault of its own) can suppress the
      // compatibility mouse events and with them the click, which used to leave the
      // list open and the row inert. The flag makes click a fallback, never a
      // second fill.
      let activated = false;
      const activate = function () {
        if (activated) return;
        activated = true;
        fillEntry(entry);
      };
      button.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener('pointerup', function (event) {
        event.preventDefault();
        event.stopPropagation();
        activate();
      });
      button.addEventListener('mousedown', function (event) {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        activate();
      });
      li.appendChild(button);
      ul.appendChild(li);
    });
    shadow.appendChild(ul);

    document.documentElement.appendChild(host);
    return host;
  }

  function placeList(host, field) {
    const rect = field.getBoundingClientRect();
    let top = rect.bottom + 6;
    const height = host.getBoundingClientRect().height || 0;
    if (height && top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6);
    }
    let left = rect.right - LIST_WIDTH;
    if (left < 8) left = 8;
    if (left + LIST_WIDTH > window.innerWidth - 8) left = window.innerWidth - LIST_WIDTH - 8;
    host.style.setProperty('top', Math.round(top) + 'px', 'important');
    host.style.setProperty('left', Math.round(left) + 'px', 'important');
  }

  function closeList() {
    // Sweep by attribute, not by the variable: a list can outlive the reference to
    // it (an open that raced a close, a fill, a page mutation) and would otherwise
    // stay on screen for good.
    allLists().forEach(function (host) {
      host.remove();
    });
    openList = null;
  }

  /* ------------------------------------------------------------------- fill */

  function fillEntry(entry) {
    closeList();
    send({ m: 'inlineFill', id: entry.id }).then(function (res) {
      if (res && res.ok) return;
      // Locked, entry gone, or the page refused the fill: re-check so the icons
      // disappear rather than pretending they still work.
      matches = null;
      scheduleScan();
    });
  }

  /* ------------------------------------------------------------------- sync */

  function syncIcons(fields) {
    const wanted = new Set(fields);
    icons.forEach(function (host, field) {
      if (!wanted.has(field)) {
        host.remove();
        icons.delete(field);
      }
    });
    fields.forEach(function (field) {
      if (icons.has(field)) return;
      icons.set(field, createIcon(field));
    });
  }

  function scan() {
    scanTimer = 0;
    if (!document.documentElement) return;
    const fields = anchorFields();
    if (!fields.length) {
      removeAllIcons();
      closeList();
      return;
    }
    loadMatches(false).then(function (list) {
      if (!list || !list.length) {
        removeAllIcons();
        closeList();
        return;
      }
      syncIcons(anchorFields());
    });
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  /* ----------------------------------------------------------------- wiring */

  document.addEventListener('focusin', function (event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    // The icon now lives on the username field, so a password-only check would
    // miss the moment the user starts typing a username.
    const isCredentialField =
      icons.has(target) || (target.getAttribute('type') || '').toLowerCase() === 'password';
    if (!isCredentialField) return;
    loadMatches(true).then(function (list) {
      if (list && list.length) syncIcons(anchorFields());
      else removeAllIcons();
    });
  }, true);

  window.addEventListener('focus', function () {
    loadMatches(true).then(function (list) {
      if (list && list.length) syncIcons(anchorFields());
      else removeAllIcons();
    });
  });

  window.addEventListener('scroll', scheduleReposition, true);
  window.addEventListener('resize', scheduleReposition);
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && hasList()) closeList();
  }, true);
  window.addEventListener('mousedown', function (event) {
    if (!hasList()) return;
    const path = event.composedPath ? event.composedPath() : [];
    const inside = allLists().some(function (host) {
      return path.indexOf(host) >= 0;
    });
    if (inside) return;
    closeList();
  }, true);

  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(function (records) {
      // Ignore our own hosts: they are appended to <html> and would otherwise
      // schedule a scan for every icon we add or remove.
      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (record.target === document.documentElement) {
          const added = Array.prototype.slice.call(record.addedNodes);
          const removed = Array.prototype.slice.call(record.removedNodes);
          const touchesUs = added.concat(removed).some(function (node) {
            return node && node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-keepass-cat');
          });
          if (touchesUs) continue;
        }
        scheduleScan();
        return;
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  scan();
}
