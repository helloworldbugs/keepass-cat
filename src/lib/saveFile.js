'use strict';

/*
 * Saves a generated file the way each browser allows.
 *
 * Chrome has the File System Access API, so the user picks the location and we write
 * the bytes directly. Firefox has no such API: the file goes through a regular
 * download instead, which is the only way a page can produce a file there.
 */
export async function saveBinaryFile(suggestedName, bytes, types) {
  if (typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: suggestedName,
        types: types,
        excludeAcceptAllOption: false,
      });
    } catch (err) {
      // Closing the dialog is not a failure worth reporting.
      if (err && (err.name === 'AbortError' || err.code === 20)) return false;
      throw err;
    }
    const writable = await handle.createWritable();
    await writable.write(bytes);
    await writable.close();
    return true;
  }

  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
