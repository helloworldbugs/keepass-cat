<script>
import GoBack from '@/components/GoBack.vue';
import { Otp } from '@/lib/otp.js';
import { scanVisibleTabForOtpUrl } from '@/lib/qrScan.js';
import { i18n } from '@/services/i18n';

// An error toast clears itself after this long, leaving the user on the form so
// they can fix the problem. Success/progress toasts are driven elsewhere.
const ERROR_TOAST_MS = 5000;

// KDBX keeps the expiry in UTC; a datetime-local input speaks local time, so the
// two directions are converted here and nowhere else.
function toDateTimeLocal(dateish) {
  const date = dateish instanceof Date ? dateish : new Date(dateish);
  if (isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    'T' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  );
}

// A month out when the user first turns expiry on: picking "now" would make the
// entry immediately invisible to matching.
const DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

// The footer label has no room for a timezone, so it shows the local time in a
// compact form; the input remains the place for precise edits.
function formatDateTime(dateish) {
  if (!dateish) return '';
  const date = dateish instanceof Date ? dateish : new Date(dateish);
  if (isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes())
  );
}

export default {
  components: { GoBack },
  props: {
    unlockedState: Object,
    keepassService: Object,
    secureCache: Object,
    settings: Object,
    links: Object,
  },
  data() {
    return {
      entry: null,
      isNew: false,
      editFields: {},
      // Password field starts masked on every open and only reveals when the
      // user asks for it (or a generated password is written into the field).
      // Kept out of editFields so a toggle never looks like a value change.
      isPasswordVisible: false,
      // OTP block state. `otpEditing` shows the input row; `otpRemoved`
      // records that the user pressed the block's delete button this session,
      // which means "remove the stored OTP on save". `loadedOtp` keeps the
      // value the entry had when the form opened, so an empty input can mean
      // "no change". `hasSavedOtp` restores the button+hint after a delete.
      otpEditing: false,
      otpRemoved: false,
      qrScanning: false,
      loadedOtp: '',
      hasSavedOtp: false,
      groups: [],
      selectedGroupUuid: '',
      saving: false,
      message: '',
      // 'progress' | 'success' | 'error' - drives the status toast colour/icon.
      messageKind: '',
      messageTimer: null,   // pending auto-hide for the status toast
      navTimer: null,       // pending "return to list" after a successful save
      deleteClick: 0,   // 0=not clicked, 1=clicked once (show confirm), 2=delete now
      fromBrowse: false,
      deleting: false,
      // Custom string fields shown at the bottom of the form. `originalName`
      // is the exact name as loaded from the file (null for rows the user
      // added) so a rename can delete the old field and write the new one.
      customFields: [],
      // Expiry lives on the entry's times, not in its fields: a preset list in the
      // footer row, plus a datetime-local input when "Custom" is chosen.
      expires: false,
      expiresAt: '',
      expiryMenuOpen: false,
      // Which preset is highlighted; a date loaded from the file counts as custom.
      expiryChoice: 'never',
      // Entry history: the list is fetched when the menu opens. `viewingHistory`
      // previews a version read-only; `historyRestore` means that version has been
      // pulled into the editable form; `pendingDelete` is the snapshot the Save
      // button will drop.
      historyOpen: false,
      historyLoading: false,
      historyList: [],
      viewingHistory: null,
      historyRestore: false,
      pendingDelete: null,
      // Snapshot of the names present when the form opened. Compared against
      // the rows at save time to work out what was deleted or renamed.
      loadedCustomNames: [],
      customFieldsLoading: false,
      customFieldsLoadError: '',
      customKeySeq: 1,
    };
  },
  computed: {
    // Live per-row problems, keyed by row key. Names that are blank on a row
    // the user has not filled in yet are not errors - they are just ignored.
    customFieldErrors() {
      const builtin = { title: true, username: true, password: true, url: true, notes: true };
      // Internal bookkeeping fields that must not be shadowed by a custom field.
      const internal = { otp: true };
      const errors = {};
      const seen = Object.create(null);
      for (const row of this.customFields) {
        const name = (row.name || '').trim();
        if (name === '' && (row.value || '') === '') continue; // untouched add row
        if (name === '') {
          errors[row.key] = this.$t('Field name cannot be empty.');
          continue;
        }
        const lower = name.toLowerCase();
        if (builtin[lower]) {
          errors[row.key] = this.$t('"{0}" is a built-in field.', name);
          continue;
        }
        if (internal[lower]) {
          errors[row.key] = this.$t('"{0}" is used by Keepass Cat internally.', name);
          continue;
        }
        if (seen[lower]) {
          errors[row.key] = this.$t('"{0}" is listed more than once.', name);
        } else {
          seen[lower] = true;
        }
      }
      return errors;
    },
    // Icon shown in the status toast, matched to the message kind.
    messageIcon() {
      if (this.messageKind === 'success') return 'fa-check';
      if (this.messageKind === 'error') return 'fa-exclamation-triangle';
      return 'fa-spinner fa-spin';
    },
    // With "ignore expired entries" on by default, a past date hides the entry
    // from every page the moment it is saved - the label says so in the warning
    // colour instead of explaining it in a paragraph.
    expiryInPast() {
      if (!this.expires || !this.expiresAt) return false;
      const time = Date.parse(this.expiresAt);
      return !isNaN(time) && time < Date.now();
    },
    expiryOptions() {
      return [
        { key: 'never', label: this.$t('Never expires') },
        { key: 'now', label: this.$t('Expire now') },
        { key: '1w', label: this.$t('1 week') },
        { key: '2w', label: this.$t('2 weeks') },
        { key: '1m', label: this.$t('1 month') },
        { key: '3m', label: this.$t('3 months') },
        { key: '6m', label: this.$t('6 months') },
        { key: '1y', label: this.$t('1 year') },
        { key: 'custom', label: this.$t('Custom') },
      ];
    },
    expiryLabel() {
      if (!this.expires) return this.$t('Never expires');
      return formatDateTime(this.expiresAt);
    },
    expiryCustomOpen() {
      return this.expires && this.expiryChoice === 'custom';
    },
    // Tooltip for the custom-fields heading; kept here so the key's inner double
    // quotes need no HTML escaping in the template.
    protectHint() {
      return this.$t('Protect stores the value as KeePass does with "Protect value in process memory".');
    },
    // A version is previewed read-only until the user chooses to restore it; once
    // restored it is just the normal edit form holding that version's values.
    readOnly() {
      return !!this.viewingHistory && !this.historyRestore;
    },
    // Previewing a version leaves nothing to save; a pending delete or a restored
    // version does.
    saveDisabled() {
      return this.saving || (this.viewingHistory && !this.historyRestore);
    },
    // A deleted snapshot disappears from the menu until the page is saved.
    visibleHistory() {
      if (this.pendingDelete === null) return this.historyList;
      return this.historyList.filter((item) => item.index !== this.pendingDelete);
    },
    showHistoryActions() {
      return !!this.viewingHistory && !this.historyRestore;
    },
  },
  mounted() {
    // The form is remounted per entry, but reset explicitly as well so a
    // revealed password can never carry over to the next entry.
    this.isPasswordVisible = false;
    // Close the expiry preset list on any click outside it; the toggle and the
    // options stop propagation, so their own clicks never reach this.
    document.addEventListener('click', this.closeExpiryMenu);
    document.addEventListener('click', this.closeHistoryMenu);
    let route = this.$router.getRoute();
    let rawEntryId = route.entryId || '';
    // Strip query params from entryId (e.g. "abc123?from=browse" → "abc123")
    let qIdx = rawEntryId.indexOf('?');
    let entryId = qIdx >= 0 ? rawEntryId.substring(0, qIdx) : rawEntryId;
    let queryStr = qIdx >= 0 ? rawEntryId.substring(qIdx + 1) : '';
    this.fromBrowse = queryStr.indexOf('from=browse') >= 0;
    // Parse title and url from query params
    var queryTitle = '', queryUrl = '';
    try {
      queryStr.split('&').forEach(function(p) {
        var parts = p.split('=');
        if (parts[0] === 'title') queryTitle = decodeURIComponent(parts.slice(1).join('='));
        if (parts[0] === 'url') queryUrl = decodeURIComponent(parts.slice(1).join('='));
      });
    } catch(e) {}
    if (entryId === 'new') {
      this.isNew = true;
      this.editFields = {
        title: queryTitle || '',
        userName: '',
        url: queryUrl || '',
        notes: '',
        password: '',
        otp: ''
      };
    } else {
      this.entry = this.unlockedState.cacheGet('allEntries').filter((entry) => {
        return entry.id == entryId;
      })[0];
      if (this.entry) {
        let editableKeys = ['title', 'userName', 'url', 'notes', 'password'];
        for (let key of editableKeys) {
          if (key === 'password') {
            this.editFields[key] = this.unlockedState.getDecryptedAttribute(this.entry, key);
          } else {
            this.editFields[key] = this.entry[key] || '';
          }
        }
        // OTP
        let otpUrl = this.unlockedState.getDecryptedAttribute(this.entry, 'otp') || '';
        this.editFields.otp = otpUrl;
        this.loadedOtp = otpUrl;
        // The entry has an OTP iff it has a non-empty `otp` value, whether
        // stored as a protected field (protectedData.otp) or a plain field -
        // the same rule the entry lists use. The input is shown from the start
        // when there is one, otherwise the "Add OTP" button is.
        let protectedOtp = this.entry.protectedData && this.entry.protectedData.otp;
        this.hasSavedOtp = protectedOtp
          ? !!(protectedOtp.value && protectedOtp.value.length > 0)
          : !!this.entry.otp;
        this.otpEditing = this.hasSavedOtp;
        // Expiry: `expires` is the switch, `expiry` the timestamp (absent when the
        // entry never expires).
        this.expires = !!this.entry.expires;
        this.expiresAt = this.entry.expiry ? toDateTimeLocal(this.entry.expiry) : '';
        this.expiryChoice = this.expires ? 'custom' : 'never';
      }
    }
    // Load groups keyed by UUID (same-named groups stay distinct), merging in
    // groups referenced by cached entries when the group cache is stale.
    let allEntries = this.unlockedState.cacheGet('allEntries') || [];
    const byUuid = {};
    const byName = {};
    const addGroup = function(uuid, name, parentUuid, path) {
      name = name || '';
      path = path || name;
      if (uuid) {
        if (!byUuid[uuid]) {
          byUuid[uuid] = { uuid: uuid, name: name, parentUuid: parentUuid || null, path: path };
        } else if (!byUuid[uuid].name && name) {
          byUuid[uuid].name = name;
          if (!byUuid[uuid].path) byUuid[uuid].path = path;
        }
      } else if (name && !byName[name]) {
        byName[name] = { uuid: null, name: name, parentUuid: parentUuid || null, path: path };
      }
    };
    (this.keepassService.getGroups() || []).forEach(function(g) {
      addGroup(g.uuid || null, g.name, g.parentUuid, g.path);
    });
    allEntries.forEach(function(e) {
      if (e.groupUuid) addGroup(e.groupUuid, e.groupName, null, e.groupPath);
      else if (e.groupName) addGroup(null, e.groupName, null, e.groupPath);
    });
    // A name-only legacy row is redundant when a UUID row already has that
    // name/path; legacy entries are then resolved onto the UUID row.
    const uuidNames = {};
    const uuidPaths = {};
    Object.keys(byUuid).forEach(function(uuid) {
      const g = byUuid[uuid];
      if (g.name) uuidNames[g.name] = true;
      if (g.path) uuidPaths[g.path] = true;
    });
    let groupList = Object.keys(byUuid).map(function(uuid) { return byUuid[uuid]; });
    Object.keys(byName).forEach(function(name) {
      const g = byName[name];
      if (!uuidNames[g.name] && !uuidPaths[g.path]) groupList.push(g);
    });
    groupList.sort(function(a, b) {
      return (a.path || a.name || '').localeCompare(b.path || b.name || '');
    });
    this.groups = groupList;
    if (this.isNew || !this.entry) {
      this.selectedGroupUuid = this.groupOptionValue(this.groups[0]);
    } else {
      // Older cached entries have no groupUuid; resolve by name/path. When it
      // cannot be resolved, keep it empty so save skips the move entirely.
      this.selectedGroupUuid = this.resolveEntryGroupUuid(this.entry);
    }
    // Custom fields only exist for saved entries; a new entry starts empty.
    if (!this.isNew && this.entry) {
      this.loadCustomFields(this.entry.id);
    }
  },
  beforeUnmount() {
    if (this.messageTimer) clearTimeout(this.messageTimer);
    if (this.navTimer) clearTimeout(this.navTimer);
    this.messageTimer = null;
    this.navTimer = null;
    document.removeEventListener('click', this.closeExpiryMenu);
    document.removeEventListener('click', this.closeHistoryMenu);
  },
  methods: {
    // Select value: the UUID when known, otherwise the legacy group name.
    groupOptionValue(group) {
      if (!group) return '';
      return group.uuid || group.name || '';
    },
    // Resolve an entry's group UUID, falling back to its name/path for entries
    // restored from a cache written before groupUuid existed.
    resolveEntryGroupUuid(entry) {
      if (!entry) return '';
      if (entry.groupUuid) return entry.groupUuid;
      return this.uuidForGroupName(entry.groupName, entry.groupPath);
    },
    uuidForGroupName(name, path) {
      if (!name && !path) return '';
      let byName = '';
      for (const g of this.groups) {
        if (!g.uuid) continue;
        if (path && g.path === path) return g.uuid;
        if (!path && name && g.name === name && !byName) byName = g.uuid;
      }
      if (byName) return byName;
      if (path) {
        for (const g of this.groups) {
          if (g.uuid && name && g.name === name) return g.uuid;
        }
      }
      return '';
    },
    // Single entry point for the status toast. It clears any pending auto-hide
    // first, so a timer from an older message can never hide a newer one.
    // Errors clear themselves after ERROR_TOAST_MS; pass autoHideMs to override.
    showMessage(kind, text, autoHideMs = kind === 'error' ? ERROR_TOAST_MS : 0) {
      if (this.messageTimer) {
        clearTimeout(this.messageTimer);
        this.messageTimer = null;
      }
      this.messageKind = kind;
      this.message = text;
      if (autoHideMs > 0) {
        this.messageTimer = setTimeout(() => {
          this.messageTimer = null;
          this.message = '';
          this.messageKind = '';
        }, autoHideMs);
      }
    },
    // Reveal/hide the password. Only the input's `type` changes, so the value
    // in editFields is never touched and no change event is emitted.
    togglePasswordVisibility() {
      this.isPasswordVisible = !this.isPasswordVisible;
    },
    generatePassword() {
      var upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      var lower = 'abcdefghijklmnopqrstuvwxyz';
      var digits = '0123456789';
      var specials = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      var all = upper + lower + digits + specials;
      var pick = function(str, n) {
        var result = '';
        for (var i = 0; i < n; i++) result += str[Math.floor(Math.random() * str.length)];
        return result;
      };
      var hasConsecutiveDup = function(s) {
        for (var i = 1; i < s.length; i++) if (s[i] === s[i - 1]) return true;
        return false;
      };
      var password;
      // Regenerate until no two consecutive characters are equal
      do {
        var len = 16 + Math.floor(Math.random() * 5); // 16-20
        var extra = len - 16;
        var chars = pick(upper, 4) + pick(lower, 4) + pick(digits, 4) + pick(specials, 4)
          + pick(all, extra);
        // Shuffle
        var arr = chars.split('');
        for (var i = arr.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        password = arr.join('');
      } while (hasConsecutiveDup(password));
      this.editFields.password = password;
      // Show what was generated. Stays visible until the user hides it; the
      // next manual toggle is respected as usual.
      this.isPasswordVisible = true;
    },
    // Load the entry's stored custom string fields. Runs async so the form
    // above is usable immediately; the section shows a small loading state.
    async loadCustomFields(entryId) {
      if (typeof this.keepassService.getEntryCustomFields !== 'function') return;
      this.customFieldsLoading = true;
      this.customFieldsLoadError = '';
      try {
        const fields = await this.keepassService.getEntryCustomFields(entryId);
        const list = fields || [];
        this.loadedCustomNames = list.map(function(f) { return f.name; });
        this.customFields = list.map((f) => ({
          key: this.customKeySeq++,
          name: f.name,
          value: f.value || '',
          isProtected: !!f.isProtected,
          originalName: f.name,
        }));
      } catch {
        this.customFieldsLoadError = this.$t('Failed to load custom fields.');
      }
      this.customFieldsLoading = false;
    },
    addCustomField() {
      this.customFields.push({
        key: this.customKeySeq++,
        name: '',
        value: '',
        isProtected: false,
        originalName: null,
      });
      this.$nextTick(() => {
        const inputs = this.$refs.customNameInput;
        const el = Array.isArray(inputs) ? inputs[inputs.length - 1] : inputs;
        if (el && el.focus) el.focus();
      });
    },
    removeCustomField(index) {
      this.customFields.splice(index, 1);
    },
    // Build what the service needs: the fields to write and the exact names to
    // delete. Invalid rows are skipped (and their original field kept), so a
    // bad custom row never blocks saving the rest of the form.
    buildCustomFieldPayload() {
      const errors = this.customFieldErrors;
      const customFields = [];
      const writtenNames = Object.create(null);
      const preservedOriginals = Object.create(null);
      let invalidCount = 0;
      for (const row of this.customFields) {
        const name = (row.name || '').trim();
        if (name === '' && (row.value || '') === '') continue; // untouched add row
        if (errors[row.key]) {
          invalidCount++;
          if (row.originalName) preservedOriginals[row.originalName] = true;
          continue;
        }
        customFields.push({ name, value: row.value || '', isProtected: !!row.isProtected });
        writtenNames[name] = true;
      }
      // Anything that was loaded but is no longer written was deleted or
      // renamed. An invalid row keeps its stored name so it is never lost.
      const removedFieldNames = this.loadedCustomNames.filter(function(n) {
        return !writtenNames[n] && !preservedOriginals[n];
      });
      return { customFields, removedFieldNames, invalidCount };
    },
    // Reveal the OTP input row and focus it. Starting a fresh add also clears
    // any earlier delete, so a new value is saved normally.
    startOtp() {
      this.otpEditing = true;
      this.otpRemoved = false;
      this.$nextTick(() => {
        const el = this.$refs.otpInput;
        if (el && el.focus) el.focus();
      });
    },
    // Hide the input and remember the delete, so saving removes the stored OTP.
    removeOtp() {
      this.otpEditing = false;
      this.otpRemoved = true;
      this.editFields.otp = '';
    },
    // Turning expiry on needs a date to start from; a month out is far enough that
    // a stray click cannot retire the entry on save.
    toggleExpiryMenu() {
      this.expiryMenuOpen = !this.expiryMenuOpen;
    },
    closeExpiryMenu() {
      this.expiryMenuOpen = false;
    },
    // Presets are relative to now; "custom" keeps whatever date is already there
    // (or a month out) and reveals the picker.
    chooseExpiry(option) {
      this.expiryMenuOpen = false;
      this.expiryChoice = option.key;
      if (option.key === 'never') {
        this.expires = false;
        return;
      }
      this.expires = true;
      if (option.key === 'custom') {
        if (!this.expiresAt) this.expiresAt = toDateTimeLocal(new Date(Date.now() + DEFAULT_EXPIRY_MS));
        this.$nextTick(() => {
          const el = this.$refs.expiryInput;
          if (el && el.focus) el.focus();
        });
        return;
      }
      const when = new Date();
      if (option.key === '1w') when.setDate(when.getDate() + 7);
      else if (option.key === '2w') when.setDate(when.getDate() + 14);
      else if (option.key === '1m') when.setMonth(when.getMonth() + 1);
      else if (option.key === '3m') when.setMonth(when.getMonth() + 3);
      else if (option.key === '6m') when.setMonth(when.getMonth() + 6);
      else if (option.key === '1y') when.setFullYear(when.getFullYear() + 1);
      // 'now' falls through with `when` already at the current time.
      this.expiresAt = toDateTimeLocal(when);
    },

    /* --------------------------------------------------------------- history */

    closeHistoryMenu() {
      this.historyOpen = false;
    },
    // Field names are stored as KDBX names; custom fields keep their own name.
    historyFieldLabel(name) {
      const keys = {
        Title: 'Title',
        UserName: 'Username',
        Password: 'Password',
        URL: 'URL',
        Notes: 'Notes',
        otp: 'OTP',
        expiry: 'Expiry time',
      };
      return keys[name] ? this.$t(keys[name]) : name;
    },
    // "Changed: Password, Notes". Only the first three names are spelled out so a
    // version that touched every custom field cannot produce a wall of text.
    historyChangeLabel(fields) {
      const labels = fields.map((name) => this.historyFieldLabel(name));
      const shown = labels.slice(0, 3);
      const extra = labels.length - shown.length;
      const list = shown.join(i18n.isZh ? '、' : ', ') + (extra > 0 ? ' +' + extra : '');
      return this.$t('Changed: {0}', list);
    },
    async toggleHistoryMenu() {
      this.historyOpen = !this.historyOpen;
      if (!this.historyOpen) return;
      this.historyLoading = true;
      try {
        const list = await this.keepassService.getEntryHistory(this.entry.id);
        // Newest first: the file stores snapshots oldest-first, and the version
        // a user wants is almost always the most recent one.
        this.historyList = list.slice().reverse().map((item) => ({
          ...item,
          timeLabel: formatDateTime(item.time) || this.$t('(empty)'),
        }));
      } catch (err) {
        this.historyList = [];
        this.showMessage('error', this.$t('Error: ') + err.message);
      } finally {
        this.historyLoading = false;
      }
    },
    // Show a version: the form becomes a read-only view of it, password in clear.
    async selectHistoryVersion(item) {
      try {
        const version = await this.keepassService.getHistoryVersion(this.entry.id, item.index);
        this.editFields = {
          title: version.title || '',
          userName: version.userName || '',
          url: version.url || '',
          notes: version.notes || '',
          password: version.password || '',
          otp: version.otp || '',
        };
        this.loadedOtp = version.otp || '';
        this.hasSavedOtp = !!version.otp;
        // Keeps the OTP value on screen read-only; the add/remove/scan controls
        // are hidden by the .is-readonly rules.
        this.otpEditing = !!version.otp;
        this.otpRemoved = false;
        // The version's own custom fields, shown with the rest. `loadedCustomNames`
        // deliberately keeps the live entry's names, so saving the restore removes
        // any custom field the old version does not have.
        this.customFields = (version.customFields || []).map((f) => ({
          key: this.customKeySeq++,
          name: f.name,
          value: f.value || '',
          isProtected: !!f.isProtected,
          originalName: f.name,
        }));
        this.viewingHistory = { index: item.index, label: formatDateTime(version.time) };
        this.historyRestore = false;
        // Choosing another version abandons a pending delete.
        this.pendingDelete = null;
        // The password is plaintext in the preview; the eye toggles it back to dots.
        this.isPasswordVisible = true;
        this.expires = !!version.expires;
        this.expiresAt = version.expiry ? toDateTimeLocal(version.expiry) : '';
        this.expiryChoice = this.expires ? 'custom' : 'never';
        this.expiryMenuOpen = false;
        this.historyOpen = false;
      } catch (err) {
        this.showMessage('error', this.$t('Error: ') + err.message);
      }
    },
    selectCurrentVersion() {
      this.historyOpen = false;
      this.viewingHistory = null;
      this.historyRestore = false;
      this.pendingDelete = null;
      this.restoreEditFieldsFromEntry();
      this.loadCustomFields(this.entry.id);
    },
    // Re-read the live entry into the form (also used when leaving a version).
    restoreEditFieldsFromEntry() {
      if (!this.entry) return;
      this.editFields = {
        title: this.entry.title || '',
        userName: this.entry.userName || '',
        url: this.entry.url || '',
        notes: this.entry.notes || '',
        password: this.unlockedState.getDecryptedAttribute(this.entry, 'password'),
        otp: this.unlockedState.getDecryptedAttribute(this.entry, 'otp') || '',
      };
      const otp = this.editFields.otp;
      this.loadedOtp = otp;
      this.hasSavedOtp = !!otp;
      this.otpEditing = !!otp;
      this.otpRemoved = false;
      this.isPasswordVisible = false;
      this.expires = !!this.entry.expires;
      this.expiresAt = this.entry.expiry ? toDateTimeLocal(this.entry.expiry) : '';
      this.expiryChoice = this.expires ? 'custom' : 'never';
    },
    // Restoring takes the version over into the normal edit form: the action
    // buttons go away, the fields become editable, and Save writes the entry (with
    // the state being replaced pushed to history).
    restoreHistoryVersion() {
      if (!this.viewingHistory || this.historyRestore) return;
      this.historyRestore = true;
    },
    // Deleting returns to the live entry and hides the version from the menu until
    // the page is saved.
    deleteHistoryVersion() {
      if (!this.viewingHistory) return;
      this.pendingDelete = this.viewingHistory.index;
      this.viewingHistory = null;
      this.historyRestore = false;
      this.restoreEditFieldsFromEntry();
      this.loadCustomFields(this.entry.id);
    },
    // Capture the visible part of the page and pull the otpauth:// URL out of a
    // QR code, so the user does not need a third-party scanner (which can hand
    // over a truncated URL). Best-effort: every failure becomes a toast.
    async scanOtpQr() {
      if (this.qrScanning) return;
      this.qrScanning = true;
      try {
        const result = await scanVisibleTabForOtpUrl();
        if (result.url) {
          this.editFields.otp = result.url;
          this.$nextTick(() => {
            const el = this.$refs.otpInput;
            if (el && el.focus) el.focus();
          });
          return;
        }
        const messages = {
          'no-qr': 'No QR code found on the page. Scroll the QR code into view and try again.',
          'not-otpauth': 'The QR code on the page is not an otpauth:// link.',
          'invalid-otpauth': 'The QR code contains an invalid otpauth:// link.',
        };
        this.showMessage(
          'error',
          this.$t(
            messages[result.reason] ||
              'Could not capture this page for scanning.'
          )
        );
      } catch (e) {
        this.showMessage('error', this.$t('Could not capture this page for scanning.'));
      } finally {
        this.qrScanning = false;
      }
    },
    async save() {
      // A preview with nothing chosen has nothing to commit.
      if (this.viewingHistory && !this.historyRestore) return;
      this.saving = true;
      this.showMessage('progress', this.$t('Saving...'));

      // Expiry is on the entry's times; `{ expires: false }` switches it off and
      // leaves the stored timestamp alone, like KeePass does.
      let expiry;
      if (this.expires) {
        const time = new Date(this.expiresAt);
        if (!this.expiresAt || isNaN(time.getTime())) {
          this.showMessage('error', this.$t('Choose an expiry date, or switch expiry off.'));
          this.saving = false;
          return;
        }
        expiry = { expires: true, time };
      } else {
        expiry = { expires: false };
      }

      // OTP: what gets written depends on what the user did in this session.
      if (this.otpRemoved) {
        // The block's delete button was pressed → remove the stored field.
        this.editFields.otp = null;
      } else {
        let otpUrl = (this.editFields.otp || '').trim();
        if (otpUrl) {
          try {
            Otp.parseUrl(otpUrl);
          } catch (e) {
            this.showMessage('error', this.$t('Invalid otpauth URL'));
            this.saving = false;
            return;
          }
          this.editFields.otp = otpUrl;
        } else {
          // Hidden or left empty → no change. Pass whatever the entry had, or
          // null when it had none, so the service deletes the field instead of
          // storing an empty one.
          this.editFields.otp = this.loadedOtp || null;
        }
      }

      // Validate custom fields up front so a bad row is reported rather than
      // silently breaking the save. Invalid rows are skipped, not saved.
      const customPayload = this.buildCustomFieldPayload();

      try {
        let newBuffer;
        if (this.isNew) {
          newBuffer = await this.keepassService.addEntry(
            this.selectedGroupUuid, this.editFields, customPayload.customFields, expiry
          );
        } else {
          // Skip the move when the legacy entry's group could not be resolved
          // (empty value) rather than silently moving it to an arbitrary group.
          if (this.selectedGroupUuid && this.selectedGroupUuid !== this.entry.groupUuid) {
            await this.keepassService.moveEntryToGroup(this.entry.id, this.selectedGroupUuid);
            const target = this.groups.filter(g => this.groupOptionValue(g) === this.selectedGroupUuid)[0];
            if (target) {
              if (target.uuid) this.entry.groupUuid = target.uuid;
              this.entry.groupName = target.name || this.entry.groupName;
              this.entry.groupPath = target.path || this.entry.groupPath;
            }
          }
          newBuffer = await this.keepassService.saveEntry(
            this.entry.id, this.editFields,
            customPayload.customFields, customPayload.removedFieldNames, expiry,
            {
              // A restore keeps the state it replaced, so it can be undone.
              pushHistory: this.historyRestore,
              // A pending history deletion rides along with this same save.
              deleteHistoryIndex: this.pendingDelete,
            }
          );
        }
        
        await this.persist(
          newBuffer,
          customPayload.invalidCount > 0
            ? this.$t('Saved. {0} custom field(s) were skipped due to errors.', customPayload.invalidCount)
            : this.$t('Saved!'),
          // Success needs enough dwell time to be read; the skipped-fields
          // message carries more information, so it stays a little longer.
          customPayload.invalidCount > 0 ? 1900 : 1400
        );
      } catch (err) {
        this.showMessage('error', this.$t('Error: ') + err.message);
      }
      this.saving = false;
    },
    // Uploads a freshly saved buffer, refreshes the cache the lists read from, then
    // goes back once the toast has been readable. Every save ends here: a plain
    // edit, a restored version or a dropped history version.
    async persist(newBuffer, message, dwellMs) {
      this.showMessage('progress', this.$t('Uploading...'));
      await this.keepassService.uploadDatabase(newBuffer);

      // Refresh cache from server to avoid re-unlock spinner
      try {
        let freshEntries = await this.keepassService.reparseLocal();
        this.unlockedState.cacheSet('allEntries', freshEntries);
        if (this.secureCache) {
          this.secureCache.save('secureCache.entries', freshEntries);
          this.secureCache.save('secureCache.entries', freshEntries, 'local');
        }
      } catch (e) {
        // Fallback: clear cache so next open re-downloads
        this.unlockedState.clearCache();
        if (this.secureCache) {
          this.secureCache.clear('secureCache.entries');
          this.secureCache.clear('secureCache.entries', 'local');
        }
      }

      this.showMessage('success', message);
      this.navTimer = setTimeout(() => this.$router.goBack(), dwellMs || 1400);
    },
    async deleteEntry() {
      if (this.deleteClick === 0) {
        this.deleteClick = 1;
        this.showMessage('', '');
        return;
      }
      this.deleting = true;
      this.showMessage('progress', this.$t('Deleting...'));
      try {
        let newBuffer = await this.keepassService.deleteEntry(this.entry.id);
        await this.keepassService.uploadDatabase(newBuffer);
        // Refresh cache from server
        try {
          let freshEntries = await this.keepassService.reparseLocal();
          this.unlockedState.cacheSet('allEntries', freshEntries);
          if (this.secureCache) {
            this.secureCache.save('secureCache.entries', freshEntries);
            this.secureCache.save('secureCache.entries', freshEntries, 'local');
          }
        } catch (e) {
          // Fallback: remove from cache
          let allEntries = this.unlockedState.cacheGet('allEntries') || [];
          let idx = allEntries.findIndex(e => e.id === this.entry.id);
          if (idx >= 0) allEntries.splice(idx, 1);
          this.unlockedState.cacheSet('allEntries', allEntries);
          if (this.secureCache) {
            this.secureCache.save('secureCache.entries', allEntries);
            this.secureCache.save('secureCache.entries', allEntries, 'local');
          }
        }
        this.$router.goBack();
      } catch (err) {
        this.showMessage('error', this.$t('Delete error: ') + err.message);
        this.deleteClick = 0;
      }
      this.deleting = false;
    },
  },
};
</script>

<template>
  <div class="entry-edit-view" :class="{ 'is-readonly': readOnly }">
    <go-back :message="$t('Back')">
      <template #extra>
        <!-- Save lives in the shared top bar (top-right). Compact by design so
             the bar height, driven by the 18px title line, never grows. -->
        <button
          class="bar-save-btn"
          :disabled="saveDisabled"
          :title="$t('Save')"
          @click.stop="save"
        >
          <i v-if="saving" class="fa fa-spinner fa-spin" aria-hidden="true" />
          <span>{{ saving ? $t('Saving...') : $t('Save') }}</span>
        </button>
      </template>
    </go-back>
    <div class="edit-form" v-if="entry || isNew">
      <div v-if="!isNew" class="history-bar">
        <span class="history-toggle selectable" @click.stop="toggleHistoryMenu">
          <i class="fa fa-history" />
          <span>{{ $t('History') }}</span>
          <i :class="['fa', historyOpen ? 'fa-caret-up' : 'fa-caret-down']" />
        </span>
        <span v-if="viewingHistory" class="history-time">{{ viewingHistory.label }}</span>
        <span v-if="showHistoryActions" class="history-actions">
          <span
            class="history-action is-delete selectable"
            @click.stop="deleteHistoryVersion"
          >{{ $t('Delete') }}</span>
          <span
            class="history-action is-restore selectable"
            @click.stop="restoreHistoryVersion"
          >{{ $t('Restore') }}</span>
        </span>
        <div v-if="historyOpen" class="history-menu">
          <div v-if="historyLoading" class="history-empty">{{ $t('Loading...') }}</div>
          <template v-else>
            <span class="history-option selectable" @click.stop="selectCurrentVersion">
              <span class="history-option-time">{{ $t('Current version') }}</span>
            </span>
            <div v-if="!historyList.length" class="history-empty">
              {{ $t('No earlier versions yet.') }}
            </div>
            <span
              v-for="item in visibleHistory"
              :key="item.index"
              class="history-option selectable"
              :class="{ 'is-active': viewingHistory && viewingHistory.index === item.index }"
              @click.stop="selectHistoryVersion(item)"
            >
              <span class="history-option-time">{{ item.timeLabel }}</span>
              <span v-if="item.changedFields && item.changedFields.length" class="history-option-info">
                {{ historyChangeLabel(item.changedFields) }}
              </span>
            </span>
          </template>
        </div>
      </div>
      <div class="edit-field">
        <label>{{ $t('Group') }}</label>
        <select v-model="selectedGroupUuid" :disabled="readOnly">
          <option
            v-for="g in groups"
            :key="groupOptionValue(g)"
            :value="groupOptionValue(g)"
          >{{ g.path || g.name }}</option>
        </select>
      </div>
      <div class="edit-field">
        <label>{{ $t('Title') }}</label>
        <input v-model="editFields.title" type="text" :readonly="readOnly" />
      </div>
      <div class="edit-field">
        <label>{{ $t('Username') }}</label>
        <input v-model="editFields.userName" type="text" :readonly="readOnly" />
      </div>
      <div class="edit-field">
        <label>{{ $t('Password') }}</label>
        <div class="password-row">
          <div class="password-input-wrap">
            <input
              v-model="editFields.password"
              :type="isPasswordVisible ? 'text' : 'password'"
              :readonly="readOnly"
              spellcheck="false"
            />
            <!-- Floats inside the input's right edge; the input reserves room
                 for it with padding-right so typing never runs underneath. -->
            <button
              type="button"
              class="password-toggle"
              :class="{ 'is-visible': isPasswordVisible }"
              :aria-label="isPasswordVisible ? $t('Hide password') : $t('Show password')"
              :title="isPasswordVisible ? $t('Hide password') : $t('Show password')"
              :aria-pressed="isPasswordVisible ? 'true' : 'false'"
              @click="togglePasswordVisibility"
            >
              <i
                :class="['fa', isPasswordVisible ? 'fa-eye-slash' : 'fa-eye', 'fa-fw']"
                aria-hidden="true"
              />
            </button>
          </div>
          <span class="generate-btn selectable" @click="generatePassword" :title="$t('Generate strong password')">
            <i class="fa fa-refresh" />
          </span>
        </div>
      </div>
      <div class="edit-field">
        <label class="label-help">
          {{ $t('URL') }}
          <i
            class="fa fa-exclamation-circle field-help"
            :title="$t('Supports regular expression matching: write the expression after the regex: prefix, e.g. regex:^https://.*\\.example\\.com/.*')"
          />
        </label>
        <input v-model="editFields.url" type="text" :readonly="readOnly" :placeholder="$t('e.g. https://site.com or regex:.*\\.domain\\.com/.*')" />
      </div>
      <div class="edit-field">
        <label>{{ $t('Notes') }}</label>
        <textarea v-model="editFields.notes" rows="4" :readonly="readOnly"></textarea>
      </div>
      <div v-if="!readOnly || otpEditing" class="edit-field">
        <label>{{ $t('OTP') }}</label>
        <div v-if="otpEditing" class="otp-row">
          <input
            ref="otpInput"
            v-model="editFields.otp"
            type="text"
            :readonly="readOnly"
            placeholder="otpauth://totp/...?secret=..."
          />
          <span
            class="otp-qr selectable"
            :class="{ 'is-busy': qrScanning }"
            :title="$t('Scan the page for a QR code')"
            :aria-label="$t('Scan the page for a QR code')"
            @click="scanOtpQr"
          >
            <i :class="['fa', qrScanning ? 'fa-spinner fa-pulse' : 'fa-qrcode']" />
          </span>
          <span
            class="otp-remove selectable"
            :title="$t('Remove OTP')"
            :aria-label="$t('Remove OTP')"
            @click="removeOtp"
          >
            <i class="fa fa-trash" />
          </span>
        </div>
        <template v-else>
          <div class="otp-add-btn selectable" @click="startOtp">
            <i class="fa fa-plus" /> {{ $t('Add OTP') }}
          </div>
          <p v-if="otpRemoved && hasSavedOtp" class="otp-hint">
            {{ $t('OTP will be removed when you save.') }}
          </p>
        </template>
      </div>
      <div v-if="!readOnly || customFields.length" class="custom-fields-section">
        <div class="custom-fields-header">
          <label class="custom-section-label">
            {{ $t('Custom fields') }}
            <i
              class="fa fa-exclamation-circle field-help"
              :title="protectHint"
            />
          </label>
        </div>
        <div v-if="customFieldsLoading" class="custom-empty">
          {{ $t('Loading custom fields...') }}
        </div>
        <template v-else>
          <div v-if="customFieldsLoadError" class="custom-load-error">
            {{ customFieldsLoadError }}
          </div>
          <div
            v-for="(field, i) in customFields"
            :key="field.key"
            class="custom-row"
            :class="{ invalid: customFieldErrors[field.key] }"
          >
            <div class="custom-row-top">
              <input
                ref="customNameInput"
                v-model="field.name"
                class="custom-name"
                type="text"
                :readonly="readOnly"
                :placeholder="$t('Field name')"
              />
              <label class="protect-toggle" :title="$t('Protect')">
                <input v-model="field.isProtected" type="checkbox" />
                <span>{{ $t('Protect') }}</span>
              </label>
              <span
                class="remove-btn selectable"
                :title="$t('Remove field')"
                @click="removeCustomField(i)"
              >
                <i class="fa fa-times" />
              </span>
            </div>
            <input
              v-model="field.value"
              class="custom-value"
              type="text"
              :readonly="readOnly"
              :placeholder="$t('Field value')"
            />
            <div v-if="customFieldErrors[field.key]" class="row-error">
              {{ customFieldErrors[field.key] }}
            </div>
          </div>
          <div class="add-field-area" :class="{ 'has-rows': customFields.length }">
            <div class="add-field-btn selectable" @click="addCustomField">
              <i class="fa fa-plus" /> {{ $t('Add field') }}
            </div>
          </div>
        </template>
      </div>
      <div
        v-if="message"
        class="message"
        :class="'message--' + (messageKind || 'progress')"
        :role="messageKind === 'error' ? 'alert' : 'status'"
        :aria-live="messageKind === 'error' ? 'assertive' : 'polite'"
      >
        <i class="fa fa-fw" :class="messageIcon" aria-hidden="true" />
        <span>{{ message }}</span>
      </div>
    </div>
    <!-- Footer bar: pinned to the bottom of the viewport, same width and gutter as
         the top bar, so the expiry and Delete never scroll away. -->
    <div v-if="entry || isNew" class="edit-actions">
      <div class="expiry-control">
        <span class="expiry-toggle selectable" @click.stop="toggleExpiryMenu">
          <i class="fa fa-clock-o" />
          <span class="expiry-title">{{ $t('Expiry time') }}</span>
          <span class="expiry-value" :class="{ 'is-warning': expiryInPast }">{{ expiryLabel }}</span>
          <i v-if="!readOnly" :class="['fa', expiryMenuOpen ? 'fa-caret-up' : 'fa-caret-down']" />
        </span>
        <div v-if="expiryMenuOpen" class="expiry-menu">
          <span
            v-for="option in expiryOptions"
            :key="option.key"
            class="expiry-option selectable"
            :class="{ 'is-active': option.key === expiryChoice }"
            @click.stop="chooseExpiry(option)"
          >{{ option.label }}</span>
        </div>
        <input
          v-if="expiryCustomOpen"
          ref="expiryInput"
          v-model="expiresAt"
          class="expiry-input"
          type="datetime-local"
          :readonly="readOnly"
        />
      </div>
      <span
        v-if="!isNew"
        class="delete-btn selectable"
        :title="$t('Delete')"
        @click="deleteEntry"
      >
        <i class="fa fa-trash" />
        <span v-if="deleteClick === 0"> {{ $t('Delete') }}</span>
        <span v-if="deleteClick === 1" class="confirm-text">{{ $t('Click again to confirm') }}</span>
      </span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/settings.scss';

// The view fills the popup at minimum so the footer bar can sit at the bottom even
// when an entry has few fields; the form grows to push it there.
.entry-edit-view {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

// Keep the shared top bar pinned while this form scrolls (the user wanted it
// still there after scrolling to the bottom). :deep() keeps the rule scoped to
// this screen only, so every other .box-bar consumer is untouched. The document
// (html/body) is this screen's scroll container and no
// normal flow - no layout shift and no form padding needed.
.entry-edit-view :deep(.box-bar) {
  position: sticky;
  top: 0;
  // Above the form content, below the status toast (z-index: 50).
  z-index: 40;
  // .box-bar is transparent by default, so give it the page background;
  // otherwise the form scrolls visibly through it.
  background-color: $background-color;
  // The bar's height comes from the 18px title line alone (~21px); the
  // floated #extra slot does not add to it, so the taller Save button would
  // spill over the 2px border. Lay the bar out as a fixed-height flex row
  // instead: the button is centred with an equal gap above and below and the
  // bar stays exactly 39px, which is what the toast offset below assumes.
  // `float` has no effect on a flex item, so the #extra slot still lands on
  // the right via space-between. The vertical padding is folded into 39px.
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 39px;
  padding: 0 $wall-padding;
}

.edit-form {
  // Fills the view so the footer bar is pushed to the bottom on short entries.
  flex: 1 0 auto;
  padding: $wall-padding;
}

// Entry history sits between the top bar and the first field: the same quiet
// shape as the footer's expiry control, with the versions' times in the list.
.history-bar {
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 10px;
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--keepass-cat-border-light);
}

// The two dropdown triggers share their look and their hover pill; only the icon
// differs (sized just below). The negative margin keeps the text exactly where it
// was while the tint extends past it.
.history-toggle,
.expiry-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--keepass-cat-text-subtle);
  cursor: pointer;
  white-space: nowrap;
  padding: 2px 6px;
  margin: -2px -6px;
  border-radius: 4px;
  transition: background-color 0.12s ease;
  &:hover {
    background: var(--keepass-cat-bg-hover);
  }
}

.history-toggle .fa-history,
.expiry-toggle .fa-clock-o {
  font-size: 13px;
}

.history-time {
  padding-left: 10px;
  border-left: 1px solid var(--keepass-cat-border);
  font-size: 12px;
  color: var(--keepass-cat-text-muted);
  white-space: nowrap;
}

.history-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  // Pinned to the right end of the bar, level with the version's own time.
  margin-left: auto;
}

.history-action {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  &.is-delete {
    color: var(--keepass-cat-text-subtle);
    &:hover {
      color: var(--keepass-cat-delete-hover);
      background: var(--keepass-cat-bg-hover);
    }
  }
  &.is-restore {
    color: var(--keepass-cat-blue);
    &:hover {
      background: var(--keepass-cat-bg-hover);
    }
  }
}

.history-menu {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 220px;
  max-width: 280px;
  max-height: 240px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--keepass-cat-bg-dark) transparent;
  margin-top: 4px;
  padding: 4px;
  background: var(--keepass-cat-bg-light);
  border: 1px solid var(--keepass-cat-border);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}

.history-option {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  &:hover {
    background: var(--keepass-cat-bg-hover);
  }
  &.is-active .history-option-time {
    color: var(--keepass-cat-blue);
    font-weight: 600;
  }
}

.history-option-time {
  font-size: 12px;
  color: var(--keepass-cat-text);
}

.history-option-info {
  font-size: 11px;
  color: var(--keepass-cat-text-muted);
  overflow-wrap: anywhere;
}

.history-empty {
  padding: 8px;
  font-size: 12px;
  color: var(--keepass-cat-text-muted);
}

// Previewing a version: the form keeps its normal look and the text stays
// selectable (the inputs are `readonly`), but the controls that would change it
// are gone and the password starts visible, so the eye can mask it again.
.entry-edit-view.is-readonly {
  .history-toggle {
    color: var(--keepass-cat-blue);
  }
  .generate-btn,
  .otp-add-btn,
  .otp-remove,
  .otp-qr,
  .remove-btn,
  .protect-toggle,
  .add-field-btn,
  .delete-btn {
    display: none;
  }
  // The expiry line stays visible as information, but cannot open its presets.
  .expiry-control {
    pointer-events: none;
    .expiry-input {
      display: none;
    }
  }
  // The group picker is disabled (it could still be changed from the keyboard
  // otherwise) but keeps the normal colours instead of the greyed-out disabled look.
  select {
    pointer-events: none;
    &:disabled {
      opacity: 1;
      color: var(--keepass-cat-text);
      -webkit-text-fill-color: var(--keepass-cat-text);
    }
  }
}

.delete-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 2px;
  color: var(--keepass-cat-red);
  font-size: 13px;
  cursor: pointer;
  user-select: none;
  // The expiry block beside it can grow a second line for the custom date picker;
  // the label must stay on one line and keep its width.
  white-space: nowrap;
  flex-shrink: 0;
  &:hover { opacity: 0.7; }
  .confirm-text {
    color: var(--keepass-cat-red);
    font-weight: 700;
  }
}

// Save button in the shared top bar's #extra slot. The label now matches the
// bar's own 18px (shared .box-bar font-size) for visual consistency, so the
// spinner is scaled with it (16px) to keep the icon-to-text ratio. The bar is
// flex-centred at 39px (see above): the 21.6px line (18px x 1.2) plus 4px
// padding top/bottom keeps the button at ~30px, so it still clears the bar's
// edges with the same ~3.5px gap and the bar stays 39px.
.bar-save-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  // Idle "Save" is governed by this floor; the busy label ("Saving..." plus
  // the spinner) is what actually sizes the button at runtime.
  min-width: 88px;
  // Vertical padding is the counterweight to font-size: 5 + 16x1.2 + 5 keeps
  // the button ~29px tall inside the 37px bar content box, so the gap to the
  // bar's edges and the toast offset (39 + 7 = 46px) both stay put.
  padding: 5px 16px;
  border: none;
  border-radius: 3px;
  background: $blue;
  color: var(--keepass-cat-svg-fill);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  // Same hover feedback as the plugin's other primary button (the unlock button).
  transition: opacity 0.12s ease;
  &:hover:not(:disabled) {
    opacity: 0.7;
  }
  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .fa { font-size: 14px; }
}

.edit-field {
  margin-bottom: 12px;
  label {
    display: block;
    font-size: 12px;
    font-weight: 700;
    margin-bottom: 4px;
    color: var(--keepass-cat-text-subtle);
  }
  input, textarea, select {
    width: 100%;
    box-sizing: border-box;
    padding: 8px;
    border: 1px solid $light-gray;
    border-radius: 3px;
    font-size: 14px;
    color: $text-color;
    background: $light-background-color;
    &:focus { outline: none; border-color: $blue; }
  }
}

.password-row {
  display: flex; align-items: center; gap: 6px;
  .generate-btn {
    color: $green;
    font-size: 16px;
    cursor: pointer;
    padding: 6px 8px;
    border-radius: 3px;
    flex-shrink: 0;
    &:hover { background: $light-gray; }
  }
}

// Wraps just the password input so the eye button can float inside its right
// edge without affecting the generate-key button beside it.
.password-input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;

  // 30px button + a 4px gap keeps the caret and text clear of the icon.
  input { padding-right: 34px; }
  // Edge/IE draw their own reveal control in the same corner; ours replaces it.
  input::-ms-reveal,
  input::-ms-clear { display: none; }
}

// Floats over the input, vertically centred by the 2px inset. Absolutely
// positioned so flipping fa-eye/fa-eye-slash shifts nothing in the form.
.password-toggle {
  position: absolute;
  top: 2px;
  right: 2px;
  bottom: 2px;
  width: 30px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--keepass-cat-icon-muted, #888);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  &:hover {
    background: var(--keepass-cat-bg-hover, #eef0f2);
    color: $text-color;
  }
  // Visible keyboard ring only; mouse clicks keep the quiet look.
  &:focus-visible {
    outline: 2px solid $blue;
    outline-offset: 1px;
  }
  // Plaintext mode is "on": the icon picks up the app accent.
  &.is-visible { color: $blue; }
  .fa { line-height: 1; }
}

// The form now ends with Delete; Save moved to the top bar's #extra slot.
// Pinned to the bottom of the viewport while the form scrolls, at the same height
// as the top bar so the two read as a pair. Min-height lets it grow by one line
// when the custom date picker widens the expiry control.
.edit-actions {
  position: sticky;
  bottom: 0;
  z-index: 35;
  box-sizing: border-box;
  min-height: 39px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px $wall-padding;
  background: $background-color;
  border-top: 2px solid $light-gray;
}

// Expiry sits on the left of the footer row: a clock, the label, and the date in
// a quieter style. Clicking the label opens the preset list above it.
.expiry-control {
  position: relative;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  flex: 1 1 auto;
  gap: 8px;
  min-width: 0;
}

.expiry-value {
  color: var(--keepass-cat-text-muted);
  &.is-warning {
    color: var(--keepass-cat-keyfile-active);
  }
}

.expiry-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  min-width: 132px;
  padding: 4px;
  background: var(--keepass-cat-bg-light);
  border: 1px solid var(--keepass-cat-border);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}

.expiry-option {
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--keepass-cat-text);
  white-space: nowrap;
  &:hover {
    background: var(--keepass-cat-bg-hover);
  }
  &.is-active {
    color: var(--keepass-cat-blue);
    font-weight: 600;
  }
}

.expiry-input {
  width: auto;
  padding: 4px 6px;
  font-size: 12px;
  border: 1px solid $light-gray;
  border-radius: 3px;
  color: $text-color;
  background: $light-background-color;
  &:focus {
    outline: none;
    border-color: $blue;
  }
}

// Status toast: fixed just below the shared top bar, so it is always on screen
// no matter how far the form is scrolled. `pointer-events: none` means it never
// blocks the form underneath; it reserves no layout space, so showing it never
// shifts the form.
.message {
  position: fixed;
  left: 12px;
  right: 12px;
  // `.box-bar` is pinned to exactly 39px on this screen (see the flex rule
  // above), so this floats a 7px gap under it (46px - 39px).
  top: 46px;
  z-index: 50;
  box-sizing: border-box;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  text-align: center;
  color: var(--keepass-cat-svg-fill);
  background: $blue;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  // Wrap long errors instead of truncating them.
  overflow-wrap: anywhere;

  .fa {
    margin-right: 6px;
  }

  &.message--progress { background: $blue; }
  &.message--success { background: $green; }
  &.message--error { background: var(--keepass-cat-red); }
}

.error { color: red; }

// OTP block: an input with a destructive delete button, or the "Add OTP"
// button that reveals it. Mirrors the input + remove-btn row used for custom
// fields, and the blue "add" button language used elsewhere in the app.
.otp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  input {
    flex: 1;
    min-width: 0;
  }
  .otp-qr {
    flex: 0 0 auto;
    padding: 6px 8px;
    border-radius: 3px;
    font-size: 15px;
    color: $blue;
    cursor: pointer;
    &:hover {
      background: $light-gray;
    }
    &.is-busy {
      cursor: default;
      opacity: 0.7;
    }
    &.is-busy:hover {
      background: transparent;
    }
  }
  .otp-remove {
    flex: 0 0 auto;
    padding: 6px 8px;
    border-radius: 3px;
    font-size: 15px;
    color: var(--keepass-cat-red);
    cursor: pointer;
    &:hover {
      background: $light-gray;
      opacity: 0.8;
    }
  }
}

.otp-add-btn {
  padding: 8px;
  text-align: center;
  font-size: 13px;
  color: $blue;
  cursor: pointer;
  &:hover { background: var(--keepass-cat-bg-hover); }
  .fa { margin-right: 4px; }
}

.otp-hint {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--keepass-cat-text-muted);
}

.custom-fields-section {
  margin-top: 20px;
  padding-top: 14px;
  border-top: 2px solid $light-gray;
}

.custom-fields-header {
  margin-bottom: 8px;
}

.custom-section-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  color: var(--keepass-cat-text-subtle);
}

// Info icon used in field labels (custom fields, URL); the tooltip carries the
// explanation, so the same icon is reused wherever a field needs one.
.field-help {
  font-size: 12px;
  color: var(--keepass-cat-text-muted);
  cursor: help;
}

// A field label followed by an info icon.
.edit-field label.label-help {
  display: flex;
  align-items: center;
  gap: 5px;
}

.custom-empty {
  padding: 10px;
  font-size: 12px;
  color: var(--keepass-cat-text-muted);
  background: $light-background-color;
  border: 1px dashed $light-gray;
  border-radius: 3px;
}

.custom-load-error {
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--keepass-cat-red);
}

.custom-row {
  margin-bottom: 10px;
  padding: 8px;
  background: $background-color;
  border: 1px solid $light-gray;
  border-radius: 3px;

  &.invalid {
    border-color: var(--keepass-cat-light-red);
  }

  input[type='text'] {
    box-sizing: border-box;
    padding: 8px;
    border: 1px solid $light-gray;
    border-radius: 3px;
    font-size: 14px;
    color: $text-color;
    background: $light-background-color;
    &:focus { outline: none; border-color: $blue; }
  }

  .custom-row-top {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .custom-name {
    flex: 1 1 auto;
    min-width: 0;
  }

  // Checkbox + label language shared with the rest of the app.
  .protect-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--keepass-cat-text-subtle);
    cursor: pointer;
    input[type='checkbox'] {
      width: auto;
      margin: 0;
      cursor: pointer;
    }
  }

  .remove-btn {
    flex: 0 0 auto;
    padding: 3px 5px;
    border-radius: 2px;
    font-size: 13px;
    color: var(--keepass-cat-icon-muted);
    &:hover {
      color: var(--keepass-cat-delete-hover);
      background: $light-gray;
    }
  }

  .custom-value {
    display: block;
    width: 100%;
  }

  .row-error {
    margin-top: 5px;
    font-size: 11px;
    line-height: 1.4;
    color: var(--keepass-cat-red);
    // Wrap long field names instead of clipping them.
    overflow-wrap: anywhere;
  }
}

// Mirrors the "New Group" button in BrowseEntries.vue.
.add-field-area {
  // The rule belongs between the rows and the Add field action; with no rows it
  // would sit right under the section heading, so only draw it when there are some.
  &.has-rows {
    border-top: 2px solid $light-gray;
  }
}

.add-field-btn {
  padding: 10px $wall-padding;
  text-align: center;
  font-size: 13px;
  color: $blue;
  cursor: pointer;
  &:hover { background: var(--keepass-cat-bg-hover); }
  .fa { margin-right: 4px; }
}
</style>
