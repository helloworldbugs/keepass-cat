'use strict';

import { ChromePromiseApi } from '@/lib/chrome-api-promise.js';
import { parseUrl } from '@/lib/utils.js';
import { buildEntryFilters } from '@/lib/entryFilters.js';
import { Otp } from '@/lib/otp.js';
import { ref } from 'vue';
import { i18n } from '@/services/i18n';

const chromePromise = ChromePromiseApi();

/**
 * Shared state and methods for an unlocked password file.
 */
function UnlockedState(keepassReference, settings, notifications) {
  var my = {
    tabId: '', //tab id of current tab
    url: '', //url of current tab
    title: '', //window title of current tab
    origin: '', //url of current tab without path or querystring
    sitePermission: false, //true if the extension already has rights to autofill the password
    cache: {}, // a secure cache that refreshes when values are set or fetched
    clipboardStatus: '', //status message about clipboard, used when copying password to the clipboard
    unlocked: ref(false),
  };
  var copyEntry;
  var copyPart;
  var cacheTimeoutId;

  //determine current url:
  my.getTabDetails = function () {
    return new Promise(function (resolve, reject) {
      chrome.tabs.query(
        {
          active: true,
          currentWindow: true,
        },
        function (tabs) {
          if (tabs && tabs.length) {
            my.tabId = tabs[0].id;
            // if (!tabs[0].url) {
            // 	resolve();
            // 	return;
            // }
            // my.url keeps no query string and no fragment (used as the fallback
            // for pre-filling a new entry); my.fullUrl keeps both for matching.
            var url = tabs[0].url.split(/[?#]/);
            my.url = url[0];
            my.fullUrl = tabs[0].url; // keep query params for matching
            my.title = tabs[0].title;

            var parsedUrl = parseUrl(tabs[0].url);
            my.origin = parsedUrl.protocol + '//' + parsedUrl.hostname + '/';

            chromePromise.permissions
              .contains({
                origins: [my.origin],
              })
              .then(function () {
                my.sitePermission = true;
              })
              .catch(function (err) {
                my.sitePermission = false;
              })
              .then(function () {
                resolve();
              });
          } else {
            reject(new Error(i18n.t('Unable to determine tab details')));
          }
        }
      );
    });
  };

  my.clearCache = function () {
    console.log('Clearing cache');
    // Destroys an object in memory.
    function destroy(obj) {
      for (var prop in obj) {
        var property = obj[prop];
        if (property != null && typeof property == 'object') {
          destroy(property);
        } else {
          obj[prop] = null;
        }
      }
    }
    destroy(my.cache);
    my.unlocked.value = false;
    my.cache = {};
    console.log('locked', my.unlocked.value);
  };

  my.cacheSet = function (key, value) {
    // Derived UI index: whenever allEntries enters the cache it must already carry
    // filterKey, because the browse page has no mount hook of its own to rebuild it.
    if (key === 'allEntries') buildEntryFilters(value);
    // Refresh cache
    clearTimeout(cacheTimeoutId);
    cacheTimeoutId = setTimeout(function () {
      my.clearCache();
      window.close();
    }, 120000);
    console.log('Setting cache for ' + key);
    my.cache[key] = value;
    my.unlocked.value = true;
  };

  my.cacheGet = function (key) {
    // Refresh cache
    clearTimeout(cacheTimeoutId);
    cacheTimeoutId = setTimeout(function () {
      my.clearCache();
      window.close();
    }, 120000);
    return my.cache[key];
  };

  my.clearClipboardState = function () {
    my.clipboardStatus = '';
  };
  setTimeout(my.clearClipboardState, 60000); //clear backgroundstate after 1 minutes live - we should never be alive that long

  my.autofill = function (entry) {
    chrome.runtime.sendMessage({
      m: 'requestPermission',
      perms: {
        origins: [my.origin],
      },
      then: {
        m: 'autofill',
        tabId: my.tabId,
        u: entry.userName,
        p: getAttribute(entry, 'password'),
        o: my.origin,
      },
    });

    // Optionally auto-copy the entry's TOTP code to the clipboard
    settings.getSetCopyTotpOnAutofill().then(function (enabled) {
      var otpUrl = enabled ? my.getDecryptedAttribute(entry, 'otp') : '';
      if (otpUrl && entry['keepassCatTotpEnabled'] !== 'false') {
        my.copyTotpUrl(otpUrl, false);
      } else {
        window.close(); //close the popup
      }
    });
  };

  //get clear-text password from entry
  function getAttribute(entry, attr = 'password') {
    return my.getDecryptedAttribute(entry, attr);
  }

  function copyTotpCode(code, alsoFill) {
    var finish = function () {
      settings.getSetClipboardExpireInterval().then(function (interval) {
        settings.setForgetTime('clearClipboard', Date.now() + interval * 60000);
        notifications
          .push({
            text: 'TOTP' + i18n.t(' copied to clipboard. Clipboard will clear in {0} minute(s).', interval),
            type: 'clipboard',
          })
          .then(function () {
          settings.getSetFillTotpEnabled().then(function (enabled) {
            if (alsoFill && enabled) {
              chrome.runtime.sendMessage({ m: 'fillTotp', tabId: my.tabId, code: code });
            }
            window.close();
          });
        });
      });
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(finish).catch(function () {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      finish();
    }
  }

  my.copyPassword = function (entry) {
    copyPart = 'password';
    copyEntry = entry;
    document.execCommand('copy');
  };
  my.copyUsername = function (entry) {
    copyPart = 'userName';
    copyEntry = entry;
    document.execCommand('copy');
  };
  my.copyTotpUrl = function (url, alsoFill) {
    try {
      Otp.parseUrl(url).next(function (_, code) {
        if (!code) { window.close(); return; }
        copyTotpCode(code, alsoFill);
      });
    } catch (err) {
      console.warn('[copyTotp] failed:', err);
      window.close();
    }
  };
  my.copyTotp = function (entry) {
    var url = my.getDecryptedAttribute(entry, 'otp');
    if (!url) return;
    my.copyTotpUrl(url, true);
  };

  my.getDecryptedAttribute = function (entry, attributeName) {
    return keepassReference.getFieldValue(entry, attributeName, my.cache.allEntries);
  };

  //listens for the copy event and does the copy
  document.addEventListener('copy', function (e) {
    if (!copyEntry && !copyPart) {
      return; //listener can get registered multiple times
    }

    var textToPutOnClipboard = getAttribute(copyEntry, copyPart);
    var fieldName = copyPart.charAt(0).toUpperCase() + copyPart.slice(1); // https://stackoverflow.com/a/1026087
    copyEntry = null;
    copyPart = null;
    e.clipboardData.setData('text/plain', textToPutOnClipboard);
    e.preventDefault();

    settings.getSetClipboardExpireInterval().then((interval) => {
      settings.setForgetTime('clearClipboard', Date.now() + interval * 60000);
      notifications
        .push({
          text: fieldName + i18n.t(' copied to clipboard.  Clipboard will clear in ', interval) + interval + i18n.t(' minute(s).'),
          type: 'clipboard',
        })
        .then(() => window.close());
    });
  });

  return my;
}

export { UnlockedState };
