<script>
import { parseUrl } from '@/lib/utils.js';
import { setBadgeText, setBadgeBackgroundColor } from '@/lib/browser.js';

import EntryList from '@/components/EntryList.vue';
import BrowseEntries from '@/components/BrowseEntries.vue';
import Spinner from 'vue-simple-spinner';
import Messenger from '@/components/Messenger.vue';
import { defineComponent } from 'vue';

export default defineComponent({
  components: {
    EntryList,
    BrowseEntries,
    Spinner,
    Messenger,
  },
  props: {
    /* Service dependeicies */
    unlockedState: Object,
    secureCache: Object,
    settings: Object,
    keepassService: Object,
    links: Object,
  },
  data() {
    return {
      /* UI state data */
      unlockedMessages: {
        warn: '',
        error: '',
      },
      busy: false,
      // True from mount until we know whether to show the unlock form or jump
      // straight to the entries. The template keeps the layout but hides it, so
      // the form never flashes for a remembered password.
      initializing: true,
      // True when Chrome wants a fresh gesture before the local file can be read.
      // Set when the background refresh could not read a local-file database because
      // Chrome needs a user gesture; the first click retries it.
      autoSyncPending: false,
      // Local-file database: show the small floating sync button.
      isLocalFile: false,
      // Bumped whenever the cached entries change, so the list remounts and re-reads
      // the (non-reactive) unlockedState cache.
      listVersion: 0,
      syncing: false,
      syncToast: '',
      isUnlocked: false,
      masterPassword: '',
      isMasterPasswordInputVisible: false,
      keyFiles: [], // list of all available
      selectedKeyFile: undefined, // chosen keyfile object
      rememberPeriod: 0, // in minutes. default: do not remember
      rememberPeriodText: '',
      databaseFileName: '',
      keyFilePicker: false,
      showBrowse: false,
      appVersion: chrome.runtime.getManifest().version,
      slider_options: [
        {
          time: 0,
          text: 'Do not remember',
        },
        {
          time: 30,
          text: 'Remember for 30 min.',
        },
        {
          time: 120,
          text: 'Remember for 2 hours.',
        },
        {
          time: 240,
          text: 'Remember for 4 hours.',
        },
        {
          time: 480,
          text: 'Remember for 8 hours.',
        },
        {
          time: 1440,
          text: 'Remember for 24 hours.',
        },
        {
          time: -1,
          text: 'Until browser exits.',
        },
        {
          time: -2,
          text: 'Remember forever.',
        },
      ],
      slider_int: 0,
    };
  },
  computed: {
    rememberPassword: function () {
      return this.rememberPeriod !== 0;
    },
    selectedKeyFileName: function () {
      if (this.selectedKeyFile !== undefined) return this.selectedKeyFile.name;
      return this.$t('No keyfile selected. (click to change)');
    },
  },
  watch: {
    unlockedMessages: {
      handler(newval) {
        this.unlockedState.cacheSet('unlockedMessages', newval);
      },
      deep: true,
    },
  },
  async mounted() {    // Prime the group names from the last snapshot: the entries may come from the
    // cache without the database being loaded, and a group with no entries must
    // still appear in the group pickers.
    this.keepassService.loadCachedGroups();
    // Key files are needed by the form even when the database opens straight from the
    // cache (no silent unlock runs then, and the picker used to be empty).
    this.loadKeyFiles();
    // Same for the remember-period label and the field visibility rules.
    this.loadDatabaseUsage();
    // Same for the remember-period label: without this the slider read "(slide to
    // choose)" with no value until a silent unlock happened to run.
    this.settings
      .getSetDefaultRememberPeriod()
      .then((period) => this.setRememberPeriod(period))
      .catch(() => this.setRememberPeriod(0));
    // Safety net: the auto-unlock chain can stall (e.g. a stuck file read), and the
    // initial veil would then leave the popup permanently blank. Reveal the form
    // instead; whatever stalled is reported in the console.
    setTimeout(() => {
      if (this.initializing) {
        console.warn('[unlock-mount] init did not settle; showing the form');
        this.initializing = false;
      }
    }, 2500);
    // A local-file read needs a user gesture, and the popup opens without one, so the
    // open-time refresh cannot read the file. Retry on the first click anywhere.
    this.firstClickHandler = () => {
      if (!this.autoSyncPending) return;
      this.autoSyncPending = false;
      this.silentRefresh(this.unlockedState.cacheGet('allEntries') || []);
    };
    document.addEventListener('click', this.firstClickHandler, { once: true });

    this.settings.getCurrentDatabaseChoice().then((choice) => {
      this.isLocalFile = !!choice && choice.providerKey === 'localfile';
    }).catch(() => {});

    // Restore browse state
    if (this.unlockedState.cacheGet('showBrowse')) this.showBrowse = true;
    // modify unlockedState internal state
    await this.unlockedState.getTabDetails();

    if (!this.isUnlocked) {

      // Firefox's popup panel takes keyboard focus asynchronously (Bug 1324255):
      // until the document actually has focus, element.focus() only sets
      // activeElement and typed keys go nowhere. Poll until the document is
      // focused instead of betting on a single focus event that may have fired
      // before this component mounted, or may never fire at all.
      let focus = () => {
        let doFocus = () => {
          this.$nextTick(() => {
            let mp = this.$refs.masterPassword;
            if (mp) mp.focus();
          });
        };
        let attempt = 0;
        const focusWhenReady = () => {
          if (document.hasFocus() || attempt >= 20) {
            doFocus();
            return;
          }
          attempt += 1;
          setTimeout(focusWhenReady, 50);
        };
        focusWhenReady();
      };

      console.log('[unlock-mount] starting, session get...');
      try {
        let entries = await this.secureCache.get('secureCache.entries');
        console.log('[unlock-mount] session result:', entries ? entries.length + ' entries' : 'empty');
        if (entries !== undefined && entries.length > 0) {
          console.log('[unlock-mount] session OK, showResults + silentRefresh');
          this.showResults(entries, true);
          this.silentRefresh(entries);
        } else {
          console.log('[unlock-mount] session empty, trying local...');
          // Session empty — try local storage for instant display
          try {
            let localRaw = await this.secureCache.get('secureCache.entries', 'local');
            console.log('[unlock-mount] local result:', localRaw ? localRaw.length + ' entries' : 'empty');
            if (localRaw !== undefined && localRaw.length > 0) {
              console.log('[unlock-mount] local OK, showResults + silentRefresh');
              this.showResults(localRaw, true);
              this.silentRefresh(localRaw);
            }
          } catch (e) {
            console.error('[unlock-mount] local get failed:', e);
          }
          console.log('[unlock-mount] isUnlocked:', this.isUnlocked, '— try_autounlock?', !this.isUnlocked);
          if (!this.isUnlocked) this.autoUnlock();
        }
      } catch (err) {
        console.error('[unlock-mount] session get crashed:', err);
        this.secureCache.clear('secureCache.entries');
        // Session failed — try local before full unlock
        try {
          let localRaw = await this.secureCache.get('secureCache.entries', 'local');
          if (localRaw !== undefined && localRaw.length > 0) {
            this.showResults(localRaw, true);
          }
        } catch (_) {}
          if (!this.isUnlocked) this.autoUnlock();
      }
      console.log('[unlock-mount] done, busy:', this.busy);
      this.busy = false;
      focus();
    }
    //set knowlege from the URL
    this.databaseFileName = decodeURIComponent(this.$router.getRoute().title);
  },
  methods: {
    setRememberPeriod(time_int) {
      /* Args: optional time_int
       * if time_int is given, derive slider_int
       * else assume slider_int is alread set.
       */
      let slider_option_index;
      if (time_int !== undefined) {
        slider_option_index = ((t) => {
          for (let i = 0; i < this.slider_options.length; i++) {
            if (this.slider_options[i].time === t) return i;
          }
          return 0;
        })(time_int);
      } else {
        slider_option_index = parseInt(this.slider_int, 10);
      }
      // Never leave the label blank: an invalid index (NaN from an unset slider, or a
      // value outside the options) falls back to the first option.
      if (
        !Number.isInteger(slider_option_index) ||
        slider_option_index < 0 ||
        slider_option_index >= this.slider_options.length
      ) {
        slider_option_index = 0;
      }
      this.slider_int = slider_option_index;
      this.rememberPeriod = this.slider_options[slider_option_index].time;
      this.rememberPeriodText = this.slider_options[slider_option_index].text;
    },
    closeWindow(event) {
      window.close();
    },
    chooseKeyFile(index) {
      if (index !== undefined)
        if (index >= 0) this.selectedKeyFile = this.keyFiles[index];
        else this.selectedKeyFile = undefined;
      this.keyFilePicker = false;
    },
    chooseAnotherFile() {
      this.unlockedState.clearBackgroundState();
      this.secureCache.clear('secureCache.entries');
      this.secureCache.clear('secureCache.entries', 'local');
      this.$router.route('/choose');
    },
    toggleBrowse() {
      this.showBrowse = !this.showBrowse;
      this.unlockedState.cacheSet('showBrowse', this.showBrowse);
    },
    forgetPassword() {
      this.showBrowse = false;
      this.unlockedState.cacheSet('showBrowse', false);
      this.settings.getCurrentMasterPasswordCacheKey().then((key) => {
        if (key !== null) {
          this.secureCache.clear(key);
          this.secureCache.clear(key, 'local');
        }
        this.secureCache.clear('secureCache.entries');
        this.secureCache.clear('secureCache.entries', 'local');
        this.unlockedState.clearClipboardState();
        this.unlockedState.clearCache(); // new
        this.isUnlocked = false;
        setBadgeText({ text: '' });
      });
    },
    showResults(entries, fromCache) {
      // Results are on screen: the initial veil (which keeps the unlock form from
      // flashing for users whose password is remembered) can go.
      this.initializing = false;
      // A successful read means the file grant is actually in place, whatever
      // queryPermission() claimed; drop any stale "grant needed" prompt.
      // The cache below is a plain object, not reactive: bump the key so the list
      // remounts and re-reads it instead of waiting for a navigation.
      this.listVersion += 1;
      console.log('[showResults] entries:', entries ? entries.length : 0, 'fromCache:', fromCache);
      this.unlockedMessages.warn = '';
      this.unlockedMessages.error = '';
      let siteUrl = parseUrl(this.unlockedState.fullUrl || this.unlockedState.url);
      this.keepassService.rankEntries(entries, siteUrl); // in-place

      let allEntries = entries;
      // Cascade: show highest matching level first
      let priorityEntries = entries.filter((e) => e.matchRank === 100);
      if (priorityEntries.length === 0) priorityEntries = entries.filter((e) => e.matchRank === 75);
      if (priorityEntries.length === 0) priorityEntries = entries.filter((e) => e.matchRank === 50);
      if (priorityEntries.length === 0) priorityEntries = entries.filter((e) => e.matchRank === 25);
      priorityEntries.sort((a, b) => b.matchRank - a.matchRank);

      if (priorityEntries.length == 0) {
        this.unlockedMessages.warn = this.$t('No matches found for this site.');
      }

      // Cache in memory
      this.unlockedState.cacheSet('allEntries', allEntries);
      this.unlockedState.cacheSet('priorityEntries', priorityEntries);

      //save longer term (in encrypted storage)
      if (!fromCache && this.rememberPeriod !== 0) {
        this.secureCache.save('secureCache.entries', entries);
        if (this.rememberPeriod === -2) {
          this.secureCache.save('secureCache.entries', entries, 'local');
        }
      }
      this.busy = false;
      this.isUnlocked = true;

      // Badge: show matched count on extension icon
      let badgeCount = priorityEntries.length;
      if (badgeCount > 0) {
        setBadgeText({ text: String(badgeCount) });
          setBadgeBackgroundColor({ color: '#0089ec' });
      } else {
        setBadgeText({ text: '' });
      }
    },
    silentRefresh(cachedEntries) {
      // Auto-sync: after showing cached entries, quietly re-fetch from the backend
      // and refresh the UI/cache if the database changed on another device.
      var self = this;
      chrome.storage.local.get('lastSync', function (items) {
        var now = Date.now();
        var last = items.lastSync || 0;
        // Throttle only when this page already has the database in memory. A popup that
        // reopened after a restart has nothing loaded, and skipping the check left the
        // cached list stale until some other action happened to load the database.
        if (now - last < 30000 && self.keepassService.isDbLoaded()) return; // at most once per 30s
        self.keepassService
          .refreshIfChanged()
          .then(function (fresh) {
            if (fresh === null) return chrome.storage.local.set({ lastSync: Date.now() }); // file unchanged
            var siteUrl = parseUrl(self.unlockedState.fullUrl || self.unlockedState.url);
            self.keepassService.rankEntries(fresh, siteUrl);
            if (!self.entriesEqual(fresh, cachedEntries)) {
              // Update cache in place WITHOUT re-running showResults, which would
              // steal a pending fill from a fresh shortcut popup.
              self.unlockedState.cacheSet('allEntries', fresh);
              var priority = fresh.filter(function (e) { return e.matchRank === 100; });
              if (!priority.length) priority = fresh.filter(function (e) { return e.matchRank === 75; });
              if (!priority.length) priority = fresh.filter(function (e) { return e.matchRank === 50; });
              if (!priority.length) priority = fresh.filter(function (e) { return e.matchRank === 25; });
              self.unlockedState.cacheSet('priorityEntries', priority);
              // The cache is a plain object, so the list would not repaint on its own;
              // bumping the key remounts it (WebDAV had the same stale-list bug).
              self.listVersion += 1;
              self.secureCache.save('secureCache.entries', fresh);
              self.settings.getSetDefaultRememberPeriod().then(function (period) {
                if (period === -2) {
                  self.secureCache.save('secureCache.entries', fresh, 'local');
                }
              });
            }
            chrome.storage.local.set({ lastSync: Date.now() });
          })
          .catch(function (err) {
            // offline / session expired / auth error → keep cached data, stay silent
            console.warn('[silentRefresh] skipped:', err && err.message);
            if (err && err.code === 'localfile-permission-required') {
              // Reading a local file needs a user gesture; the first click retries.
              self.autoSyncPending = true;
            }
          });
      });
    },
    entriesEqual(a, b) {
      if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
      if (a.length !== b.length) return false;
      // strip transient UI-derived fields before comparing
      var canon = function (arr) {
        return arr
          .map(function (e) {
            var c = {};
            for (var k in e) {
              if (k === 'matchRank' || k === 'filterKey' || k === 'view_is_active') continue;
              c[k] = e[k];
            }
            return c;
          })
          .sort(function (x, y) {
            var xk = x.id || x.title || x.userName || x.url || '';
            var yk = y.id || y.title || y.userName || y.url || '';
            return xk < yk ? -1 : xk > yk ? 1 : 0;
          });
      };
      return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
    },
    // Silent unlock using only the cached credentials. Never prompts and never decrypts
    // with an empty password: this used to be called from the grant path, which
    // decrypted with '' and reported "invalid key" right after the grant succeeded.
    autoUnlock() {

      this.loadKeyFiles()
        .then(() => this.settings.getSetDefaultRememberPeriod())
        .then((rememberPeriod) => {
          this.setRememberPeriod(rememberPeriod);
          return this.settings.getCurrentDatabaseUsage();
        })
        .then((usage) => {
          this.hidePassword = usage.requiresPassword === false;
          this.hideKeyFile = usage.requiresKeyfile === false;
          this.rememberedPassword = usage.passwordKey !== undefined;
          this.setRememberPeriod(usage.rememberPeriod);

          if (usage.passwordKey !== undefined && usage.requiresKeyfile === false) {
            this.unlock(usage.passwordKey, true);
          } else if (usage.keyFileName !== undefined) {
            let matches = this.keyFiles.filter((kf) => kf.name === usage.keyFileName);
            if (matches.length > 0) {
              this.selectedKeyFile = matches[0];
              if (this.hidePassword === true || usage.passwordKey !== undefined) {
                this.unlock(usage.passwordKey, true);
                // unlock() clears the veil on success or failure; nothing else to do.
                return;
              }
            }
            // Stored keyfile could not be used for a silent unlock: fall through and
            // show the form. Without this the veil stayed up forever and the popup
            // was blank until the watchdog fired.
            this.busy = false;
            this.initializing = false;
          } else {
            // No cached credentials — show unlock UI
            this.busy = false;
            this.initializing = false;
          }
        })
        .catch((err) => {
          console.error('[autounlock] failed:', err);
          if (err && err.code === 'localfile-permission-required') {
          }
          this.busy = false;
          this.initializing = false;
        });
    },
    clickUnlock(event) {
      event.preventDefault();
      this.unlock();
    },
    // Opening the picker must not deselect the current keyfile, and it must always
    // have the list: keyFiles used to be loaded only by the silent unlock path, so a
    // popup that opened from the entry cache showed an empty picker.
    toggleKeyFilePicker() {
      this.keyFilePicker = !this.keyFilePicker;
      if (this.keyFilePicker) this.loadKeyFiles();
    },
    // Load the key files and keep the stored choice selected even when the silent
    // unlock path never ran (entries served from the cache).
    loadKeyFiles() {
      return this.settings
        .getKeyFiles()
        .then((keyFiles) => {
          this.keyFiles = keyFiles || [];
          if (this.selectedKeyFile !== undefined) return;
          return this.settings.getCurrentDatabaseUsage().then((usage) => {
            if (!usage || !usage.keyFileName) return;
            const match = this.keyFiles.filter((kf) => kf.name === usage.keyFileName)[0];
            if (match) this.selectedKeyFile = match;
          });
        })
        .catch((err) => {
          console.warn('[unlock] could not load key files:', err && err.message);
        });
    },
    // The saved usage decides which fields the form shows (password-only/keyfile-only)
    // and whether the password is remembered. It used to be read only by the silent
    // unlock path, so a popup opened from the cache showed both fields regardless.
    loadDatabaseUsage() {
      return this.settings
        .getCurrentDatabaseUsage()
        .then((usage) => {
          if (!usage) return;
          this.hidePassword = usage.requiresPassword === false;
          this.hideKeyFile = usage.requiresKeyfile === false;
          this.rememberedPassword = usage.passwordKey !== undefined;
          if (usage.rememberPeriod !== undefined) this.setRememberPeriod(usage.rememberPeriod);
        })
        .catch((err) => {
          console.warn('[unlock] could not read the database usage:', err && err.message);
        });
    },
    // Manual sync: the click supplies the gesture the background check lacks. Reports
    // what changed so the user knows the click did something.
    async syncNow() {
      if (this.syncing) return;
      this.autoSyncPending = false;
      this.syncing = true;
      try {
        const before = this.unlockedState.cacheGet('allEntries') || [];
        const fresh = await this.keepassService.refreshIfChanged();
        if (fresh === null) {
          this.showSyncToast(this.$t('No changes'));
          return;
        }
        const siteUrl = parseUrl(this.unlockedState.fullUrl || this.unlockedState.url);
        this.keepassService.rankEntries(fresh, siteUrl);
        const changed = this.countEntryChanges(before, fresh);
        this.unlockedState.cacheSet('allEntries', fresh);
        let priority = fresh.filter((e) => e.matchRank === 100);
        if (!priority.length) priority = fresh.filter((e) => e.matchRank === 75);
        if (!priority.length) priority = fresh.filter((e) => e.matchRank === 50);
        if (!priority.length) priority = fresh.filter((e) => e.matchRank === 25);
        this.unlockedState.cacheSet('priorityEntries', priority);
        this.secureCache.save('secureCache.entries', fresh);
        this.settings.getSetDefaultRememberPeriod().then((period) => {
          if (period === -2) this.secureCache.save('secureCache.entries', fresh, 'local');
        });
        chrome.storage.local.set({ lastSync: Date.now() });
        this.showResults(fresh);
        this.showSyncToast(
          changed ? this.$t('Synced {0} entries', changed) : this.$t('No changes')
        );
      } catch (err) {
        console.warn('[sync] failed:', err && err.message);
        if (err && err.code === 'localfile-permission-required') {
        }
        this.showSyncToast(this.$t('Sync failed. Try again.'));
      } finally {
        this.syncing = false;
      }
    },
    // Entries added, removed or edited compared with the cached list. OTP and password
    // are compared decrypted: an OTP-only edit used to report "no changes" even though
    // the list had been refreshed.
    countEntryChanges(before, after) {
      const decrypted = (entry, field) => {
        try {
          return this.unlockedState.getDecryptedAttribute(entry, field) || '';
        } catch (err) {
          return '';
        }
      };
      const fingerprint = (e) =>
        [
          e.id,
          e.title,
          e.userName,
          e.url,
          e.notes,
          e.groupPath,
          decrypted(e, 'otp'),
          decrypted(e, 'password'),
        ].join('\u0000');
      const previous = new Map((before || []).map((e) => [e.id, fingerprint(e)]));
      let changed = 0;
      (after || []).forEach((e) => {
        const prev = previous.get(e.id);
        if (prev === undefined || prev !== fingerprint(e)) changed += 1;
        previous.delete(e.id);
      });
      return changed + previous.size;
    },
    showSyncToast(text) {
      this.syncToast = text;
      if (this.syncToastTimer) clearTimeout(this.syncToastTimer);
      this.syncToastTimer = setTimeout(() => {
        this.syncToast = '';
      }, 2500);
    },
    unlock(passwordKey, quiet) {
      // `quiet` is used by the silent auto-unlock on open: the form stays on screen
      // (and the popup keeps its size) instead of swapping to the "Unlocking ..."
      // spinner for a fraction of a second.
      if (!quiet) this.busy = true;
      this.unlockedMessages.error = '';
      let passwordKeyPromise;
      let bufferPromise = this.keepassService.getChosenDatabaseFile();
      if (passwordKey === undefined)
        passwordKeyPromise = this.keepassService.getMasterKey(
          bufferPromise,
          this.masterPassword,
          this.selectedKeyFile
        );
      else passwordKeyPromise = Promise.resolve(passwordKey);

      let keyFileName = this.selectedKeyFile !== undefined ? this.selectedKeyFile.name : undefined;
      passwordKeyPromise
        .then((passwordKey) => {
          return this.keepassService
            .getDecryptedData(bufferPromise, passwordKey)
            .then((decryptedData) => {
              let entries = decryptedData.entries;
              let version = decryptedData.version;
              let dbUsage = {
                requiresPassword: passwordKey.passwordHash === null ? false : true,
                requiresKeyfile: passwordKey.keyFileHash === null ? false : true,
                passwordKey: undefined,
                version: version,
                keyFileName: keyFileName,
                rememberPeriod: this.rememberPeriod,
              };
              if (this.rememberPeriod !== 0) {
                let check_time = 60000 * this.rememberPeriod; // milliseconds / min
                // Save the password in memory independently.
                if (this.rememberPeriod === -2) {
                  // Forever - use -1 to bypass forgetStuff check
                  this.settings.cacheMasterPassword(passwordKey, {
                    forgetTime: -1,
                  });
                } else {
                  this.settings.cacheMasterPassword(passwordKey, {
                    forgetTime: check_time > 0 ? Date.now() + check_time : check_time,
                  });
                }
              } else {
                this.settings.getCurrentMasterPasswordCacheKey().then(this.secureCache.clear);
              }
              this.settings.saveCurrentDatabaseUsage(dbUsage);
              this.settings.getSetDefaultRememberPeriod(this.rememberPeriod);
              this.showResults(entries);
              if (!quiet) this.busy = false;
              this.masterPassword = '';
            });
        })
        .catch((err) => {
          console.error(err);
          var msg = err.message || '';
          // Try full message, then try without "Error " prefix
          var translated = this.$t(msg);
          if (translated === msg && msg.indexOf('Error ') === 0) {
            translated = this.$t(msg.slice(6));
          }
          // A late failure (e.g. a silent attempt racing a manual unlock) must not
          // paint an error over a database that is already open.
          if (!this.isUnlocked) {
            this.unlockedMessages['error'] = translated || this.$t('invalid keyfile or KDBX file');
          }
          if (err && err.code === 'localfile-permission-required') {
          }
          this.busy = false;
          this.initializing = false;
          throw err;        });
    },
  },
});
</script>

<template>
  <div :class="{ 'is-initializing': initializing }">
    <!-- Busy Spinner -->
    <div v-if="busy" class="spinner">
      <spinner size="medium" :message="$t('Unlocking ') + databaseFileName" />
    </div>

    <!-- Local-file sync: a small floating button above the footer. The popup opens
         without a user gesture, so the background check cannot read the file; this
         click supplies the gesture and reports what changed. -->
    <button
      v-if="isLocalFile && isUnlocked"
      type="button"
      class="sync-fab selectable"
      :disabled="syncing"
      :title="$t('Sync now')"
      :aria-label="$t('Sync now')"
      @click="syncNow"
    >
      <i class="fa fa-refresh" :class="{ 'fa-spin': syncing }" aria-hidden="true" />
    </button>
    <div v-if="syncToast" class="sync-toast">{{ syncToast }}</div>

    <!-- Entry List -->
    <EntryList
      v-if="!busy && isUnlocked && !showBrowse"
      :key="listVersion"
      :messages="unlockedMessages"
      :unlocked-state="unlockedState"
    />

    <!-- Browse All Entries -->
    <BrowseEntries
      v-if="!busy && isUnlocked && showBrowse"
      :key="listVersion"
      :unlocked-state="unlockedState"
      :keepass-service="keepassService"
    />

    <!-- Unlock input group -->
    <div v-if="!busy && !isUnlocked" id="masterPasswordGroup">
      <messenger v-show="unlockedMessages.error" :messages="unlockedMessages" />
      <div class="unlockLogo stack-item">
        <img src="@/assets/icons/exported/logo.png" width="256px" height="256px" />
          <span>{{ $t('Keepass Cat') }}</span>
      </div>

      <form @submit="clickUnlock">
        <div class="selectable databaseChoose" @click="$router.route('/choose')">
          <i class="fa fa-database database-icon" aria-hidden="true" />
          <b class="database-name">{{ databaseFileName }}</b>
          <span class="change-badge">{{ $t('change...') }}</span>
        </div>

        <div class="stack-item masterPasswordInput">
          <input
            id="masterPassword"
            ref="masterPassword"
            v-model="masterPassword"
            :type="isMasterPasswordInputVisible ? 'text' : 'password'"
            :placeholder="$t('🔒 master password')"
            autocomplete="off"
          />
          <i
            :class="['fa', isMasterPasswordInputVisible ? 'fa-eye-slash' : 'fa-eye', 'fa-fw']"
            aria-hidden="true"
            @click="isMasterPasswordInputVisible = !isMasterPasswordInputVisible"
          />
        </div>

        <div class="stack-item">
          <div
            id="select-keyfile"
            class="selectable"
            @click="toggleKeyFilePicker"
          >
            <i class="fa fa-key" aria-hidden="true" /> {{ selectedKeyFileName }}
          </div>
        </div>

        <div v-if="keyFilePicker" class="stack-item keyfile-picker">
          <transition name="keyfile-picker">
            <div>
              <span
                v-for="(kf, kf_index) in keyFiles"
                class="selectable"
                :keyfile-index="kf_index"
                @click="chooseKeyFile(kf_index)"
              >
                <i class="fa fa-file fa-fw" aria-hidden="true" /> {{ kf.name }}
              </span>
              <span class="selectable" @click="links.openOptionsKeyfiles">
                <i class="fa fa-wrench fa-fw" aria-hidden="true" /> {{ $t('Manage Keyfiles') }}</span
              >
            </div>
          </transition>
        </div>

        <div class="box-bar small plain remember-period-picker">
          <span>
            <label for="rememberPeriodLength">
              <span>{{ $t(rememberPeriodText) }} {{ $t(' (slide to choose)') }}</span>
            </label>
            <input
              id="rememberPeriodLength"
              v-model="slider_int"
              type="range"
              min="0"
              :max="slider_options.length - 1"
              step="1"
              @input="setRememberPeriod(undefined)"
            />
          </span>
        </div>

        <div class="stack-item">
          <button class="action-button selectable" @click="clickUnlock">{{ $t('Unlock Database') }}</button>
        </div>
      </form>
    </div>

    <!-- Footer -->
    <div v-show="!busy" class="box-bar medium footer">
      <span class="selectable" @click="links.openOptions">
        <i class="fa fa-cog" aria-hidden="true" /> {{ $t('Settings') }}</span
      >
      <span v-if="isUnlocked" class="selectable browse-btn" @click="toggleBrowse" :class="{ active: showBrowse }">
        <i :class="['fa', showBrowse ? 'fa-folder-open' : 'fa-folder']" aria-hidden="true" /> {{ $t('Database') }}</span
      >
      <span v-if="isUnlocked" class="selectable lock-btn" @click="forgetPassword">
        <i class="fa fa-lock" aria-hidden="true" /> {{ $t('Lock') }}</span
      >
      <span v-else class="selectable lock-btn" @click="closeWindow">
        <i class="fa fa-times-circle" aria-hidden="true" /> {{ $t('Close Window') }}</span
      >
    </div>
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';

/* Hidden rather than removed: the layout keeps its size while the auto-unlock
   decision is pending, so the popup opens at the right size and the unlock form
   never flashes for users whose password is remembered. */
.is-initializing {
  visibility: hidden;
}

/* Manual sync for local-file databases only (see v-if="isLocalFile"). Sits above the
   footer so it stays reachable without covering the entry list. */
.sync-fab {
  position: fixed;
  right: 12px;
  bottom: 56px;
  z-index: 20;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: $light-background-color;
  color: $blue;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  font-size: 14px;
  cursor: pointer;

  &:hover {
    background: var(--keepass-cat-bg-hover, #eef0f2);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
}

.sync-toast {
  position: fixed;
  right: 12px;
  bottom: 96px;
  z-index: 21;
  max-width: 260px;
  padding: 6px 10px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  pointer-events: none;
}

#masterPasswordGroup {
  .keyfile-picker {
    background-color: $light-background-color;
    box-sizing: border-box;
    transition: all 0.2s linear;
    max-height: 200px;
    overflow-y: auto;
    opacity: 1;
    border-top: 1px solid $light-gray;
    border-bottom: 1px solid $light-gray;
    padding: 5px $wall-padding;
    margin: 5px 0px;

    &.keyfile-picker-enter,
    &.keyfile-picker-leave-to {
      max-height: 0px;
      opacity: 0;
    }

    span {
      display: block;
      padding: 2px 0px;

      &:hover {
        padding-left: 3px;
      }
    }
  }

  #select-keyfile {
    padding: 8px $wall-padding;
    background-color: $light-background-color;
    border-bottom: 1px solid $light-gray;

    i {
      font-size: 14px;
    }

    &:hover {
      opacity: 0.7;
    }
  }

  #rememberPeriodLength {
    width: 80px;
    float: left;
  }

  .masterPasswordInput {
    border-top: 1px solid $light-gray;
    position: relative;

    i {
      position: absolute;
      font-size: 14px;
      top: calc(50% - 0.5em);
      right: 10px;
      cursor: pointer;
    }

    // The generic rule below leaves a 1em strip on the right, which showed the
    // row background as a mismatched patch next to the eye icon. Fill the row
    // and pad for the icon instead.
    input[type='text'],
    input[type='password'] {
      width: 100%;
      padding-right: 36px;
    }
  }

  input[type='text'],
  input[type='password'] {
    width: calc(100% - 1em);
    box-sizing: border-box;
    font-size: 18px;
    color: $text-color;
    background: $light-background-color;
    border-width: 0px 0px;
    padding: 5px $wall-padding;

    &:focus {
      outline: none;
    }
  }

  .remember-period-picker {
    margin: 6px 0px;

    input[type='range'] {
      -webkit-appearance: none;
      margin: 6px;
      margin-left: 0px;
    }
  }

  input[type='range']:focus {
    outline: none;
  }

  input[type='range']::-webkit-slider-runnable-track {
    height: 6px;
    cursor: pointer;
    animate: 0.2s;
    background: $blue;
    border-radius: 1.3px;
    border: 0.2px solid var(--keepass-cat-text);
    margin-top: -2px;
  }

  input[type='range']::-webkit-slider-thumb {
    border: 1px solid black;
    height: 18px;
    width: 10px;
    border-radius: 2px;
    background: white;
    cursor: pointer;
    -webkit-appearance: none;
    margin-top: -7px;
  }
}

.spinner {
  padding: $wall-padding;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.browse-btn {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.lock-btn {
  margin-left: auto;
}

.footer span {
  padding: 2px 4px;
  border-radius: 3px;

  &:hover {
    background-color: $dark-background-color;
  }
  &.active {
    background-color: $blue;
    color: var(--keepass-cat-svg-fill);
  }
}

.databaseChoose {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px $wall-padding;
  background: $light-background-color;
  border-top: 1px solid $light-gray;
  color: $text-color;

  .database-icon {
    flex-shrink: 0;
    font-size: 16px;
    color: $blue;
  }

  .database-name {
    flex: 1;
    min-width: 0;
    font-size: 16px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: clip;
    // Dissolve the cut like the entry rows rather than truncating with dots.
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 1.5em), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 1.5em), transparent);
  }

  .change-badge {
    flex-shrink: 0;
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1.4;
    color: $blue;
    border: 1px solid $blue;
    border-radius: 3px;
    transition: background-color 0.15s ease, color 0.15s ease;
  }

  &:hover {
    background: var(--keepass-cat-bg-hover);

    .change-badge {
      color: var(--keepass-cat-svg-fill);
      background: $blue;
    }
  }
}
</style>
