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
 * @returns {number} 4=URI contains, 3=origin exact, 2=same domain, 1=regex, 0=none
 */
const matchLevel = (pageUrl, entry) => {
  if (!pageUrl || !entry || !entry.url) return 0;

  // Level 1: regex pattern (prefix "regex:")
  if (entry.url.startsWith('regex:')) {
    try { if (new RegExp(entry.url.slice(6)).test(pageUrl)) return 1; } catch(ex) {}
    return 0;
  }

  var safeParse = function(raw) {
    try {
      if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
      var u = new URL(raw);
      return { href: u.href, origin: u.origin, hostname: u.hostname,
        domain: u.hostname.split('.').slice(-2).join('.') };
    } catch(e) { return null; }
  };
  var page = safeParse(pageUrl);
  var e = safeParse(entry.url);
  if (!page || !e) return 0;
  if (page.href.indexOf(e.href) > -1) return 4;
  if (page.origin === e.origin) return 3;
  if (page.domain === e.domain && page.domain.indexOf('.') > -1) return 2;
  if (entry.matchRegex) {
    try { if (new RegExp(entry.matchRegex).test(pageUrl)) return 1; } catch(ex) {}
  }
  return 0;
};

export { matchLevel, parseUrl, urlencode, guid, isVisible, isFirefox };
