import fs from 'fs-extra';
import type { Manifest } from 'webextension-polyfill';
import { isDev, log, port, r } from './utils';

const action = {
  default_icon: '/assets/38x38.png',
  default_popup: './dist/popup.html',
  default_title: 'Keepass Cat',
};

const backgroundScript = './dist/background/index.mjs';

const executeAction = {
  suggested_key: {
    windows: 'Ctrl+Shift+Space',
    mac: 'Command+Shift+Space',
    chromeos: 'Ctrl+Shift+Space',
    linux: 'Ctrl+Shift+Space',
    default: 'Ctrl+Shift+Space',
  },
};

const hostPermissions = ['https://*/*', 'http://*/*', 'file:///*/*'];

const permissions = [
  'activeTab',
  'tabs',
  'webNavigation',
  'scripting',
  'storage',
  'clipboardWrite',
  'alarms',
  'notifications',
];

const baseManifest: Manifest.WebExtensionManifest = {
  name: 'Keepass Cat - Password Access and Autofill',
  short_name: 'Keepass Cat',
  version: '1.0.0',
  description: 'Keepass Cat - KeePass password manager and autofill for Chrome and Firefox',
  default_locale: 'en',
  icons: {
    '16': '/assets/16x16.png',
    '48': '/assets/48x48.png',
    '128': '/assets/128x128.png',
  },

  options_ui: {
    page: './dist/options.html',
    open_in_tab: true,
  },
};

/**
 * Chrome requires MV3 starting in July 2024
 */
function chromeManifestV3(): Manifest.WebExtensionManifest {
  return Object.assign({}, baseManifest, {
    manifest_version: 3,
    minimum_chrome_version: '102',
    permissions,
    content_security_policy: {
      extension_pages: isDev
        ? // this is required on dev for Vite script to load
          `script-src \'self\' \'wasm-unsafe-eval\' http://localhost:${port}; object-src \'self\'`
        : "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    action,
    commands: {
      _execute_action: executeAction,
      autofill_best_match: {
        suggested_key: { default: 'Ctrl+Shift+X' },
        description: '__MSG_autofillBestMatch__',
      },
    },
    background: {
      service_worker: backgroundScript,
    },
    host_permissions: hostPermissions,
  });
}

/**
 * Manifest V3 support in Firefox is abysmal, so we're sticking with V2 for now
 */
function firefoxManifestV2(): Manifest.WebExtensionManifest {
  return Object.assign({}, baseManifest, {
    manifest_version: 2,
    browser_specific_settings: {
      gecko: {
        id: 'brandon@subdavis.com',
      },
    },
    browser_action: action,
    commands: {
      _execute_browser_action: executeAction,
      autofill_best_match: {
        suggested_key: { default: 'Ctrl+Shift+X' },
        description: '__MSG_autofillBestMatch__',
      },
    },
    permissions: [
      ...permissions,
      // Firefox implements user initiated flag improperly and canot prompt for site access
      // so we just have to give Keepass Cat everything from the start.
      ...hostPermissions,
    ],
    background: {
      scripts: [backgroundScript],
    },
  });
}

export async function writeManifest(target: 'chrome' | 'firefox' = 'chrome') {
  const manifest = target === 'chrome' ? chromeManifestV3() : firefoxManifestV2();
  await fs.writeJSON(r('extension/manifest.json'), manifest, { spaces: 2 });
  log('PRE', 'write manifest.json ' + target);
}

writeManifest(process.env.TARGET as 'chrome' | 'firefox');
