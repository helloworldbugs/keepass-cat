<script>
import JSONFormatter from 'json-formatter-js'
import { isFirefox } from '@/lib/utils'
import { toRaw } from 'vue'

export default {
  props: {
    settings: Object,
    secureCacheMemory: Object
  },
  data() {
    return {
      busy: false,
      expireTime: 2,
      autofillShortcut: false,
      allOriginPermission: false,
      allOriginPerms: {
        origins: [
          "https://*/*",
          "http://*/*"
        ]
      },
      strictMatchEnabled: false,
      notificationsEnabled: [],
      jsonState: [{
        k: 'databaseUsages',                      // key
        f: this.settings.getSetDatabaseUsages,    // getter
        delete: {
          f: this.settings.destroyLocalStorage, // remover
          arg: 'databaseUsages',                // remover args
          op: 'Delete'                          // remover button name
        }
      },
      {
        k: 'webdavServerList',
        f: this.settings.getSetWebdavServerList,
        delete: {
          f: this.settings.destroyLocalStorage,
          arg: 'webdavServerList',
          op: 'Delete'
        }
      },
      {
        k: 'webdavDirectoryMap',
        f: this.settings.getSetWebdavDirectoryMap,
        delete: {
          f: this.settings.destroyLocalStorage,
          arg: 'webdavDirectoryMap',
          op: 'Delete'
        }
      },
      {
        k: 'selectedDatabase',
        f: this.settings.getCurrentDatabaseChoice,
        delete: {
          f: this.settings.destroyLocalStorage,
          arg: 'selectedDatabase',
          op: 'Delete'
        }
      },
      {
        k: 'keyFiles',
        f: this.settings.getKeyFiles,
        delete: {
          f: this.settings.deleteAllKeyFiles,
          arg: undefined,
          op: 'Delete'
        }
      },
      {
        k: 'forgetTimes',
        f: this.settings.getAllForgetTimes
      },
      {
        k: 'sharedUrlList',
        f: this.settings.getSharedUrlList,
        delete: {
          f: this.settings.destroyLocalStorage,
          arg: 'sharedUrlList',
          op: 'Delete'
        }
      },
      ]
    }
  },
  watch: {
    expireTime(newval, oldval) {
      this.settings.getSetClipboardExpireInterval(parseInt(newval))
    },
    strictMatchEnabled(newval, oldval) {
      this.settings.getSetStrictModeEnabled(newval)
    },
    notificationsEnabled(newval) {
      this.settings.getSetNotificationsEnabled(newval)
    }
  },
  mounted() {
    this.init();
  },
  methods: {
    isFirefox: isFirefox,
    saveAutofillShortcut() {
      chrome.storage.local.set({ autofillShortcut: this.autofillShortcut });
    },
    openShortcuts() {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    },
    toggleOriginPermissions(evt) {
      // Negated because this function will call before the vue model update.
      const rawPerms = toRaw(this.allOriginPerms); // Convert proxy to raw object
      if (!this.allOriginPermission) {
        chrome.permissions.request(rawPerms);
      } else {
        chrome.permissions.remove(rawPerms);
      }
      this.settings.getSetOriginPermissionEnabled(!this.allOriginPermission);
      this.allOriginPermission = !this.allOriginPermission;
    },
    init() {
      this.settings.getSetClipboardExpireInterval().then(val => {
        this.expireTime = val
      })
      this.settings.getSetAutofillShortcut().then(val => {
        this.autofillShortcut = val
      })
      this.settings.getSetNotificationsEnabled().then(val => {
        this.notificationsEnabled = val
      })
      this.settings.getSetStrictModeEnabled().then(val => {
        this.strictMatchEnabled = val;
      })
      if (!isFirefox()) {
        const rawPerms = toRaw(this.allOriginPerms);
        chrome.permissions.contains(rawPerms, granted => {
          this.allOriginPermission = !!granted;
        });
      }
      this.jsonState.forEach(blob => {
        blob.f().then(result => {
          if (result && Object.keys(result).length) {
            let formatter = new JSONFormatter(result)
            let place = document.getElementById(blob.k)
            while (place.firstChild) place.removeChild(place.firstChild);
            place.appendChild(formatter.render())
          } else {
            document.getElementById(blob.k).parentNode.parentNode.remove();
          }
        });
      });
    }
  }
}
</script>

<template>
  <div>
    <div class="box-bar roomy">
      <h4>{{ $t('Clipboard Expiration Time') }}</h4>
      <p>
        {{ $t('When you copy a value to the clipboard, Keepass Cat will set a timeout to automatically clear it again. You can choose how long this timeout will last.') }}
      </p>
    </div>
    <div class="box-bar roomy lighter">
      <select
        v-model="expireTime"
        style="display: inline-block;"
      >
        <option value="1">
          {{ $t('1 minute') }}
        </option>
        <option value="2">
          {{ $t('2 minutes') }}
        </option>
        <option value="3">
          {{ $t('3 minutes') }}
        </option>
        <option value="5">
          {{ $t('5 minutes') }}
        </option>
        <option value="8">
          {{ $t('8 minutes') }}
        </option>
      </select>
    </div>

    <div class="box-bar roomy">
      <h4>{{ $t('Autofill Shortcut') }}</h4>
      <p>
        <template v-if="isFirefox()">
          {{ $t('Customize shortcuts in Firefox: toolbar menu (top-right) → Add-ons and themes → gear icon (top-right) → Manage Extension Shortcuts.') }}
        </template>
        <template v-else>
          <a href="#" @click.prevent="openShortcuts">{{ $t('Open Chrome shortcut settings') }}</a>
        </template>
      </p>
    </div>
    <div class="box-bar roomy lighter">
      <div>
        <div class="switch">
          <label>
            <input
              v-model="autofillShortcut"
              type="checkbox"
              @change="saveAutofillShortcut"
            >
            <span class="lever" />
            {{ $t('Autofill Shortcut') }}
          </label>
        </div>
      </div>
    </div>

    <div
      v-if="!isFirefox()"
      class="box-bar roomy"
    >
      <h4>{{ $t('Grant Permission on All Websites') }}</h4>
      <p>
        <strong style="color: var(--keepass-cat-red)">{{ $t('Only proceed if you know what you\'re doing.') }}</strong>
        {{ $t(' If enabled, the extension prompts once for permission to access and change data on all websites which disables the permissions popup on each new website. This has ') }}
        <a href="https://github.com/subdavis/Tusk/issues/168">{{ $t('serious security implications') }}</a>
        {{ $t('. Only applies to Chrome. Because of a Chrome bug, it is currently impossible to revoke this permission again after it is enabled. If you turn this ON, Keepass Cat must be reinstalled to reset.') }}
      </p>
    </div>
    <div
      v-if="!isFirefox()"
      class="box-bar roomy lighter"
    >
      <div>
        <div class="switch">
          <label @click="toggleOriginPermissions">
            <input
              v-model="allOriginPermission"
              type="checkbox"
            >
            <span
              class="lever"
              @click.prevent
            />
            {{ $t('Grant All Permissions') }}
          </label>
        </div>
      </div>
    </div>

    <div class="box-bar roomy">
      <h4>{{ $t('Notification') }}</h4>
      <p>{{ $t('Choose which type of notification do you want to receive from Keepass Cat.') }}</p>
    </div>
    <div class="box-bar roomy lighter">
      <div>
        <div class="switch">
          <label>
            <input
              v-model="notificationsEnabled"
              type="checkbox"
              value="expiration"
            >
            <span class="lever" />
            {{ $t('Password expiration') }}
          </label>
        </div>
        <div class="switch">
          <label>
            <input
              v-model="notificationsEnabled"
              type="checkbox"
              value="clipboard"
            >
            <span class="lever" />
            {{ $t('Clipboard events') }}
          </label>
        </div>
      </div>
    </div>

    <div class="box-bar roomy">
      <h4>{{ $t('Enable Strict Matching') }}</h4>
      <p>
        {{ $t('If enabled, only entries whose origins match exactly will be suggested for input. Titles and other tab information will not be considered in matching. For example') }},
        <pre>www.google.com</pre>
        {{ $t(' will not match ') }}
        <pre>https://google.com</pre>
      </p>
    </div>
    <div class="box-bar roomy lighter">
      <div>
        <div class="switch">
          <label>
            <input
              v-model="strictMatchEnabled"
              type="checkbox"
            >
            <span class="lever" />
            {{ $t('Strict Matching') }}
          </label>
        </div>
      </div>
    </div>

    <div class="box-bar roomy">
      <h4>{{ $t('Stored Data') }}</h4>
      <p>
        {{ $t('The following objects represent the current data cached in local storage. This data is only available to Keepass Cat, and is never sent over any network connection.') }}
      </p>
    </div>
    <div
      v-for="blob in jsonState"
      class="box-bar lighter roomy"
    >
      <p>{{ blob.k }}</p>
      <div class="between">
        <div
          :id="blob.k"
          class="json"
        />
        <a
          v-if="blob.delete !== undefined"
          class="waves-effect waves-light btn"
          @click="blob.delete.f(blob.delete.arg); init();"
        >{{ $t(blob.delete.op) }}</a>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@import "../styles/settings.scss";

.json {
	font-size: 12px;
}

h4 {
	font-size: 24px;
}
</style>
