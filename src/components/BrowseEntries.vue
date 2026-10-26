<script>
import { Otp } from '@/lib/otp.js';

export default {
  props: {
    unlockedState: Object,
    keepassService: Object,
  },
  data() {
    return {
      searchTerm: '',
      expandedGroups: {},
      savedExpandedGroups: null,
      renamingGroup: null,
      renameInput: '',
      showNewGroup: false,
      newGroupName: '',
      // Parent UUID for the new-group form. Null keeps the historical default
      // (the database's default group); threaded through for nested creation.
      newGroupParentUuid: null,
      busy: false,
      message: '',
      entriesVersion: 0,
      // entry.id -> seconds left on its OTP code, refreshed by the shared ticker.
      otpCountdowns: {},
    };
  },
  created() {
    // entry.id -> OTP period (seconds). Deliberately plain/non-reactive: it is
    // resolved lazily on the first sight of each entry and never changes after.
    this.otpPeriods = {};
  },
  watch: {
    searchTerm(val) {
      if (val.length > 0) {
        // Save current expansion state before modifying
        if (this.savedExpandedGroups === null) {
          this.savedExpandedGroups = { ...this.expandedGroups };
        }
        this.autoExpandGroups();
      } else {
        // Restore saved expansion state when search is cleared
        if (this.savedExpandedGroups !== null) {
          this.expandedGroups = this.savedExpandedGroups;
          this.savedExpandedGroups = null;
        }
      }
    },
  },
  mounted() {
    this.$nextTick(() => {
      if (this.groups.length === 1) {
        this.$set(this.expandedGroups, this.groupKey(this.groups[0]), true);
      }
    });
    // One ticker for the whole list, not one per row: the browse view can hold
    // hundreds of entries, so per-row intervals (as in the match list) would be
    // far too costly here.
    this.tickOtp();
    this.otpTicker = setInterval(() => this.tickOtp(), 1000);
  },
  beforeUnmount() {
    clearInterval(this.otpTicker);
  },
  computed: {
    allEntries() {
      this.entriesVersion; // reactive dependency — bump after cache updates
      return this.unlockedState.cacheGet('allEntries') || [];
    },
    groups() {
      this.entriesVersion;
      // Key by UUID so same-named groups stay distinct. Legacy cached entries
      // (no groupUuid) and legacy group caches (uuid: null) fall back to names.
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
      this.allEntries.forEach(function(e) {
        if (e.groupUuid) {
          // A group the cached group list does not know about (stale cache).
          addGroup(e.groupUuid, e.groupName, null, e.groupPath);
        } else if (e.groupName) {
          addGroup(null, e.groupName, null, e.groupPath);
        }
      });
      // Drop a legacy name-only row when a UUID row has the same name/path:
      // its entries are still shown by the UUID row (see getGroupEntries).
      const uuidNames = {};
      const uuidPaths = {};
      Object.keys(byUuid).forEach(function(uuid) {
        const g = byUuid[uuid];
        if (g.name) uuidNames[g.name] = true;
        if (g.path) uuidPaths[g.path] = true;
      });
      let result = Object.keys(byUuid).map(function(uuid) { return byUuid[uuid]; });
      Object.keys(byName).forEach(function(name) {
        const g = byName[name];
        if (!uuidNames[g.name] && !uuidPaths[g.path]) result.push(g);
      });
      result.sort(function(a, b) {
        return (a.path || a.name || '').localeCompare(b.path || b.name || '');
      });
      return result;
    },
  },
  methods: {
    // Stable expansion/rename key. UUID when available, name for legacy rows.
    groupKey(group) {
      return (group && (group.uuid || group.name)) || '';
    },
    toggleGroup(group) {
      const key = this.groupKey(group);
      this.$set(this.expandedGroups, key, !this.expandedGroups[key]);
    },
    autoExpandGroups() {
      this.groups.forEach(g => {
        const hasMatches = this.getGroupEntries(g).length > 0;
        this.$set(this.expandedGroups, this.groupKey(g), hasMatches);
      });
    },
    // Entries belonging to a UUID group, with a name path fallback for entries
    // restored from an older cache that predates groupUuid.
    getGroupEntries(group) {
      let uuid = null;
      let name = null;
      let path = null;
      if (group && typeof group === 'object') {
        uuid = group.uuid || null;
        name = group.name || null;
        path = group.path || name;
      } else if (group) {
        // Backwards-compatible call with a bare uuid or name. Resolve a known
        // UUID to its group so entries are matched by identity, not label.
        const known = this.groups.filter(function(g) { return g.uuid === group; })[0];
        if (known) {
          uuid = known.uuid;
          name = known.name;
          path = known.path || known.name;
        } else {
          name = group;
          path = group;
        }
      }
      let result = this.allEntries.filter(e => {
        if (uuid && e.groupUuid) return e.groupUuid === uuid;
        if (e.groupUuid) return false;
        // Legacy entry: only the first matching UUID group owns it, so it is
        // never duplicated across same-named groups.
        if (uuid) return this.legacyGroupUuid(e) === uuid;
        if (path && e.groupPath) return e.groupPath === path;
        return e.groupName === name;
      });
      if (this.searchTerm.length > 0) {
        let term = this.searchTerm.toLowerCase();
        result = result.filter(e => (e.filterKey || '').indexOf(term) > -1);
      }
      return result;
    },
    // Resolve the UUID a legacy (uuid-less) entry belongs to, by path then name.
    legacyGroupUuid(entry) {
      let byName = null;
      for (const g of this.groups) {
        if (!g.uuid) continue;
        if (entry.groupPath && g.path === entry.groupPath) return g.uuid;
        if (!entry.groupPath && entry.groupName && g.name === entry.groupName) {
          if (!byName) byName = g.uuid;
        }
      }
      if (byName) return byName;
      for (const g of this.groups) {
        if (g.uuid && entry.groupName && g.name === entry.groupName) return g.uuid;
      }
      return null;
    },
    autofill(entry) {
      this.unlockedState.autofill(entry);
    },
    editEntry(entry) {
      this.$router.route('/entry-edit/' + entry.id + '?from=browse');
    },
    openUrl(entry) {
      if (entry.url) chrome.tabs.create({ url: entry.url });
    },
    copyEntryPassword(entry) {
      this.unlockedState.copyPassword(entry);
    },
    copyEntryUsername(entry) {
      this.unlockedState.copyUsername(entry);
    },
    copyEntryTotp(entry) {
      this.unlockedState.copyTotp(entry);
    },
    // Same condition as the match list (EntryListItem.vue): OTP is enabled iff
    // the entry has a non-empty `otp` value, protected or plain-text.
    hasTotp(entry) {
      const protectedOtp = entry.protectedData && entry.protectedData.otp;
      if (protectedOtp) return !!(protectedOtp.value && protectedOtp.value.length > 0);
      return !!entry.otp;
    },
    // Resolve an entry's OTP period once, then reuse it. Never decrypt on a tick.
    totpPeriod(entry) {
      const cached = this.otpPeriods[entry.id];
      if (cached !== undefined) return cached;
      let period = 30;
      try {
        let url = this.unlockedState.getDecryptedAttribute(entry, 'otp');
        period = Otp.parseUrl(url).period || 30;
      } catch (e) {}
      this.otpPeriods[entry.id] = period;
      return period;
    },
    tickOtp() {
      const now = Date.now();
      this.allEntries.forEach(entry => {
        if (!this.hasTotp(entry)) return;
        const ms = this.totpPeriod(entry) * 1000;
        const left = Math.ceil((ms - (now % ms)) / 1000);
        if (this.otpCountdowns[entry.id] !== left) {
          this.$set(this.otpCountdowns, entry.id, left);
        }
      });
    },
    newEntry() {
      var title = this.unlockedState.title || '';
      var url = this.unlockedState.fullUrl || this.unlockedState.url || '';
      // Drop both the query string and the URL fragment: neither belongs in a
      // saved entry URL (`#...` alone would otherwise slip through).
      url = url.split(/[?#]/)[0];
      var params = 'title=' + encodeURIComponent(title) + '&url=' + encodeURIComponent(url);
      this.$router.route('/entry-edit/new?' + params);
    },
    // --- Group management ---
    startRename(group) {
      this.renamingGroup = this.groupKey(group);
      this.renameInput = group.name;
      this.$nextTick(() => this.$refs.renameInput?.focus());
    },
    async confirmRename(group) {
      let newName = this.renameInput.trim();
      if (!newName || newName === group.name) { this.renamingGroup = null; return; }
      this.busy = true;
      this.message = this.$t('Renaming...');
      try {
        // UUID first; legacy name-only rows still fall back to the name.
        let buf = await this.keepassService.renameGroup(group.uuid || group.name, newName);
        await this.keepassService.uploadDatabase(buf);
        let fresh = await this.keepassService.refreshFromServer();
        this.unlockedState.cacheSet('allEntries', fresh);
        if (this.$parent?.secureCache) {
          this.$parent.secureCache.save('secureCache.entries', fresh);
          this.$parent.secureCache.save('secureCache.entries', fresh, 'local');
        }
        this.entriesVersion++;
        this.renamingGroup = null;
        this.message = this.$t('Renamed.');
        setTimeout(() => this.message = '', 1500);
      } catch (err) {
        this.message = this.$t('Error: ') + err.message;
      }
      this.busy = false;
    },
    cancelRename() {
      this.renamingGroup = null;
    },
    async confirmDeleteGroup(group) {
      let count = this.getGroupEntries(group).length;
      let label = group.path || group.name;
      let msg = count > 0
        ? this.$t('Delete group "{0}" and all {1} entries?', label, count)
        : this.$t('Delete empty group "{0}"?', label);
      if (!confirm(msg)) return;
      this.busy = true;
      this.message = this.$t('Deleting...');
      try {
        let buf = await this.keepassService.deleteGroup(group.uuid || group.name);
        await this.keepassService.uploadDatabase(buf);
        let fresh = await this.keepassService.refreshFromServer();
        this.unlockedState.cacheSet('allEntries', fresh);
        if (this.$parent?.secureCache) {
          this.$parent.secureCache.save('secureCache.entries', fresh);
          this.$parent.secureCache.save('secureCache.entries', fresh, 'local');
        }
        this.entriesVersion++;
        this.message = this.$t('Deleted.');
        this.$forceUpdate();
        setTimeout(() => this.message = '', 1500);
      } catch (err) {
        this.message = this.$t('Error: ') + err.message;
      }
      this.busy = false;
    },
    // Optional parentGroup lets a caller nest the new group; without one the
    // service keeps its historical default (the database's default group).
    startNewGroup(parentGroup) {
      this.showNewGroup = true;
      this.newGroupName = '';
      this.newGroupParentUuid = (parentGroup && parentGroup.uuid) || null;
      this.$nextTick(() => this.$refs.newGroupInput?.focus());
    },
    async confirmNewGroup() {
      let name = this.newGroupName.trim();
      if (!name) { this.showNewGroup = false; return; }
      this.busy = true;
      this.message = this.$t('Creating...');
      try {
        let buf = await this.keepassService.createGroup(name, this.newGroupParentUuid);
        await this.keepassService.uploadDatabase(buf);
        // Refresh cache from server (same as entry save)
        let fresh = await this.keepassService.refreshFromServer();
        this.unlockedState.cacheSet('allEntries', fresh);
        if (this.$parent?.secureCache) {
          this.$parent.secureCache.save('secureCache.entries', fresh);
          this.$parent.secureCache.save('secureCache.entries', fresh, 'local');
        }
        this.entriesVersion++;
        this.showNewGroup = false;
        this.$forceUpdate();
        this.message = this.$t('Created.');
        setTimeout(() => this.message = '', 1500);
      } catch (err) {
        this.message = this.$t('Error: ') + err.message;
      }
      this.busy = false;
    },
    cancelNewGroup() {
      this.showNewGroup = false;
    },
  },
};
</script>

<template>
  <div id="browse-panel">
    <div class="search">
      <i class="fa fa-search" />
      <input v-model="searchTerm" type="search" :placeholder="$t('search entire database...')" />
      <i class="fa fa-plus add-entry" @click="newEntry" :title="$t('New entry')" />
    </div>
    <div class="browse-groups">
      <div v-for="group in groups" :key="groupKey(group)" class="group-section">
        <div class="group-header" @click="toggleGroup(group)">
          <i :class="['fa', expandedGroups[groupKey(group)] ? 'fa-folder-open' : 'fa-folder', 'fa-fw']" />
          <span
            v-if="renamingGroup !== groupKey(group)"
            class="group-name"
            :title="group.path || group.name"
          >{{ group.path || group.name }}</span>
          <span v-else class="rename-field">
            <input
              ref="renameInput"
              v-model="renameInput"
              class="group-name-input"
              @click.stop
              @keyup.enter="confirmRename(group)"
              @keyup.escape="cancelRename"
            />
            <i class="fa fa-check confirm-icon" @click.stop="confirmRename(group)" :title="$t('Confirm')" />
            <i class="fa fa-times cancel-icon" @click.stop="cancelRename" :title="$t('Cancel')" />
          </span>
          <span class="action-icons" @click.stop>
            <i class="fa fa-pencil group-edit-icon" @click="startRename(group)" :title="$t('Rename group')" />
            <i class="fa fa-trash group-delete-icon" @click="confirmDeleteGroup(group)" :title="$t('Delete group')" />
          </span>
          <span class="group-count">{{ getGroupEntries(group).length }}</span>
        </div>
        <div v-if="expandedGroups[groupKey(group)]" class="group-entries">
          <div
            v-for="entry in getGroupEntries(group)"
            :key="entry.id"
            class="entry-row selectable"
            @click="autofill(entry)"
          >
            <div class="entry-info">
              <span
                class="entry-title"
                :title="entry.title"
              >{{ entry.title || $t('(empty)') }}</span>
              <span
                class="entry-user"
                :title="entry.userName || ''"
              >{{ entry.userName || '' }}</span>
            </div>
            <span v-if="hasTotp(entry)" class="otp-countdown">{{ otpCountdowns[entry.id] }}s</span>
            <span v-if="hasTotp(entry)" class="fa-stack entry-copy-otp" @click.stop="copyEntryTotp(entry)" :title="$t('Copy OTP code')">
              <i class="fa fa-circle fa-stack-2x" />
              <i class="fa fa-clock-o fa-stack-1x fa-inverse" />
            </span>
            <span class="fa-stack entry-url" @click.stop="openUrl(entry)" :title="$t('Open URL')">
              <i class="fa fa-circle fa-stack-2x" />
              <i class="fa fa-external-link fa-stack-1x fa-inverse" />
            </span>
            <span class="fa-stack entry-copy-user" @click.stop="copyEntryUsername(entry)" :title="$t('Copy username')">
              <i class="fa fa-circle fa-stack-2x" />
              <i class="fa fa-user fa-stack-1x fa-inverse" />
            </span>
            <span class="fa-stack entry-copy" @click.stop="copyEntryPassword(entry)" :title="$t('Copy password')">
              <i class="fa fa-circle fa-stack-2x" />
              <i class="fa fa-clipboard fa-stack-1x fa-inverse" />
            </span>
            <span class="fa-stack entry-edit" @click.stop="editEntry(entry)" :title="$t('Edit entry')">
              <i class="fa fa-circle fa-stack-2x" />
              <i class="fa fa-pencil fa-stack-1x fa-inverse" />
            </span>
          </div>
        </div>
      </div>
      <!-- New Group -->
      <div class="new-group-area">
        <div v-if="showNewGroup" class="new-group-form">
          <input
            ref="newGroupInput"
            v-model="newGroupName"
            :placeholder="$t('Group name...')"
            class="new-group-input"
            @keyup.enter="confirmNewGroup"
            @keyup.escape="cancelNewGroup"
          />
          <i class="fa fa-check confirm-icon" @click="confirmNewGroup" :title="$t('Confirm')" />
          <i class="fa fa-times cancel-icon" @click="cancelNewGroup" :title="$t('Cancel')" />
        </div>
        <div v-else class="new-group-btn selectable" @click="startNewGroup">
          <i class="fa fa-plus" /> {{ $t('New Group') }}
        </div>
      </div>
    </div>
    <transition name="toast">
      <div v-if="message" class="status-toast">{{ message }}</div>
    </transition>
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/settings.scss';

.search {
  padding: 8px $wall-padding;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  border-bottom: 2px solid $light-gray;
  input {
    float: right;
    width: 96%;
    border: 0px;
    padding: 2px 0px;
    padding-left: 10px;
    font-size: 18px;
    color: $text-color;
    background-color: $background-color;
    &:focus { outline: none; }
  }
  .fa {
    width: 4%;
    font-size: 15px;
  }
  .add-entry {
    width: auto;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 3px;
    &:hover { background: $light-background-color; }
  }
}

.browse-groups {
  height: 350px;
  overflow-y: auto;
  overflow-x: hidden;
  border-bottom: 2px solid $light-gray;
}

.group-header {
  padding: 8px $wall-padding;
  border-bottom: 1px solid $light-gray;
  background: $light-background-color;
  display: flex; align-items: center; gap: 6px;
  cursor: pointer;
  &:hover { opacity: 0.7; }
  > .fa { flex: 0 0 auto; }
  .group-name {
    font-weight: 600;
    font-size: 14px;
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: clip;
    // Dissolve the cut like the entry rows rather than truncating with dots.
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 1.5em), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 1.5em), transparent);
  }
  .group-count {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--keepass-cat-text-muted);
  }
  .action-icons {
    display: flex; align-items: center; gap: 4px;
    margin-left: 8px;
    flex: 0 0 auto;
    opacity: 0;
    transition: opacity 0.15s;
  }
  &:hover .action-icons { opacity: 1; }
  .group-edit-icon, .group-delete-icon {
    font-size: 12px;
    padding: 3px 4px;
    border-radius: 2px;
    color: var(--keepass-cat-icon-muted);
    &:hover { color: var(--keepass-cat-text); background: $light-gray; }
  }
  .group-delete-icon:hover { color: var(--keepass-cat-delete-hover); }
  .rename-field {
    display: flex; align-items: center; gap: 4px; flex: 1;
  }
  .group-name-input {
    font-weight: 600;
    font-size: 14px;
    border: 1px solid $blue;
    border-radius: 3px;
    padding: 2px 6px;
    width: 120px;
    &:focus { outline: none; }
  }
}

.confirm-icon {
  font-size: 13px;
  color: $green;
  cursor: pointer;
  flex-shrink: 0;
  &:hover { opacity: 0.7; }
}

.cancel-icon {
  font-size: 13px;
  color: var(--keepass-cat-icon-muted);
  cursor: pointer;
  flex-shrink: 0;
  &:hover { opacity: 0.7; }
}

.group-entries {
  .entry-row {
    display: flex; align-items: center;
    padding: 8px $wall-padding;
    border-bottom: 1px solid var(--keepass-cat-border-light);
    overflow-x: hidden;
    &:hover { background: var(--keepass-cat-bg-hover); }
    .entry-info {
      flex: 1 1 auto;
      min-width: 0;
      .entry-title,
      .entry-user {
        display: block;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: clip;
        // Dissolve the cut like the popup entry rows rather than truncating with dots.
        -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 1.5em), transparent);
        mask-image: linear-gradient(to right, #000 calc(100% - 1.5em), transparent);
      }
      .entry-title { font-size: 14px; }
      .entry-user { font-size: 11px; color: var(--keepass-cat-text-subtle); }
    }
    .entry-copy-user,
    .entry-copy,
    .entry-copy-otp,
    .entry-url,
    .entry-edit {
      flex: 0 0 auto;
      opacity: 0.3; font-size: 16px; &:hover { opacity: 0.8; }
    }
    // Fixed-ish column so the row never reflows as the number ticks.
    .otp-countdown {
      flex: 0 0 auto;
      font-size: 11px;
      color: var(--keepass-cat-text-subtle);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      min-width: 22px;
    }
    @media (prefers-color-scheme: dark) {
      .entry-copy-user, .entry-copy, .entry-copy-otp, .entry-url, .entry-edit { opacity: 0.6; }
      .entry-copy-user:hover, .entry-copy:hover, .entry-copy-otp:hover, .entry-url:hover, .entry-edit:hover { opacity: 0.35; }
    }
  }
}

.new-group-area {
  border-top: 2px solid $light-gray;
}
.new-group-btn {
  padding: 10px $wall-padding;
  text-align: center;
  font-size: 13px;
  color: $blue;
  cursor: pointer;
  &:hover { background: var(--keepass-cat-bg-hover); }
  .fa { margin-right: 4px; }
}
.new-group-form {
  padding: 8px $wall-padding;
  display: flex; align-items: center; gap: 6px;
}
.new-group-input {
  flex: 1;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid $blue;
  border-radius: 3px;
  font-size: 14px;
  &:focus { outline: none; }
}

.status-toast {
  position: absolute;
  bottom: 0;
  left: 0; right: 0;
  padding: 6px $wall-padding;
  font-size: 12px;
  color: var(--keepass-cat-svg-fill);
  background: rgba(0,0,0,0.7);
  text-align: center;
  z-index: 10;
  pointer-events: none;
}
.toast-enter-active, .toast-leave-active {
  transition: opacity 0.2s;
}
.toast-enter-from, .toast-leave-to {
  opacity: 0;
}

#browse-panel {
  position: relative;
}
</style>
