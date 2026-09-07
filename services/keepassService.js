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
      // Also check tuskUrls field for additional URL matches
      if (level === 0 && entry.keys && entry.keys.indexOf('tuskUrls') >= 0) {
        var urls = entry.tuskUrls.split(',');
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
   * Takes a kdbxweb group object and transforms it into a list of entries.
   **/
  function parseKdbxDb(groups) {
    var results = [];
    for (var i = 0; i < groups.length; i++) {
      var group = groups[i];
      if (group.groups.length > 0) {
        // recursive case for subgroups.
        results = results.concat(parseKdbxDb(group.groups));
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
          for (const [key, field] of db_entry.fields) {
            const camelKey = Case.camel(key);
            if (typeof field === 'object') {
              // type = object ? protected value
              entry.protectedData[camelKey] = protectedValueToJSON(field);
            } else {
              entry.keys.push(camelKey);
              entry[camelKey] = field;
            }
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

  my.saveEntry = function (entryId, updatedFields) {
    console.log('[keepassService] saveEntry called, _db:', !!_db, '_masterKey:', !!_masterKey);
    return my.ensureDbLoaded().then(() => {
      // Find the entry in the kdbx db by UUID
      function findEntryInGroup(group, id) {
        for (let e of group.entries) {
          if (e.uuid && !e.uuid.empty) {
            let eid = convertArrayToUUID(Base64.decode(e.uuid.id));
            if (eid === id) return e;
          }
        }
        for (let sub of group.groups) {
          let found = findEntryInGroup(sub, id);
          if (found) return found;
        }
        return null;
      }

      let kdbxEntry = null;
      for (let g of _db.groups) {
        kdbxEntry = findEntryInGroup(g, entryId);
        if (kdbxEntry) break;
      }
        if (!kdbxEntry) throw new Error(i18n.t('Entry not found in database'));

      // Update fields on the kdbx entry (fields is a Map in kdbxweb)
      let protectedFields = ['password', 'otp', 'tOTPSeed'];
      
      for (let key in updatedFields) {
        let value = updatedFields[key];
        if (value === null || value === undefined) {
          // null/undefined means delete the field (used by TOTP toggle-off with cleared URL)
          kdbxEntry.fields.delete(key);
          continue;
        }
        if (protectedFields.includes(key)) {
          let pv = kdbxweb.ProtectedValue.fromString(value);
          kdbxEntry.fields.set(key, pv);
        } else {
          kdbxEntry.fields.set(key, value);
        }
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

  my.addEntry = function (groupName, fields) {
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
      if (fields.title) entry.fields.set('Title', fields.title);
      if (fields.userName) entry.fields.set('UserName', fields.userName);
      if (fields.url) entry.fields.set('URL', fields.url);
      if (fields.notes) entry.fields.set('Notes', fields.notes);
      if (fields.password) entry.fields.set('Password', kdbxweb.ProtectedValue.fromString(fields.password));
      if (fields.otp) entry.fields.set('otp', kdbxweb.ProtectedValue.fromString(fields.otp));
      if (fields.tuskTotpEnabled) entry.fields.set('tuskTotpEnabled', fields.tuskTotpEnabled);
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
