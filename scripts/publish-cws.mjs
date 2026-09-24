#!/usr/bin/env node
/**
 * Publishes a packaged extension to the Chrome Web Store.
 *
 * Talks to the Chrome Web Store API v2 (https://chromewebstore.googleapis.com);
 * the v1 API is retired on 2026-10-15, so nothing here uses it.
 *
 * Credentials come from the environment, never from a file checked into git:
 *   CWS_SERVICE_ACCOUNT_JSON  the service-account key, as the raw JSON text
 *   CWS_PUBLISHER_ID          the publisher ID from the developer dashboard
 *   CWS_EXTENSION_ID          the extension's item ID in the store
 *
 * Usage:
 *   node scripts/publish-cws.mjs keepass-cat-chrome.zip
 *   node scripts/publish-cws.mjs keepass-cat-chrome.zip --dry-run
 *
 * Deliberately dependency-free (node:fs + node:crypto + global fetch) so the
 * release workflow can run it with nothing but the checked-out repository.
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

const BASE = 'https://chromewebstore.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

// The upload is processed asynchronously server-side, so :fetchStatus is polled
// a bounded number of times instead of trusting the first response.
const STATUS_POLL_ATTEMPTS = 10;
const STATUS_POLL_DELAY_MS = 3000;

/** Print a readable message and stop. Used instead of throwing so callers never
 *  see a stack trace for an expected misconfiguration. */
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const base64url = (input) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** Return the response body, or print the status and full body and exit. */
const readBody = async (response, label) => {
  const text = await response.text();
  if (!response.ok) {
    console.error(`HTTP ${response.status} ${response.statusText} — ${label}`);
    console.error(text);
    process.exit(1);
  }
  return text;
};

async function main() {
  const [zipPath, ...flags] = process.argv.slice(2);
  const dryRun = flags.includes('--dry-run');

  if (!zipPath) {
    fail('Usage: node scripts/publish-cws.mjs <path-to-zip> [--dry-run]');
  }

  const serviceAccountJson = process.env.CWS_SERVICE_ACCOUNT_JSON;
  const publisherId = process.env.CWS_PUBLISHER_ID;
  const extensionId = process.env.CWS_EXTENSION_ID;

  const missing = [
    ['CWS_SERVICE_ACCOUNT_JSON', serviceAccountJson],
    ['CWS_PUBLISHER_ID', publisherId],
    ['CWS_EXTENSION_ID', extensionId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    fail(
      `Chrome Web Store publishing is not configured — missing environment variable(s): ${missing.join(', ')}.\n` +
        'Provide the service-account JSON and the publisher/item IDs to publish.',
    );
  }

  let zipBytes;
  try {
    zipBytes = readFileSync(zipPath);
  } catch (error) {
    fail(`Cannot read the extension package at ${zipPath}: ${error.message}`);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch (error) {
    fail(`CWS_SERVICE_ACCOUNT_JSON is not valid JSON: ${error.message}`);
  }
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    fail('CWS_SERVICE_ACCOUNT_JSON must contain both "client_email" and "private_key".');
  }

  const uploadUrl = `${BASE}/upload/v2/publishers/${publisherId}/items/${extensionId}:upload`;
  const statusUrl = `${BASE}/v2/publishers/${publisherId}/items/${extensionId}:fetchStatus`;
  const publishUrl = `${BASE}/v2/publishers/${publisherId}/items/${extensionId}:publish`;

  // ── 1. Mint an access token from the service account ──
  // A self-signed JWT (RS256) exchanged for an OAuth2 access token, hand-rolled
  // so the workflow needs no google-auth dependency.
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const signingInput =
    `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.` +
    `${base64url(JSON.stringify(claims))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const assertion = `${signingInput}.${base64url(signer.sign(serviceAccount.private_key))}`;

  const tokenBody = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });
  const tokenText = await readBody(tokenResponse, `POST ${TOKEN_URL}`);
  const accessToken = JSON.parse(tokenText).access_token;
  if (!accessToken) {
    fail('The token endpoint did not return an access_token.');
  }
  console.log('Minted a Chrome Web Store access token from the service account.');

  if (dryRun) {
    // Still mint the token above: that proves the credentials are valid without
    // touching the store item.
    console.log('[dry-run] Credentials work; skipping the write calls. Requests that would be made:');
    console.log(`[dry-run] POST ${uploadUrl}`);
    console.log(
      `[dry-run]   Authorization: Bearer <token>, Content-Type: application/zip, body: ${zipBytes.length} bytes (${zipPath})`,
    );
    console.log(`[dry-run] GET  ${statusUrl}   (only if the upload does not report SUCCEEDED)`);
    console.log(`[dry-run] POST ${publishUrl}`);
    console.log(
      '[dry-run]   Authorization: Bearer <token>, Content-Type: application/json, body: {"publishType":"DEFAULT_PUBLISH"}',
    );
    return;
  }

  // ── 2. Upload the package (media upload) ──
  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/zip',
    },
    body: zipBytes,
  });
  const uploadText = await readBody(uploadResponse, `POST ${uploadUrl}`);
  const uploadState = JSON.parse(uploadText).uploadState;
  console.log(`Upload accepted: uploadState=${uploadState ?? 'unknown'}`);

  // ── 3. Wait for the asynchronous upload to succeed ──
  if (uploadState !== 'SUCCEEDED') {
    let state = uploadState;
    for (let attempt = 1; attempt <= STATUS_POLL_ATTEMPTS; attempt += 1) {
      if (attempt > 1) await sleep(STATUS_POLL_DELAY_MS);
      const statusResponse = await fetch(statusUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const statusText = await readBody(statusResponse, `GET ${statusUrl}`);
      const statusJson = JSON.parse(statusText);
      // fetchStatus reports a recent upload as `lastAsyncUploadState`; the docs'
      // `uploadState` wording is inconsistent between methods, so accept both.
      state = statusJson.lastAsyncUploadState ?? statusJson.uploadState;
      console.log(`Upload status (attempt ${attempt}/${STATUS_POLL_ATTEMPTS}): ${state ?? 'unknown'}`);
      if (state === 'SUCCEEDED') break;
      if (state === 'FAILED') {
        console.error('Chrome Web Store reported that the upload failed:');
        console.error(statusText);
        process.exit(1);
      }
    }
    if (state !== 'SUCCEEDED') {
      fail(
        `Upload did not reach SUCCEEDED after ${STATUS_POLL_ATTEMPTS} status checks (last state: ${state ?? 'unknown'}).`,
      );
    }
  }

  // ── 4. Publish the uploaded draft ──
  // The upload above only replaces the store item's *draft*; :publish is what
  // actually submits that draft for review / staged rollout.
  const publishResponse = await fetch(publishUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
  });
  const publishText = await readBody(publishResponse, `POST ${publishUrl}`);
  const publishJson = JSON.parse(publishText);
  console.log(`Publish requested: state=${publishJson.state ?? 'unknown'}`);
}

main().catch((error) => {
  // Anything that escaped the explicit checks becomes one readable line, never
  // a raw stack trace.
  console.error(`Chrome Web Store publish failed: ${error.message}`);
  process.exit(1);
});
