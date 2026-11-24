#!/usr/bin/env node
'use strict';

/*
 * keepass-cat-mcp — the MCP bridge between a local AI client and the
 * Keepass Cat browser extension.
 *
 * Topology: the AI tool launches this script over stdio (MCP). This script runs
 * a WebSocket *server* on 127.0.0.1; the extension's background worker dials in
 * as the *client* (extensions cannot listen on sockets). Tool calls flow:
 *   AI → stdio/MCP → this script → WebSocket → extension → back.
 *
 * Credentials:
 *   - First run: the extension's External Access page hands out a one-time
 *     bootstrap code (15 min, single use). Pass it as KEEPASS_CAT_BOOTSTRAP.
 *     On first contact it is exchanged for a session token, which is written to
 *     ~/.keepass-cat-mcp/config.json. The bootstrap code never survives.
 *   - Later runs: the saved token is used. Delete the config file (or revoke
 *     the client in the extension) to force re-pairing.
 *
 * Environment:
 *   KEEPASS_CAT_PORT       port to listen on (default 19455)
 *   KEEPASS_CAT_BOOTSTRAP  one-time pairing code (first run only)
 *
 * Zero dependencies by design: the WebSocket server and the MCP stdio framing
 * are hand-rolled below. Node.js 18+.
 */

import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const PORT = parseInt(process.env.KEEPASS_CAT_PORT || '19455', 10);
const BOOTSTRAP = process.env.KEEPASS_CAT_BOOTSTRAP || '';
const CONFIG_DIR = join(homedir(), '.keepass-cat-mcp');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const REQUEST_TIMEOUT_MS = 15000;
const MCP_PROTOCOL_VERSION = '2024-11-05';

function log(...args) {
  // MCP stdio: stdout is protocol-only, so every diagnostic goes to stderr.
  console.error('[keepass-cat-mcp]', ...args);
}

/* ------------------------------------------------------------- credentials */

function loadToken() {
  try {
    if (!existsSync(CONFIG_PATH)) return '';
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return typeof config.token === 'string' ? config.token : '';
  } catch (e) {
    return '';
  }
}

function saveToken(token) {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CONFIG_PATH, JSON.stringify({ token }, null, 2) + '\n', { mode: 0o600 });
  } catch (e) {
    log('could not save the session token:', e.message);
  }
}

/* --------------------------------------------------- websocket (server) */

function wsAccept(key) {
  return createHash('sha1').update(key + WS_GUID).digest('base64');
}

/* Parses incoming client frames from a buffer; returns { frames, rest }. */
function parseFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let length = b1 & 0x7f;
    let header = 2;
    if (length === 126) {
      if (buffer.length - offset < 4) break;
      length = buffer.readUInt16BE(offset + 2);
      header = 4;
    } else if (length === 127) {
      if (buffer.length - offset < 10) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      header = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buffer.length - offset < header + maskLen + length) break;
    let payload = buffer.subarray(offset + header + maskLen, offset + header + maskLen + length);
    if (masked) {
      const mask = buffer.subarray(offset + header, offset + header + 4);
      const unmasked = Buffer.allocUnsafe(payload.length);
      for (let i = 0; i < payload.length; i++) unmasked[i] = payload[i] ^ mask[i % 4];
      payload = unmasked;
    }
    frames.push({ fin, opcode, payload });
    offset += header + maskLen + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function encodeFrame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length]);
  } else if (length < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/* ------------------------------------------------------- extension channel */

let extensionSocket = null; // the one authenticated-or-authenticating connection
let extensionAuthed = false;
let nextRequestId = 1;
const pendingRequests = new Map(); // id -> { resolve, reject, timer }

function sendToExtension(object) {
  if (!extensionSocket) return false;
  try {
    extensionSocket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(object), 'utf8')));
    return true;
  } catch (e) {
    return false;
  }
}

/*
 * The extension is a WebSocket *client*, and the MV3 service worker behind it is
 * recycled whenever the browser decides to idle it. That drops the socket, and
 * the extension only re-dials on its 30-second keepalive alarm - so a tool call
 * arriving in that window would otherwise fail for no better reason than timing.
 *
 * A request therefore waits for the connection instead of assuming it: up to
 * RETRY_ATTEMPTS polls, one second apart. Only the "not connected yet" case is
 * retried; a request that was actually written and then timed out is NOT resent,
 * because the extension may have executed it already.
 */
const RETRY_ATTEMPTS = 10;
const RETRY_DELAY_MS = 1000;

function waitForExtension(attempt) {
  if (extensionSocket && extensionAuthed) return Promise.resolve();
  if (attempt >= RETRY_ATTEMPTS) {
    return Promise.reject(
      new Error(
        'the Keepass Cat extension is not connected (is the browser running, and external access enabled?)'
      )
    );
  }
  return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS)).then(() =>
    waitForExtension(attempt + 1)
  );
}

async function callExtension(method, params) {
  await waitForExtension(0);
  return new Promise((resolve, reject) => {
    if (!extensionSocket || !extensionAuthed) {
      reject(new Error('the Keepass Cat extension disconnected while sending the request'));
      return;
    }
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('the extension did not answer in time'));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(id, { resolve, reject, timer });
    if (!sendToExtension({ jsonrpc: '2.0', id, method, params: params || {} })) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      reject(new Error('could not write to the extension connection'));
    }
  });
}

function handleExtensionMessage(text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch (e) {
    return;
  }
  if (!msg || msg.id == null) return;
  const pending = pendingRequests.get(msg.id);
  if (!pending) return;
  pendingRequests.delete(msg.id);
  clearTimeout(pending.timer);
  if (msg.error) {
    const err = new Error(msg.error.message || msg.error.code || 'extension error');
    err.code = msg.error.code;
    pending.reject(err);
  } else {
    pending.resolve(msg.result);
  }
}

/* Authenticate the freshly connected extension socket. */
function authenticate(socket) {
  const token = loadToken();
  const params = token ? { token } : BOOTSTRAP ? { bootstrap: BOOTSTRAP } : null;
  if (!params) {
    log('no credentials: set KEEPASS_CAT_BOOTSTRAP for the first pairing, or re-pair from the extension settings.');
    socket.end();
    return;
  }
  const id = nextRequestId++;
  const timer = setTimeout(() => {
    pendingRequests.delete(id);
    log('authentication timed out; closing the connection.');
    socket.destroy();
  }, REQUEST_TIMEOUT_MS);
  pendingRequests.set(id, {
    timer,
    resolve(result) {
      extensionAuthed = true;
      if (result && typeof result.sessionToken === 'string' && result.sessionToken) {
        saveToken(result.sessionToken);
        log('paired successfully; the session token was saved to', CONFIG_PATH);
      } else {
        log('connected to Keepass Cat (existing token).');
      }
    },
    reject(err) {
      log('authentication failed:', err.message);
      socket.destroy();
    },
  });
  socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method: 'kc.auth', params }), 'utf8')));
}

function onSocketData(socket, chunk) {
  // Phase 1: the HTTP upgrade handshake (buffered per socket until "\r\n\r\n").
  if (!socket.upgraded) {
    socket.hsBuffer = Buffer.concat([socket.hsBuffer, chunk]);
    const end = socket.hsBuffer.indexOf('\r\n\r\n');
    if (end < 0) {
      if (socket.hsBuffer.length > 8192) socket.destroy();
      return;
    }
    const head = socket.hsBuffer.subarray(0, end).toString('latin1');
    const keyMatch = /sec-websocket-key:\s*(\S+)/i.exec(head);
    if (!keyMatch || !/^GET\s/i.test(head)) {
      socket.destroy();
      return;
    }
    socket.upgraded = true;
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + wsAccept(keyMatch[1]) + '\r\n\r\n'
    );
    // Only one extension: a new connection replaces a stale one.
    if (extensionSocket && extensionSocket !== socket) {
      try {
        extensionSocket.destroy();
      } catch (e) {
        /* already gone */
      }
    }
    extensionSocket = socket;
    extensionAuthed = false;
    authenticate(socket);
    // Bytes that arrived after the header terminator are already frames.
    chunk = socket.hsBuffer.subarray(end + 4);
    socket.hsBuffer = Buffer.alloc(0);
    if (!chunk.length) return;
  }
  // Phase 2: framed WebSocket traffic.
  socket.wsBuffer = Buffer.concat([socket.wsBuffer, chunk]);
  drainFrames(socket);
}

function drainFrames(socket) {
  const parsed = parseFrames(socket.wsBuffer || Buffer.alloc(0));
  socket.wsBuffer = parsed.rest;
  for (const frame of parsed.frames) {
    if (frame.opcode === 0x8) {
      socket.end();
    } else if (frame.opcode === 0x9) {
      socket.write(encodeFrame(0xA, frame.payload));
    } else if (frame.opcode === 0x1 && frame.fin) {
      handleExtensionMessage(frame.payload.toString('utf8'));
    }
    // Continuation frames are not expected from the extension (its messages are
    // small); fragmented frames are dropped rather than reassembled.
  }
}

function startServer() {
  const server = createServer((socket) => {
    socket.setNoDelay(true);
    socket.upgraded = false;
    socket.hsBuffer = Buffer.alloc(0);
    socket.wsBuffer = Buffer.alloc(0);
    socket.on('data', (chunk) => onSocketData(socket, chunk));
    const drop = () => {
      if (extensionSocket === socket) {
        extensionSocket = null;
        extensionAuthed = false;
      }
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      log('port ' + PORT + ' is already in use - is another keepass-cat-mcp instance running?');
      process.exit(1);
    }
    log('server error:', err.message);
  });
  server.listen(PORT, '127.0.0.1', () => {
    log('listening on 127.0.0.1:' + PORT + ', waiting for the Keepass Cat extension to connect.');
  });
}

/* ----------------------------------------------------------- MCP on stdio */

const TOOLS = [
  {
    name: 'keepass_status',
    description: 'Check whether the Keepass Cat vault is unlocked and which scopes this bridge has.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_groups',
    description: 'List the vault groups (folders) visible to this bridge.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_entries',
    description: 'Search vault entries by keyword and/or group. Returns metadata only (id, title, userName, url, groupPath, hasOtp). Use the id with get_entry, get_password or get_otp.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'keyword matched against title, user name, URL, notes and tags' },
        group: { type: 'string', description: 'restrict to a group path substring' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_entry',
    description: 'Get one entry by id. Includes password, notes and custom fields only when the secrets scope is granted.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_password',
    description: 'Get the password of one entry by id. Requires the secrets scope.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_otp',
    description: 'Get the current TOTP code of one entry by id. Only the current code is returned, never the OTP secret.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

function mcpResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function mcpToolText(id, text, isError) {
  return mcpResult(id, {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  });
}

async function handleMcp(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    return mcpResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'keepass-cat-mcp', version: '1.0.0' },
    });
  }
  if (method === 'ping') {
    return mcpResult(id, {});
  }
  if (method === 'tools/list') {
    return mcpResult(id, { tools: TOOLS });
  }
  if (method === 'tools/call') {
    const name = params && params.name;
    const args = (params && params.arguments) || {};
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return mcpToolText(id, 'unknown tool: ' + name, true);
    try {
      const result = await callExtension(name, args);
      return mcpToolText(id, JSON.stringify(result, null, 2));
    } catch (err) {
      return mcpToolText(id, (err.code ? err.code + ': ' : '') + err.message, true);
    }
  }
  // Notifications (initialized, cancelled, ...) and anything else: no response.
  return null;
}

function startStdio() {
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch (e) {
      return;
    }
    if (!message || typeof message.method !== 'string') return;
    try {
      const response = await handleMcp(message);
      if (response && message.id != null) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err) {
      if (message.id != null) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32000, message: String((err && err.message) || err) },
          }) + '\n'
        );
      }
    }
  });
}

startServer();
startStdio();

// Keep the process alive even if stdin closes unexpectedly; the AI tool kills us.
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
