# Privacy Policy

**Keepass Cat** is an open-source browser extension that lets you autofill and manage the passwords stored in your own KeePass (.kdbx) database, hosted on your own WebDAV server.

## Data We Handle

Keepass Cat handles **authentication information** — specifically the passwords, usernames, and other credentials you store in your KeePass database.

## Where Your Data Lives

- **On your device:** Data is cached locally in your browser's storage, encrypted with AES-CBC. Your master password is never stored in plaintext and is decrypted only in memory.
- **On your own server:** Your database is synced to the WebDAV server you configure. We (the developers) have no access to it.

## What We Do NOT Collect

- We do not collect, transmit, or store any of your data on our own servers.
- We do not collect personal information (name, email, address), health, financial, or location data.
- We do not use analytics, tracking, or advertising.
- We do not sell or share your data with any third party.

## Permissions

The extension requests permissions solely to perform its single purpose:
- **activeTab / scripting / host permissions** — to detect and fill username/password fields on the page you choose.
- **tabs / webNavigation** — to read the current page URL and match it against your entries (badge count).
- **storage** — to store your settings and the locally-encrypted cache.
- **clipboardWrite** — to copy a password or TOTP code when you click copy.
- **alarms / notifications** — to clear the clipboard/expired passwords and notify you.

## Contact

For questions, open an issue at https://github.com/helloworldbugs/keepass-cat/issues

---

# 隐私政策（中文）

**Keepass Cat** 是一款开源的浏览器扩展，用于自动填充和管理你存储在自己 KeePass（.kdbx）数据库中的密码（数据库托管在你自己的 WebDAV 服务器上）。

- 本扩展处理**身份验证信息**（密码、用户名等凭据），但仅存储在你的设备本地（AES-CBC 加密）和/或你自己的 WebDAV 服务器上。
- **我们（开发者）不收集、不传输、不存储你的任何数据**，也没有自己的服务器来存放它们。
- 我们不收集个人信息、健康、财务、位置等数据，不使用任何分析/追踪/广告，不向任何第三方出售或分享你的数据。
- 扩展申请的权限仅用于实现其单一用途（自动填充、匹配、本地存储、剪贴板复制、定时清理与通知）。

如有疑问，请到 https://github.com/helloworldbugs/keepass-cat/issues 提交问题。
