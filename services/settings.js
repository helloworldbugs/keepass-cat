import * as Base64 from 'base64-arraybuffer';
import { ChromePromiseApi } from '@/lib/chrome-api-promise.js';
import { toRaw } from 'vue';
const chromePromise = ChromePromiseApi();

function Settings(secureCache) {
  'use strict';

  var exports = {};

  // upgrade old settings.  Called on install.
  exports.upgrade = function () {
    // Patch https://subdavis.com/blog/jekyll/update/2017/01/02/ckp-security-flaw.html
    exports.getSetDatabaseUsages().then((usages) => {
      let keys = Object.keys(usages);
      keys.forEach((k) => {
        if (usages[k]['passwordKey'] !== undefined) chrome.storage.local.clear();
      });
    });
  };

  exports.getKeyFiles = function () {
    return chromePromise.storage.local.get(['keyFiles']).then(function (items) {
      return items.keyFiles || [];
    });
  };

  exports.deleteKeyFile = function (name) {
    return exports.getKeyFiles().then(function (keyFiles) {
      keyFiles.forEach(function (keyFile, index) {
        if (keyFile.name === name) {
          keyFiles.splice(index, 1);
        }
      });

      return chromePromise.storage.local.set({
        keyFiles: keyFiles,
      });
    });
  };

  exports.deleteAllKeyFiles = function () {
    return chromePromise.storage.local.remove('keyFiles');
  };

  exports.destroyLocalStorage = function (key) {
    if (key.length) {
      return chromePromise.storage.local.remove(key);
    }
  };

  exports.addKeyFile = function (name, key) {
    return exports.getKeyFiles().then(function (keyFiles) {
      var matches = keyFiles.filter(function (keyFile) {
        return keyFile.name === name;
      });

      var encodedKey = Base64.encode(key);
      if (matches.length) {
        //update
        matches[0].encodedKey = encodedKey;
      } else {
        //insert
        keyFiles.push({
          name: name,
          encodedKey: encodedKey,
        });
      }

      return chromePromise.storage.local.set({
        keyFiles: keyFiles,
      });
    });
  };

  exports.saveCurrentDatabaseChoice = function (passwordFile, provider) {
    let shallowCopy = function (obj) {
      let clone = {};
      clone.prototype = obj.prototype;
      Object.keys(obj).forEach((property) => {
        clone[property] = obj[property];
      });
      return clone;
    };
    let passwordFileClone = shallowCopy(passwordFile);
    passwordFileClone.data = undefined; //don't save the data with the choice

    return chromePromise.storage.local.set({
      selectedDatabase: {
        passwordFile: passwordFileClone,
        providerKey: provider.key,
      },
    });
  };

  exports.getCurrentDatabaseChoice = function () {
    return chromePromise.storage.local.get(['selectedDatabase']).then(function (items) {
      if (items.selectedDatabase) {
        return items.selectedDatabase;
      } else {
        return null;
      }
    });
  };

  exports.disableDatabaseProvider = function (provider) {
    return chromePromise.storage.local.get(['selectedDatabase']).then((items) => {
      const selected = items.selectedDatabase;
      if (!selected || selected.providerKey !== provider.key) return Promise.resolve(false);
      const key = selected.passwordFile.title + '__' + selected.providerKey + '.password';
      /*
       * Switching a provider off has to forget its secrets, not just the selection.
       * Leaving the cached master password (the "remember forever" entry in the local
       * store) and the cached entries behind meant that turning the provider back on
       * unlocked the database again without asking for the password. Same for WebDAV.
       */
      return Promise.all([
        secureCache.clear(key),
        secureCache.clear(key, 'local'),
        secureCache.clear('secureCache.entries'),
        secureCache.clear('secureCache.entries', 'local'),
        exports.clearForgetTimes([key]),
      ])
        .catch(() => {})
        .then(() => chromePromise.storage.local.remove('selectedDatabase'))
        .then(() => true);
    });
  };

  exports.getCurrentMasterPasswordCacheKey = function () {
    return exports.getCurrentDatabaseChoice().then((info) => {
      if (info !== null) return info.passwordFile.title + '__' + info.providerKey + '.password';
      return null;
    });
  };

  exports.cacheMasterPassword = function (pw, args) {
    return exports.getCurrentMasterPasswordCacheKey().then((key) => {
      let forgetTime = args['forgetTime'];
      let savePromise;
      if (forgetTime === -1) {
        // Forever: store in local storage for persistence
        savePromise = secureCache.save(key, pw, 'local');
      } else {
        // Timed or session: clear any old forever password from local
        savePromise = secureCache.clear(key, 'local').then(() => {
          return secureCache.save(key, pw);
        });
      }
      return savePromise.then(() => {
        return exports.setForgetTime(key, forgetTime);
      });
    });
  };

  /*
   * Sets a time to forget something
   */
  exports.setForgetTime = function (key, time) {
    var storageKey = 'forgetTimes';
    return chromePromise.storage.local.get(storageKey).then(function (items) {
      var forgetTimes = {};
      if (items[storageKey]) {
        forgetTimes = items[storageKey];
      }
      // only set if not exists...  This prevents us from resetting the clock every unlock...
      if (!(key in forgetTimes) || time !== forgetTimes[key]) forgetTimes[key] = time;

      return chromePromise.storage.local.set({
        forgetTimes: forgetTimes,
      });
    });
  };

  exports.getAllForgetTimes = function () {
    var storageKey = 'forgetTimes';
    return chromePromise.storage.local.get(storageKey).then(function (items) {
      var forgetTimes = {};
      if (items[storageKey]) {
        forgetTimes = items[storageKey];
      }

      return forgetTimes;
    });
  };

  exports.clearForgetTimes = function (keysArray) {
    var storageKey = 'forgetTimes';
    return chromePromise.storage.local.get(storageKey).then(function (items) {
      var forgetTimes = {};
      if (items[storageKey]) {
        forgetTimes = items[storageKey];
      }
      keysArray.forEach(function (key) {
        if (forgetTimes[key]) delete forgetTimes[key];
      });

      return chromePromise.storage.local.set({
        forgetTimes: forgetTimes,
      });
    });
  };

  /**
   * Saves information about how the database was opened, so we can optimize the
   * UI next time by hiding the irrelevant options and remembering the keyfile
   */
  exports.saveCurrentDatabaseUsage = function (usage) {
    return exports.getCurrentDatabaseChoice().then(function (info) {
      return exports.getSetDatabaseUsages().then(function (usages) {
        var key = info.passwordFile.title + '__' + info.providerKey;
        usages[key] = usage;

        return exports.getSetDatabaseUsages(usages);
      });
    });
  };

  /**
   * Retrieves information about how the database was opened, so we can optimize the
   * UI by hiding the irrelevant options and remembering the keyfile
   */
  exports.getCurrentDatabaseUsage = function () {
    return exports.getCurrentDatabaseChoice().then(function (info) {
      return exports.getSetDatabaseUsages().then(function (usages) {
        var key = info.passwordFile.title + '__' + info.providerKey;
        var usage = usages[key] || {};

        return secureCache.get(key + '.password').then(function (value) {
          if (value !== undefined) {
            usage['passwordKey'] = value;
            return usage;
          }
          // Try local storage for forever passwords
          return secureCache.get(key + '.password', 'local').then(function (localValue) {
            usage['passwordKey'] = localValue;
            return usage;
          });
        });
      });
    });
  };

  let keyGetSetter = function (key, val, defaultval, value_type) {
    let update_obj = {};
    update_obj[key] = toRaw(val);
    if (val !== undefined && (typeof val === value_type || val === null)) {
      console.info('Setting ' + key + ' to ', val);
      return chromePromise.storage.local.set(update_obj).then(() => val);
    } else
      return chromePromise.storage.local.get(key).then((oldval) => {
        if (oldval[key] !== undefined) if (typeof oldval[key] === value_type) return oldval[key];
        return defaultval;
      });
  };

  // Seconds: the options are 15 s / 30 s / 1 min / 3 min / 5 min / 10 min.
  const CLIPBOARD_EXPIRE_OPTIONS = [15, 30, 60, 180, 300, 600];
  const CLIPBOARD_EXPIRE_DEFAULT = 15;

  // A value the dropdown cannot show would leave it blank, so anything else is
  // pulled to the closest option (ties go to the shorter, safer interval).
  function snapClipboardInterval(seconds) {
    if (!(seconds > 0)) return CLIPBOARD_EXPIRE_DEFAULT;
    if (CLIPBOARD_EXPIRE_OPTIONS.indexOf(seconds) !== -1) return seconds;
    return CLIPBOARD_EXPIRE_OPTIONS.reduce((best, option) => {
      const distance = Math.abs(option - seconds);
      const bestDistance = Math.abs(best - seconds);
      if (distance < bestDistance) return option;
      return best;
    });
  }

  // Older builds stored the interval in minutes (1, 2, 3, 5, 8). A stored value
  // below the shortest option can only be such a value, so it is converted once
  // and written back; without this a stored "2" would mean two seconds.
  exports.getSetClipboardExpireInterval = function (interval) {
    if (interval !== undefined) {
      return keyGetSetter('expireInterval', snapClipboardInterval(interval), CLIPBOARD_EXPIRE_DEFAULT, 'number');
    }
    return keyGetSetter('expireInterval', undefined, CLIPBOARD_EXPIRE_DEFAULT, 'number').then((value) => {
      const seconds = value > 0 && value < 15 ? value * 60 : value;
      const snapped = snapClipboardInterval(seconds);
      if (snapped === value) return snapped;
      return keyGetSetter('expireInterval', snapped, CLIPBOARD_EXPIRE_DEFAULT, 'number').then(() => snapped);
    });
  };

  // Master switch for the clipboard expiry feature: when off, copying never
  // schedules a clear and never announces one.
  exports.getSetClipboardExpireEnabled = function (enabled) {
    return keyGetSetter('clipboardExpireEnabled', enabled, true, 'boolean');
  };

  exports.getSetDatabaseUsages = function (usages) {
    return keyGetSetter('databaseUsages', usages, {}, 'object');
  };

  exports.getSetDefaultRememberPeriod = function (rememberPeriod) {
    return keyGetSetter('rememberPeriod', rememberPeriod, 0, 'number');
  };

  exports.getSetWebdavServerList = function (serverList) {
    return keyGetSetter('webdavServerList', serverList, [], 'object');
  };

  exports.getSetWebdavDirectoryMap = function (dirMap) {
    return keyGetSetter('webdavDirectoryMap', dirMap, {}, 'object');
  };

  exports.getSetAutofillShortcut = function (enabled) {
    return keyGetSetter('autofillShortcut', enabled, true, 'boolean');
  };

  exports.getSetFillTotpEnabled = function (enabled) {
    return keyGetSetter('fillTotpEnabled', enabled, true, 'boolean');
  };

  exports.getSetCopyTotpOnAutofill = function (enabled) {
    return keyGetSetter('copyTotpOnAutofill', enabled, true, 'boolean');
  };

  exports.getSetNotificationsEnabled = function (enabledTypes) {
    return keyGetSetter(
      'notificationsEnabled',
      enabledTypes,
      ['expiration', 'clipboard'],
      'object'
    );
  };

  return exports;
}

export { Settings };
