/*
 * Whether an entry is past its expiry date.
 *
 * KeePass stores the expiry as an ISO timestamp on `entry.expiry`, and leaves the
 * field out entirely when the entry never expires. It is read live rather than
 * from `entry.is_expired`, which is a snapshot taken when the database was
 * unlocked and goes stale if an entry expires while the vault stays open.
 */
export function entryIsExpired(entry) {
  if (!entry) return false;
  if (entry.expiry) {
    const time = Date.parse(entry.expiry);
    return !isNaN(time) && time < Date.now();
  }
  return !!entry.is_expired;
}
