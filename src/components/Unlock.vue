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
      silentAutofill: false,
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
      return this.$t('No keyfile selected.  (click to change)');
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
  async mounted() {
    // Restore browse state
    if (this.unlockedState.cacheGet('showBrowse')) this.showBrowse = true;
    // modify unlockedState internal state
    await this.unlockedState.getTabDetails();

    if (!this.isUnlocked) {
      let try_autounlock = () => {
        this.busy = true;
        this.settings
          .getKeyFiles()
          .then((keyFiles) => {
            this.keyFiles = keyFiles;
            return this.settings.getSetDefaultRememberPeriod();
          })
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
              this.unlock(usage.passwordKey);
            } else if (usage.keyFileName !== undefined) {
              let matches = this.keyFiles.filter((kf) => kf.name === usage.keyFileName);
              if (matches.length > 0) {
                this.selectedKeyFile = matches[0];
                if (this.hidePassword === true || usage.passwordKey !== undefined)
                  this.unlock(usage.passwordKey);
              }
            } else {
              // No cached credentials — show unlock UI
              this.busy = false;
            }
          })
          .catch((err) => {
            console.error('[autounlock] failed:', err);
            this.busy = false;
          });
      };

      let focus = () => {
        this.$nextTick(() => {
          let mp = this.$refs.masterPassword;
          if (mp) mp.focus();
        });
      };

      this.busy = true;
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
          if (!this.isUnlocked) try_autounlock();
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
          if (!this.isUnlocked) try_autounlock();
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
        this.slider_int = ((t) => {
          for (let i = 0; i < this.slider_options.length; i++) {
            if (this.slider_options[i].time === t) return i;
          }
          return 0;
        })(time_int);
        slider_option_index = this.slider_int;
      } else {
        slider_option_index = parseInt(this.slider_int);
      }
      if (slider_option_index < this.slider_options.length) {
        this.rememberPeriod = this.slider_options[slider_option_index].time;
        this.rememberPeriodText = this.slider_options[slider_option_index].text;
      }
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

      // Check for pending shortcut autofill
      this.checkPendingAutofill(allEntries);
    },
    silentRefresh(cachedEntries) {
      // Auto-sync: after showing cached entries, quietly re-fetch from the backend
      // and refresh the UI/cache if the database changed on another device.
      var self = this;
      chrome.storage.local.get('lastSync', function (items) {
        var now = Date.now();
        var last = items.lastSync || 0;
        if (now - last < 30000) return; // throttled: at most once per 30s
        self.keepassService
          .refreshFromServer()
          .then(function (fresh) {
            var siteUrl = parseUrl(self.unlockedState.fullUrl || self.unlockedState.url);
            self.keepassService.rankEntries(fresh, siteUrl);
            if (!self.entriesEqual(fresh, cachedEntries)) {
              // Update cache in place WITHOUT re-running showResults, which would
              // call checkPendingAutofill and steal a pending fill from a fresh shortcut popup.
              self.unlockedState.cacheSet('allEntries', fresh);
              var priority = fresh.filter(function (e) { return e.matchRank === 100; });
              if (!priority.length) priority = fresh.filter(function (e) { return e.matchRank === 75; });
              if (!priority.length) priority = fresh.filter(function (e) { return e.matchRank === 50; });
              if (!priority.length) priority = fresh.filter(function (e) { return e.matchRank === 25; });
              self.unlockedState.cacheSet('priorityEntries', priority);
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
    checkPendingAutofill(allEntries) {
      var self = this;
      console.log('[checkPendingAutofill] called, entries=', allEntries ? allEntries.length : 0);
      var processPa = function (pa) {
        console.log('[checkPendingAutofill] pa=', pa ? ('title=' + pa.title) : 'null');
        if (!pa) return;
        var entry = allEntries.find(e =>
          e.title === pa.title && e.url === pa.url && e.userName === pa.userName
        );
        if (!entry) { entry = allEntries.find(e => e.title === pa.title); }
        if (entry) {
          // Clear the pending fill now that we've matched and are about to fill.
          chrome.runtime.sendMessage({ m: 'clearPendingFill' });
          self.silentAutofill = true;
          self.$nextTick(() => {
            self.unlockedState.autofill(entry);
          });
        }
      };

      // Primary: pull the pending fill via a message (avoids the storage.local
      // propagation race between the service worker and the popup).
      chrome.runtime.sendMessage({ m: 'getPendingFill' }, (response) => {
        console.log('[checkPendingAutofill] msg response=', response && response.pendingAutofill ? 'set' : 'null',
          'lastError=', chrome.runtime.lastError ? chrome.runtime.lastError.message : 'none');
        if (chrome.runtime.lastError) { response = null; }
        if (response && response.pendingAutofill) {
          processPa(response.pendingAutofill);
          return;
        }
        // Fallback: storage.session (poll a few times)
        var attempts = 0;
        var tryRead = function () {
          chrome.storage.session.get('pendingAutofill', (items) => {
            var pa = items.pendingAutofill;
            if (!pa) {
              attempts++;
              if (attempts < 4) setTimeout(tryRead, 200);
              return;
            }
            chrome.storage.session.remove('pendingAutofill');
            processPa(pa);
          });
        };
        tryRead();
      });
    },
    clickUnlock(event) {
      event.preventDefault();
      this.unlock();
    },
    unlock(passwordKey) {
      this.busy = true;
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
              this.busy = false;
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
          this.unlockedMessages['error'] = translated || this.$t('invalid keyfile or KDBX file');
          this.busy = false;
          throw err;
        });
    },
  },
});
</script>

<template>
  <div v-if="!silentAutofill">
    <!-- Busy Spinner -->
    <div v-if="busy" class="spinner">
      <spinner size="medium" :message="$t('Unlocking ') + databaseFileName" />
    </div>

    <!-- Entry List -->
    <EntryList
      v-if="!busy && isUnlocked && !showBrowse"
      :messages="unlockedMessages"
      :unlocked-state="unlockedState"
      :settings="settings"
    />

    <!-- Browse All Entries -->
    <BrowseEntries
      v-if="!busy && isUnlocked && showBrowse"
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
        <div class="small selectable databaseChoose" @click="$router.route('/choose')">
          <b>{{ databaseFileName }}</b> <span class="muted-color">{{ $t('change...') }}</span>
        </div>

        <div class="stack-item masterPasswordInput">
          <input
            id="masterPassword"
            ref="masterPassword"
            v-model="masterPassword"
            :type="isMasterPasswordInputVisible ? 'text' : 'password'"
            placeholder="🔒 master password"
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
            @click="
              selectedKeyFile = undefined;
              keyFilePicker = !keyFilePicker;
            "
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
  padding-left: 5px;
}
</style>
