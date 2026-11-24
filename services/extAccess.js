'use strict';

/*
 * External access: the local-AI bridge's configuration and credentials.
 *
 * The extension exposes a read-only API to local MCP clients (DeepSeek Harness,
 * opencode, codex, Claude Code) over a loopback WebSocket. Everything about that
 * channel lives here so the background worker and the options page share one
 * source of truth:
 *
 * - config: master switch (default OFF), port, scopes, group ACL, token TTL,
 *   rate limit
 * - clients: one record per paired AI client. Only SHA-256(token) is stored; the
 *   raw token is shown once at pairing time and never recoverable afterwards.
 * - bootstrap: a one-time pairing code (15 minutes, single use). It is the only
 *   secret that ever appears in the copy-paste guide, so the long-lived token
 *   never enters a chat log.
 * - audit: a bounded ring of the most recent requests, kept in a separate
 *   storage key so frequent writes do not rewrite the whole config blob.
 *
 * Storage layout (chrome.storage.local):
 *   extAccess       { enabled, port, scopes, groupMode, groupIds, tokenTtlDays, rateLimitPerMin }
 *   extAccessClients [ { id, name, tokenHash, createdAt, expiresAt, lastUsedAt, revokedAt } ]
 *   extAccessBootstrap { codeHash, name, expiresAt } | null
 *   extAccessAudit   [ { ts, client, method, target, result } ]   (newest first, max 500)
 */

const DEFAULTS = {
  enabled: false,
  port: 19455,
  scopes: { groups: true, entries: true, otp: false, secrets: false },
  groupMode: 'all',
  groupIds: [],
  tokenTtlSeconds: 7 * 24 * 3600,
  rateLimitPerMin: 60,
};

const BOOTSTRAP_TTL_MS = 15 * 60 * 1000;
const AUDIT_LIMIT = 500;

/*
 * Token lifetimes, in seconds. Hours are included because a short-lived token is
 * the practical way to grant an AI a single session; there is no "forever"
 * option by design.
 */
const TTL_OPTIONS_SECONDS = [
  3600, // 1 hour
  8 * 3600, // 8 hours
  24 * 3600, // 1 day
  3 * 24 * 3600, // 3 days
  7 * 24 * 3600, // 7 days (default)
  14 * 24 * 3600, // 14 days
  30 * 24 * 3600, // 30 days
];
const DEFAULT_TTL_SECONDS = 7 * 24 * 3600;

/* Live bridge status lives in session storage: it is per-run and must not be
 * persisted across browser restarts, but it does need to reach the options page
 * instantly. */
const STATUS_KEY = 'extAccessStatus';

function storageGet(keys) {
  return new Promise(function (resolve) {
    chrome.storage.local.get(keys, function (items) {
      resolve(items || {});
    });
  });
}

function storageSet(obj) {
  return new Promise(function (resolve) {
    chrome.storage.local.set(obj, resolve);
  });
}

function sessionGet(keys) {
  return new Promise(function (resolve) {
    chrome.storage.session.get(keys, function (items) {
      resolve(items || {});
    });
  });
}

function sessionSet(obj) {
  return new Promise(function (resolve) {
    chrome.storage.session.set(obj, resolve);
  });
}

/* SHA-256 hex of a string. Tokens are only ever stored through this. */
function sha256Hex(text) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (buf) {
    return Array.from(new Uint8Array(buf))
      .map(function (b) {
        return b.toString(16).padStart(2, '0');
      })
      .join('');
  });
}

/* A 128-bit random token, grouped for readability when shown to the user. */
function randomToken(prefix) {
  var bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  var hex = Array.from(bytes)
    .map(function (b) {
      return b.toString(16).padStart(2, '0');
    })
    .join('');
  return prefix + '-' + hex.slice(0, 8) + '-' + hex.slice(8, 16) + '-' + hex.slice(16, 24) + '-' + hex.slice(24);
}

function ExtAccess() {
  var exports = {};

  /* ------------------------------------------------------------------ config */

  exports.getConfig = function () {
    return storageGet(['extAccess']).then(function (items) {
      var stored = items.extAccess || {};
      var config = Object.assign({}, DEFAULTS, stored);
      config.scopes = Object.assign({}, DEFAULTS.scopes, stored.scopes || {});
      // Older builds stored whole days only; keep those databases working by
      // translating the field instead of dropping a user's choice.
      if (typeof stored.tokenTtlSeconds !== 'number') {
        var days = typeof stored.tokenTtlDays === 'number' ? stored.tokenTtlDays : 0;
        config.tokenTtlSeconds = days > 0 ? days * 24 * 3600 : DEFAULT_TTL_SECONDS;
      }
      if (TTL_OPTIONS_SECONDS.indexOf(config.tokenTtlSeconds) < 0) {
        config.tokenTtlSeconds = DEFAULT_TTL_SECONDS;
      }
      delete config.tokenTtlDays;
      if (config.groupMode !== 'selected') config.groupMode = 'all';
      if (!Array.isArray(config.groupIds)) config.groupIds = [];
      return config;
    });
  };

  /* Shallow-merges a patch into the stored config. */
  exports.saveConfig = function (patch) {
    return exports.getConfig().then(function (config) {
      var next = Object.assign({}, config, patch);
      if (patch.scopes) next.scopes = Object.assign({}, config.scopes, patch.scopes);
      if (TTL_OPTIONS_SECONDS.indexOf(next.tokenTtlSeconds) < 0) {
        next.tokenTtlSeconds = DEFAULT_TTL_SECONDS;
      }
      return storageSet({ extAccess: next }).then(function () {
        return next;
      });
    });
  };

  exports.ttlOptions = function () {
    return TTL_OPTIONS_SECONDS.slice();
  };

  /* ----------------------------------------------------------------- clients */

  exports.listClients = function () {
    return storageGet(['extAccessClients']).then(function (items) {
      return Array.isArray(items.extAccessClients) ? items.extAccessClients : [];
    });
  };

  function saveClients(clients) {
    return storageSet({ extAccessClients: clients });
  }

  /*
   * Creates a one-time bootstrap code for a new client named `name`. The raw
   * code is returned (and shown in the guide the user copies); only its hash is
   * kept. Any previous un-consumed code is replaced - it would be useless soon
   * anyway.
   */
  exports.createBootstrap = function (name) {
    var clientName = String(name == null ? '' : name).trim();
    // A blank name made every client indistinguishable in the list and in the
    // audit log, so it is refused here as well as in the form.
    if (!clientName) return Promise.reject(new Error('A client name is required'));
    var code = randomToken('KC1');
    return sha256Hex(code).then(function (codeHash) {
      return storageSet({
        extAccessBootstrap: {
          codeHash: codeHash,
          name: clientName,
          expiresAt: Date.now() + BOOTSTRAP_TTL_MS,
        },
      }).then(function () {
        return { code: code, expiresAt: Date.now() + BOOTSTRAP_TTL_MS };
      });
    });
  };

  /*
   * Exchanges a bootstrap code for a long-lived session token. Single use: a
   * successful exchange consumes the code. Returns { client, token } or null.
   * The token expires after the configured TTL (at most 30 days - there is no
   * "forever" option by design).
   */
  exports.consumeBootstrap = function (code) {
    if (!code || typeof code !== 'string') return Promise.resolve(null);
    return Promise.all([sha256Hex(code), storageGet(['extAccessBootstrap']), exports.getConfig()]).then(
      function (results) {
        var codeHash = results[0];
        var bootstrap = results[1].extAccessBootstrap;
        var config = results[2];
        if (!bootstrap || bootstrap.codeHash !== codeHash) return null;
        if (!bootstrap.expiresAt || bootstrap.expiresAt < Date.now()) return null;
        var token = randomToken('KCT');
        return sha256Hex(token).then(function (tokenHash) {
          return exports.listClients().then(function (clients) {
            var client = {
              id: 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
              name: bootstrap.name,
              tokenHash: tokenHash,
              createdAt: Date.now(),
              expiresAt: Date.now() + config.tokenTtlSeconds * 1000,
              lastUsedAt: 0,
              revokedAt: 0,
            };
            clients.push(client);
            return Promise.all([saveClients(clients), storageSet({ extAccessBootstrap: null })]).then(
              function () {
                return { client: client, token: token };
              }
            );
          });
        });
      }
    );
  };

  /*
   * Resolves a session token to its client, or null when the token is unknown,
   * the client was revoked, or the token expired. An expired client is not
   * deleted - the record stays visible in the list so the user sees it lapsed.
   */
  exports.resolveToken = function (token) {
    if (!token || typeof token !== 'string') return Promise.resolve(null);
    return sha256Hex(token).then(function (tokenHash) {
      return exports.listClients().then(function (clients) {
        var client = null;
        for (var i = 0; i < clients.length; i++) {
          if (clients[i].tokenHash === tokenHash) {
            client = clients[i];
            break;
          }
        }
        if (!client || client.revokedAt) return null;
        if (client.expiresAt && client.expiresAt < Date.now()) return null;
        return client;
      });
    });
  };

  exports.touchClient = function (clientId) {
    return exports.listClients().then(function (clients) {
      var dirty = false;
      clients.forEach(function (client) {
        if (client.id === clientId) {
          client.lastUsedAt = Date.now();
          dirty = true;
        }
      });
      return dirty ? saveClients(clients) : null;
    });
  };

  /*
   * Whether a client may still be used right now.
   *
   * Revoking has to take effect on *existing* connections too: an open
   * WebSocket was authenticated once, and without this check the extension
   * would keep serving it until the socket happened to drop. The background
   * asks this on every request (and again when the client list changes) so a
   * revoke closes the door immediately instead of eventually.
   */
  exports.isClientActive = function (clientId) {
    if (!clientId) return Promise.resolve(false);
    return exports.listClients().then(function (clients) {
      for (var i = 0; i < clients.length; i++) {
        if (clients[i].id !== clientId) continue;
        if (clients[i].revokedAt) return false;
        if (clients[i].expiresAt && clients[i].expiresAt < Date.now()) return false;
        return true;
      }
      return false;
    });
  };

  exports.revokeClient = function (clientId) {
    return exports.listClients().then(function (clients) {
      clients.forEach(function (client) {
        if (client.id === clientId && !client.revokedAt) client.revokedAt = Date.now();
      });
      return saveClients(clients);
    });
  };

  /* A client is "inactive" once it can no longer authenticate: revoked or its
   * token expired. Inactive records are only history and may be deleted. */
  exports.isClientInactive = function (client) {
    if (!client) return false;
    if (client.revokedAt) return true;
    return !!(client.expiresAt && client.expiresAt < Date.now());
  };

  /*
   * Removes one client record. Only inactive records can go: deleting a live one
   * would silently revoke it, and that has its own button.
   */
  exports.removeClient = function (clientId) {
    return exports.listClients().then(function (clients) {
      var next = clients.filter(function (client) {
        if (client.id !== clientId) return true;
        return !exports.isClientInactive(client);
      });
      return saveClients(next);
    });
  };

  /* Drops every inactive record in one go. */
  exports.purgeInactiveClients = function () {
    return exports.listClients().then(function (clients) {
      var next = clients.filter(function (client) {
        return !exports.isClientInactive(client);
      });
      return saveClients(next).then(function () {
        return clients.length - next.length;
      });
    });
  };

  /* ------------------------------------------------------------------ status */

  /*
   * The live bridge state, kept in session storage so the options page can
   * follow it in real time (chrome.storage.onChanged) without polling.
   */
  exports.getStatus = function () {
    return sessionGet([STATUS_KEY]).then(function (items) {
      return (
        items[STATUS_KEY] || {
          connected: false,
          authenticated: false,
          clientId: '',
          clientName: '',
          connectedAt: 0,
          lastRequestAt: 0,
          error: '',
        }
      );
    });
  };

  exports.patchStatus = function (patch) {
    return exports.getStatus().then(function (status) {
      var next = Object.assign({}, status, patch);
      return sessionSet({ [STATUS_KEY]: next }).then(function () {
        return next;
      });
    });
  };

  exports.resetStatus = function () {
    return exports.patchStatus({
      connected: false,
      authenticated: false,
      clientId: '',
      clientName: '',
      connectedAt: 0,
      error: '',
    });
  };

  /* ------------------------------------------------------------------- audit */

  /* Consecutive repeats of the same event (same client, method, target, result)
   * inside this window collapse into one row with a counter: the MV3 service
   * worker dies every ~30 idle seconds and redials, which would otherwise flood
   * the log with kc.auth rows and bury the calls that actually read data. */
  var AUDIT_COALESCE_MS = 10 * 60 * 1000;

  /*
   * Appends one audit record (newest first), keeping the ring at AUDIT_LIMIT.
   * Never throws: auditing must not break the request it describes.
   */
  exports.appendAudit = function (record) {
    try {
      return storageGet(['extAccessAudit']).then(function (items) {
        var audit = Array.isArray(items.extAccessAudit) ? items.extAccessAudit : [];
        var now = Date.now();
        var client = String(record.client || '');
        var method = String(record.method || '');
        var target = String(record.target || '');
        var result = String(record.result || '');
        var last = audit[0];
        if (
          last &&
          last.client === client &&
          last.method === method &&
          last.target === target &&
          last.result === result &&
          now - last.ts < AUDIT_COALESCE_MS
        ) {
          last.ts = now;
          last.count = (last.count || 1) + 1;
        } else {
          audit.unshift({
            ts: now,
            client: client,
            method: method,
            target: target,
            result: result,
            count: 1,
          });
        }
        if (audit.length > AUDIT_LIMIT) audit.length = AUDIT_LIMIT;
        return storageSet({ extAccessAudit: audit });
      });
    } catch (e) {
      return Promise.resolve();
    }
  };

  exports.getAudit = function () {
    return storageGet(['extAccessAudit']).then(function (items) {
      return Array.isArray(items.extAccessAudit) ? items.extAccessAudit : [];
    });
  };

  exports.clearAudit = function () {
    return storageSet({ extAccessAudit: [] });
  };

  return exports;
}

export { ExtAccess, DEFAULTS as EXT_ACCESS_DEFAULTS };
