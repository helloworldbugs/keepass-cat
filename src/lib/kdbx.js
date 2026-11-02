'use strict';

/*
 * kdbxweb plumbing shared by the popup and the settings page.
 *
 * The Argon2 implementation has to be registered on kdbxweb's CryptoEngine before
 * any KDBX4 database is opened *or created*. It used to live inside
 * keepassService; the settings page now creates databases as well, and it must not
 * pull in the whole service just to get this side effect.
 */

import * as kdbxweb from 'kdbxweb';
import argon2 from 'argon2-browser/dist/argon2-bundled.min.js';
import * as Base64 from 'base64-arraybuffer';

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

/*
 * Credentials from a password and an optional managed key file.
 *
 * Mirrors keepassService.getMasterKey(): an empty password together with a key
 * file means "no password", which kdbxweb expresses as a null password. The
 * key-file bytes are stored base64-encoded in the settings.
 */
export function credentialsFromPassword(password, keyFileInfo) {
  const hasKeyFile = !!(keyFileInfo && keyFileInfo.encodedKey);
  const protectedPassword =
    password === '' && hasKeyFile
      ? null
      : kdbxweb.ProtectedValue.fromString(typeof password === 'string' ? password : '');
  const fileKey = hasKeyFile ? Base64.decode(keyFileInfo.encodedKey) : null;
  return new kdbxweb.Credentials(protectedPassword, fileKey);
}

/**
 * Creates an empty KDBX4 database (kdbxweb's default parameters: Argon2d, AES,
 * gzip) with one group and one example entry in it, and returns the saved bytes.
 */
export async function createDatabase(name, credentials) {
  const db = kdbxweb.Kdbx.create(credentials, name);
  const group = db.createGroup(db.getDefaultGroup(), 'Default');
  const entry = db.createEntry(group);
  entry.fields.set('Title', 'Example');
  entry.fields.set('UserName', 'user@example.com');
  entry.fields.set('URL', 'https://example.com');
  entry.fields.set('Password', kdbxweb.ProtectedValue.fromString('example-password'));
  return db.save();
}

export function loadDatabase(bytes, credentials) {
  return kdbxweb.Kdbx.load(bytes, credentials);
}

/**
 * Re-encrypts the database with new credentials. kdbxweb's save() uses
 * `db.credentials`, so assigning them here is what changes the master key; the
 * KDF parameters of the file are preserved.
 */
export function saveWithCredentials(db, credentials) {
  db.credentials = credentials;
  return db.save();
}

export { kdbxweb };
