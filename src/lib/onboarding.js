/*
 * A one-shot hand-off between the Getting Started page and the database settings.
 *
 * "New local database" has to land on the local-file section with the provider
 * switched on, because that switch is what reveals the create button. The route
 * carries no state, so the request travels through localStorage instead - and it
 * is consumed by whoever renders the section next, exactly once, so a normal visit
 * later never turns the provider on behind the user's back.
 */
const EXPAND_LOCAL_FILE_KEY = 'keepassCat.expandLocalFile';

export function requestLocalFileExpansion() {
  try {
    localStorage.setItem(EXPAND_LOCAL_FILE_KEY, '1');
  } catch (e) {
    // Storage can be unavailable; the page still opens, just collapsed.
  }
}

export function takeLocalFileExpansionRequest() {
  try {
    const requested = localStorage.getItem(EXPAND_LOCAL_FILE_KEY) === '1';
    if (requested) localStorage.removeItem(EXPAND_LOCAL_FILE_KEY);
    return requested;
  } catch (e) {
    return false;
  }
}
