'use strict';

/*
 * Persists the FileSystemFileHandles used by the local-file provider.
 *
 * A FileSystemFileHandle cannot be structured-cloned into chrome.storage, but
 * IndexedDB can store it: Chrome keeps the handle reference and the permission
 * grant is re-checked every time it is used.
 *
 * Records are keyed by a stable id generated when the file is added, because one
 * extension install can hold several .kdbx files. Each value is
 * `{ id, cacheId, alias, addedAt, handle }`; the alias is what the UI shows (the
 * File System Access API exposes no path, only handle.name) and cacheId is the key
 * the remembered password is stored under (see localFileManager.js).
 */

const DB_NAME = 'keepass-cat';
const DB_VERSION = 1;
const STORE_NAME = 'fileHandles';

/*
 * Single-file builds stored the handle under this fixed key. It is still read so
 * an existing install can migrate to id-keyed records without re-picking the file.
 */
const LEGACY_HANDLE_KEY = 'localfile';

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

function requestToPromise(request) {
  return new Promise(function (resolve, reject) {
    request.onsuccess = function () {
      resolve(request.result);
    };
    request.onerror = function () {
      reject(request.error || new Error('Failed to read the stored file handle.'));
    };
  });
}

/* Reads run inside a transaction that closes as soon as the requests settle. */
function read(action) {
  return openDatabase().then(function (db) {
    let tx;
    try {
      tx = db.transaction(STORE_NAME, 'readonly');
    } catch (err) {
      db.close();
      throw err;
    }
    const result = action(tx.objectStore(STORE_NAME));
    tx.oncomplete = function () {
      db.close();
    };
    tx.onerror = function () {
      db.close();
    };
    tx.onabort = function () {
      db.close();
    };
    return result;
  });
}

/* Writes resolve only once the transaction commits, so a crash cannot lose them. */
function write(action) {
  return openDatabase().then(function (db) {
    return new Promise(function (resolve, reject) {
      let tx;
      try {
        tx = db.transaction(STORE_NAME, 'readwrite');
      } catch (err) {
        db.close();
        reject(err);
        return;
      }
      try {
        action(tx.objectStore(STORE_NAME));
      } catch (err) {
        db.close();
        reject(err);
        return;
      }
      tx.oncomplete = function () {
        db.close();
        resolve();
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

/** True for a bare FileSystemFileHandle as written by the single-file builds. */
function isFileHandle(value) {
  return !!value && typeof value === 'object' && typeof value.getFile === 'function';
}

/**
 * Resolves every raw entry as `{ key, value }`, including a legacy bare handle
 * stored under LEGACY_HANDLE_KEY.
 */
function listRecords() {
  return read(function (store) {
    return Promise.all([
      requestToPromise(store.getAllKeys()),
      requestToPromise(store.getAll()),
    ]).then(function (results) {
      const keys = results[0];
      const values = results[1];
      return keys.map(function (key, index) {
        return { key: key, value: values[index] };
      });
    });
  });
}

/** Stores (or replaces) the record for `id`. */
function putRecord(id, value) {
  return write(function (store) {
    store.put(value, id);
  });
}

/** Removes the record for `id`. */
function deleteRecord(id) {
  return write(function (store) {
    store.delete(id);
  });
}

export { listRecords, putRecord, deleteRecord, LEGACY_HANDLE_KEY, isFileHandle };
