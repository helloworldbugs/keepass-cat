'use strict';

/**
 * Storage in background page memory.
 */
function SecureCacheMemory(protectedMemory) {
  var exports = {};

  var awaiting = [];
  var port = null;

  function onMessage(serializedSavedState) {
    try {
      var savedState = protectedMemory.hydrate(serializedSavedState);
      var notifier = awaiting.shift();
      if (notifier) notifier(savedState);
    } catch (e) {
      console.error('[secureCache] hydrate failed:', e);
      var notifier = awaiting.shift();
      if (notifier) notifier(undefined);
    }
  }

  // Open a fresh port to the background service worker.
  function connect() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs === undefined || tabs.length === 0) return;
      var p = chrome.runtime.connect({ name: 'tab' + tabs[0].id });
      port = p;
      p.onMessage.addListener(onMessage);
      p.onDisconnect.addListener(function () {
        // The port can be dropped when the MV3 service worker is recycled.
        // Flush pending gets (resolve as cache miss) and reconnect immediately.
        console.warn('[secureCache] port disconnected, reconnecting');
        port = null;
        while (awaiting.length) {
          var n = awaiting.shift();
          if (n) n(undefined);
        }
        connect();
      });
    });
  }

  // Resolve to a live port, reconnecting/waitting briefly if one is not ready yet.
  function getPort() {
    if (port) return Promise.resolve(port);
    return new Promise(function (resolve) {
      var tries = 0;
      var check = function () {
        if (port) { resolve(port); return; }
        if (++tries > 30) { resolve(null); return; } // ~3s bail
        setTimeout(check, 100);
      };
      check();
    });
  }

  connect();

  exports.ready = function () {
    return getPort().then(function () { return true; });
  };

  exports.get = function (key, storageType) {
    var resolveFn;
    var result = new Promise(function (resolve) {
      resolveFn = resolve;
      awaiting.push(resolve);
    });
    getPort().then(function (p) {
      if (!p) {
        // No port became available — resolve as a cache miss.
        var idx = awaiting.indexOf(resolveFn);
        if (idx >= 0) awaiting.splice(idx, 1);
        resolveFn(undefined);
        return;
      }
      p.postMessage({ action: 'get', key: key, storageType: storageType || 'session' });
    });
    return result;
  };

  exports.clear = function (key, storageType) {
    console.log('clearing key: ' + key);
    return getPort().then(function (p) {
      if (p) p.postMessage({ action: 'clear', key: key, storageType: storageType || 'session' });
    });
  };

  exports.save = function (key, value, storageType) {
    return getPort().then(function (p) {
      if (!p) return;
      var serializedValue = protectedMemory.serialize(value);
      p.postMessage({ action: 'save', key: key, value: serializedValue, storageType: storageType || 'session' });
    });
  };

  exports.forgetStuff = function () {
    return getPort().then(function (p) {
      if (p) p.postMessage({ action: 'forgetStuff' });
    });
  };

  return exports;
}

export { SecureCacheMemory };
