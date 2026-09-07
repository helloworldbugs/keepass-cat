import { isFirefox } from './utils.js';

function ChromePromiseApi() {
  var my = {
    permissions: {
      contains: permissionContains,
      request: permissionRequest,
      remove: permissionRemove,
    },
    storage: {
      sync: {
        set: storageSyncSet,
        get: storageSyncGet,
        remove: storageSyncRemove,
      },
      local: {
        set: storageLocalSet,
        get: storageLocalGet,
        remove: storageLocalRemove,
      },
    },
    runtime: {
      getManifest: runtimeGetManifest,
    },
  };

  function runtimeGetManifest() {
    return new Promise((resolve, reject) => {
      let mfest = chrome.runtime.getManifest();
      if (mfest !== undefined) resolve(mfest);
      else reject('Uknown error while fetching manifest');
    });
  }

  function permissionRemove(perms) {
    // Firefox does not support permissions API
    if (isFirefox()) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      chrome.permissions.remove(perms, function (removed) {
        if (removed) {
          // The permissions have been removed.
          resolve();
        } else {
          // The permissions have not been removed (e.g., you tried to remove
          // required permissions).
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            reject(new Error('Failed to remove permission'));
          }
        }
      });
    });
  }

  function permissionContains(perms) {
    // Firefox does not support permissions API
    if (isFirefox()) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      chrome.permissions.contains(perms, function (hasPermission) {
        if (hasPermission) {
          resolve();
        } else {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            reject(new Error('Requested permission not present'));
          }
        }
      });
    });
  }

  function permissionRequest(perms) {
    // Firefox does not support permissions API
    if (isFirefox()) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      chrome.permissions.request(perms, function (granted) {
        if (granted) {
          resolve();
        } else {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.error('Permissions request failed for an unknown reason');
            reject(new Error('Failed to grant permission'));
          }
        }
      });
    });
  }

  function storageLocalRemove(key) {
    return storageRemove(chrome.storage.local, key);
  }

  function storageSyncRemove(key) {
    return storageRemove(chrome.storage.sync, key);
  }

  function storageRemove(storageArea, key) {
    return new Promise(function (resolve, reject) {
      storageArea.remove(key, function () {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  function storageSet(storageArea, data) {
    return new Promise(function (resolve, reject) {
      storageArea.set(data, function () {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message);
        } else {
          resolve();
        }
      });
    });
  }

  function storageGet(storageArea, keys) {
    return new Promise(function (resolve, reject) {
      storageArea.get(keys, function (items) {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message);
        } else {
          resolve(items);
        }
      });
    });
  }

  function storageSyncSet(data) {
    return storageSet(chrome.storage.sync, data);
  }

  function storageSyncGet(keys) {
    return storageGet(chrome.storage.sync, keys);
  }

  function storageLocalSet(data) {
    return storageSet(chrome.storage.local, data);
  }

  function storageLocalGet(keys) {
    return storageGet(chrome.storage.local, keys);
  }

  return my;
}

export { ChromePromiseApi };
