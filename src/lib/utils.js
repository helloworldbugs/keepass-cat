const urlencode = function (str) {
  // https://stackoverflow.com/questions/10896807/javascript-encodeuricomponent-doesnt-encode-single-quotes?foo=%27%27
  return encodeURIComponent(str).replace(/[!'()*]/g, escape);
};

/**
 * parseUrl creates an anchor element from a url string
 * @param {String} url
 * @returns {HTMLHyperlinkElementUtils}
 */
const parseUrl = (url) => {
  // Default to http, unencrypted if not specified.
  if (!url) {
    return null;
  }
  if (url && !url.indexOf('http') == 0) {
    url = 'http://' + url;
  }
  // from https://gist.github.com/jlong/2428561
  var parser = document.createElement('a');
  parser.href = url;

  /**
   * parser.protocol; // => "http:"
   * parser.hostname; // => "example.com"
   * parser.port;     // => "3000"
   * parser.pathname; // => "/pathname/"
   * parser.search;   // => "?search=test"
   * parser.hash;     // => "#hash"
   * parser.host;     // => "example.com:3000"
   * parser.origin    // => "http://example.com:3000"
   */

  return parser;
};

const guid = () => {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
};

/**
 * function to tell if the element can be seen by a human.
 * @param el DOM element
 * @returns booleans
 */
const isVisible = (el) => {
  return (
    el.offsetWidth > 0 &&
    el.offsetHeight > 0 &&
    parseFloat(window.getComputedStyle(el).getPropertyValue('opacity')) > 0.1
  );
};

const isFirefox = () => {
  return navigator.userAgent.includes('Firefox');
};

/**
 * Unified URL matching: returns match level 4-1, or 0 for no match.
 * @param {string} pageUrl - current page URL
 * @param {object} entry - entry with .url, optional .matchRegex
 * @returns {number} 4=origin & path prefix, 3=origin exact, 2=same domain & port,
 *                   1=regex, 0=none
 */
const matchLevel = (pageUrl, entry) => {
  if (!pageUrl || !entry || !entry.url) return 0;

  var safeParse = function(raw) {
    try {
      if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
      var u = new URL(raw);
      return { href: u.href, origin: u.origin, hostname: u.hostname,
        domain: u.hostname.split('.').slice(-2).join('.'),
        pathname: u.pathname, search: u.search, port: u.port };
    } catch(e) { return null; }
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
      if (pp.startsWith(ep) &&
          (ep.length === pp.length ||
           ep.charAt(ep.length - 1) === '/' ||
           '/?#'.indexOf(pp.charAt(ep.length)) > -1)) {
        return 4;
      }
      return 3;
    }
    // Level 2: same registrable domain and same port (protocol ignored).
    if (page.domain === e.domain && page.domain.indexOf('.') > -1 && page.port === e.port) return 2;
  }

  // Level 1: regex fallback ("regex:" URL, then the legacy matchRegex field).
  if (regexSource !== null) {
    try { if (new RegExp(regexSource).test(pageUrl)) return 1; } catch(ex) {}
    return 0;
  }
  if (entry.matchRegex) {
    try { if (new RegExp(entry.matchRegex).test(pageUrl)) return 1; } catch(ex) {}
  }
  return 0;
};

export { matchLevel, parseUrl, urlencode, guid, isVisible, isFirefox };
