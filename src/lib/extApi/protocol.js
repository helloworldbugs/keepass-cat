'use strict';

/*
 * The read-only JSON-RPC protocol spoken between the extension and a local MCP
 * bridge over the loopback WebSocket.
 *
 * Framing: one JSON object per WebSocket text message.
 *   request  { "jsonrpc": "2.0", "id": <any>, "method": <string>, "params": {...} }
 *   response { "jsonrpc": "2.0", "id": <same>, "result": {...} }
 *            { "jsonrpc": "2.0", "id": <same>, "error": { "code": <string>, "message": <string> } }
 *
 * The first message on a connection MUST be `kc.auth`. The bridge proves its
 * identity before any data flows: either with a session token it saved from an
 * earlier pairing, or with a one-time bootstrap code which is exchanged for a
 * fresh session token in the same reply. Anything else before authentication is
 * answered with `unauthorized` and the connection is dropped by the caller.
 *
 * Methods after authentication (all read-only; write methods are reserved and
 * answer `not_supported`):
 *   keepass_status                    -> { unlocked, version, protocol, scopes }
 *   list_groups                       -> { groups: [{ uuid, name, path }] }
 *   search_entries { query?, group? } -> { entries: [meta...] }   (max 100)
 *   get_entry   { id }                -> meta (+ secrets when that scope is on)
 *   get_password { id }               -> { password }             (read:secrets)
 *   get_otp     { id }                -> { code, period, remaining } (read:otp)
 *
 * The OTP secret itself is NEVER returned - only the current code, which dies
 * with its period. HOTP answers `otp_unsupported`: the counter lives on the
 * server side, and returning a code without incrementing would desync it.
 *
 * Error codes: unauthorized, disabled, locked, denied, not_found, rate_limited,
 * bad_request, otp_unsupported, not_supported.
 */

import { Otp } from '@/lib/otp.js';

const PROTOCOL_VERSION = 1;
const SEARCH_LIMIT = 100;

function makeError(id, code, message) {
  return { jsonrpc: '2.0', id: id, error: { code: code, message: message } };
}

function makeResult(id, result) {
  return { jsonrpc: '2.0', id: id, result: result };
}

/*
 * deps:
 *   extAccess            the ExtAccess service (config, clients, audit)
 *   getEntries()         Promise<entry[]|null> - null while the vault is locked
 *   decrypt(entry, field) -> string            - protectedData -> plain text
 *   version              extension version string
 */
function createExtApi(deps) {
  var extAccess = deps.extAccess;
  var getEntries = deps.getEntries;
  var decrypt = deps.decrypt;
  var version = deps.version || '';

  // Per-connection state: which client authenticated, and its sliding rate window.
  var client = null;
  var requestTimestamps = [];

  function audit(method, target, result) {
    extAccess.appendAudit({
      client: client ? client.name : '(unauthenticated)',
      method: method,
      target: target,
      result: result,
    });
  }

  /* Sliding-window rate limit; the window is per connection, which is also per
   * client because a bridge holds exactly one connection. */
  function checkRateLimit(config) {
    var limit = config.rateLimitPerMin || 60;
    var now = Date.now();
    requestTimestamps = requestTimestamps.filter(function (ts) {
      return now - ts < 60000;
    });
    if (requestTimestamps.length >= limit) return false;
    requestTimestamps.push(now);
    return true;
  }

  /* Whether an entry is inside the configured group ACL. */
  function groupAllowed(config, entry, groupPathsByUuid) {
    if (config.groupMode !== 'selected') return true;
    if (!config.groupIds.length) return false;
    if (config.groupIds.indexOf(entry.groupUuid) >= 0) return true;
    // Sub-groups inherit: an entry is allowed when its path sits under an
    // allowed group's path.
    var path = entry.groupPath || '';
    for (var i = 0; i < config.groupIds.length; i++) {
      var allowedPath = groupPathsByUuid[config.groupIds[i]];
      if (allowedPath && (path === allowedPath || path.indexOf(allowedPath + '/') === 0)) return true;
    }
    return false;
  }

  function groupPathsByUuidFrom(entries) {
    var map = {};
    entries.forEach(function (entry) {
      if (entry.groupUuid && entry.groupPath && !map[entry.groupUuid]) {
        map[entry.groupUuid] = entry.groupPath;
      }
    });
    return map;
  }

  function entryMeta(entry) {
    return {
      id: entry.id,
      title: entry.title || '',
      userName: decrypt(entry, 'userName'),
      url: entry.url || '',
      groupPath: entry.groupPath || '',
      expiry: entry.expiry || null,
      hasOtp: !!decrypt(entry, 'otp'),
    };
  }

  function findEntry(entries, id) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) return entries[i];
    }
    return null;
  }

  function getOtpCode(entry) {
    return new Promise(function (resolve, reject) {
      var otpUrl = decrypt(entry, 'otp');
      if (!otpUrl) {
        reject(new Error('not_found'));
        return;
      }
      var otp;
      try {
        otp = Otp.parseUrl(otpUrl);
      } catch (e) {
        reject(new Error('otp_unsupported'));
        return;
      }
      if (otp.type !== 'totp') {
        reject(new Error('otp_unsupported'));
        return;
      }
      otp.next(function (err, code, timeLeftMs) {
        if (err || !code) {
          reject(new Error('otp_unsupported'));
          return;
        }
        resolve({ code: code, period: otp.period, remaining: Math.round((timeLeftMs || 0) / 1000) });
      });
    });
  }

  /* ------------------------------------------------------------------- auth */

  function handleAuth(id, params, config) {
    if (!config.enabled) {
      audit('kc.auth', '', 'disabled');
      return Promise.resolve(makeError(id, 'disabled', 'external access is switched off'));
    }
    params = params || {};
    if (typeof params.token === 'string' && params.token) {
      return extAccess.resolveToken(params.token).then(function (resolved) {
        if (!resolved) {
          audit('kc.auth', '', 'unauthorized');
          return makeError(id, 'unauthorized', 'unknown, expired or revoked token');
        }
        client = resolved;
        audit('kc.auth', '', 'ok');
        announceSession();
        return makeResult(id, authResult(config));
      });
    }
    if (typeof params.bootstrap === 'string' && params.bootstrap) {
      return extAccess.consumeBootstrap(params.bootstrap).then(function (exchanged) {
        if (!exchanged) {
          audit('kc.auth', '', 'unauthorized');
          return makeError(id, 'unauthorized', 'invalid or expired bootstrap code');
        }
        client = exchanged.client;
        audit('kc.auth', '', 'paired');
        announceSession();
        var result = authResult(config);
        result.sessionToken = exchanged.token;
        result.tokenExpiresAt = exchanged.client.expiresAt;
        return makeResult(id, result);
      });
    }
    return Promise.resolve(makeError(id, 'unauthorized', 'send token or bootstrap'));
  }

  /* Published so the settings page can show who is connected right now. */
  function announceSession() {
    extAccess.patchStatus({
      authenticated: true,
      clientId: client.id,
      clientName: client.name,
      error: '',
    });
  }

  function authResult(config) {
    return {
      protocol: PROTOCOL_VERSION,
      version: version,
      clientId: client.id,
      scopes: config.scopes,
    };
  }

  /* ---------------------------------------------------------------- methods */

  function requireEntries(id, method, target) {
    return getEntries().then(function (entries) {
      if (!entries) {
        audit(method, target, 'locked');
        return { error: makeError(id, 'locked', 'the vault is locked') };
      }
      return { entries: entries };
    });
  }

  function dispatch(id, method, params, config) {
    if (method === 'keepass_status') {
      return getEntries().then(function (entries) {
        audit(method, '', 'ok');
        return makeResult(id, {
          unlocked: !!entries,
          version: version,
          protocol: PROTOCOL_VERSION,
          scopes: config.scopes,
        });
      });
    }

    if (method === 'create_entry' || method === 'update_entry' || method === 'delete_entry') {
      audit(method, '', 'not_supported');
      return Promise.resolve(makeError(id, 'not_supported', 'write methods are reserved for a future version'));
    }

    if (method === 'list_groups') {
      if (!config.scopes.groups) return denied(id, method);
      return requireEntries(id, method).then(function (ctx) {
        if (ctx.error) return ctx.error;
        var pathsByUuid = groupPathsByUuidFrom(ctx.entries);
        var seen = {};
        var groups = [];
        ctx.entries.forEach(function (entry) {
          if (!entry.groupUuid || seen[entry.groupUuid]) return;
          if (!groupAllowed(config, entry, pathsByUuid)) return;
          seen[entry.groupUuid] = true;
          groups.push({ uuid: entry.groupUuid, name: entry.groupName || '', path: entry.groupPath || '' });
        });
        audit(method, '', 'ok');
        return makeResult(id, { groups: groups });
      });
    }

    if (method === 'search_entries') {
      if (!config.scopes.entries) return denied(id, method);
      return requireEntries(id, method).then(function (ctx) {
        if (ctx.error) return ctx.error;
        var pathsByUuid = groupPathsByUuidFrom(ctx.entries);
        var query = String((params && params.query) || '').toLocaleLowerCase();
        var group = String((params && params.group) || '').toLocaleLowerCase();
        var out = [];
        for (var i = 0; i < ctx.entries.length && out.length < SEARCH_LIMIT; i++) {
          var entry = ctx.entries[i];
          if (!groupAllowed(config, entry, pathsByUuid)) continue;
          if (group && (entry.groupPath || '').toLocaleLowerCase().indexOf(group) < 0) continue;
          if (query) {
            var hay = (entry.filterKey || '').toLocaleLowerCase();
            if (hay && hay.indexOf(query) < 0) continue;
            if (!hay) {
              var simple = ((entry.title || '') + ' ' + decrypt(entry, 'userName') + ' ' + (entry.url || '')).toLocaleLowerCase();
              if (simple.indexOf(query) < 0) continue;
            }
          }
          out.push(entryMeta(entry));
        }
        audit(method, query, 'ok');
        return makeResult(id, { entries: out });
      });
    }

    if (method === 'get_entry') {
      if (!config.scopes.entries) return denied(id, method);
      return requireEntries(id, method, params && params.id).then(function (ctx) {
        if (ctx.error) return ctx.error;
        var entry = findEntry(ctx.entries, params && params.id);
        if (!entry || !groupAllowed(config, entry, groupPathsByUuidFrom(ctx.entries))) {
          audit(method, params && params.id, 'not_found');
          return makeError(id, 'not_found', 'no such entry (or outside the allowed groups)');
        }
        var meta = entryMeta(entry);
        if (config.scopes.secrets) {
          meta.password = decrypt(entry, 'password');
          meta.notes = entry.notes || '';
          var custom = {};
          (entry.keys || []).forEach(function (key) {
            if (['title', 'userName', 'password', 'url', 'notes', 'otp'].indexOf(key) < 0) {
              custom[key] = entry[key];
            }
          });
          (function () {
            var pd = entry.protectedData || {};
            Object.keys(pd).forEach(function (key) {
              if (['password', 'otp', 'userName'].indexOf(key) < 0) custom[key] = decrypt(entry, key);
            });
          })();
          meta.customFields = custom;
        }
        audit(method, entry.title, 'ok');
        return makeResult(id, meta);
      });
    }

    if (method === 'get_password') {
      if (!config.scopes.secrets) return denied(id, method);
      return requireEntries(id, method, params && params.id).then(function (ctx) {
        if (ctx.error) return ctx.error;
        var entry = findEntry(ctx.entries, params && params.id);
        if (!entry || !groupAllowed(config, entry, groupPathsByUuidFrom(ctx.entries))) {
          audit(method, params && params.id, 'not_found');
          return makeError(id, 'not_found', 'no such entry (or outside the allowed groups)');
        }
        audit(method, entry.title, 'ok');
        return makeResult(id, { password: decrypt(entry, 'password') });
      });
    }

    if (method === 'get_otp') {
      if (!config.scopes.otp) return denied(id, method);
      return requireEntries(id, method, params && params.id).then(function (ctx) {
        if (ctx.error) return ctx.error;
        var entry = findEntry(ctx.entries, params && params.id);
        if (!entry || !groupAllowed(config, entry, groupPathsByUuidFrom(ctx.entries))) {
          audit(method, params && params.id, 'not_found');
          return makeError(id, 'not_found', 'no such entry (or outside the allowed groups)');
        }
        return getOtpCode(entry).then(
          function (otp) {
            audit(method, entry.title, 'ok');
            return makeResult(id, otp);
          },
          function (err) {
            var code = err && err.message === 'not_found' ? 'not_found' : 'otp_unsupported';
            audit(method, entry.title, code);
            return makeError(id, code, code === 'not_found' ? 'the entry has no OTP' : 'only TOTP codes can be read');
          }
        );
      });
    }

    return Promise.resolve(makeError(id, 'bad_request', 'unknown method: ' + method));
  }

  function denied(id, method) {
    audit(method, '', 'denied');
    return Promise.resolve(makeError(id, 'denied', 'the required scope is not granted'));
  }

  /*
   * Handles one incoming text frame. Returns { response, authed, fatal }:
   * `fatal` asks the caller to close the connection after sending the response
   * (auth failure before authentication). Unparseable frames get no response.
   */
  function handle(text) {
    var msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      return Promise.resolve({ response: null, authed: !!client, fatal: false });
    }
    if (!msg || typeof msg.method !== 'string') {
      return Promise.resolve({ response: null, authed: !!client, fatal: false });
    }
    var id = msg.id == null ? null : msg.id;

    if (!client) {
      if (msg.method !== 'kc.auth') {
        return Promise.resolve({
          response: makeError(id, 'unauthorized', 'authenticate first'),
          authed: false,
          fatal: true,
        });
      }
      return extAccess.getConfig().then(function (config) {
        return handleAuth(id, msg.params, config).then(function (response) {
          var failed = !!(response && response.error);
          return { response: response, authed: !failed, fatal: failed };
        });
      });
    }

    return extAccess.getConfig().then(function (config) {
      if (!config.enabled) {
        audit(msg.method, '', 'disabled');
        return { response: makeError(id, 'disabled', 'external access is switched off'), authed: true, fatal: true };
      }
      // An open socket was authenticated once; revoking the client must not wait
      // for it to drop. Every request re-checks that the client is still allowed.
      return extAccess.isClientActive(client.id).then(function (active) {
        if (!active) {
          audit(msg.method, '', 'revoked');
          extAccess.patchStatus({
            authenticated: false,
            error: 'revoked or expired',
          });
          return {
            response: makeError(id, 'unauthorized', 'this client was revoked or its token expired'),
            authed: false,
            fatal: true,
          };
        }
        if (!checkRateLimit(config)) {
          audit(msg.method, '', 'rate_limited');
          return { response: makeError(id, 'rate_limited', 'too many requests, slow down'), authed: true, fatal: false };
        }
        extAccess.touchClient(client.id);
        extAccess.patchStatus({ lastRequestAt: Date.now() });
        return dispatch(id, msg.method, msg.params, config).then(function (response) {
          return { response: response, authed: true, fatal: false };
        });
      });
    });
  }

  /*
   * Which client this connection belongs to, so the socket owner can re-check it
   * when the client list changes (a revoke should drop an open connection at
   * once, not at the next request).
   */
  function currentClientId() {
    return client ? client.id : null;
  }

  return { handle: handle, currentClientId: currentClientId };
}

export { createExtApi, PROTOCOL_VERSION };
