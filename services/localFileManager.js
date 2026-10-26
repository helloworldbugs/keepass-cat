'use strict';

/*
 * LocalFileManager reads and writes a single .kdbx file in place through the
 * File System Access API.
 *
 * Platform notes:
 * - showOpenFilePicker() is Chrome-only. Nothing at module load touches it, so
 *   the Firefox bundle can contain this module without crashing.
 * - The File System Access API is unavailable in the MV3 background worker,
 *   so writes are performed by writeDatabase() in the popup/options page;
 *   uploadCurrentDatabase() exists only to complete the provider interface.
 * - The FileSystemFileHandle lives in IndexedDB (see fileHandleStore.js) and
 *   its readwrite permission is re-checked before every read or write.
 */

import {
  get as getStoredHandle,
  set as setStoredHandle,
  clear as clearStoredHandle,
} from './fileHandleStore.js';

const LOCAL_SERVER_ID = 'localfile';
// Persisted "provider switched on" flag. Without it the database picker kept offering
// the local file after the toggle was turned off, because listDatabases() only looked
// at the stored handle.
const ENABLED_KEY = 'localfile.enabled';

/*
 * Callback-based on purpose: the chrome.* namespace does not reliably return promises
 * in Firefox, and this module is imported by the popup on both browsers.
 */
function storageGet(key) {
  return new Promise(function (resolve) {
    try {
      chrome.storage.local.get(key, function (items) {
        resolve(items || {});
      });
    } catch (e) {
      resolve({});
    }
  });
}

function storageSet(payload) {
  return new Promise(function (resolve) {
    try {
      chrome.storage.local.set(payload, function () {
        resolve();
      });
    } catch (e) {
      resolve();
    }
  });
}

function isEnabled() {
  return storageGet(ENABLED_KEY).then((items) => items[ENABLED_KEY] === true);
}

function setEnabled(value) {
  const payload = {};
  payload[ENABLED_KEY] = !!value;
  return storageSet(payload);
}

const PICKER_TYPES = [
  {
    description: 'KeePass database',
    accept: { 'application/octet-stream': ['.kdbx'] },
  },
];

/*
 * Per-page memory. `_lastReadStamp` is the '<lastModified>:<size>' of the bytes this
 * page last read and `_lastReadHash` is their SHA-256. The hash is the guard that
 * matters: an external KeePass save often keeps the size and can keep the coarse
 * filesystem timestamp, so the stamp alone is not proof that nothing changed.
 */
let _handleCache = null;
let _handleLoaded = false;
let _lastReadStamp = null;
let _lastReadHash = null;

function isSupported() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

function assertSupported() {
  if (!isSupported()) {
    throw new Error(
      'Local file access is not supported in this browser. Use Chrome or another browser with the File System Access API.'
    );
  }
}

function getHandle() {
  if (_handleLoaded) return Promise.resolve(_handleCache);
  return getStoredHandle().then(function (handle) {
    _handleCache = handle;
    _handleLoaded = true;
    return handle;
  });
}

function resetHandleCache() {
  _handleCache = null;
  _handleLoaded = false;
  _lastReadStamp = null;
}

function permissionState(handle, mode) {
  if (!handle || typeof handle.queryPermission !== 'function') {
    return Promise.resolve('unsupported');
  }
  return handle.queryPermission({ mode: mode || 'readwrite' });
}

/*
 * Resolves the handle only when read permission is already granted. A handle from
 * showOpenFilePicker starts with read; write must be requested separately, so
 * requiring readwrite here would block the very first read after picking a file.
 * The rejection carries a stable code so a caller can offer re-authorisation.
 */
function getReadableHandle() {
  return getHandle().then(function (handle) {
    if (!handle) {
      throw new Error('No local file selected. Choose a .kdbx file first.');
    }
    return ensurePermission(handle, 'read').then(function (state) {
      if (state !== 'granted') {
        const err = new Error(
          'Permission to read the local file was not granted. Re-authorise the file to continue.'
        );
        err.code = 'localfile-permission-required';
        throw err;
      }
      return handle;
    });
  });
}

/* Writing needs the stronger grant; the UI offers a button that requests it. */
function getWritableHandle() {
  return getReadableHandle().then(function (handle) {
    return ensurePermission(handle, 'readwrite').then(function (state) {
      if (state === 'granted') return handle;
      const err = new Error(
        'Permission to write the local file was not granted. Re-authorise the file to continue.'
      );
      err.code = 'localfile-permission-required';
      throw err;
    });
  });
}

function stampFor(file) {
  return file.lastModified + ':' + file.size;
}

/*
 * The baseline the write guard compares against, persisted so it survives the popup
 * being closed (a popup that reopens from the entry cache has no in-memory stamp).
 */
const STAMP_KEY = 'localfile.lastStamp';

function sha256Hex(buffer) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) return Promise.resolve(null);
  return globalThis.crypto.subtle
    .digest('SHA-256', buffer)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    )
    .catch(() => null);
}

function readPersistedStamp() {
  return chrome.storage.local
    .get(STAMP_KEY)
    .then((items) => items[STAMP_KEY] || null)
    .catch(() => null);
}

function persistStamp(record) {
  // Keep the in-memory baseline in step with what was persisted.
  _lastReadHash = (record && record.hash) || _lastReadHash;
  const payload = {};
  payload[STAMP_KEY] = record;
  return chrome.storage.local.set(payload).catch(() => {});
}

/*
 * Read/write need a grant, and a popup is a new document on every open, so the grant
 * is usually still 'prompt'. Asking here (the save/unlock click is the activation)
 * avoids a dead end: without it a save after a browser restart failed with a
 * permission error and no prompt.
 */
async function ensurePermission(handle, mode) {
  if (!handle || typeof handle.queryPermission !== 'function') return 'unsupported';
  let state = await handle.queryPermission({ mode });
  if (state === 'granted') return state;
  if (state === 'prompt' && typeof handle.requestPermission === 'function') {
    try {
      state = await handle.requestPermission({ mode });
    } catch (err) {
      // Declined, or the activation was already consumed; the caller reports it.
    }
  }
  return state;
}

function LocalFileManager() {
  const provider = {
    key: 'localfile',
    title: 'Local file',
    icon: 'icon-folder',
    chooseTitle: 'Local file',
    chooseDescription:
      'Open a .kdbx file on this computer. Keepass Cat reads and writes the same file in place, so changes made by other KeePass apps are detected before saving. Requires Chrome (File System Access API) and permission to access the file.',
    supportedFeatures: ['listDatabases'],
    login: login,
    logout: logout,
    isLoggedIn: isLoggedIn,
    isEnabled: isEnabled,
    enable: function () {
      return setEnabled(true);
    },
    disable: function () {
      return setEnabled(false);
    },
    isSupported: isSupported,
    listDatabases: listDatabases,
    getDatabaseChoiceData: getDatabaseChoiceData,
    getChosenDatabaseFile: getChosenDatabaseFile,
    getChosenDatabaseFileIfChanged: getChosenDatabaseFileIfChanged,
    getPermissionState: getPermissionState,
    requestPermission: requestPermission,
    uploadCurrentDatabase: uploadCurrentDatabase,
    writeDatabase: writeDatabase,
  };

  /**
   * Opens the file picker, remembers the chosen handle, and resolves it.
   * Resolves null when the user cancels the picker.
   */
  async function login() {
    assertSupported();
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        types: PICKER_TYPES,
        multiple: false,
        excludeAcceptAllOption: false,
      });
    } catch (err) {
      // Dismissing the picker is a no-op, not a failure to report.
      if (err && (err.name === 'AbortError' || err.code === 20)) return null;
      throw err;
    }
    const handle = handles && handles[0];
    if (!handle) return null;
    await setStoredHandle(handle);
    _handleCache = handle;
    _handleLoaded = true;
    _lastReadStamp = null;
    // Ask for write access right away: the picker hands back read permission only,
    // and requesting it later needs another click. Best effort - if the browser
    // refuses, the "Re-authorise" button still covers it.
    try {
      await handle.requestPermission({ mode: 'readwrite' });
    } catch (e) {
      // Ignore: reads still work, writes surface the coded error.
    }
    return handle;
  }

  function logout() {
    resetHandleCache();
    return clearStoredHandle();
  }

  function isLoggedIn() {
    return getHandle()
      .then(function (handle) {
        return !!handle;
      })
      .catch(function () {
        // IndexedDB being unavailable must look like "not logged in", not throw.
        return false;
      });
  }

  /**
   * Resolves Object:[]DBInfo. The chosen file is exposed through the same
   * picker interface every other provider implements.
   */
  async function listDatabases() {
    // Firefox has no File System Access API: report no databases instead of failing,
    // otherwise Startup's Promise.all() over every provider rejects and the popup stays
    // blank.
    if (!isSupported()) return [];
    if (!(await isEnabled())) return [];
    const handle = await getHandle();
    if (!handle) return [];
    return [
      {
        provider: provider,
        title: handle.name,
        path: LOCAL_SERVER_ID,
        serverId: LOCAL_SERVER_ID,
      },
    ];
  }

  // Same identity shape as webdavFileManager.getDatabaseChoiceData().
  function getDatabaseChoiceData(dbInfo) {
    return {
      serverId: dbInfo.serverId,
      title: dbInfo.title,
      path: dbInfo.path,
    };
  }

  /*
   * Permission state for the UI. Checks *read*, not readwrite: Chrome persists the
   * read grant and expects a fresh gesture for write. Checking readwrite made every
   * popup open look unauthorised and pushed the grant button at the user each time.
   */
  function getPermissionState() {
    return getHandle().then(function (handle) {
      if (!handle) return 'none';
      return permissionState(handle, 'read');
    });
  }

  function requestPermission() {
    return getHandle().then(function (handle) {
      if (!handle) {
        throw new Error('No local file selected. Choose a .kdbx file first.');
      }
      if (typeof handle.requestPermission !== 'function') {
        throw new Error(
          'This browser cannot request file permissions. Use Chrome or another browser with the File System Access API.'
        );
      }
      return handle.requestPermission({ mode: 'readwrite' });
    });
  }

  /**
   * Returns Promise -> ArrayBuffer.
   */
  async function getChosenDatabaseFile() {
    const handle = await getReadableHandle();
    const file = await handle.getFile();
    const data = await file.arrayBuffer();
    _lastReadStamp = stampFor(file);
    persistStamp({ stamp: _lastReadStamp, hash: await sha256Hex(data) });
    return data;
  }

  /**
   * Conditional read for keepassService.refreshIfChanged().
   * Returns Promise -> { data: null } when the stamp is unchanged, otherwise
   * { data: ArrayBuffer, etag: <new stamp> }.
   */
  async function getChosenDatabaseFileIfChanged(dbInfo, stamp) {
    const handle = await getReadableHandle();
    const file = await handle.getFile();
    const newStamp = stampFor(file);
    if (stamp && newStamp === stamp) {
      _lastReadStamp = newStamp;
      return { data: null };
    }
    const data = await file.arrayBuffer();
    _lastReadStamp = newStamp;
    persistStamp({ stamp: newStamp, hash: await sha256Hex(data) });
    return { data: data, etag: newStamp };
  }

  /*
   * Interface completeness only. The background service worker cannot use the
   * File System Access API, so the in-page writeDatabase() is the real path.
   */
  function uploadCurrentDatabase() {
    return Promise.reject(
      new Error(
        'Local file writes are handled by the browser page, not the background service worker.'
      )
    );
  }

  /**
   * In-page write used by keepassService.uploadDatabase(). Refuses to write when
   * the file changed since this page last read it, then updates the stamp from
   * the file that was actually written.
   */
  async function writeDatabase(arrayBuffer) {
    const handle = await getWritableHandle();
    const file = await handle.getFile();

    /*
     * Compare the bytes, not just the metadata. A KeePass client rewrites the whole
     * database, and the result is frequently the *same size* as before; NTFS
     * timestamps are coarse as well, so a <lastModified>:<size> stamp can be identical
     * after an external save and the guard silently passed - the extension then
     * overwrote the other client's edit.
     */
    const currentBytes = await file.arrayBuffer();
    const currentHash = await sha256Hex(currentBytes);
    const previous = await readPersistedStamp();
    const knownHash = _lastReadHash || (previous && previous.hash) || null;
    if (knownHash && currentHash && knownHash !== currentHash) {
      throw new Error(
        'The file was modified outside Keepass Cat since it was opened. Save cancelled; reopen the database and try again.'
      );
    }

    const writable = await handle.createWritable();
    try {
      await writable.write(arrayBuffer);
      await writable.close();
    } catch (err) {
      try {
        await writable.abort();
      } catch {
        // The write error is the useful one; abort is best effort.
      }
      throw err;
    }

    const updated = await handle.getFile();
    await persistStamp({ stamp: stampFor(updated), hash: await sha256Hex(arrayBuffer) });
    return updated.size;
  }

  return provider;
}

export { LocalFileManager };
