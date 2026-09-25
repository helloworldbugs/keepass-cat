<script>
import GoBack from '@/components/GoBack.vue';
import { Otp } from '@/lib/otp.js';

// An error toast clears itself after this long, leaving the user on the form so
// they can fix the problem. Success/progress toasts are driven elsewhere.
const ERROR_TOAST_MS = 5000;

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
      totpEnabled: false,
      groups: [],
      selectedGroup: '',
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
      const internal = { otp: true, keepasscattotpenabled: true, keepasscaturls: true };
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
  },
  mounted() {
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
        // TOTP
        let otpUrl = this.unlockedState.getDecryptedAttribute(this.entry, 'otp') || '';
        this.editFields.otp = otpUrl;
        // Strict: only the literal 'true' enables TOTP; a missing key or any other value disables it.
        this.totpEnabled = !!otpUrl && this.entry['keepassCatTotpEnabled'] === 'true';
      }
    }
    // Load sorted groups from cached entries + keepassService
    let allEntries = this.unlockedState.cacheGet('allEntries') || [];
    let groupNames = {};
    allEntries.forEach(function(e) { if (e.groupName) groupNames[e.groupName] = true; });
    let dbGroups = this.keepassService.getGroups() || [];
    dbGroups.forEach(function(g) { groupNames[g.name] = true; });
    this.groups = Object.keys(groupNames).sort();
    this.selectedGroup = this.entry?.groupName || this.groups[0] || '';
    if (this.isNew && this.groups[0]) this.selectedGroup = this.groups[0];
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
  },
  methods: {
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
    async save() {
      this.saving = true;
      this.showMessage('progress', this.$t('Saving...'));

      // Prepare TOTP fields
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
        this.editFields.keepassCatTotpEnabled = this.totpEnabled ? 'true' : 'false';
      } else {
        // empty URL → remove TOTP (only manual clear triggers delete)
        this.editFields.otp = null;
        this.editFields.keepassCatTotpEnabled = null;
      }

      // Validate custom fields up front so a bad row is reported rather than
      // silently breaking the save. Invalid rows are skipped, not saved.
      const customPayload = this.buildCustomFieldPayload();

      try {
        let newBuffer;
        if (this.isNew) {
          newBuffer = await this.keepassService.addEntry(
            this.selectedGroup, this.editFields, customPayload.customFields
          );
        } else {
          if (this.selectedGroup !== this.entry.groupName) {
            await this.keepassService.moveEntryToGroup(this.entry.id, this.selectedGroup);
            this.entry.groupName = this.selectedGroup;
          }
          newBuffer = await this.keepassService.saveEntry(
            this.entry.id, this.editFields,
            customPayload.customFields, customPayload.removedFieldNames
          );
        }
        
        this.showMessage('progress', this.$t('Uploading...'));
        await this.keepassService.uploadDatabase(newBuffer);
        
        // Refresh cache from server to avoid re-unlock spinner
        try {
          let freshEntries = await this.keepassService.refreshFromServer();
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
        
        this.showMessage('success', customPayload.invalidCount > 0
          ? this.$t('Saved. {0} custom field(s) were skipped due to errors.', customPayload.invalidCount)
          : this.$t('Saved!'));
        // Success needs enough dwell time to be read; the skipped-fields
        // variant carries more information so it stays a little longer. This
        // navigation timer stays separate from the toast's auto-hide timer.
        this.navTimer = setTimeout(() => this.$router.goBack(), customPayload.invalidCount > 0 ? 1900 : 1400);
      } catch (err) {
        this.showMessage('error', this.$t('Error: ') + err.message);
      }
      this.saving = false;
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
          let freshEntries = await this.keepassService.refreshFromServer();
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
  <div class="entry-edit-view">
    <go-back :message="$t('back to entry list')">
      <template #extra>
        <!-- Save lives in the shared top bar (top-right). Compact by design so
             the bar height, driven by the 18px title line, never grows. -->
        <button
          class="bar-save-btn"
          :disabled="saving"
          :title="$t('Save')"
          @click.stop="save"
        >
          <i v-if="saving" class="fa fa-spinner fa-spin" aria-hidden="true" />
          <span>{{ saving ? $t('Saving...') : $t('Save') }}</span>
        </button>
      </template>
    </go-back>
    <div class="edit-form" v-if="entry || isNew">
      <div class="edit-field">
        <label>{{ $t('Group') }}</label>
        <select v-model="selectedGroup">
          <option v-for="g in groups" :key="g" :value="g">{{ g }}</option>
        </select>
      </div>
      <div class="edit-field">
        <label>{{ $t('Title') }}</label>
        <input v-model="editFields.title" type="text" />
      </div>
      <div class="edit-field">
        <label>{{ $t('Username') }}</label>
        <input v-model="editFields.userName" type="text" />
      </div>
      <div class="edit-field">
        <label>{{ $t('Password') }}</label>
        <div class="password-row">
          <input v-model="editFields.password" type="text" />
          <span class="generate-btn selectable" @click="generatePassword" :title="$t('Generate strong password')">
            <i class="fa fa-key" />
          </span>
        </div>
      </div>
      <div class="edit-field">
        <label>{{ $t('URL') }}</label>
        <input v-model="editFields.url" type="text" :placeholder="$t('e.g. https://site.com or regex:.*\\.domain\\.com/.*')" />
      </div>
      <div class="edit-field">
        <label>{{ $t('Notes') }}</label>
        <textarea v-model="editFields.notes" rows="4"></textarea>
      </div>
      <div class="edit-field">
        <label class="totp-toggle">
          <input type="checkbox" v-model="totpEnabled" />
          <span>{{ $t('Enable TOTP') }}</span>
        </label>
        <input
          v-if="totpEnabled"
          v-model="editFields.otp"
          type="text"
          placeholder="otpauth://totp/...?secret=..."
        />
      </div>
      <div class="custom-fields-section">
        <div class="custom-fields-header">
          <label class="custom-section-label">{{ $t('Custom fields') }}</label>
          <p class="custom-hint">{{ $t('Protect stores the value as KeePass does with "Protect value in process memory".') }}</p>
        </div>
        <div v-if="customFieldsLoading" class="custom-empty">
          {{ $t('Loading custom fields...') }}
        </div>
        <template v-else>
          <div v-if="customFieldsLoadError" class="custom-load-error">
            {{ customFieldsLoadError }}
          </div>
          <div v-if="!customFields.length" class="custom-empty">
            {{ $t('No custom fields yet.') }}
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
              :placeholder="$t('Field value')"
            />
            <div v-if="customFieldErrors[field.key]" class="row-error">
              {{ customFieldErrors[field.key] }}
            </div>
          </div>
          <div class="add-field-area">
            <div class="add-field-btn selectable" @click="addCustomField">
              <i class="fa fa-plus" /> {{ $t('Add field') }}
            </div>
          </div>
        </template>
      </div>
      <div class="edit-actions">
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
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/settings.scss';

// Keep the shared top bar pinned while this form scrolls (the user wanted it
// still there after scrolling to the bottom). :deep() keeps the rule scoped to
// this screen only, so FilePicker and every other .box-bar consumer is
// untouched. The document (html/body) is this screen's scroll container and no
// ancestor sets overflow/transform, so sticky works and keeps the bar in
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
  padding: $wall-padding;
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
  input { flex: 1; }
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

// The form now ends with Delete; Save moved to the top bar's #extra slot.
.edit-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
  padding-top: 14px;
  border-top: 2px solid $light-gray;
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

.totp-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  input[type='checkbox'] {
    width: auto;
    cursor: pointer;
  }
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
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: var(--keepass-cat-text-subtle);
}

.custom-hint {
  margin: 3px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--keepass-cat-text-muted);
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

  // Same checkbox + label language as the TOTP toggle above.
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
  border-top: 2px solid $light-gray;
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
