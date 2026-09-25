'use strict';
/**
 * Service for opening keepass files
 */
import * as Base64 from 'base64-arraybuffer';
import * as Case from 'case';
// import pako from 'pako'
import * as kdbxweb from 'kdbxweb';
import argon2 from 'argon2-browser/dist/argon2-bundled.min.js';
import { i18n } from '@/services/i18n';

kdbxweb.CryptoEngine.setArgon2Impl(
  (password, salt, memory, iterations, length, parallelism, type, version) => {
    console.log('Using argon2 implementation', version);
    return argon2
      .hash({
        pass: new Uint8Array(password),
        salt: new Uint8Array(salt),
        time: iterations,
        mem: memory,
        hashLen: length,
        parallelism,
        type,
        version,
      })
      .then((v) => v.hash);
  }
);

import { parseUrl, matchLevel } from '@/lib/utils.js';

/*
 * KDBX stores its built-in entry fields under exact, capitalized keys:
 * `Title`, `UserName`, `Password`, `URL` and `Notes`. The extension's UI and
 * parsed entries use lowerCamelCase keys, so every write MUST translate them
 * before touching the kdbxweb fields Map. Writing `title` verbatim makes KeePass
 * treat it as a *custom* string field and leaves the built-in Title empty/stale.
 * `otp` is intentionally NOT capitalized: KeePass's built-in TOTP reads the
 * lowercase `otp` custom field. Unknown keys pass through unchanged so callers
 * can still write arbitrary custom fields.
 */
const KDBX_FIELD_NAMES = {
  title: 'Title',
  userName: 'UserName',
  password: 'Password',
  url: 'URL',
  notes: 'Notes',
  otp: 'otp',
  keepassCatTotpEnabled: 'keepassCatTotpEnabled',
};

/* KDBX field names whose values are stored as kdbxweb ProtectedValues. */
const KDBX_PROTECTED_FIELDS = ['Password', 'otp', 'tOTPSeed'];

/*
 * Legacy lowerCamel twins written by older buggy saves. Writing a built-in
 * field also removes its twin so that re-saving an already-polluted entry
 * repairs it. Only the five built-in fields are listed here; arbitrary custom
 * fields are never touched by this cleanup.
 */
const KDBX_LEGACY_FIELD_TWINS = {
  Title: 'title',
  UserName: 'userName',
  Password: 'password',
  URL: 'url',
  Notes: 'notes',
};

/*
 * Custom string fields the extension itself reads/writes (TOTP plus the extra
 * reference URLs used by keepassReference.js). They are never user-editable:
 * excluded from the custom-field list and impossible to write or delete through
 * the custom-field path, even if the UI asks.
 */
const KDBX_OWNED_FIELDS = ['otp', 'keepassCatTotpEnabled', 'keepassCatUrls'];

/*
 * The built-in KDBX field names and their legacy lowerCamel twins, derived from
 * the twin map so this guard can never drift from the repair logic. They are
 * managed only by setKdbxEntryField and must not surface through the
 * custom-field list. The five built-ins AND their twins are reserved: neither is
 * writable/deletable through the custom-field path, so a custom field named
 * `title` can never collide with (or be silently folded onto) the built-in on
 * the next parse.
 */
const KDBX_BUILTIN_FIELD_NAMES = Object.keys(KDBX_LEGACY_FIELD_TWINS);
const KDBX_BUILTIN_TWIN_NAMES = Object.values(KDBX_LEGACY_FIELD_TWINS);

function isOwnedKdbxField(name) {
  return KDBX_OWNED_FIELDS.indexOf(name) >= 0;
}

function isBuiltinKdbxField(name) {
  return KDBX_BUILTIN_FIELD_NAMES.indexOf(name) >= 0;
}

function isTwinKdbxField(name) {
  return KDBX_BUILTIN_TWIN_NAMES.indexOf(name) >= 0;
}

/* Names that must never appear in the custom-field list. */
function isHiddenCustomFieldName(name) {
  return isOwnedKdbxField(name) || isBuiltinKdbxField(name) || isTwinKdbxField(name);
}

/*
 * Names the custom-field path must never write or delete: the extension-owned
 * fields, the five KDBX built-ins and their legacy lowerCamel twins. The twins
 * are reserved alongside the built-ins because the parse-path repair
 * (migrateLegacyFieldTwins) folds any `title` field onto `Title`, so storing a
 * custom field under a twin name would corrupt the built-in on reload. Twin
 * names are written by the built-in path (setKdbxEntryField) only.
 */
function isBlockedCustomFieldName(name) {
  return isOwnedKdbxField(name) || isBuiltinKdbxField(name) || isTwinKdbxField(name);
}

function isProtectedKdbxValue(value) {
  return (
    value instanceof kdbxweb.ProtectedValue ||
    (!!value && typeof value === 'object' && typeof value.getText === 'function')
  );
}

/* Decrypts a live kdbxweb field value for the edit form (memory only). */
function readKdbxFieldValue(value) {
  if (isProtectedKdbxValue(value)) return value.getText();
  if (value === null || value === undefined) return '';
  return String(value);
}

/*
 * Writes a single field onto a kdbxweb entry, translating the extension's
 * lowerCamelCase key to KDBX's built-in name, applying protection for secret
 * fields, deleting on null/undefined, and dropping any legacy lowerCamel twin
 * of the built-in field just written.
 */
function setKdbxEntryField(kdbxEntry, key, value) {
  var mappedKey = KDBX_FIELD_NAMES[key] || key;
  if (value === null || value === undefined) {
    kdbxEntry.fields.delete(mappedKey);
  } else if (KDBX_PROTECTED_FIELDS.indexOf(mappedKey) >= 0) {
    kdbxEntry.fields.set(mappedKey, kdbxweb.ProtectedValue.fromString(value));
  } else {
    kdbxEntry.fields.set(mappedKey, value);
  }
  var legacyTwin = KDBX_LEGACY_FIELD_TWINS[mappedKey];
  if (legacyTwin) kdbxEntry.fields.delete(legacyTwin);
}

/*
 * One-way repair of data written by the older buggy save path. A polluted
 * entry carries both a KDBX built-in field (e.g. `Title`) and a legacy
 * lowerCamel twin (e.g. `title`); the twin's value is what the extension has
 * been displaying, so move it onto the built-in key as-is (never re-wrapping a
 * ProtectedValue) and drop the twin. Only the five built-in fields are touched.
 * This mutates the in-memory entry only: it is persisted by the next
 * `_db.save()`, never by a save of its own. Idempotent — once the twins are
 * gone a second run is a no-op. Returns true if the entry was repaired.
 */
function migrateLegacyFieldTwins(db_entry) {
  var repaired = false;
  for (var builtIn in KDBX_LEGACY_FIELD_TWINS) {
    var twin = KDBX_LEGACY_FIELD_TWINS[builtIn];
    if (db_entry.fields.has(twin)) {
      db_entry.fields.set(builtIn, db_entry.fields.get(twin));
      db_entry.fields.delete(twin);
      repaired = true;
    }
  }
  return repaired;
}

/*
 * Writes a user-defined custom string field under the EXACT name the user gave.
 * Deliberately does no key mapping and no legacy-twin deletion: it only ever
 * touches a genuinely user-owned name. Extension-owned names, the five KDBX
 * built-ins and their legacy lowerCamel twins are reserved, so a write under
 * any of them is ignored silently (never written, and never folded onto a
 * built-in by the next parse). The caller's isProtected flag is the single
 * source of truth: a truthy flag stores the value as a ProtectedValue, a falsy
 * flag stores it as plain text. The flag therefore wins over the field's prior
 * state, so the user can un-protect an existing protected field by unticking
 * the checkbox. Returns true if it acted.
 */
function setKdbxCustomField(kdbxEntry, name, value, isProtected) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (isBlockedCustomFieldName(name)) return false;
  if (value === null || value === undefined) {
    kdbxEntry.fields.delete(name);
    return true;
  }
  // Normalize to text, even if a caller hands us a live ProtectedValue, so the
  // caller's isProtected flag alone decides the stored representation.
  var text = isProtectedKdbxValue(value) ? value.getText() : String(value);
  var stored = isProtected ? kdbxweb.ProtectedValue.fromString(text) : text;
  kdbxEntry.fields.set(name, stored);
  return true;
}

/*
 * Deletes a user-defined custom field by its exact name. Extension-owned names,
 * the five built-ins and their legacy lowerCamel twins are ignored silently so
 * the custom-field path can never clobber the fields the extension (or KDBX
 * itself) owns.
 */
function deleteKdbxCustomField(kdbxEntry, name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (isBlockedCustomFieldName(name)) return false;
  kdbxEntry.fields.delete(name);
  return true;
}

function KeepassService(keepassHeader, settings, passwordFileStoreRegistry, keepassReference) {
  var my = {};
  var _db = null; // raw kdbx db reference for save operations
  var _masterKey = null; // master key for save operations

  /* Shared helper: recursively find a group by name */
  function findGroup(groups, name) {
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].name === name) return groups[i];
      var found = findGroup(groups[i].groups, name);
      if (found) return found;
    }
    return null;
  }

  /*
   * Shared helper: find the RAW kdbxweb entry by the extension's UUID string
   * (same lookup saveEntry has always used). Used instead of the parsed entry so
   * protected values are only ever decrypted on demand, never stored in the
   * parsed/cached shape.
   */
  function findKdbxEntryById(id) {
    function findInGroup(group) {
      for (let e of group.entries) {
        if (e.uuid && !e.uuid.empty) {
          let eid = convertArrayToUUID(Base64.decode(e.uuid.id));
          if (eid === id) return e;
        }
      }
      for (let sub of group.groups) {
        let found = findInGroup(sub);
        if (found) return found;
      }
      return null;
    }
    if (!_db) return null;
    for (let g of _db.groups) {
      let found = findInGroup(g);
      if (found) return found;
    }
    return null;
  }

  /**
   * return Promise(arrayBufer)
   */
  my.getChosenDatabaseFile = function () {
    return passwordFileStoreRegistry.getChosenDatabaseFile(settings);
  };

  my.getMasterKey = function (bufferPromise, masterPassword, keyFileInfo) {
    /**
     * Validate that one of the following is true:
     * (password isn't empty OR keyfile isn't empty)
     * ELSE
     * (assume password is the empty string)
     */
    let protectedMasterPassword;
    if (masterPassword === undefined && keyFileInfo === undefined) {
      // Neither keyfile nor password provided.  Assume empty string password.
      protectedMasterPassword = kdbxweb.ProtectedValue.fromString('');
    } else if (masterPassword === '' && keyFileInfo !== undefined) {
      // Keyfile but empty password provided.  Assume password is unused.
      // This extension does not support the combo empty string + keyfile.
      protectedMasterPassword = null;
    } else {
      protectedMasterPassword = kdbxweb.ProtectedValue.fromString(masterPassword);
    }
    var fileKey = keyFileInfo ? Base64.decode(keyFileInfo.encodedKey) : null;
    return bufferPromise.then(function (buf) {
      var h = keepassHeader.readHeader(buf);
      return getKey(h.kdbx, protectedMasterPassword, fileKey);
    });
  };

  my.getDecryptedData = function (bufferPromise, masterKey) {
    var majorVersion;
    return bufferPromise
      .then(function (buf) {
        var h = keepassHeader.readHeader(buf);
        if (!h) throw new Error(i18n.t('Failed to read file header'));

        if (h.kdbx) {
          // KDBX - use kdbxweb library
          _masterKey = masterKey; // store for save operations
          var kdbxCreds = jsonCredentialsToKdbx(masterKey);
          return kdbxweb.Kdbx.load(buf, kdbxCreds).then((db) => {
            _db = db; // store for save operations
            var entries = parseKdbxDb(db.groups);
            majorVersion = db.header.versionMajor;
            return processReferences(entries, majorVersion);
          });
        } else {
          // KDB - we don't support this anymore
          throw 'Unsupported Database Version';
        }
      })
      .then(function (entries) {
        return {
          entries: entries,
          version: majorVersion,
        };
      });
  };

  my.rankEntries = (entries, siteUrl) => {
    entries.forEach(function (entry) {
      var level = matchLevel(siteUrl.href, entry);
      // Also check keepassCatUrls field for additional URL matches
      if (level === 0 && entry.keys && entry.keys.indexOf('keepassCatUrls') >= 0) {
        var urls = entry.keepassCatUrls.split(',');
        for (var i = 0; i < urls.length; i++) {
          var altLevel = matchLevel(siteUrl.href, { url: urls[i].trim() });
          if (altLevel > level) level = altLevel;
        }
      }
      entry.matchRank = level * 25; // 100, 75, 50, 25 for levels 4,3,2,1
    });
  };

  function getKey(isKdbx, protectedMasterPassword, fileKey) {
    var creds = new kdbxweb.Credentials(protectedMasterPassword, fileKey);
    return creds.ready.then(() => {
      return kdbxCredentialsToJson(creds);
    });
  }

  function processReferences(entries, majorVersion) {
    // In order to fully implement references, majorVersion will need to be known
    // as there are more capabilities for references in v2+
    entries.forEach(function (entry) {
      if (entry.keys) {
        entry.keys.forEach(function (key) {
          var fieldRefs = keepassReference.hasReferences(entry[key]);
          if (fieldRefs) {
            let value = keepassReference.processAllReferences(
              majorVersion,
              entry[key],
              entry,
              entries
            );
            if (['password', 'otp'].indexOf(key) >= 0) {
              let newProtectedVal = kdbxweb.ProtectedValue.fromString(value);
              entry.protectedData[Case.camel(key)] = protectedValueToJSON(newProtectedVal);
              delete entry[key];
            } else {
              entry[key] = value;
            }
          }
        });
      }
    });
    return entries;
  }

  /*
   * Applies a single kdbxweb entry field onto the parsed entry object,
   * camel-casing the key exactly as before. Protected values go to
   * entry.protectedData, plain values to entry keys.
   */
  function addParsedKdbxField(entry, key, field) {
    const camelKey = Case.camel(key);
    if (typeof field === 'object') {
      // type = object ? protected value
      entry.protectedData[camelKey] = protectedValueToJSON(field);
    } else {
      entry.keys.push(camelKey);
      entry[camelKey] = field;
    }
  }

  /*
   * Takes a kdbxweb group object and transforms it into a list of entries.
   **/
  function parseKdbxDb(groups, repairCounter) {
    var isTopLevel = repairCounter === undefined;
    if (isTopLevel) repairCounter = { count: 0 };
    var results = [];
    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      if (group.groups.length > 0) {
        // recursive case for subgroups.
        results = results.concat(parseKdbxDb(group.groups, repairCounter));
      }
      for (var j = 0; j < group.entries.length; j++) {
        var db_entry = group.entries[j];
        var entry = {
          protectedData: {},
          keys: [],
        };
        // Entry properties defined by the parent group
        entry.searchable = true;
        if (group.enableSearching === false) entry.searchable = false;
        entry.groupIconId = group.icon;
        entry.keys.push('groupName');
        entry.groupName = group.name;
        if (entry.searchable) results.push(entry);
        // Entry properties defined by the entry
        if (db_entry.uuid) {
          if (db_entry.uuid.empty == false)
            entry.id = convertArrayToUUID(Base64.decode(db_entry.uuid.id));
        }
        if (db_entry.icon) entry.iconId = db_entry.icon;
        if (db_entry.tags.length > 0) {
          //verify
          var tagstring = '';
          for (let k = 0; k < db_entry.tags.length; k++) {
            tagstring += db_entry.tags[k] + ',';
          }
          entry.tags = tagstring;
          entry.keys.push('tags');
        }
        if (db_entry.fields) {
          /*
           * One-way repair of entries polluted by the older buggy save path.
           * Runs before parsing so the migrated (twin) value is what gets read.
           * Only mutates memory; the next `_db.save()` persists it.
           */
          if (migrateLegacyFieldTwins(db_entry)) repairCounter.count++;
          /*
           * `Case.camel` collapses `Title` and its legacy lowerCamel twin
           * `title` onto the same output key. Older buggy saves wrote the twin
           * (e.g. `title`) as a custom field, and that twin's value is what the
           * extension has always displayed, so it must keep winning. Resolve
           * this explicitly: apply the built-in keys first, then the legacy
           * twins, instead of relying on Map insertion order. Normalization
           * above removes the twins, so this is now only a safety net.
           */
          const legacyTwinNames = Object.values(KDBX_LEGACY_FIELD_TWINS);
          for (const [key, field] of db_entry.fields) {
            if (legacyTwinNames.indexOf(key) >= 0) continue;
            addParsedKdbxField(entry, key, field);
          }
          for (const [key, field] of db_entry.fields) {
            if (legacyTwinNames.indexOf(key) < 0) continue;
            addParsedKdbxField(entry, key, field);
          }
        }
        if (db_entry.times) {
          if (db_entry.times.expires) {
            let expiry_date = Date.parse(db_entry.times.expiryTime);
            entry.expiry = db_entry.times.expiryTime.toString();
            entry.is_expired = Date.now() - expiry_date > 0; // Both measured in milliseconds
            entry.keys.push('expiry');
          }
        }
      }
    }
    if (isTopLevel && repairCounter.count > 0) {
      console.log(
        '[keepassService] repaired ' +
          repairCounter.count +
          ' polluted entries in memory (persisted on the next save)'
      );
    }
    return results;
  }

  function convertArrayToUUID(arr) {
    var int8Arr = new Uint8Array(arr);
    var result = new Array(int8Arr.byteLength * 2);
    for (var i = 0; i < int8Arr.byteLength; i++) {
      var hexit = int8Arr[i].toString(16).toUpperCase();
      result[i * 2] = hexit.length == 2 ? hexit : '0' + hexit;
    }
    return result.join('');
  }

  /*
   * The following 3 methods are utilities for the KeeWeb protectedValue class.
   * Because it uses uint8 arrays that are not JSON serializable, we must transform them
   * in and out of JSON serializable formats for use.
   */

  function protectedValueToJSON(pv) {
    return {
      salt: Array.from(pv.salt),
      value: Array.from(pv.value),
    };
  }

  function kdbxCredentialsToJson(creds) {
    var jsonRet = {
      passwordHash: null,
      keyFileHash: null,
    };
    for (var key in jsonRet) if (creds[key]) jsonRet[key] = protectedValueToJSON(creds[key]);
    return jsonRet;
  }

  function jsonCredentialsToKdbx(jsonCreds) {
    var creds = new kdbxweb.Credentials(null, null);
    for (var key in jsonCreds)
      if (jsonCreds[key])
        creds[key] = new kdbxweb.ProtectedValue(jsonCreds[key].value, jsonCreds[key].salt);
    return creds;
  }

  my.ensureDbLoaded = function () {
    if (_db) return Promise.resolve();
    console.log('[keepassService] _db is null, re-loading...');
    // Try to get masterKey from cached password first
    var keyPromise = _masterKey ? Promise.resolve(_masterKey) : 
      settings.getCurrentDatabaseUsage().then(function(usage) {
        if (usage.passwordKey) {
          _masterKey = usage.passwordKey;
        }
        return _masterKey;
      });
    return keyPromise.then(function(mk) {
        if (!mk) throw new Error(i18n.t('Session expired. Please re-unlock the database.'));
      return my.getChosenDatabaseFile().then(function (buf) {
        var kdbxCreds = jsonCredentialsToKdbx(mk);
        return kdbxweb.Kdbx.load(buf, kdbxCreds).then((db) => {
          _db = db;
          console.log('[keepassService] db re-loaded');
        });
      });
    });
  };

  /*
   * Returns the user's custom string fields for an entry, reading the RAW
   * kdbxweb entry so protected values are decrypted only into this in-memory
   * result (never into the parsed/cached entry shape). Names are returned
   * exactly as stored. Extension-owned fields, the five built-ins and their
   * lowerCamel twins are excluded. Rejects when the entry is missing.
   */
  my.getEntryCustomFields = function (entryId) {
    return my.ensureDbLoaded().then(function () {
      var kdbxEntry = findKdbxEntryById(entryId);
      if (!kdbxEntry) throw new Error(i18n.t('Entry not found in database'));
      var customFields = [];
      if (!kdbxEntry.fields) return customFields;
      for (const [name, value] of kdbxEntry.fields) {
        if (isHiddenCustomFieldName(name)) continue;
        customFields.push({
          name: name,
          value: readKdbxFieldValue(value),
          isProtected: isProtectedKdbxValue(value),
        });
      }
      return customFields;
    });
  };

  my.saveEntry = function (entryId, updatedFields, customFields, removedFieldNames) {
    console.log('[keepassService] saveEntry called, _db:', !!_db, '_masterKey:', !!_masterKey);
    customFields = customFields || [];
    removedFieldNames = removedFieldNames || [];
    return my.ensureDbLoaded().then(() => {
      let kdbxEntry = findKdbxEntryById(entryId);
      if (!kdbxEntry) throw new Error(i18n.t('Entry not found in database'));

      /*
       * Removals first, then writes, so a rename (old name in
       * removedFieldNames, new name in customFields) can never delete the
       * freshly written field. Custom removals are blocked from ever touching
       * the extension-owned or built-in fields.
       */
      for (let i = 0; i < removedFieldNames.length; i++) {
        deleteKdbxCustomField(kdbxEntry, removedFieldNames[i]);
      }

      // Update fields on the kdbx entry (fields is a Map in kdbxweb).
      // setKdbxEntryField maps the extension's lowerCamel keys onto KDBX's
      // built-in field names (and repairs legacy twins) for both the set and
      // the null/undefined delete paths.
      for (let key in updatedFields) {
        setKdbxEntryField(kdbxEntry, key, updatedFields[key]);
      }

      /*
       * Custom fields are written by their EXACT name, with no key mapping and
       * no twin cleanup, honouring the caller's isProtected flag.
       */
      for (let i = 0; i < customFields.length; i++) {
        var customField = customFields[i];
        if (!customField) continue;
        setKdbxCustomField(
          kdbxEntry,
          customField.name,
          customField.value,
          customField.isProtected
        );
      }

      return _db.save().then(function(saved) {
        console.log('[keepassService] save result type:', typeof saved, 'constructor:', saved && saved.constructor && saved.constructor.name);
        return saved;
      });
    });
  };

  my.uploadDatabase = function (arrayBuffer) {
    console.log('[keepassService] uploadDatabase size:', arrayBuffer && arrayBuffer.byteLength);
    var bytes = new Uint8Array(arrayBuffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    var base64 = btoa(binary);
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        m: 'uploadDatabase',
        data: base64,
      }, (response) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else if (response && response.error) reject(new Error(response.error));
        else resolve(response);
      });
    });
  };

  my.refreshFromServer = function () {
    _db = null;
    return my.ensureDbLoaded().then(function () {
      var entries = parseKdbxDb(_db.groups);
      return processReferences(entries, _db.header.versionMajor);
    });
  };

  my.getGroups = function () {
    if (!_db) return [];
    var result = [];
    var defaultGroup = _db.getDefaultGroup();
    var recycleUuid = _db.meta.recycleBinUuid;
    function isRecycleBin(group) {
      return !!(recycleUuid && group.uuid && group.uuid.equals(recycleUuid));
    }
    function collect(group) {
      // Skip Root and recycle bin groups, but still traverse Root's children
      if (group !== defaultGroup && !isRecycleBin(group)) {
        result.push({ name: group.name || 'Root' });
      }
      if (group.groups) group.groups.forEach(collect);
    }
    _db.groups.forEach(collect);
    return result;
  };

  my.createGroup = function (groupName) {
    return my.ensureDbLoaded().then(function () {
      var parent = _db.getDefaultGroup();
      _db.createGroup(parent, groupName);
      return _db.save();
    });
  };

  my.renameGroup = function (oldName, newName) {
    return my.ensureDbLoaded().then(function () {
      var group = findGroup(_db.groups, oldName);
      if (!group) return Promise.reject(new Error(i18n.t('Group not found')));
      group.name = newName;
      return _db.save();
    });
  };

  my.deleteGroup = function (groupName) {
    return my.ensureDbLoaded().then(function () {
      var group = findGroup(_db.groups, groupName);
      if (!group) return Promise.reject(new Error(i18n.t('Group not found')));
      // Splice directly from parent to bypass recycle bin (same pattern as deleteEntry)
      var parent = group.parentGroup;
      if (parent) {
        var idx = parent.groups.indexOf(group);
        if (idx >= 0) parent.groups.splice(idx, 1);
      }
      return _db.save();
    });
  };

  my.addEntry = function (groupName, fields, customFields) {
    customFields = customFields || [];
    return my.ensureDbLoaded().then(function () {
      function findGroup(groups, name) {
        for (var i = 0; i < groups.length; i++) {
          if (groups[i].name === name) return groups[i];
          var found = findGroup(groups[i].groups, name);
          if (found) return found;
        }
        return null;
      }
      var group = findGroup(_db.groups, groupName) || _db.getDefaultGroup();
      var entry = _db.createEntry(group);
      // Reuse the shared KDBX mapping so add and save cannot drift again.
      // Only non-empty values are written (createEntry already seeds the
      // built-in fields), matching the previous hand-written if-chain.
      for (var key in fields) {
        if (!fields[key]) continue;
        setKdbxEntryField(entry, key, fields[key]);
      }
      // User-defined custom fields are written by their exact name on the new
      // entry, honouring the caller-provided isProtected flag.
      for (var c = 0; c < customFields.length; c++) {
        var customField = customFields[c];
        if (!customField) continue;
        setKdbxCustomField(
          entry,
          customField.name,
          customField.value,
          customField.isProtected
        );
      }
      return _db.save();
    });
  };

  my.deleteEntry = function (entryId) {
    return my.ensureDbLoaded().then(function () {
      function findAndRemove(groups, id) {
        for (var i = 0; i < groups.length; i++) {
          for (var j = 0; j < groups[i].entries.length; j++) {
            var e = groups[i].entries[j];
            if (e.uuid && !e.uuid.empty) {
              if (convertArrayToUUID(Base64.decode(e.uuid.id)) === id)
                return groups[i].entries.splice(j, 1)[0];
            }
          }
          var found = findAndRemove(groups[i].groups, id);
          if (found) return found;
        }
        return null;
      }
      var removed = findAndRemove(_db.groups, entryId);
      if (!removed) return Promise.reject(new Error('Entry not found'));
      return _db.save();
    });
  };

  my.moveEntryToGroup = function (entryId, groupName) {
    return my.ensureDbLoaded().then(function () {
    function findGroup(groups, name) {
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].name === name) return groups[i];
        var found = findGroup(groups[i].groups, name);
        if (found) return found;
      }
      return null;
    }
    function findAndRemoveEntry(groups, id) {
      for (var i = 0; i < groups.length; i++) {
        for (var j = 0; j < groups[i].entries.length; j++) {
          var e = groups[i].entries[j];
          if (e.uuid && !e.uuid.empty) {
            if (convertArrayToUUID(Base64.decode(e.uuid.id)) === id)
              return groups[i].entries.splice(j, 1)[0];
          }
        }
        var found = findAndRemoveEntry(groups[i].groups, id);
        if (found) return found;
      }
      return null;
    }
    var entry = findAndRemoveEntry(_db.groups, entryId);
    if (!entry) return Promise.reject(new Error('Entry not found'));
    var target = findGroup(_db.groups, groupName);
    if (!target) return Promise.reject(new Error('Group not found'));
    target.entries.push(entry);
    return _db.save();
    });
  };

  return my;
}

export { KeepassService };
