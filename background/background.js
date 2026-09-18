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
import { matchLevel } from '@/lib/utils.js';

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
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId, allFrames: true },
        files: ['/dist/contentScripts/index.global.js'],
      },
      function () {
        console.log('Autofill script injected.');
        fillAllFrames();
      }
    );
  }

  function handleMessage(message, sender, sendResponse) {
    if (!message || !message.m) return; //message format unrecognized

    if (message.m == 'showMessage') {
      const expire = typeof message.expire !== 'undefined' ? message.expire * 1000 : 60000;
      chrome.notifications.create(
        null,
        {
          type: 'basic',
          iconUrl: '/assets/48x48.png',
          title: 'Keepass Cat',
          message: message.text,
        },
        function (notificationId) {
          setTimeout(() => chrome.notifications.clear(notificationId), expire);
        }
      );
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

  // function to determine if the content script is already injected, so we don't do it twice
  function alreadyInjected(tabId) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, { m: 'ping' }, (response) => {
        if (response) resolve(true);
        else {
          let err = chrome.runtime.lastError;
          resolve(false);
        }
      });
    });
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
      if (!items.autofillShortcut) { console.log('[shortcut] disabled'); return; }
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
        performAutofill(tab.id, userName, password);
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

  function forgetStuff() {
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
      var forgottenKeys = [];
      for (var key in allTimes) {
        // If the time has passed but is still positive...
        if (allTimes[key] < now && allTimes[key] > 0) {
          forgottenKeys.push(key);
          switch (key) {
            case 'clearClipboard':
              clearClipboard();
              notifications.push({
                text: i18n.t('Clipboard cleared'),
                type: 'expiration',
                expire: 2,
              });
              break;
            default:
              if (key.indexOf('password') >= 0) {
                forgetPassword().then(() => {
                  notifications.push({
                    text: i18n.t('Remember password expired'),
                    type: 'expiration',
                  });
                });
              } else {
                console.error("I don't know what to do with key", key);
              }
          }
        }
      }

      //remove stuff
      settings.clearForgetTimes(forgottenKeys);
    });
  }

  function clearClipboard() {
    // No longer have access to document in this context.
    // https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/functional-samples/cookbook.offscreen-clipboard-write
    console.info('Clearing clipboard');
    // var clearClipboard = function(e) {
    // 	e.clipboardData.setData('text/plain', "");
    // 	e.preventDefault();
    // 	document.removeEventListener('copy', clearClipboard); //don't listen anymore
    // }

    // document.addEventListener('copy', clearClipboard);
    // document.execCommand('copy');
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
