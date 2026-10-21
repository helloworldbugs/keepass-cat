'use strict';

/*
  This page runs as an Background page, not an event

  Be careful using settings.
  Settings can call secureCacheMemory, which in turn can open new ports to this script.
*/

import { ProtectedMemory } from '$services/protectedMemory';
import { Settings } from '$services/settings.js';
import { Notifications } from '$services/notifications';
import { i18n } from '@/services/i18n';
import { openPopup, setBadgeText, setBadgeBackgroundColor } from '@/lib/browser.js';
import { matchLevel } from '@/lib/matchLevel.js';
import { Otp } from '@/lib/otp.js';

function Background(protectedMemory, localMemory, settings, notifications) {
  console.log('Background worker registered.');
  chrome.runtime.onInstalled.addListener(settings.upgrade);
  chrome.runtime.onStartup.addListener(forgetStuff);

  //keep saved state for the popup for as long as we are alive (not long):
  chrome.runtime.onConnect.addListener(function (port) {
    //communicate state on this pipe.  each named port gets its own state.
    port.onMessage.addListener(function (msg) {
      if (!msg) return;
      switch (msg.action) {
        case 'clear':
          (msg.storageType === 'local' ? localMemory : protectedMemory).clearData(msg.key);
          break;
        case 'save':
          (msg.storageType === 'local' ? localMemory : protectedMemory).setData(msg.key, msg.value);
          break;
        case 'get':
          (msg.storageType === 'local' ? localMemory : protectedMemory).getData(msg.key).then(function (value) {
            port.postMessage(value);
          }).catch(function () {
            port.postMessage(undefined);
          });
          break;
        case 'forgetStuff':
          forgetStuff();
          break;
        default:
          throw new Error('unrecognized action ' + obj.action);
          break;
      }
    });

    port.onDisconnect.addListener(function () {
      //uncomment below to forget the state when the popup closes
      //protectedMemory.clearData();
    });
  });

  // Inject the content script into all frames of the tab and ask each frame to
  // fill the given credentials. Shared by the popup autofill message and the
  // background-only shortcut path.
  function performAutofill(tabId, userName, password) {
    var fillAllFrames = function() {
      chrome.webNavigation.getAllFrames({tabId: tabId}, function(frames) {
        if (!frames) return;
        frames.forEach(function(f) {
          var url = new URL(f.url);
          var frameOrigin = url.protocol + '//' + url.hostname + '/';
          chrome.tabs.sendMessage(tabId, {
            m: 'fillPassword',
            u: userName,
            p: password,
            o: frameOrigin,
          }, {frameId: f.frameId});
        });
      });
    };
    // Resolves once the content script has been injected, so callers that need to
    // send it another message (e.g. the OTP clipboard copy) can wait for it.
    return new Promise(function (resolve) {
      chrome.scripting.executeScript(
        {
          target: { tabId: tabId, allFrames: true },
          files: ['/dist/contentScripts/index.global.js'],
        },
        function () {
          console.log('Autofill script injected.');
          fillAllFrames();
          resolve();
        }
      );
    });
  }

  // Mirror the popup autofill path for the shortcut flow: when "copy OTP on
  // autofill" is enabled, compute the entry's OTP and have the content script
  // copy it to the clipboard (a service worker has no document/clipboard access).
  // Every failure here is silent and never affects the password fill itself.
  function copyTotpForShortcut(tabId, entry) {
    settings
      .getSetCopyTotpOnAutofill()
      .then(function (enabled) {
        if (!enabled) return;
        var otpUrl = decryptProtectedField(entry, 'otp');
        if (!otpUrl) return;
        try {
          Otp.parseUrl(otpUrl).next(function (err, code) {
            if (err || !code) return;
            chrome.tabs.sendMessage(tabId, { m: 'copyToClipboard', code: code, label: 'OTP' });
            settings.getSetClipboardExpireEnabled().then(function (clearEnabled) {
              settings.getSetClipboardExpireInterval().then(function (interval) {
                if (clearEnabled) {
                  settings.setForgetTime('clearClipboard', Date.now() + interval * 60000);
                }
                pushNotification(
                  i18n.t('OTP') +
                    (clearEnabled
                      ? i18n.t(' copied to clipboard. Clipboard will clear in {0} minute(s).', interval)
                      : i18n.t(' copied to clipboard.')),
                  'clipboard'
                );
              });
            });
          });
        } catch (e) {
          console.warn('[shortcut] OTP failed:', e);
        }
      })
      .catch(function (e) {
        console.warn('[shortcut] OTP setting lookup failed:', e);
      });
  }

  function showSystemNotification(text, expireSeconds) {
    const expire = typeof expireSeconds !== 'undefined' ? expireSeconds * 1000 : 60000;
    // Firefox rejects a null notification id (Chrome tolerates it), so always
    // pass a real one.
    const notificationId =
      'keepasscat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    try {
      chrome.notifications.create(
        notificationId,
        {
          type: 'basic',
          iconUrl: '/assets/48x48.png',
          title: 'Keepass Cat',
          message: text,
        },
        function () {
          if (chrome.runtime.lastError) {
            console.warn('[notify] create failed:', chrome.runtime.lastError.message);
            return;
          }
          setTimeout(() => chrome.notifications.clear(notificationId), expire);
        }
      );
    } catch (e) {
      console.warn('[notify] create threw:', e);
    }
  }

  // Notifications raised *inside* the background must not go through
  // Notifications.push(): that helper uses chrome.runtime.sendMessage, and a
  // runtime message is never delivered back to the context that sent it, so the
  // background's own onMessage listener would never fire and nothing would be
  // shown. Same gating as Notifications.push, applied locally.
  function pushNotification(text, type, expireSeconds) {
    return settings
      .getSetNotificationsEnabled()
      .then(function (enabled) {
        if (!enabled || enabled.indexOf(type) === -1) return;
        showSystemNotification(text, expireSeconds);
      })
      .catch(function () {});
  }

  function handleMessage(message, sender, sendResponse) {
    if (!message || !message.m) return; //message format unrecognized

    if (message.m == 'showMessage') {
      showSystemNotification(message.text, message.expire);
    }

    if (message.m == 'requestPermission') {
      //better to do the request here on the background, because on some platforms
      //the popup may close prematurely when requesting access
      chrome.permissions.contains(message.perms, function (alreadyGranted) {
        if (chrome.runtime.lastError || (alreadyGranted && message.then)) {
          handleMessage(message.then, sender, sendResponse);
        } else {
          //request
          chrome.permissions.request(message.perms, function (granted) {
            if (granted && message.then) {
              handleMessage(message.then, sender, sendResponse);
            }
          });
        }
      });
  }

  if (message.m == 'autofill') {
      performAutofill(message.tabId, message.u, message.p);
    }

    if (message.m == 'fillTotp') {
      chrome.scripting.executeScript(
        {
          target: { tabId: message.tabId, allFrames: true },
          files: ['/dist/contentScripts/index.global.js'],
        },
        function () {
          chrome.webNavigation.getAllFrames({ tabId: message.tabId }, function (frames) {
            if (!frames) return;
            frames.forEach(function (f) {
              chrome.tabs.sendMessage(message.tabId, { m: 'fillTotpAtCursor', code: message.code }, { frameId: f.frameId });
            });
          });
        }
      );
    }

    if (message.m == 'uploadDatabase') {
      var binary = atob(message.data);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var arrayBuffer = bytes.buffer;
      import('$services/webdavFileManager.js').then(({ WebdavFileManager }) => {
        return new WebdavFileManager(settings).uploadCurrentDatabase(arrayBuffer);
      }).then(() => {
        sendResponse({ success: true });
      }).catch((err) => {
        sendResponse({ error: err.message });
      });
      return true; // keep channel open for async response
    }
  }

  //listen for "autofill" message:
  chrome.runtime.onMessage.addListener(handleMessage);

  // Decrypt a cached protected field (XOR of value and salt) without kdbxweb.
  // protectedData[field] may be absent when the field is not protected, in which
  // case we fall back to the plain-text field on the entry (mirrors
  // keepassReference.keewebGetDecryptedFieldValue).
  function decryptProtectedField(entry, field) {
    var pd = entry && entry.protectedData && entry.protectedData[field];
    if (!pd || !pd.value || !pd.salt) {
      return (entry && entry[field]) || '';
    }
    var value = new Uint8Array(pd.value);
    var salt = new Uint8Array(pd.salt);
    var out = new Uint8Array(value.length);
    for (var i = 0; i < value.length; i++) out[i] = value[i] ^ salt[i];
    try { return new TextDecoder().decode(out); } catch (e) { return ''; }
  }

  // Best-effort fallback: open the popup. openPopup() must be called within a
  // user gesture; after our async reads the gesture may already have expired
  // (Chrome usually still allows it, Firefox may not), so this is wrapped and
  // must never throw.
  function fallbackToPopup() {
    try { openPopup(); } catch (e) { console.warn('[shortcut] openPopup failed:', e); }
  }

  // Shortcut autofill (Firefox has no default key; user assigns one manually)
  chrome.commands.onCommand.addListener(function(cmd, tab) {
    if (cmd !== 'autofill_best_match') return;
    console.log('[shortcut] triggered:', cmd, 'tab:', tab?.url);
    chrome.storage.local.get('autofillShortcut', function(items) {
      if (items.autofillShortcut === false) { console.log('[shortcut] disabled'); return; }
      protectedMemory.getData('secureCache.entries').then(function(entries) {
        if (typeof entries === 'string') entries = protectedMemory.deserialize(entries);
        if (!entries || !Array.isArray(entries) || !entries.length) { fallbackToPopup(); return; }
        var url = (tab && tab.url) || '';
        var bestMatch = null, bestRank = 0, bestCount = 0;
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (!e.url) continue;
          var rank = matchLevel(url, e) * 25; // level 4..1 -> 100/75/50/25
          if (rank > bestRank) { bestRank = rank; bestMatch = e; bestCount = 1; }
          else if (rank === bestRank && rank > 0) { bestCount++; }
        }
        // autofill_best_match: require exactly 1 match
        if (!bestMatch || bestCount > 1) { fallbackToPopup(); return; }
        // Unique match: fill entirely in the background, without opening a popup.
        var password = decryptProtectedField(bestMatch, 'password');
        var userName = decryptProtectedField(bestMatch, 'userName');
        if (!password) { console.warn('[shortcut] no password to fill; falling back to popup'); fallbackToPopup(); return; }
        console.log('[shortcut] unique match, autofilling in background:', bestMatch.title);
        performAutofill(tab.id, userName, password).then(function () {
          copyTotpForShortcut(tab.id, bestMatch);
        });
      }).catch(function (err) {
        console.warn('[shortcut] lookup failed; falling back to popup:', err);
        fallbackToPopup();
      });
    });
  });

  chrome.alarms.create('forgetStuff', {
    delayInMinutes: 1,
    periodInMinutes: 2,
  });

  // Trigger immediately on service worker wake-up
  forgetStuff();
  setTimeout(updateBadgeForTab, 200); // brief delay for storage to be ready

  // Update badge when active tab changes
  var updateBadgeForTab = function() {
    console.log('[badge] updateBadgeForTab called');
    chrome.storage.local.get('rememberPeriod', function(items) {
      if (items.rememberPeriod !== -2) return;
      protectedMemory.getData('secureCache.entries').then(function(entries) {
        if (!entries || !entries.length) {
          localMemory.getData('secureCache.entries').then(function(raw) {
            if (raw) {
              var localEntries = typeof raw === 'string' ? localMemory.deserialize(raw) : raw;
              if (localEntries && localEntries.length) filterAndSetBadge(localEntries);
            }
          }).catch(function() {});
          return;
        }
        if (typeof entries === 'string') entries = protectedMemory.deserialize(entries);
        if (!Array.isArray(entries)) return;
        console.log('[badge] got', entries.length, 'entries, filtering');
        filterAndSetBadge(entries);
      }).catch(function() {});
    });
  };
  
  function filterAndSetBadge(entries) {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      console.log('[badge] tabs query returned', tabs.length, 'tabs');
      if (!tabs || tabs.length === 0) return;
      var count = 0;
      if (tabs.length > 0 && tabs[0].url && tabs[0].url.startsWith('http')) {
        try {
          var pageUrl = tabs[0].url;
          // Cascade: highest matching level first
          for (var level = 4; level >= 1; level--) {
            var matched = entries.filter(function(e) {
              return matchLevel(pageUrl, e) === level;
            });
            if (matched.length > 0) {
              count = matched.length;
              console.log('[badge] matched', count, 'at level', level, 'for', pageUrl);
              break;
            }
          }
        } catch(e) { console.error('[badge] filter error', e); }
      }
      if (count > 0) {
        setBadgeText({ text: String(count), tabId: tabs[0].id });
        setBadgeBackgroundColor({ color: '#4688F1', tabId: tabs[0].id });
        console.log('[badge] set badge to', count, 'on tab', tabs[0].id);
      } else {
        setBadgeText({ text: '', tabId: tabs[0].id });
        console.log('[badge] cleared badge on tab', tabs[0].id);
      }
    });
  }

  chrome.tabs.onActivated.addListener(updateBadgeForTab);
  chrome.tabs.onUpdated.addListener(function(tabId, changeInfo) {
    if (changeInfo.status === 'complete') updateBadgeForTab();
  });

  chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name == 'forgetStuff') {
        forgetStuff();
        updateBadgeForTab();
        return;
    }
  });

  // forgetStuff has four triggers (the top-level call on service-worker start, the
  // alarm, onStartup and a port message) and they overlap: waking the worker for
  // the alarm also runs the top-level call. Without this guard each concurrent run
  // re-read the same expired key before clearForgetTimes had landed, so one expiry
  // fired one "Clipboard cleared" notification per run.
  var forgetInFlight = false;

  function forgetStuff() {
    if (forgetInFlight) return;
    forgetInFlight = true;
    console.log('Alarm Handler -- Check if we should clear Cache --', new Date());
    chrome.storage.local.get('rememberPeriod', function(items) {
      if (items.rememberPeriod === -2) {
        console.log('[forgetStuff] Forever mode, restoring cache from local');
        localMemory.getData('secureCache.entries').then(function(raw) {
          if (raw) {
            var entries = localMemory.deserialize(raw);
            if (entries && entries.length > 0) {
              protectedMemory.setData('secureCache.entries', entries);
            }
          }
        }).catch(function() {});
      } else {
        protectedMemory.clearData('secureCache.entries');
        setBadgeText({ text: '' });
      }
    });
    settings.getAllForgetTimes().then(function (allTimes) {
      var now = Date.now();
      var forgotten = [];
      for (var key in allTimes) {
        // If the time has passed but is still positive...
        if (allTimes[key] < now && allTimes[key] > 0) {
          forgotten.push(key);
        }
      }
      if (!forgotten.length) return;

      // Claim the expired keys *before* acting. clearForgetTimes is a read-modify-
      // write on storage, so a second run starting in the same tick would still see
      // them and repeat every action below.
      return settings
        .clearForgetTimes(forgotten)
        .catch(function () {})
        .then(function () {
          forgotten.forEach(function (key) {
            switch (key) {
              case 'clearClipboard':
                clearClipboard();
                // "Clipboard cleared" is a clipboard event, not a password
                // expiration: gating it on 'expiration' hid it from anyone who
                // left the password-expiration toggle off.
                pushNotification(i18n.t('Clipboard cleared'), 'clipboard', 5);
                break;
              default:
                if (key.indexOf('password') >= 0) {
                  forgetPassword().then(() => {
                    pushNotification(i18n.t('Remember password expired'), 'expiration');
                  });
                } else {
                  console.error("I don't know what to do with key", key);
                }
            }
          });
        });
    }).catch(function (e) {
      console.warn('[forgetStuff] failed:', e);
    }).then(function () {
      forgetInFlight = false;
    });
  }

  function clearClipboard() {
    // Best-effort only: every failure below is swallowed so the expiry timer
    // and its notifications are never affected.
    console.info('Clearing clipboard');

    // Chrome MV3: the service worker has no DOM, so delegate to an offscreen
    // document. https://developer.chrome.com/docs/extensions/reference/api/offscreen
    if (chrome.offscreen && typeof chrome.offscreen.createDocument === 'function') {
      return clearClipboardOffscreen();
    }

    // Firefox MV2: the background is a page, so clear it directly.
    emptyClipboardWithDom();
  }

  function emptyClipboardWithDom() {
    try {
      var textarea = document.createElement('textarea');
      // Same as the offscreen path: an empty selection makes the copy command a
      // no-op, so copy a single space to actually replace the clipboard.
      textarea.value = ' ';
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch (e) {
      console.warn('[clearClipboard] Could not clear clipboard:', e);
    }
  }

  function clearClipboardOffscreen() {
    var created = false;

    function close() {
      if (!created) return Promise.resolve();
      try {
        return chrome.offscreen.closeDocument().catch(function () {});
      } catch (e) {
        return Promise.resolve();
      }
    }

    var ensureDocument = function () {
      if (typeof chrome.offscreen.hasDocument === 'function') {
        return chrome.offscreen.hasDocument().then(function (exists) {
          return exists;
        });
      }
      // hasDocument() is unavailable before Chrome 116; just try to create it.
      return Promise.resolve(false);
    };

    // The offscreen document may not have registered its onMessage listener the
    // instant createDocument() resolves, so retry a few times before giving up.
    function sendClearMessage(attempt) {
      return chrome.runtime.sendMessage({ m: 'clearClipboard' }).catch(function (e) {
        if (attempt >= 3) throw e;
        return new Promise(function (resolve) {
          setTimeout(resolve, 150);
        }).then(function () {
          return sendClearMessage(attempt + 1);
        });
      });
    }

    return ensureDocument()
      .then(function (exists) {
        if (exists) return;
        return chrome.offscreen
          .createDocument({
            url: 'offscreen.html',
            reasons: ['CLIPBOARD'],
            justification: 'Clear the clipboard after the configured expiry interval',
          })
          .then(function () {
            created = true;
          })
          .catch(function () {
            // "Only a single offscreen document may be created" means one
            // already exists, which is fine for our purposes.
          });
      })
      .then(function () {
        return sendClearMessage(0);
      })
      .catch(function (e) {
        console.warn('[clearClipboard] Offscreen clear failed:', e);
      })
      .then(close, close);
  }

  function forgetPassword() {
    return settings
      .getCurrentDatabaseChoice()
      .then((info) => {
        let key = info.passwordFile.title + '__' + info.providerKey + '.password';
        return key;
      })
      .then(protectedMemory.clearData);
  }
}

const settings = new Settings();
const notifications = new Notifications(settings);
const protectedMemory = new ProtectedMemory('session');
const localMemory = new ProtectedMemory('local');

Background(protectedMemory, localMemory, settings, notifications);
