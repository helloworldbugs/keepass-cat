'use strict';

/*
 * The extension's side of the local-AI bridge.
 *
 * Extensions cannot listen on sockets, so the roles are inverted: the MCP bridge
 * (started by the AI client) runs the WebSocket *server* on 127.0.0.1, and this
 * module is the *client* that keeps a connection to it while external access is
 * enabled. Requests arrive on that connection; the bridge authenticates itself
 * first (see lib/extApi/protocol.js) and nothing sensitive crosses before that.
 *
 * MV3 notes: the service worker dies and the socket dies with it, so reconnects
 * are driven from three directions - worker start, config changes, and a
 * repeating alarm that wakes the worker and re-dials while the feature is on.
 * The alarm is also what notices the bridge starting *after* the worker did
 * (the common case: the user opens their AI tool later in the day).
 */

import { createExtApi } from '@/lib/extApi/protocol.js';

const KEEPALIVE_ALARM = 'extBridgeKeepalive';
const KEEPALIVE_PERIOD_MIN = 0.5;

/*
 * deps:
 *   extAccess  the ExtAccess service
 *   getEntries () => Promise<entry[]|null>   (null while locked)
 *   decrypt    (entry, field) => string
 *   version    extension version string
 */
function startExtBridge(deps) {
  var socket = null;
  var connecting = false;

  function ensureAlarm(on) {
    if (on) {
      chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_PERIOD_MIN });
    } else {
      chrome.alarms.clear(KEEPALIVE_ALARM);
    }
  }

  function closeSocket() {
    if (!socket) return;
    try {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    } catch (e) {
      /* already gone */
    }
    socket = null;
  }

  function connect() {
    if (socket || connecting) return;
    deps.extAccess.getConfig().then(function (config) {
      if (!config.enabled) {
        ensureAlarm(false);
        return;
      }
      connecting = true;
      var ws;
      try {
        ws = new WebSocket('ws://127.0.0.1:' + config.port + '/');
      } catch (e) {
        connecting = false;
        return;
      }
      var api = createExtApi({
        extAccess: deps.extAccess,
        getEntries: deps.getEntries,
        decrypt: deps.decrypt,
        version: deps.version,
      });
      ws.onopen = function () {
        socket = ws;
        connecting = false;
        ensureAlarm(true);
        console.log('[ext-bridge] connected to the MCP bridge on port', config.port);
      };
      ws.onmessage = function (event) {
        api
          .handle(String(event.data))
          .then(function (outcome) {
            if (outcome.response) {
              try {
                ws.send(JSON.stringify(outcome.response));
              } catch (e) {
                /* socket died mid-answer */
              }
            }
            // A failed handshake is the end of the connection: the peer could not
            // prove it is a paired client, so nothing else it says is interesting.
            if (outcome.fatal) closeSocket();
          })
          .catch(function () {
            /* a handler bug must not kill the socket */
          });
      };
      ws.onerror = function () {
        // onclose follows and does the cleanup.
      };
      ws.onclose = function () {
        if (socket === ws) socket = null;
        connecting = false;
        // Nothing listening is the normal state (the AI is not running), so the
        // keepalive alarm simply tries again later.
      };
    });
  }

  function ensure() {
    deps.extAccess.getConfig().then(function (config) {
      if (config.enabled) connect();
      else {
        closeSocket();
        ensureAlarm(false);
      }
    });
  }

  // Re-dial while the feature is on. The alarm also wakes the worker, which is
  // how a bridge started hours later still gets picked up.
  chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === KEEPALIVE_ALARM) ensure();
  });

  // Config edits apply immediately: off tears down, on dials right away, a port
  // change reconnects.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.extAccess) {
      closeSocket();
      ensure();
    }
  });

  // First attempt as the worker comes up.
  ensure();

  return { ensure: ensure };
}

export { startExtBridge };
