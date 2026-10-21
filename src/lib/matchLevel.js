// URL matching levels for entries, kept out of lib/utils.js on purpose: this is
// the only module that needs the Public Suffix List, and utils.js is also pulled
// into the content script, which must stay small.
import { getDomain } from 'tldts';

// The registrable domain (eTLD+1) of a hostname, e.g.
//   webvpn.fjut.edu.cn -> fjut.edu.cn   (edu.cn is a public suffix)
//   mhsc.bnu.edu.cn    -> bnu.edu.cn
//   a.b.example.com    -> example.com
// Private suffixes count too, so user1.github.io and user2.github.io are treated
// as different sites: a password manager must never merge unrelated subdomains
// that happen to share a hosting suffix. IPs and single-label hosts (localhost)
// have no registrable domain and fall back to the hostname itself.
const registrableDomain = (hostname) => {
  try {
    return getDomain(hostname, { allowPrivateDomains: true }) || hostname;
  } catch (e) {
    return hostname;
  }
};

/**
 * Unified URL matching: returns match level 4-1, or 0 for no match.
 * @param {string} pageUrl - current page URL
 * @param {object} entry - entry with .url, optional .matchRegex
 * @returns {number} 4=origin & path prefix, 3=origin exact, 2=same registrable
 *                   domain & port, 1=regex, 0=none
 */
const matchLevel = (pageUrl, entry) => {
  if (!pageUrl || !entry || !entry.url) return 0;

  var safeParse = function (raw) {
    try {
      if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
      var u = new URL(raw);
      return {
        href: u.href,
        origin: u.origin,
        hostname: u.hostname,
        domain: registrableDomain(u.hostname),
        pathname: u.pathname,
        search: u.search,
        port: u.port,
      };
    } catch (e) {
      return null;
    }
  };

  // Level 1 source: "regex:" URLs are patterns rather than real URLs, so parse
  // them separately and only consider them after all URL-based levels fail.
  var regexSource = entry.url.startsWith('regex:') ? entry.url.slice(6) : null;

  var page = safeParse(pageUrl);
  var e = regexSource === null ? safeParse(entry.url) : null;

  if (page && e) {
    // Level 4: same origin, and the page's path+search starts with the entry's
    // with a boundary check (so /admin doesn't match /administrator). A trailing
    // "/" (including the root "/") is always a valid prefix boundary.
    if (page.origin === e.origin) {
      var ep = e.pathname + e.search;
      var pp = page.pathname + page.search;
      if (
        pp.startsWith(ep) &&
        (ep.length === pp.length ||
          ep.charAt(ep.length - 1) === '/' ||
          '/?#'.indexOf(pp.charAt(ep.length)) > -1)
      ) {
        return 4;
      }
      return 3;
    }
    // Level 2: same registrable domain and same port (protocol ignored). The
    // dot check rejects single-label hosts like "localhost".
    if (
      page.domain === e.domain &&
      page.domain.indexOf('.') > -1 &&
      page.port === e.port
    ) {
      return 2;
    }
  }

  // Level 1: regex fallback ("regex:" URL, then the legacy matchRegex field).
  if (regexSource !== null) {
    try {
      if (new RegExp(regexSource).test(pageUrl)) return 1;
    } catch (ex) {}
    return 0;
  }
  if (entry.matchRegex) {
    try {
      if (new RegExp(entry.matchRegex).test(pageUrl)) return 1;
    } catch (ex) {}
  }
  return 0;
};

export { matchLevel, registrableDomain };
