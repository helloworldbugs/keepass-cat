'use strict';

/*
 * LocalFileManager reads and writes .kdbx files in place through the File System
 * Access API.
 *
 * Platform notes:
 * - showOpenFilePicker() is Chrome-only. Nothing at module load touches it, so
 *   the Firefox bundle can contain this module without crashing.
 * - The File System Access API is unavailable in the MV3 background worker,
 *   so writes are performed by writeDatabase() in the popup/options page;
 *   uploadCurrentDatabase() exists only to complete the provider interface.
 * - Every FileSystemFileHandle lives in IndexedDB (see fileHandleStore.js) and
 *   its permission is re-checked before every read or write.
 *
 * Identity, and why there are three names per file:
 * - `id` is generated when the file is added and never changes. It is the
 *   IndexedDB record key and the `path` of the database choice, so a read or a
 *   write always knows which file it is dealing with. The provider can hold
 *   several files at once, so no code may assume "the" handle any more.
 * - `alias` is what the UI shows. The File System Access API exposes no path,
 *   only handle.name, so two files with the same name in different folders look
 *   identical to the browser; uniqueness is therefore enforced on the alias (a
 *   duplicate gets a numbered suffix when it is added).
 * - `cacheId` is the key the remembered master password and the database-usage
 *   record are stored under. New files use their id; a file migrated from the
 *   single-file builds keeps the name it was saved with, so that install does
 *   not lose its remembered password on upgrade.
 */

import {
  listRecords as listStoredRecords,
  putRecord as putStoredRecord,
  deleteRecord as deleteStoredRecord,
  LEGACY_HANDLE_KEY,
  isFileHandle,
} from './fileHandleStore.js';

const LOCAL_SERVER_ID = 'localfile';

// Persisted "provider switched on" flag. Without it the database picker kept offering
// the local file after the toggle was turned off, because listDatabases() only looked
// at the stored handles.
const ENABLED_KEY = 'localfile.enabled';

// IndexedDB cannot be read from the options page and the popup at the same
// moment without both agreeing on this shape, so keep the flag next to the data
// it describes.
const SELECTED_KEY = 'selectedDatabase';
// `{ [id]: { stamp, hash } }` - the baseline the write guard compares against.
const STAMPS_KEY = 'localfile.lastStamps';
// Single-file builds kept one baseline here; migrated on first load.
const LEGACY_STAMP_KEY = 'localfile.lastStamp';

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

function storageRemove(key) {
  return new Promise(function (resolve) {
    try {
      chrome.storage.local.remove(key, function () {
        resolve();
      });
    } catch (e) {
      resolve();
    }
  });
}

/*
 * The picker builds its filter from the extensions the OS associates with the MIME
 * type, and only falls back to the list below when the type has none. Chrome maps
 * `application/octet-stream` to everything registered for it on Windows - the
 * dialog then offered dozens of suffixes, .exe included - so a type nothing
 * registers is used here: the filter is just ".kdbx".
 */
const PICKER_TYPES = [
  {
    description: 'KeePass database',
    accept: { 'application/x-keepass-database': ['.kdbx'] },
  },
];

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

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for engines without randomUUID: good enough as an opaque key.
  return 'lf-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function stampFor(file) {
  return file.lastModified + ':' + file.size;
}

function sha256Hex(buffer) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) return Promise.resolve(null);
  return globalThis.crypto.subtle
    .digest('SHA-256', buffer)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    )
    .catch(() => null);
}

function permissionState(handle, mode) {
  if (!handle || typeof handle.queryPermission !== 'function') {
    return Promise.resolve('unsupported');
  }
  return handle.queryPermission({ mode: mode || 'readwrite' });
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
  // Loaded once per page; IndexedDB round trips are cheap but not free, and the
  // popup asks for the list on every open. `_loading` keeps two concurrent callers
  // (the popup asks for the list and the selected file at the same time) from
  // running the legacy migration twice.
  let _records = null;
  let _loading = null;

  const provider = {
    key: 'localfile',
    title: 'Local file',
    icon: 'icon-folder',
    chooseTitle: 'Local file',
    chooseDescription:
      'Open .kdbx files on this computer. Keepass Cat reads and writes each file in place, so changes made by other KeePass apps are detected before saving. Requires Chrome (File System Access API) and permission to access the files.',
    supportedFeatures: ['listDatabases'],
    // Settings screen
    listFiles: listFiles,
    addFiles: addFiles,
    removeFile: removeFile,
    getFilePermission: getFilePermission,
    // Picker interface shared with every other provider
    listDatabases: listDatabases,
    getDatabaseChoiceData: getDatabaseChoiceData,
    getChosenDatabaseFile: getChosenDatabaseFile,
    getChosenDatabaseFileIfChanged: getChosenDatabaseFileIfChanged,
    getPermissionState: getPermissionState,
    requestPermission: requestPermission,
    uploadCurrentDatabase: uploadCurrentDatabase,
    writeDatabase: writeDatabase,
    isEnabled: isEnabled,
    enable: function () {
      return setEnabled(true);
    },
    disable: function () {
      return setEnabled(false);
    },
    isSupported: isSupported,
  };

  function isEnabled() {
    return storageGet(ENABLED_KEY).then((items) => items[ENABLED_KEY] === true);
  }

  function setEnabled(value) {
    const payload = {};
    payload[ENABLED_KEY] = !!value;
    return storageSet(payload);
  }

  /* ------------------------------------------------------------------ records */

  function findById(records, id) {
    for (const record of records) {
      if (record.id === id) return record;
    }
    return null;
  }

  function loadRecords() {
    if (_records) return Promise.resolve(_records);
    if (_loading) return _loading;
    _loading = loadRecordsOnce().then(
      function (records) {
        _records = records;
        _loading = null;
        return records;
      },
      function (err) {
        _loading = null;
        throw err;
      }
    );
    return _loading;
  }

  /**
   * Resolves every stored file, migrating the single-file layout the first time.
   * Ordered by when the file was added, so the list is stable across sessions.
   */
  async function loadRecordsOnce() {
    const raw = await listStoredRecords();
    const records = [];
    let legacyHandle = null;

    for (const entry of raw) {
      if (isFileHandle(entry.value)) {
        // A bare handle: written by a single-file build under the fixed key.
        if (entry.key === LEGACY_HANDLE_KEY) legacyHandle = entry.value;
        continue;
      }
      if (entry.value && isFileHandle(entry.value.handle)) {
        records.push(Object.assign({ id: entry.key }, entry.value));
      }
    }

    if (legacyHandle) {
      const migrated = await migrateLegacyRecord(legacyHandle);
      if (migrated) records.push(migrated);
    }

    records.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));

    // A selection saved by a single-file build carries path 'localfile', which no
    // longer matches any record. Heal it here instead of failing on the next read.
    const selected = records.length === 1 ? records[0] : await selectedRecord(records);
    if (selected) await healSelection(selected);

    return records;
  }

  /**
   * Converts the one handle the single-file builds stored into an id-keyed record.
   * Its cacheId is kept as the old title because that is the prefix of the
   * remembered-password key those builds wrote.
   */
  async function migrateLegacyRecord(handle) {
    const id = newId();
    const name = handle.name || 'database.kdbx';
    const record = { id: id, cacheId: name, alias: name, addedAt: Date.now(), handle: handle };
    try {
      await putStoredRecord(id, record);
      await deleteStoredRecord(LEGACY_HANDLE_KEY);
    } catch (err) {
      // Leave the legacy record alone: the next open retries the migration.
      return null;
    }
    await migrateLegacyStamp(id);
    return record;
  }

  async function migrateLegacyStamp(id) {
    const items = await storageGet(LEGACY_STAMP_KEY);
    const legacy = items && items[LEGACY_STAMP_KEY];
    if (!legacy || typeof legacy !== 'object') return;
    const stamps = await readStamps();
    if (!stamps[id]) stamps[id] = legacy;
    const payload = {};
    payload[STAMPS_KEY] = stamps;
    await storageSet(payload);
    await storageRemove(LEGACY_STAMP_KEY);
  }

  /* The database choice persisted by settings.js, read directly to avoid a cycle. */
  async function readSelection() {
    const items = await storageGet(SELECTED_KEY);
    return (items && items[SELECTED_KEY]) || null;
  }

  async function selectedRecord(records) {
    const selected = await readSelection();
    if (!selected || selected.providerKey !== LOCAL_SERVER_ID) return null;
    return matchRecord(records, selected.passwordFile);
  }

  async function healSelection(record) {
    const selected = await readSelection();
    if (!selected || selected.providerKey !== LOCAL_SERVER_ID) return;
    const current = selected.passwordFile || {};
    if (
      current.path === record.id &&
      current.cacheId === record.cacheId &&
      current.title === record.alias
    ) {
      return;
    }
    const healed = Object.assign({}, selected);
    healed.passwordFile = Object.assign({}, current, {
      serverId: LOCAL_SERVER_ID,
      title: record.alias,
      path: record.id,
      cacheId: record.cacheId,
    });
    const payload = {};
    payload[SELECTED_KEY] = healed;
    await storageSet(payload);
  }

  /**
   * Finds the record a database choice points at. `path` is the id; the other two
   * lookups only exist so a choice written by a single-file build still resolves.
   */
  function matchRecord(records, dbInfo) {
    if (!dbInfo) return records[0] || null;
    const byId = dbInfo.path && findById(records, dbInfo.path);
    if (byId) return byId;
    if (dbInfo.cacheId) {
      const byCache = records.find((record) => record.cacheId === dbInfo.cacheId);
      if (byCache) return byCache;
    }
    if (dbInfo.title) {
      const byTitle = records.find((record) => record.alias === dbInfo.title);
      if (byTitle) return byTitle;
    }
    return null;
  }

  async function findRecord(dbInfo) {
    const records = await loadRecords();
    if (!records.length) return null;
    return matchRecord(records, dbInfo);
  }

  /* ------------------------------------------------------------------ stamps */

  async function readStamps() {
    const items = await storageGet(STAMPS_KEY);
    return (items && items[STAMPS_KEY]) || {};
  }

  async function readStamp(id) {
    const stamps = await readStamps();
    return stamps[id] || null;
  }

  async function writeStamp(id, value) {
    const stamps = await readStamps();
    if (value) stamps[id] = value;
    else delete stamps[id];
    const payload = {};
    payload[STAMPS_KEY] = stamps;
    await storageSet(payload);
  }

  /* -------------------------------------------------------------------- files */

  /**
   * Adds one or more .kdbx files. Files that are already in the list are skipped
   * (compared with isSameEntry), and files with a duplicate name get a numbered
   * alias so the UI can tell them apart.
   */
  async function addFiles() {
    assertSupported();
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        types: PICKER_TYPES,
        multiple: true,
        excludeAcceptAllOption: false,
      });
    } catch (err) {
      // Dismissing the picker is a no-op, not a failure to report.
      if (err && (err.name === 'AbortError' || err.code === 20)) return [];
      throw err;
    }

    const records = await loadRecords();
    const added = [];

    for (const handle of handles || []) {
      if (!handle) continue;
      if (await isAlreadyAdded(handle, records)) continue;

      const id = newId();
      const record = {
        id: id,
        cacheId: id,
        alias: uniqueAlias(handle.name || 'database.kdbx', records),
        addedAt: Date.now(),
        handle: handle,
      };
      await putStoredRecord(id, record);
      records.push(record);
      added.push(record);

      /*
       * The picker hands back read permission only, and asking for write later
       * needs another click in the middle of a save. Asking here means Chrome's
       * "save changes to ...?" dialog appears once per file while the user is
       * deliberately picking files, and a later save never interrupts. That many
       * dialogs is the intended trade; getWritableHandle() is only the fallback
       * for a grant that was declined or has since expired.
       */
      try {
        await handle.requestPermission({ mode: 'readwrite' });
      } catch (e) {
        // Ignore: reads still work, writes surface the coded error.
      }
    }

    _records = records;
    return added;
  }

  async function isAlreadyAdded(handle, records) {
    if (typeof handle.isSameEntry !== 'function') return false;
    for (const record of records) {
      try {
        if (await handle.isSameEntry(record.handle)) return true;
      } catch (e) {
        // A handle the browser refuses to compare is not a reason to skip adding.
      }
    }
    return false;
  }

  /**
   * Forces the alias to be unique inside the provider. The API gives no path, so
   * this is the only thing that keeps two same-named files distinguishable, and
   * the same alias also becomes the database route (/unlock/localfile/<alias>).
   */
  function uniqueAlias(name, records) {
    const taken = new Set(records.map((record) => record.alias));
    if (!taken.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; n < 1000; n++) {
      const candidate = stem + ' (' + n + ')' + extension;
      if (!taken.has(candidate)) return candidate;
    }
    return stem + ' (' + Date.now() + ')' + extension;
  }

  async function listFiles() {
    const records = await loadRecords();
    return records.map((record) => ({
      id: record.id,
      alias: record.alias,
      cacheId: record.cacheId,
      addedAt: record.addedAt,
    }));
  }

  async function getFilePermission(id) {
    const records = await loadRecords();
    const record = findById(records, id);
    if (!record) return 'none';
    return permissionState(record.handle, 'read');
  }

  async function removeFile(id) {
    const records = await loadRecords();
    const record = findById(records, id);
    if (!record) return;
    records.splice(records.indexOf(record), 1);
    await deleteStoredRecord(id);
    await writeStamp(id, null);
    _records = records;
  }

  /* ------------------------------------------------------------------ handles */

  /*
   * Resolves the handle only when read permission is already granted. A handle from
   * showOpenFilePicker starts with read; write must be requested separately, so
   * requiring readwrite here would block the very first read after picking a file.
   * The rejection carries a stable code so a caller can offer re-authorisation.
   */
  async function getReadableHandle(record) {
    if (!record) {
      throw new Error('No local file selected. Choose a .kdbx file first.');
    }
    const state = await ensurePermission(record.handle, 'read');
    if (state !== 'granted') {
      const err = new Error(
        'Permission to read the local file was not granted. Re-authorise the file to continue.'
      );
      err.code = 'localfile-permission-required';
      throw err;
    }
    return record.handle;
  }

  /* Writing needs the stronger grant; the UI offers a button that requests it. */
  async function getWritableHandle(record) {
    const handle = await getReadableHandle(record);
    const state = await ensurePermission(handle, 'readwrite');
    if (state === 'granted') return handle;
    const err = new Error(
      'Permission to write the local file was not granted. Re-authorise the file to continue.'
    );
    err.code = 'localfile-permission-required';
    throw err;
  }

  /* ------------------------------------------------------- picker interface */

  /**
   * Resolves Object:[]DBInfo, one entry per stored file. The files are exposed
   * through the same picker interface every other provider implements.
   */
  async function listDatabases() {
    // Firefox has no File System Access API: report no databases instead of failing,
    // otherwise Startup's Promise.all() over every provider rejects and the popup stays
    // blank.
    if (!isSupported()) return [];
    if (!(await isEnabled())) return [];
    const records = await loadRecords();
    return records.map(dbInfoFor);
  }

  function dbInfoFor(record) {
    return {
      provider: provider,
      title: record.alias,
      path: record.id,
      serverId: LOCAL_SERVER_ID,
      cacheId: record.cacheId,
    };
  }

  // Same identity shape as webdavFileManager.getDatabaseChoiceData().
  function getDatabaseChoiceData(dbInfo) {
    return {
      serverId: dbInfo.serverId,
      title: dbInfo.title,
      path: dbInfo.path,
      cacheId: dbInfo.cacheId,
    };
  }

  /*
   * Permission state for the UI. Checks *read*, not readwrite: Chrome persists the
   * read grant and expects a fresh gesture for write. Checking readwrite made every
   * popup open look unauthorised and pushed the grant button at the user each time.
   */
  async function getPermissionState(dbInfo) {
    const record = await findRecord(dbInfo);
    if (!record) return 'none';
    return permissionState(record.handle, 'read');
  }

  async function requestPermission(dbInfo) {
    const record = await findRecord(dbInfo);
    if (!record) {
      throw new Error('No local file selected. Choose a .kdbx file first.');
    }
    if (typeof record.handle.requestPermission !== 'function') {
      throw new Error(
        'This browser cannot request file permissions. Use Chrome or another browser with the File System Access API.'
      );
    }
    return record.handle.requestPermission({ mode: 'readwrite' });
  }

  /**
   * Returns Promise -> ArrayBuffer.
   */
  async function getChosenDatabaseFile(dbInfo) {
    const record = await findRecord(dbInfo);
    const handle = await getReadableHandle(record);
    const file = await handle.getFile();
    const data = await file.arrayBuffer();
    await writeStamp(record.id, { stamp: stampFor(file), hash: await sha256Hex(data) });
    return data;
  }

  /**
   * Conditional read for keepassService.refreshIfChanged().
   * Returns Promise -> { data: null } when the stamp is unchanged, otherwise
   * { data: ArrayBuffer, etag: <new stamp> }.
   */
  async function getChosenDatabaseFileIfChanged(dbInfo, stamp) {
    const record = await findRecord(dbInfo);
    const handle = await getReadableHandle(record);
    const file = await handle.getFile();
    const newStamp = stampFor(file);
    if (stamp && newStamp === stamp) return { data: null };
    const data = await file.arrayBuffer();
    await writeStamp(record.id, { stamp: newStamp, hash: await sha256Hex(data) });
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
   *
   * The baseline is per file and persisted, so the guard still works in a popup
   * that was reopened from the entry cache and never read the file itself.
   */
  async function writeDatabase(arrayBuffer, dbInfo) {
    const record = await findRecord(dbInfo);
    const handle = await getWritableHandle(record);
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
    const previous = await readStamp(record.id);
    const knownHash = (previous && previous.hash) || null;
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
    await writeStamp(record.id, { stamp: stampFor(updated), hash: await sha256Hex(arrayBuffer) });
    return updated.size;
  }

  return provider;
}

export { LocalFileManager };
