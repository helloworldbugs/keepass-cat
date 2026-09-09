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
  var pendingFill = null;
  var shortcutPending = false;
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

  function handleMessage(message, sender, sendResponse) {
    if (!message || !message.m) return; //message format unrecognized

    if (message.m == 'getPendingFill') {
      console.log('[getPendingFill] pendingFill=', pendingFill ? 'set' : 'null');
      // Do NOT clear pendingFill here — multiple popups (stale + fresh) may read it.
      if (pendingFill) {
        sendResponse({ pendingAutofill: pendingFill });
        return;
      }
      if (shortcutPending) {
        // The shortcut handler is still computing the best match; wait briefly.
        var attempts = 0;
        var waitTimer = setInterval(function () {
          attempts++;
          if (pendingFill) {
            clearInterval(waitTimer);
            sendResponse({ pendingAutofill: pendingFill });
          } else if (attempts >= 20) {
            clearInterval(waitTimer);
            sendResponse({ pendingAutofill: null });
          }
        }, 50);
        return true; // keep the message channel open for the async response
      }
      sendResponse({ pendingAutofill: null });
      return;
    }

    if (message.m == 'clearPendingFill') {
      pendingFill = null;
      shortcutPending = false;
      chrome.storage.session.remove('pendingAutofill');
      return;
    }

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
      var fillAllFrames = function() {
        chrome.webNavigation.getAllFrames({tabId: message.tabId}, function(frames) {
          if (!frames) return;
          frames.forEach(function(f) {
            var url = new URL(f.url);
            var frameOrigin = url.protocol + '//' + url.hostname + '/';
            chrome.tabs.sendMessage(message.tabId, {
              m: 'fillPassword',
              u: message.u,
              p: message.p,
              o: frameOrigin,
            }, {frameId: f.frameId});
          });
        });
      };
      chrome.scripting.executeScript(
        {
          target: { tabId: message.tabId, allFrames: true },
          files: ['/dist/contentScripts/index.global.js'],
        },
        function () {
          console.log('Autofill script injected.');
          fillAllFrames();
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

  // Shortcut autofill (Firefox has no default key; user assigns one manually)
  chrome.commands.onCommand.addListener(function(cmd, tab) {
    if (cmd !== 'autofill_best_match') return;
    console.log('[shortcut] triggered:', cmd, 'tab:', tab?.url);
    // Open the popup immediately within the user-gesture context.
    // Firefox requires openPopup() to be called synchronously in the command
    // handler; otherwise the gesture expires and the popup never opens.
    shortcutPending = true;
    openPopup();
    chrome.storage.local.get('autofillShortcut', function(items) {
      if (!items.autofillShortcut) { console.log('[shortcut] disabled'); shortcutPending = false; return; }
      protectedMemory.getData('secureCache.entries').then(function(entries) {
        if (typeof entries === 'string') entries = protectedMemory.deserialize(entries);
        if (!entries || !Array.isArray(entries) || !entries.length) { shortcutPending = false; return; }
        var url = (tab && tab.url) || '';
        var bestMatch = null, bestRank = 0, bestCount = 0;
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (!e.url) continue;
          var rank = matchLevel(url, e) * 25; // level 4/3/2/1 -> 100/75/50/25
          if (rank > bestRank) { bestRank = rank; bestMatch = e; bestCount = 1; }
          else if (rank === bestRank && rank > 0) { bestCount++; }
        }
        // autofill_best_match: require exactly 1 match
        if (!bestMatch || bestCount > 1) { shortcutPending = false; return; }
        pendingFill = {
          title: bestMatch.title,
          userName: bestMatch.userName,
          url: bestMatch.url
        };
        console.log('[shortcut] pendingFill set: title:', pendingFill.title);
        chrome.storage.session.set({ pendingAutofill: pendingFill });
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
