<script>
import GoBack from '@/components/GoBack.vue';
import { Otp } from '@/lib/otp.js';

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
      deleteClick: 0,   // 0=not clicked, 1=clicked once (show confirm), 2=delete now
      fromBrowse: false,
      deleting: false,
    };
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
        this.totpEnabled = !!otpUrl && this.entry['keepassCatTotpEnabled'] !== 'false';
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
  },
  methods: {
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
    async save() {
      this.saving = true;
      this.message = this.$t('Saving...');

      // Prepare TOTP fields
      let otpUrl = (this.editFields.otp || '').trim();
      if (otpUrl) {
        try {
          Otp.parseUrl(otpUrl);
        } catch (e) {
          this.message = this.$t('Invalid otpauth URL');
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

      try {
        let newBuffer;
        if (this.isNew) {
          newBuffer = await this.keepassService.addEntry(this.selectedGroup, this.editFields);
        } else {
          if (this.selectedGroup !== this.entry.groupName) {
            await this.keepassService.moveEntryToGroup(this.entry.id, this.selectedGroup);
            this.entry.groupName = this.selectedGroup;
          }
          newBuffer = await this.keepassService.saveEntry(this.entry.id, this.editFields);
        }
        
        this.message = this.$t('Uploading...');
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
        
        this.message = this.$t('Saved!');
        setTimeout(() => this.$router.goBack(), 800);
      } catch (err) {
        this.message = this.$t('Error: ') + err.message;
      }
      this.saving = false;
    },
    cancel() {
      this.$router.goBack();
    },
    async deleteEntry() {
      if (this.deleteClick === 0) {
        this.deleteClick = 1;
        this.message = '';
        return;
      }
      this.deleting = true;
      this.message = this.$t('Deleting...');
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
        this.message = this.$t('Delete error: ') + err.message;
        this.deleteClick = 0;
      }
      this.deleting = false;
    },
  },
};
</script>

<template>
  <div>
    <go-back :message="$t('back to entry list')">
      <template v-if="!isNew" #extra>
        <span class="delete-btn selectable" @click.stop="deleteEntry" :title="$t('Delete')">
          <i class="fa fa-trash" />
          <span v-if="deleteClick === 0"> {{ $t('Delete') }}</span>
          <span v-if="deleteClick === 1" class="confirm-text">{{ $t('Click again to confirm') }}</span>
        </span>
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
      <div class="edit-actions">
        <button class="action-button" :disabled="saving" @click="save">
          {{ saving ? $t('Saving...') : $t('Save') }}
        </button>
        <button class="action-button cancel" @click="cancel">{{ $t('Cancel') }}</button>
      </div>
      <div class="message" v-if="message">{{ message }}</div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/settings.scss';

.edit-form {
  padding: $wall-padding;
}

.delete-btn {
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

.edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  button {
    flex: 1;
    padding: 10px;
    border: none;
    border-radius: 3px;
    font-size: 14px;
    cursor: pointer;
    &:disabled { opacity: 0.5; }
  }
  .action-button { background: $blue; color: var(--keepass-cat-svg-fill); }
  .cancel { background: $light-gray; color: var(--keepass-cat-text); }
}

.message {
  margin-top: 12px;
  padding: 8px;
  background: $light-background-color;
  border-radius: 3px;
  font-size: 13px;
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
</style>
