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
  tokenTtlDays: 30,
  rateLimitPerMin: 60,
};

const BOOTSTRAP_TTL_MS = 15 * 60 * 1000;
const AUDIT_LIMIT = 500;
const TTL_OPTIONS_DAYS = [7, 14, 30];

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
      if (TTL_OPTIONS_DAYS.indexOf(config.tokenTtlDays) < 0) config.tokenTtlDays = DEFAULTS.tokenTtlDays;
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
      return storageSet({ extAccess: next }).then(function () {
        return next;
      });
    });
  };

  exports.ttlOptions = function () {
    return TTL_OPTIONS_DAYS.slice();
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
    var code = randomToken('KC1');
    return sha256Hex(code).then(function (codeHash) {
      return storageSet({
        extAccessBootstrap: {
          codeHash: codeHash,
          name: String(name || '').trim() || 'AI client',
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
              expiresAt: Date.now() + config.tokenTtlDays * 24 * 3600 * 1000,
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

  /* ------------------------------------------------------------------- audit */

  /*
   * Appends one audit record (newest first), keeping the ring at AUDIT_LIMIT.
   * Never throws: auditing must not break the request it describes.
   */
  exports.appendAudit = function (record) {
    try {
      return storageGet(['extAccessAudit']).then(function (items) {
        var audit = Array.isArray(items.extAccessAudit) ? items.extAccessAudit : [];
        audit.unshift({
          ts: Date.now(),
          client: String(record.client || ''),
          method: String(record.method || ''),
          target: String(record.target || ''),
          result: String(record.result || ''),
        });
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
