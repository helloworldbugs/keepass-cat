<script>
import JSONFormatter from 'json-formatter-js'
import { isFirefox } from '@/lib/utils'

export default {
  props: {
    settings: Object
  },
  data() {
    return {
      expireTime: 2,
      autofillShortcut: false,
      fillTotpEnabled: false,
      copyTotpOnAutofill: false,
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
      ]
    }
  },
  watch: {
    expireTime(newval, oldval) {
      this.settings.getSetClipboardExpireInterval(parseInt(newval))
    },
    fillTotpEnabled(newval) {
      this.settings.getSetFillTotpEnabled(newval)
    },
    copyTotpOnAutofill(newval) {
      this.settings.getSetCopyTotpOnAutofill(newval)
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
    init() {
      this.settings.getSetClipboardExpireInterval().then(val => {
        this.expireTime = val
      })
      this.settings.getSetAutofillShortcut().then(val => {
        this.autofillShortcut = val
      })
      this.settings.getSetFillTotpEnabled().then(val => {
        this.fillTotpEnabled = val
      })
      this.settings.getSetCopyTotpOnAutofill().then(val => {
        this.copyTotpOnAutofill = val
      })
      this.settings.getSetNotificationsEnabled().then(val => {
        this.notificationsEnabled = val
      })
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

    <div class="box-bar roomy">
      <h4>{{ $t('TOTP Automation') }}</h4>
      <p>{{ $t('Choose how Keepass Cat automates one-time passwords (TOTP).') }}</p>
    </div>
    <div class="box-bar roomy lighter">
      <div>
        <p class="totp-note">
          {{ $t('Copies the code and also fills it into the focused input field on the current page when you click the TOTP button.') }}
        </p>
        <div class="switch">
          <label>
            <input
              v-model="fillTotpEnabled"
              type="checkbox"
            >
            <span class="lever" />
            {{ $t('Fill TOTP at cursor') }}
          </label>
        </div>
        <p class="totp-note">
          {{ $t('Copies the code to the clipboard whenever you autofill an entry that has a TOTP.') }}
        </p>
        <div class="switch">
          <label>
            <input
              v-model="copyTotpOnAutofill"
              type="checkbox"
            >
            <span class="lever" />
            {{ $t('Copy TOTP on autofill') }}
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
.json {
	font-size: 12px;
	/* The JSON viewer renders strings with `white-space: pre`, which never
	   wraps and would otherwise push the page (and the Delete button) wide.
	   Let the block shrink and scroll its own long lines instead. */
	min-width: 0;
	overflow-x: auto;
}

h4 {
	font-size: 24px;
}

.totp-note {
	margin: 0 0 4px;
	padding-left: 16px;
	font-size: 12px;
	line-height: 1.5;
	color: var(--keepass-cat-text-muted);
}

.switch + .totp-note {
	margin-top: 16px;
}
</style>
