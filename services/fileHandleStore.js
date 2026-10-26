'use strict';

/*
 * Persists the single FileSystemFileHandle used by the local-file provider.
 *
 * A FileSystemFileHandle cannot be structured-cloned into chrome.storage, but
 * IndexedDB can store it: Chrome keeps the handle reference and the permission
 * grant is re-checked every time it is used. One fixed database/store/key is
 * used so this module can never collide with other extension data.
 */

const DB_NAME = 'keepass-cat';
const DB_VERSION = 1;
const STORE_NAME = 'fileHandles';
const HANDLE_KEY = 'localfile';

function openDatabase() {
  return new Promise(function (resolve, reject) {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = function () {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = function () {
      resolve(request.result);
    };
    request.onerror = function () {
      reject(request.error || new Error('Failed to open the file handle database.'));
    };
    request.onblocked = function () {
      reject(new Error('The file handle database is blocked by another tab.'));
    };
  });
}

/*
 * Runs one transaction and resolves with the value returned by `action` once
 * the transaction commits. `action` receives the object store and may return a
 * promise (e.g. the result of a get request).
 */
function withDatabase(mode, action) {
  return openDatabase().then(function (db) {
    return new Promise(function (resolve, reject) {
      let tx;
      try {
        tx = db.transaction(STORE_NAME, mode);
      } catch (err) {
        db.close();
        reject(err);
        return;
      }
      const store = tx.objectStore(STORE_NAME);
      let result;
      try {
        result = action(store);
      } catch (err) {
        db.close();
        reject(err);
        return;
      }
      tx.oncomplete = function () {
        db.close();
        resolve(result);
      };
      tx.onerror = function () {
        db.close();
        reject(tx.error || new Error('The file handle transaction failed.'));
      };
      tx.onabort = function () {
        db.close();
        reject(tx.error || new Error('The file handle transaction was aborted.'));
      };
    });
  });
}

/**
 * Resolves the stored FileSystemFileHandle, or null when none is saved.
 */
function get() {
  return withDatabase('readonly', function (store) {
    return new Promise(function (resolve, reject) {
      const request = store.get(HANDLE_KEY);
      request.onsuccess = function () {
        resolve(request.result || null);
      };
      request.onerror = function () {
        reject(request.error || new Error('Failed to read the stored file handle.'));
      };
    });
  });
}

/**
 * Stores (or replaces) the FileSystemFileHandle.
 */
function set(handle) {
  return withDatabase('readwrite', function (store) {
    store.put(handle, HANDLE_KEY);
  });
}

/**
 * Forgets the stored FileSystemFileHandle.
 */
function clear() {
  return withDatabase('readwrite', function (store) {
    store.delete(HANDLE_KEY);
  });
}

export { get, set, clear };
