# 🐱 Keepass Cat — KeePass Browser Extension

English | [中文](README.md)

[![Releases](https://img.shields.io/badge/releases-latest-blue)](https://github.com/helloworldbugs/keepass-cat/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![CI](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/helloworldbugs/keepass-cat/actions)

> Keepass Cat is a lightweight, open-source KeePass browser extension that connects your existing KeePass database (.kdbx) on your WebDAV cloud directly to your browser, enabling password autofill and full entry management — create, read, edit, and delete. You can ditch local KeePass / KeePassXC clients entirely: a browser extension is all you need.

---

## 📋 Table of Contents

- [🐱 Keepass Cat — KeePass Browser Extension](#-keepass-cat--keepass-browser-extension)
  - [📋 Table of Contents](#-table-of-contents)
  - [✨ Features](#-features)
  - [🗄️ Database Management](#️-database-management)
    - [Entry Operations](#entry-operations)
    - [📁 Group Management](#-group-management)
    - [🔐 TOTP Two-Factor Authentication](#-totp-two-factor-authentication)
  - [⌨️ Keyboard Shortcuts](#️-keyboard-shortcuts)
  - [🧠 4-Level URL Matching](#-4-level-url-matching)
    - [Matching Levels](#matching-levels)
    - [Matching Flow](#matching-flow)
    - [Badge Count Logic](#badge-count-logic)
    - [Regular Expression Matching](#regular-expression-matching)
  - [⚡ Autofill Engine](#-autofill-engine)
    - [Two Trigger Methods](#two-trigger-methods)
    - [Field Detection Algorithm](#field-detection-algorithm)
    - [Iframe Cross-Origin Autofill](#iframe-cross-origin-autofill)
  - [☁️ Cloud Storage](#️-cloud-storage)
    - [Storage Backend Architecture](#storage-backend-architecture)
  - [🔐 Security Design](#-security-design)
    - [Encrypted Storage](#encrypted-storage)
    - [Two-Tier Memory System](#two-tier-memory-system)
    - [Forget Timer](#forget-timer)
    - [Security Principles](#security-principles)
    - [Keyfiles](#keyfiles)
  - [🚀 Quick Start](#-quick-start)
    - [Installation](#installation)
    - [Development](#development)
    - [Build Output](#build-output)
  - [🏗️ Tech Stack](#️-tech-stack)
  - [📐 Architecture Overview](#-architecture-overview)
    - [Data Flow](#data-flow)
  - [🧪 Testing](#-testing)
  - [🙏 Acknowledgements](#-acknowledgements)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🕐 **Forget Timer** | Configurable unlock remember period: 30 minutes → forever, auto-clears on expiry |
| 🔢 **Badge Count** | Real-time count of matching password entries shown on the extension icon |
| ⚡ **One-Click Autofill** | Click an entry to autofill username and password |
| 🧠 **4-Level Matching** | Original 4-level URL matching (with regex support) that ranks the best-matching entry |
| ✏️ **CRUD** | Edit title, username, password (with strong password generator), URL, notes, and TOTP right in the popup; saves back to the KDBX file on WebDAV |
| 📂 **Group Management** | Create, rename, and delete groups; move entries between groups |
| 🔐 **TOTP 2FA** | One-click copy of TOTP codes (with countdown), with edit support (`otpauth://`) |
| 🔄 **WebDAV Sync** | WebDAV cloud sync (Jianguoyun / Nextcloud and other self-hosted services), auto-writes changes back |
| 🌍 **i18n (EN & ZH)** | Full English/Chinese UI, auto-detects browser language |
| 🛡️ **Manifest V3** | Full Chrome MV3 support, plus Firefox MV2 |

---

## 🗄️ Database Management

### Entry Operations

| Action | Description |
|--------|-------------|
| ➕ **Create** | Fill in title, username, password, URL (regex supported), notes, and select a group |
| ✏️ **Edit** | Click the pencil icon, modify any field, click save |
| 🗑️ **Delete** | Double confirmation to prevent accidental deletion; auto-uploads after delete |
| 📋 **Copy** | One-click copy of username or password to the clipboard |
| 🔗 **Open URL** | Click the icon to open the entry URL in a new tab |
| 🔑 **Generate Password** | Click the key icon to generate a 16-20 character mixed password |
| 🔐 **TOTP** | Clock icon on list items copies the current code (with countdown); enable via `otpauth://` in the edit page |

### 📁 Group Management

```
📁 Social
  ├── 🔑 Twitter
  ├── 🔑 Facebook
  └── 🔑 Instagram
📁 Work
  ├── 🔑 Company Email
  ├── 🔑 Internal System
  └── 🔑 VPN
📁 Bank
  ├── 🔑 ICBC
  └── 🔑 CMB
```

- Create / rename / delete groups
- Move entries freely between groups
- Tree-style browsing with expand/collapse

### 🔐 TOTP Two-Factor Authentication

- Supports the `otpauth://` standard (SHA1 / SHA256 / SHA512, 6-8 digit codes, including Steam format)
- Password list shows a clock icon + plain-text countdown (e.g. `24s`); click to copy the current code
- Edit page toggles "Enable TOTP" to add/modify the `otpauth://` URL

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Command | Description |
|----------|---------|-------------|
| `Ctrl+Shift+Space` | Open popup | Open the Keepass Cat popup |
| `Ctrl+Shift+X` | Best-match autofill | Autofill the best-matching entry on the current page |

> Shortcuts can be customized at `chrome://extensions/shortcuts`.

---

## 🧠 4-Level URL Matching

An original **4-level URL matching algorithm** that drives both **badge count** and **autofill priority ranking**, ensuring the most relevant entry always ranks first.

### Matching Levels

| Level | Condition | Example | Score |
|:---:|---|---|:---:|
| **4** | Entry URL fully contained in page URL | Entry `a.com/admin` → page `a.com/admin/login` | **100** |
| **3** | Protocol + host + port exactly match | Entry `https://a.com` → page `https://a.com/any` | **75** |
| **2** | Same domain (last two segments) | Entry `a.example.com` → page `b.example.com` | **50** |
| **1** | Regular expression match | Entry `regex:login\..*\.com` → page `login.test.com` | **25** |
| **0** | No match | Any unrelated URL | **0** |

### Matching Flow

```
Page URL  ──→  Level 4: contains match?  ──→  ✅ show first
    │              │
    │              └──→  Level 3: same-origin?  ──→  ✅ second priority
    │                       │
    │                       └──→  Level 2: same domain?  ──→  ✅ third priority
    │                                │
    │                                └──→  Level 1: regex?  ──→  ✅ fallback
    │                                         │
    │                                         └──→  Level 0: no match
```

### Badge Count Logic

```
1. Iterate all cached entries, compute the highest match level for each
2. Count entries reaching the highest level
3. Show that number on the extension icon
4. Auto-update on tab switch
```

### Regular Expression Matching

Prefix the entry URL with `regex:` to use a regular expression:

```
regex:login\..*\.com    →  matches all login.*.com subdomains
regex:10\.0\.\d+\.\d+   →  matches all 10.0.x.x intranet IPs
regex:192\.168\.\d+\.\d+:8080  →  matches a specific subnet and port
```

---

## ⚡ Autofill Engine

### Two Trigger Methods

| Method | Action | Use Case |
|--------|--------|----------|
| 🖱️ **Popup click** | Open the Keepass Cat popup and click an entry | Most common; browse and choose |
| ⌨️ **Shortcut** | `Ctrl+Shift+X` | Fast autofill, no mouse |

### Field Detection Algorithm

Keepass Cat uses a **dual-method detection** to locate username/password fields on the page:

**Method 1: Focus (preferred)**
```
Cursor position → detect adjacent inputs → skip hidden/invisible elements → precise targeting
```
- Focus on username field → search forward for the first visible `type="password"` input
- Focus on password field → search backward for the first visible non-password input
- Auto-skip `type="hidden"` and other invisible elements

**Method 2: Global scan (fallback)**
```
Iterate all visible inputs → pair by type → generate username-password pair list
```
- Detect registration forms (two consecutive password fields) and exclude them
- Handle standalone password fields (no username pairing)

### Iframe Cross-Origin Autofill

```
┌─────────────────────────────────┐
│  Main page (gitee.com)          │
│  ┌───────────────────────────┐  │
│  │  iframe (udesk.cn)         │  │
│  │  [username] [password] [login]  │  │  ← can also autofill!
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

- Content script injected into **all frames**
- Each frame independently performs **origin security checks**
- Whitelist mechanism for known cross-origin scenarios (e.g. bank websites)

---

## ☁️ Cloud Storage

Keepass Cat syncs KeePass databases via the **WebDAV** protocol:

| Backend | Type | Description |
|---------|------|-------------|
| 🔗 **WebDAV** | Self-hosted | Supports Jianguoyun and other WebDAV services; scans directories to auto-discover `.kdbx` files, with upload/save support |

### Storage Backend Architecture

```
PasswordFileStoreRegistry (registry)
    └── WebdavFileManager (WebDAV)
```

All backends implement the `FileManager` interface and are registered/dispatched via `PasswordFileStoreRegistry`.

---

## 🔐 Security Design

### Encrypted Storage

```
┌──────────────┐     AES-CBC      ┌──────────────────┐
│  plaintext    │  ──────────────→  │  chrome.storage   │
│  (passwords/  │   256-bit key    │  (encrypted)       │
│   entries)    │                  │                    │
└──────────────┘                  └──────────────────┘
```

- Encrypted with **AES-CBC 256-bit** in `chrome.storage.session` or `chrome.storage.local`
- Key generated at runtime via the Web Crypto API, never persisted
- Custom serialization for binary data (ArrayBuffer → Base64)

### Two-Tier Memory System

| Tier | Storage | Lifetime | Purpose |
|------|---------|----------|---------|
| **Session tier** | `storage.session` | Browser session | Temporary cache, auto-cleared on session end |
| **Local tier** | `storage.local` | Persistent | "Remember forever" mode, across browser restarts |

### Forget Timer

```
Remember period:  [Never]  [30 min]  [2 h]  [4 h]  [8 h]  [24 h]  [This session]  [Forever]
                  ──────────────────────────────────────────────────────────────────────────→
```

- Auto-clears the master password and cached entries on expiry
- Checks the expiry timer every 2 minutes
- Supports password-expiry and clipboard-expiry notifications

### Security Principles

- 🔒 Master password decrypted only in memory, **never persisted as plaintext**
- 🚫 No sensitive information logged to console
- ✅ Read-only by default; writes back to the KDBX file only on explicit user save
- 🛡️ Origin check: verifies frame-hostname consistency before autofill

### Keyfiles

- Supports all four KeePass keyfile formats: XML (recommended), 32-byte, hex, and hash
- Keyfiles can be combined with a master password or used alone
- Keyfiles are stored in browser local storage; websites and other extensions cannot access them

---

## 🚀 Quick Start

### Installation

1. Download the latest version from [Releases](https://github.com/helloworldbugs/keepass-cat/releases)
2. Extract to a local directory
3. Open `chrome://extensions` and enable "Developer mode"
4. Click "Load unpacked" and select the extracted directory

### Development

```bash
# Clone the repository
git clone https://github.com/helloworldbugs/keepass-cat.git
cd keepass-cat

# Install dependencies
npm install --legacy-peer-deps

# Development mode (hot reload)
npm run dev

# Production build
npm run build

# Build content script only
npm run build:js

# Build background script only
npm run build:background
```

### Build Output

| Command | Input | Output |
|---------|-------|--------|
| `build:web` | `src/` (Vue popup/options) | `extension/dist/` |
| `build:background` | `background/background.js` | `extension/dist/background/index.mjs` |
| `build:js` | `background/inject.js` (content script) | `extension/dist/contentScripts/index.global.js` |

---

## 🏗️ Tech Stack

| Technology | Purpose |
|------------|---------|
| [Vue 3](https://vuejs.org/) (`@vue/compat`) | Popup UI framework |
| [Vite](https://vitejs.dev/) | Build tool |
| [kdbxweb](https://github.com/keeweb/kdbxweb) | KeePass database parsing |
| [Argon2](https://github.com/antelle/argon2-browser) | KDF key derivation |
| [webdav](https://github.com/perry-mitchell/webdav-client) | WebDAV client |
| [Chrome Extensions API](https://developer.chrome.com/docs/extensions/reference/) | Browser extension API |
| GitHub Actions | CI/CD automated build |

---

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Popup (Vue 3)                      │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Startup │ │FilePicker│ │  Unlock  │ │ Edit    │ │
│  │         │ │          │ │          │ │         │ │
│  └─────────┘ └──────────┘ └──────────┘ └─────────┘ │
│                        │                             │
│                  UnlockedState                       │
│            (state + clipboard + autofill)            │
├────────────────────────┼─────────────────────────────┤
│               SecureCacheMemory                       │
│          (port bridge popup ↔ background)             │
├────────────────────────┼─────────────────────────────┤
│              Background Service Worker                │
│  ┌──────────────────────────────────────────────┐   │
│  │  ProtectedMemory  │  Settings  │ Badge update │   │
│  │  (AES-CBC)         │  (config)  │ (icon count) │   │
│  │  LocalMemory       │            │ shortcut     │   │
│  │  (persistent)      │            │ session      │   │
│  └──────────────────────────────────────────────┘   │
├────────────────────────┼─────────────────────────────┤
│             Content Script (inject.js)                │
│  ┌──────────────────────────────────────────────┐   │
│  │  field detection │ fillPassword │ origin check │   │
│  │  (focus + global) │ (value + DOM  │ (hostname   │   │
│  │                  │  events)      │  verify)    │   │
│  └──────────────────────────────────────────────┘   │
├────────────────────────┼─────────────────────────────┤
│                    Services                           │
│  ┌──────────┐ ┌────────────┐ ┌──────────────────┐  │
│  │ Keepass  │ │ Keepass    │ │ PasswordFileStore│  │
│  │ Service  │ │ Reference  │ │ Registry (1)     │  │
│  └──────────┘ └────────────┘ └──────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Data Flow

```
User clicks an entry
    │
    ▼
UnlockedState.autofill(entry)
    │
    ▼
Background: autofill message
    │
    ├──→ inject content script into all frames
    │
    └──→ send fillPassword to each frame
            │
            ├── origin check (hostname match)
            │
            └── filler.fillPassword(user, pass)
                    │
                    ├── Method 1: focus (preferred)
                    │   └── skip hidden elements, find the real password field
                    │
                    └── Method 2: global scan (fallback)
                        └── iterate all visible inputs, pair and fill
```

---

## 🧪 Testing

> ⚠️ The current `tests/` directory is legacy from the AngularJS codebase and has not been migrated to the Vue 3 + Vite stack. `package.json` has no `test` script, so `npm test` is unavailable. Test infrastructure is planned (Vitest).

---

## 🙏 Acknowledgements

- Original project: [subdavis/Tusk](https://github.com/subdavis/Tusk)
- Fork maintained by: [helloworldbugs](https://github.com/helloworldbugs)
- KeePass parsing: [keeweb/kdbxweb](https://github.com/keeweb/kdbxweb)
- Built with [Vue 3](https://vuejs.org/) · [Vite](https://vitejs.dev/) · [Chrome Extensions](https://developer.chrome.com/docs/extensions/)

---

<p align="center">
  <sub>Made with ❤️ by the Keepass Cat community</sub>
</p>
