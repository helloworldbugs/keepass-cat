'use strict';

/*
 * Creating a local .kdbx and changing its unlock password, from the settings page.
 *
 * Both flows own the file write: the File System Access API only exists in a page
 * (never in the MV3 worker), and the settings page is where the user gesture lives
 * that the save picker and the write permission need.
 *
 * Nothing here touches the popup's in-memory database: the settings page decrypts,
 * re-encrypts and writes its own copy, then the cached credentials are refreshed by
 * the caller so the popup unlocks with the new password next time.
 */

import { credentialsFromPassword, createDatabase, loadDatabase, saveWithCredentials } from '@/lib/kdbx';

const PICKER_TYPES = [
  {
    description: 'KeePass database',
    accept: { 'application/x-keepass-database': ['.kdbx'] },
  },
];

function fileNameFor(name) {
  const trimmed = (name || '').trim() || 'passwords';
  return /\.kdbx$/i.test(trimmed) ? trimmed : trimmed + '.kdbx';
}

/**
 * Creates a database, asks where to save it, writes it and registers the handle.
 * Resolves the new provider record, or null when the save dialog was dismissed.
 */
export async function createLocalDatabase(providerManager, { name, password, keyFile }) {
  const credentials = credentialsFromPassword(password, keyFile || null);
  const bytes = await createDatabase(name, credentials);

  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: fileNameFor(name),
      types: PICKER_TYPES,
      excludeAcceptAllOption: false,
    });
  } catch (err) {
    // Closing the dialog is not a failure worth reporting.
    if (err && (err.name === 'AbortError' || err.code === 20)) return null;
    throw err;
  }

  const writable = await handle.createWritable();
  await writable.write(bytes);
  await writable.close();
  await handle.requestPermission({ mode: 'readwrite' }).catch(() => {});

  return providerManager.registerHandle(handle);
}

/**
 * Opens the file with the current credentials, re-encrypts it with the new ones,
 * verifies that the result opens with the new credentials, and only then writes it
 * back. A wrong current password, or a key file that does not belong to the file,
 * fails at load — before anything is written.
 */
export async function changeLocalDatabasePassword(providerManager, dbInfo, options) {
  const bytes = await providerManager.getChosenDatabaseFile(dbInfo);

  const currentCredentials = credentialsFromPassword(options.currentPassword, options.currentKeyFile);
  const db = await loadDatabase(bytes, currentCredentials);

  const nextCredentials = credentialsFromPassword(options.newPassword, options.newKeyFile);
  const saved = await saveWithCredentials(db, nextCredentials);

  // Prove the new key works before the only copy on disk is replaced.
  await loadDatabase(saved, nextCredentials);

  await providerManager.writeDatabase(saved, dbInfo);
  return true;
}
