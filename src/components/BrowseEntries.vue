<script>
import { Otp, entryHasTotp } from '@/lib/otp.js';
import EntryRow from '@/components/EntryRow.vue';

// Going into the entry editor swaps the whole screen (the popup router unmounts
// this view), so the expanded groups and the list's scroll offset would reset on
// every "back". Keeping them outside the component makes the return trip restore
// exactly what the user was looking at; the popup is a single page, so this lives
// for one popup session and is naturally forgotten when it closes.
let browseViewState = null;

export default {
  components: {
    EntryRow,
  },
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
      // Key of the group whose sub-group form is open; null when the form is closed.
      newGroupParentKey: null,
      // That group's UUID, which the service creates the sub-group in.
      newGroupParentUuid: null,
      busy: false,
      message: '',
      entriesVersion: 0,
      // entry.id -> seconds left on its OTP code, refreshed by the shared ticker.
      otpCountdowns: {},
      // Where the group list should scroll back to after returning from an entry,
      // and whether that has already been applied (it is retried once the groups
      // have rendered, or when the entry cache arrives late).
      restoreScrollTop: 0,
      scrollRestored: false,
    };
  },
  created() {
    // entry.id -> OTP period (seconds). Deliberately plain/non-reactive: it is
    // resolved lazily on the first sight of each entry and never changes after.
    this.otpPeriods = {};
    if (browseViewState) {
      this.expandedGroups = { ...browseViewState.expandedGroups };
      // The expansion map from before the search matters too: clearing the
      // restored search afterwards should go back to the user's own layout, not
      // to whatever the search auto-expanded.
      this.savedExpandedGroups = browseViewState.savedExpandedGroups
        ? { ...browseViewState.savedExpandedGroups }
        : null;
      this.searchTerm = browseViewState.searchTerm || '';
      this.restoreScrollTop = browseViewState.scrollTop || 0;
    }
  },
  watch: {
    // The group list is a computed over the cached entries plus the service, so it can
    // arrive *after* mount when the popup opens with an empty cache. Expanding in
    // mounted() alone then ran against an empty list and never fired again.
    groups(list) {
      this.expandLoneGroups();
      this.$nextTick(this.restoreGroupScroll);
    },
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
      this.expandLoneGroups();
      this.restoreGroupScroll();
    });
    // One ticker for the whole list, not one per row: the browse view can hold
    // hundreds of entries, so per-row intervals (as in the match list) would be
    // far too costly here.
    this.tickOtp();
    this.otpTicker = setInterval(() => this.tickOtp(), 1000);
  },
  beforeUnmount() {
    clearInterval(this.otpTicker);
    // Runs while the DOM is still in place, so this is the last honest scroll
    // offset before the router removes the browse screen.
    const list = this.$refs.scrollArea;
    browseViewState = {
      expandedGroups: { ...this.expandedGroups },
      savedExpandedGroups: this.savedExpandedGroups ? { ...this.savedExpandedGroups } : null,
      searchTerm: this.searchTerm,
      scrollTop: list ? list.scrollTop : 0,
    };
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
    // The tree, flattened into the rows the template renders. Flattening (rather
    // than a recursive component) keeps the list a single v-for and means only the
    // visible rows are built, which matters for a database with many groups.
    //
    // Sub-groups come first and the group's own entries after them, the order
    // KeePass shows. Depth is capped for indentation only, so a very deep tree
    // stops walking off the right edge.
    groupRows() {
      this.entriesVersion;
      const keyOf = (group) => this.groupKey(group);
      const byUuid = {};
      this.groups.forEach((group) => {
        if (group.uuid) byUuid[group.uuid] = keyOf(group);
      });
      // Children keyed by their parent's key; '' holds the roots (a group whose
      // parent is not in the list - the skipped Root group - is a root too).
      const children = {};
      this.groups.forEach((group) => {
        const parentKey = (group.parentUuid && byUuid[group.parentUuid]) || '';
        if (!children[parentKey]) children[parentKey] = [];
        children[parentKey].push(group);
      });

      const rows = [];
      const walk = (parentKey, depth) => {
        const list = (children[parentKey] || []).slice().sort((a, b) => {
          return String(a.name || a.path || '').localeCompare(String(b.name || b.path || ''));
        });
        list.forEach((group) => {
          const key = keyOf(group);
          const subGroups = children[key] || [];
          const expanded = !!this.expandedGroups[key];
          const entries = this.getGroupEntries(group);
          rows.push({
            type: 'group',
            key: key,
            group: group,
            depth: depth,
            expanded: expanded,
            hasChildren: subGroups.length > 0,
            count: entries.length,
            // Always the name: nesting is shown by indentation all the way down.
            label: group.name || group.path || '',
            // The top level must keep at least one group; deeper rows are always
            // deletable because their parent survives.
            canDelete: !(depth === 0 && this.rootGroups.length <= 1),
          });
          if (!expanded) return;
          // The sub-group form sits inside the group it will create in.
          if (this.showNewGroup && this.newGroupParentKey === key) {
            rows.push({ type: 'new-group', depth: depth + 1 });
          }
          walk(key, depth + 1);
          entries.forEach((entry) => {
            // Same depth as the group: an entry sits at its group's name column,
            // one step in from the sub-groups below it.
            rows.push({ type: 'entry', entry: entry, depth: depth });
          });
        });
      };
      walk('', 0);
      // With every top-level group collapsed the list is just names, so a row under
      // the last one offers to start another top-level group. It stays while the
      // form is open, even if something gets expanded meanwhile.
      if (this.allRootsCollapsed || (this.showNewGroup && this.newGroupParentKey === null)) {
        rows.push({ type: 'new-root-group', depth: 0 });
      }
      return rows;
    },
    // How wide the row area has to be. Up to five levels a name still fits in the
    // popup, so the list stays at its own width; deeper than that the rows are laid
    // out wider than the viewport and the list scrolls sideways, which is what gives
    // the deepest names room instead of squeezing them.
    treeWidth() {
      let maxDepth = 0;
      this.groupRows.forEach((row) => {
        if (row.depth > maxDepth) maxDepth = row.depth;
      });
      if (maxDepth <= 5) return '100%';
      // The deepest name column plus room for the name itself.
      return 58 + maxDepth * 14 + 260 + 'px';
    },
    // Top-level groups: the database's own Root is skipped by the service, so these
    // are Root's children. At least one of them has to survive: with none left the
    // tree is empty and there is no row carrying the new-group button.
    rootGroups() {
      const byUuid = {};
      this.groups.forEach((group) => {
        if (group.uuid) byUuid[group.uuid] = true;
      });
      return this.groups.filter((group) => !(group.parentUuid && byUuid[group.parentUuid]));
    },
    // With every top-level group collapsed the list shows nothing but the group
    // names, so the bottom offers a way to start a new one from there.
    allRootsCollapsed() {
      if (!this.rootGroups.length) return false;
      return this.rootGroups.every((group) => !this.expandedGroups[this.groupKey(group)]);
    },
  },
  methods: {
    // Left edge of a row that carries its own caret. Indentation is unlimited: a
    // deep tree widens the list instead of stopping, and the list scrolls sideways.
    indentFor(depth) {
      return 16 + depth * 14 + 'px';
    },
    // An entry row keeps its full-width background and only its text moves in, so
    // this replaces EntryRow's own left padding outright: the caret, folder and
    // gaps (42px) plus the viewport padding put the text under the group's name.
    indentEntryFor(depth) {
      return 58 + depth * 14 + 'px';
    },
    // Stable expansion/rename key. UUID when available, name for legacy rows.
    groupKey(group) {
      return (group && (group.uuid || group.name)) || '';
    },
    // True when removing this group would leave the database with no top-level group.
    isLastRootGroup(group) {
      if (!group || this.rootGroups.length !== 1) return false;
      return this.groupKey(this.rootGroups[0]) === this.groupKey(group);
    },
    // The trash icon on a protected row explains itself instead of deleting.
    deleteGroupRow(row) {
      if (!row.canDelete) {
        this.message = this.$t('The last top-level group cannot be deleted.');
        setTimeout(() => this.message = '', 1800);
        return;
      }
      this.confirmDeleteGroup(row.group);
    },
    toggleGroup(group) {
      const key = this.groupKey(group);
      this.$set(this.expandedGroups, key, !this.expandedGroups[key]);
    },
    // Expand a level that holds nothing but one group: a lone child is never
    // ambiguous, so the user should not have to open a chain of single-item levels
    // by hand. A level that also holds the parent's own entries is left alone - it
    // already shows something, and opening it would dump that group's rows on top
    // of them. Idempotent and only ever turns expansion on, so it is safe to call
    // whenever the list changes.
    expandLoneGroups() {
      const keyOf = (group) => this.groupKey(group);
      const byUuid = {};
      this.groups.forEach((group) => {
        if (group.uuid) byUuid[group.uuid] = keyOf(group);
      });
      const children = {};
      this.groups.forEach((group) => {
        const parentKey = (group.parentUuid && byUuid[group.parentUuid]) || '';
        if (!children[parentKey]) children[parentKey] = [];
        children[parentKey].push(group);
      });
      const expandKey = (key) => {
        if (key && !this.expandedGroups[key]) this.$set(this.expandedGroups, key, true);
      };
      // The root level counts as a level too (entries always belong to a group, so
      // a lone root group is the whole of that level).
      if ((children[''] || []).length === 1) expandKey(keyOf(children[''][0]));
      this.groups.forEach((group) => {
        const kids = children[keyOf(group)] || [];
        if (kids.length !== 1) return;
        if (this.getGroupEntries(group).length > 0) return;
        expandKey(keyOf(kids[0]));
      });
    },
    // Put the group list back where it was before the entry editor opened. The
    // container only has its full height after the groups render, so this runs
    // after nextTick and is retried if the entry cache lands later.
    restoreGroupScroll() {
      if (this.scrollRestored || !this.restoreScrollTop) return;
      const list = this.$refs.scrollArea;
      if (!list) return;
      list.scrollTop = this.restoreScrollTop;
      if (list.scrollTop > 0) this.scrollRestored = true;
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
        if (!entryHasTotp(entry)) return;
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
      this.$nextTick(() => {
        // The name input lives inside the row list, so the ref is an array.
        const el = this.$refs.renameInput;
        const input = Array.isArray(el) ? el[0] : el;
        if (input && input.focus) input.focus();
      });
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
        let fresh = await this.keepassService.reparseLocal();
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
      // The database needs at least one top-level group: with none left the tree is
      // empty and there is no row to hang the new-group button on.
      if (this.isLastRootGroup(group)) {
        this.message = this.$t('The last top-level group cannot be deleted.');
        setTimeout(() => this.message = '', 1800);
        return;
      }
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
        let fresh = await this.keepassService.reparseLocal();
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
    // Opens the new-group form as a sub-group row inside the given group, which also
    // opens that group so the row is on screen.
    startNewGroup(parentGroup) {
      if (!parentGroup) return;
      const key = this.groupKey(parentGroup);
      this.openNewGroupForm(key, parentGroup.uuid || null, true);
    },
    // The row under the last top-level group: a group at the same level as the
    // existing top-level ones. The service puts a group created with no parent in
    // the database's root group, which is exactly that level.
    startRootGroup() {
      this.openNewGroupForm(null, null, false);
    },
    openNewGroupForm(parentKey, parentUuid, expandParent) {
      this.showNewGroup = true;
      this.newGroupName = '';
      this.newGroupParentKey = parentKey;
      this.newGroupParentUuid = parentUuid;
      if (expandParent && parentKey) this.$set(this.expandedGroups, parentKey, true);
      this.$nextTick(() => {
        // The input lives inside a v-for, so the ref is an array there.
        const el = this.$refs.newGroupInput;
        const input = Array.isArray(el) ? el[0] : el;
        if (input && input.focus) input.focus();
      });
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
        let fresh = await this.keepassService.reparseLocal();
        this.unlockedState.cacheSet('allEntries', fresh);
        if (this.$parent?.secureCache) {
          this.$parent.secureCache.save('secureCache.entries', fresh);
          this.$parent.secureCache.save('secureCache.entries', fresh, 'local');
        }
        this.entriesVersion++;
        this.showNewGroup = false;
        this.newGroupParentKey = null;
        this.newGroupParentUuid = null;
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
      this.newGroupParentKey = null;
      this.newGroupParentUuid = null;
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
    <div class="browse-groups" ref="scrollArea">
      <div class="tree-rows" :style="{ minWidth: treeWidth }">
        <template v-for="row in groupRows">
          <div
            v-if="row.type === 'group'"
            :key="'g:' + row.key"
            class="group-header"
            :style="{ paddingLeft: indentFor(row.depth) }"
            @click="toggleGroup(row.group)"
          >
            <!-- Every group gets its caret: a group with no sub-groups still has
                 entries, and the caret is what folds those away. -->
            <i :class="['fa', 'caret', row.expanded ? 'fa-caret-down' : 'fa-caret-right']" />
            <i :class="['fa', row.expanded ? 'fa-folder-open' : 'fa-folder', 'fa-fw']" />
            <span
              v-if="renamingGroup !== row.key"
              class="group-name"
              :title="row.group.path || row.group.name"
            >{{ row.label }}</span>
            <span v-else class="rename-field">
              <input
                ref="renameInput"
                v-model="renameInput"
                class="group-name-input"
                @click.stop
                @keyup.enter="confirmRename(row.group)"
                @keyup.escape="cancelRename"
              />
              <i class="fa fa-check confirm-icon" @click.stop="confirmRename(row.group)" :title="$t('Confirm')" />
              <i class="fa fa-times cancel-icon" @click.stop="cancelRename" :title="$t('Cancel')" />
            </span>
            <span class="action-icons" @click.stop>
              <i
                class="fa fa-plus group-add-icon"
                @click="startNewGroup(row.group)"
                :title="$t('New sub-group')"
              />
              <i class="fa fa-pencil group-edit-icon" @click="startRename(row.group)" :title="$t('Rename group')" />
              <i
                class="fa fa-trash group-delete-icon"
                :class="{ 'is-disabled': !row.canDelete }"
                @click="deleteGroupRow(row)"
                :title="row.canDelete ? $t('Delete group') : $t('The last top-level group cannot be deleted.')"
              />
            </span>
            <span class="group-count">{{ row.count }}</span>
          </div>
          <div
            v-else-if="row.type === 'new-group'"
            :key="'n:' + row.depth"
            class="new-group-inline"
            :style="{ paddingLeft: indentFor(row.depth) }"
          >
            <input
              ref="newGroupInput"
              v-model="newGroupName"
              class="group-name-input"
              :placeholder="$t('Group name...')"
              @keyup.enter="confirmNewGroup"
              @keyup.escape="cancelNewGroup"
            />
            <i class="fa fa-check confirm-icon" @click="confirmNewGroup" :title="$t('Confirm')" />
            <i class="fa fa-times cancel-icon" @click="cancelNewGroup" :title="$t('Cancel')" />
          </div>
          <div
            v-else-if="row.type === 'new-root-group'"
            :key="'nr'"
            class="new-group-inline"
            :style="{ paddingLeft: indentFor(row.depth) }"
          >
            <template v-if="showNewGroup && !newGroupParentKey">
              <input
                ref="newGroupInput"
                v-model="newGroupName"
                class="group-name-input"
                :placeholder="$t('Group name...')"
                @keyup.enter="confirmNewGroup"
                @keyup.escape="cancelNewGroup"
              />
              <i class="fa fa-check confirm-icon" @click="confirmNewGroup" :title="$t('Confirm')" />
              <i class="fa fa-times cancel-icon" @click="cancelNewGroup" :title="$t('Cancel')" />
            </template>
            <span v-else class="new-group-entry selectable" @click="startRootGroup">
              <i class="fa fa-plus" /> {{ $t('New Group') }}
            </span>
          </div>
          <entry-row
            v-else
            :key="'e:' + row.entry.id"
            :style="{ paddingLeft: indentEntryFor(row.depth) }"
            :entry="row.entry"
            :unlocked-state="unlockedState"
            :otp-seconds="otpCountdowns[row.entry.id] || null"
            edit-query="?from=browse"
          />
        </template>
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
  // Both directions: the tree scrolls vertically as before, and a deep tree is laid
  // out wider than the popup (see treeWidth), which is what adds the sideways
  // scrollbar at the bottom of this list.
  overflow: auto;
  scrollbar-width: thin;
  border-bottom: 2px solid $light-gray;
}

.tree-rows {
  width: 100%;
}

.group-header {
  padding: 8px $wall-padding;
  border-bottom: 1px solid $light-gray;
  background: $light-background-color;
  display: flex; align-items: center; gap: 6px;
  cursor: pointer;
  // A tint rather than the old whole-row fade: the row now carries hover actions,
  // and fading the icons along with the label made them hard to hit.
  &:hover { background: var(--keepass-cat-bg-hover); }
  > .fa { flex: 0 0 auto; }
  // Fixed-width slot: it is on every row now, so the names always line up.
  .caret {
    width: 12px;
    text-align: center;
    font-size: 12px;
    color: var(--keepass-cat-icon-muted);
  }
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
  .group-add-icon, .group-edit-icon, .group-delete-icon {
    font-size: 12px;
    padding: 3px 4px;
    border-radius: 2px;
    color: var(--keepass-cat-icon-muted);
  }
  .group-add-icon { color: $blue; }
  .group-add-icon:hover,
  .group-edit-icon:hover { color: var(--keepass-cat-text); background: $light-gray; }
  .group-delete-icon:hover { color: var(--keepass-cat-delete-hover); background: $light-gray; }
  // The last top-level group cannot go; the icon stays visible but inert.
  .group-delete-icon.is-disabled {
    opacity: 0.35;
    cursor: default;
    &:hover { color: var(--keepass-cat-icon-muted); background: transparent; }
  }
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


// The sub-group form: an extra row inside the group it creates in, so the nesting
// is shown by position instead of by a separate dialog.
.new-group-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px $wall-padding;
  background: $light-background-color;
  border-bottom: 1px solid $light-gray;
  .group-name-input {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
    font-weight: 600;
    font-size: 13px;
    border: 1px solid $blue;
    border-radius: 3px;
    padding: 3px 6px;
    &:focus { outline: none; }
  }
}

// The "new top-level group" row under the last root group: quiet until hovered,
// like the other small actions in the list rather than a full-width button.
.new-group-entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 13px;
  color: $blue;
  cursor: pointer;
  &:hover { background: var(--keepass-cat-bg-hover); }
  .fa { font-size: 11px; }
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
