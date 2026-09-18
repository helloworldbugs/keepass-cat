'use strict';

// Client-side derived fields that must never be folded into the search index.
// Rebuilding a batch that already carries a stale `filterKey` would otherwise
// re-index the old index string, making the index grow on every rebuild.
const TRANSIENT_FIELDS = ['filterKey', 'matchRank', 'view_is_active'];

function collectFilters(data, collector) {
  if (data === null || data === undefined) return;
  var ctor = data.constructor;
  if (ctor === ArrayBuffer || ctor === Uint8Array) return;
  if (typeof data === 'string') {
    collector.push(data.toLocaleLowerCase());
    return;
  }
  if (ctor === Array) {
    for (var i = 0; i < data.length; i++) collectFilters(data[i], collector);
    return;
  }
  if (typeof data === 'object') {
    for (var prop in data) {
      if (TRANSIENT_FIELDS.indexOf(prop) > -1) continue;
      collectFilters(data[prop], collector);
    }
  }
}

/**
 * Build (or rebuild) the client-side `filterKey` search index on a batch of
 * entries. This is the single place that constructs `filterKey`; callers get it
 * for free via `unlockedState.cacheSet('allEntries', ...)`.
 *
 * Idempotent: calling it repeatedly on the same objects yields the same result,
 * because the transient fields above are skipped. Tolerant of null/undefined,
 * non-arrays, empty arrays and entries with missing fields.
 *
 * @param {Array} entries
 * @returns {Array} the same array, with each entry mutated in place
 */
export function buildEntryFilters(entries) {
  if (!Array.isArray(entries)) return entries;
  entries.forEach(function (entry) {
    if (entry === null || entry === undefined || typeof entry !== 'object') return;
    var filters = [];
    collectFilters(entry, filters);
    entry.filterKey = filters.join(' ');
  });
  return entries;
}
