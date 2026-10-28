# Chrome Web Store Listing — Keepass Cat

> Last Updated: 2026-10-27
> Single source of truth for the Chrome Web Store (and, where noted, Firefox AMO) listing.
>
> **Maintenance:** update this file whenever `scripts/manifest.ts` gains or loses a
> permission, whenever store-facing copy changes, and whenever a version is submitted.
> The packaged zips are built by CI from the extension output only, so this file is never
> shipped to the stores.

## Store Listing

**Extension Name** [REQUIRED]
Keepass Cat

**Short Description** [REQUIRED]
Open-source KeePass extension: kdbx database, one-click autofill, full password management (add, delete, edit). Self-hosted, secure.

> Exactly 132 characters — Chrome's hard limit. Any edit must *replace* text; appending will
> fail the upload. Must match `manifest.description` in `scripts/manifest.ts:37`.

**Detailed Description** [REQUIRED]

Keepass Cat connects your existing KeePass database to your browser. It opens the .kdbx file you already use — from your own WebDAV server, or straight from your computer in Chrome — and fills your logins as you browse. There is no Keepass Cat account and no server of ours: your database stays where you put it.

What it does

One-click autofill fills the username and password for the site you are on, and handles two-step logins where the password is asked for on a second page.

Four levels of URL matching rank the entry that fits the current site, with an optional regular expression when a site needs a looser or stricter rule.

Full entry management: create, edit and delete entries and groups, change passwords with the built-in generator, add custom fields, and store OTP secrets (otpauth://) with one-click codes and a countdown.

Local database file, in Chrome: point the extension at a .kdbx file on disk and changes are written straight back to that file. If another program changed the file in the meantime, the save is refused instead of overwriting it.

Your data stays yours: no analytics, no tracking, no advertising, and never a copy on our servers.

How to use it

1. Open the extension and choose your database: connect a WebDAV account, or, in Chrome, pick a .kdbx file from your computer.
2. Enter the master password, and the key file if your database uses one.
3. Browse to a site and click the matching entry, or press Ctrl + Shift + Space to fill the single best match.
4. Edit entries in the popup; changes are saved back to your database.

Privacy and permissions

The extension reads the current page only to find login fields and to match the site against your entries. It asks for access to pages so it can fill forms on whichever sites you choose to use it with. Nothing is sent to the developer and there is no telemetry.

Support

Questions and bug reports: https://github.com/helloworldbugs/keepass-cat/issues

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Autofill and manage the passwords stored in the user's own KeePass database.

**Primary Language** [REQUIRED]
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `src/assets/icons/exported/128x128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | 🟡 Verify | in dashboard |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | 🟡 Verify | in dashboard |
| Screenshot 3 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 4 | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 5 | 1280×800 or 640×400 | ⬜ Not created | |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

<!-- Status options: ⬜ Not created | 🟡 Needs update | ✅ Ready -->

### Screenshot Notes

Screenshots live only in the dashboard — they are not in this repository, so they drift
silently when the UI changes. Worth showing, in order: the entry list with matches for the
current site; the unlock screen; the editor with the password generator and OTP field; the
settings page with the database providers.

Every new feature that changes the popup (for example the local-file sync button) is a
reason to re-check the screenshots.

## Permissions Justification

<!-- Every permission in manifest.json needs a justification. The review team reads these.
     Be specific about WHY and WHICH user-facing feature, or the submission is rejected. -->

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Stores the user's settings and the locally cached database. The cache is encrypted; the master password is never stored in plaintext. |
| `clipboardWrite` | permissions | Copies a password or a one-time code to the clipboard when the user clicks the copy button. Nothing is read from the clipboard. |
| `alarms` | permissions | Runs the periodic cleanup that expires remembered secrets and clears the clipboard after the user's chosen delay, so a copied password does not stay on the clipboard forever. |
| `notifications` | permissions | Shows a short system notification for actions that finish outside the popup (for example a one-time code copied by the keyboard shortcut), then clears it automatically. |
| `activeTab` | permissions | Reads the visible tab as an image so the user can scan an otpauth QR code from a web page into an entry. Granted by the toolbar click that opens the popup, which is exactly when the scan can run. |
| `tabs` | permissions | Reads the URL of the active tab to rank entries against the current site and to update the toolbar badge. Also used to message the content script in that tab. |
| `webNavigation` | permissions | Enumerates the frames of the active tab so autofill and one-time-code filling also work inside iframes. No navigation data is stored or transmitted. |
| `scripting` | permissions | Injects the fill routine into the page the user triggered, including frames. Runs only on the user's action (click, keyboard shortcut or toolbar button), never in the background on its own. |
| `offscreen` | permissions | Chrome only. The Manifest V3 service worker has no DOM, so the clipboard can only be cleared through a small offscreen document. Used solely for that. |
| `https://*/*`, `http://*/*` | host_permissions | The extension fills logins on arbitrary sites the user visits, and the database may be hosted on any WebDAV server. Matching happens locally against the user's entries; page content is never transmitted anywhere. |

Firefox build note: the MV2 manifest merges the host permissions into `permissions`,
because Firefox cannot prompt for per-site access after a user gesture. The justification
above is the same for AMO.

## Privacy & Data Use

<!-- Maps to the CWS data-use disclosure form. Must match what is already declared in the
     dashboard — verify before changing an answer, and keep the two in sync. -->

### Data Collection

**Does the extension collect user data?** Yes — only within the user's own device and their
own database server; nothing is sent to the developer.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | Yes | Only to the WebDAV endpoint the user configures (or not at all when the database is a local file) | Storing and autofilling the credentials in the user's own KeePass database | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | Yes — the current tab's URL, in memory | No | Ranking the user's entries against the site being visited, and the toolbar badge | No |
| User activity | No | No | — | No |
| Website content | Yes — form fields on the page where the user triggers a fill | No | Locating username/password inputs to autofill them | No |

No analytics, no crash reporting, no advertising identifiers, and no developer-operated
server of any kind.

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
https://github.com/helloworldbugs/keepass-cat/blob/main/PRIVACY.md

<!-- Keep PRIVACY.md in step with the table above. The 1.2.1 review was blocked because a
     newly added permission had no rationale; a mismatch between this file, PRIVACY.md and
     the dashboard costs days. -->

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name** [REQUIRED]
helloworldbugs

**Contact Email** [REQUIRED]
alive13460@gmail.com

**Support URL / Email** [RECOMMENDED]
https://github.com/helloworldbugs/keepass-cat/issues

**Homepage URL** [RECOMMENDED]
https://github.com/helloworldbugs/keepass-cat

## Version History

<!-- Most recent first. CI adds the tag, the release and the store upload automatically
     when `package.json` version is bumped on main; add the row here in the same change. -->

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.3.3 | 2026-10-29 | Entry rows slide in on hover again, eased over a quarter of a second; the 1.3.2 hover fix had left the slide unanimated, which read as a jump | Published |
| 1.3.2 | 2026-10-28 | Local files: add and keep several .kdbx files at once, each with its own name, remove action and remembered password; a file added by an earlier version is migrated on first open without losing it. The .kdbx picker only offers .kdbx, and the key-file dialog only .key/.keyx. A provider's database list folds away when its switch is off | Published |
| 1.3.1 | 2026-10-28 | Unlock screen: slider with tick marks and a value bubble, larger keyfile picker with a "No keyfile" row, keyfile icon turns gold when one is chosen, password field focused on open; clipboard timeout offers 15 s / 30 s / 1 min / 3 min / 5 min / 10 min with a per-copy alarm; entry rows no longer clip descenders and are more compact; the WebDAV action cells no longer wrap; the username clipboard notice is translated | Published |
| 1.3.0 | 2026-10-26 | Local .kdbx file backend (Chrome only); default autofill shortcut shown in settings; switching a database provider off now forgets its cached secrets; groups identified by UUID | Published |
| 1.2.3 | 2026-10-26 | Rebuild the view from the saved database instead of a re-download; empty groups stay visible; skip the download when the database is unchanged | Published |
| 1.2.2 | 2026-10-23 | See the GitHub release notes | Published |
| 1.2.1 | 2026-10-21 | See the GitHub release notes — resubmitted after adding privacy justifications for `offscreen` and `activeTab` | Published |
| 1.2.0 | 2026-10-21 | See the GitHub release notes | Published |

<!-- Status options: Draft | Submitted | In Review | Published | Rejected -->

## Review Notes

<!-- For our records and for the agent; not published. -->

### Known Issues / Limitations

- The local-file backend is Chrome only: Firefox has no File System Access API, so the
  provider reports no databases there and the section is hidden.
- Writes to a local file are refused when the file changed on disk since it was loaded.
  Editing the *same* entry in two clients is last-writer-wins — KeePass has no field-level
  merge either.
- The Firefox build is Manifest V2 on purpose: MV3 support there is still poor.
- The popup is capped at 600px wide by Chrome.

### Rejection History

| Date | Reason | Fix Applied | Resubmitted |
|------|--------|-------------|-------------|
| 2026-10-21 | `1.2.1` appeared published but the review stalled: the newly added `offscreen` and `activeTab` permissions had no privacy-practice rationale, so "Submit for review" stayed disabled | Rationale added in the dashboard for both permissions | 2026-10-21 |

### Pre-Submission Checklist

- [ ] `package.json` version bumped (and `scripts/manifest.ts` + `package-lock.json` with it)
- [ ] `manifest.description` unchanged since the copy above was written, or updated here too
- [ ] Every `permissions` / `host_permissions` entry has a row in the table above
- [ ] `PRIVACY.md` still matches the data-use table
- [ ] Store screenshots still show the current UI
- [ ] Release notes read correctly (CI generates them from commit subjects)
