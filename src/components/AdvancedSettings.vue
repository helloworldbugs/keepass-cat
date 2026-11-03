<script>
import { isFirefox } from '@/lib/utils'

export default {
  props: {
    settings: Object
  },
  data() {
    return {
      expireTime: 15,
      clipboardExpireEnabled: true,
      autofillShortcut: true,
      inlineIconEnabled: true,
      autoFillOnLoad: false,
      fillTotpEnabled: true,
      copyTotpOnAutofill: true,
      notificationsEnabled: ['expiration', 'clipboard'],
    }
  },
  watch: {
    expireTime(newval, oldval) {
      this.settings.getSetClipboardExpireInterval(parseInt(newval))
    },
    clipboardExpireEnabled(newval) {
      this.settings.getSetClipboardExpireEnabled(newval)
      // Turning the feature off must not leave a pending clear behind — neither
      // the stored deadline nor the one-shot alarm that fires it.
      if (!newval) {
        this.settings.clearForgetTimes(['clearClipboard'])
        chrome.alarms.clear('clearClipboard')
      }
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
    saveInlineIconEnabled() {
      this.settings.getSetInlineIconEnabled(this.inlineIconEnabled);
    },
    saveAutoFillOnLoad() {
      this.settings.getSetAutoFillOnLoad(this.autoFillOnLoad);
    },
    openShortcuts() {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    },
    init() {
      this.settings.getSetClipboardExpireInterval().then(val => {
        this.expireTime = val
      })
      this.settings.getSetClipboardExpireEnabled().then(val => {
        this.clipboardExpireEnabled = val
      })
      this.settings.getSetAutofillShortcut().then(val => {
        this.autofillShortcut = val
      })
      this.settings.getSetInlineIconEnabled().then(val => {
        this.inlineIconEnabled = val
      })
      this.settings.getSetAutoFillOnLoad().then(val => {
        this.autoFillOnLoad = val
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
    }
  }
}
</script>

<template>
  <div class="advanced-settings">
    <div class="box-bar roomy">
      <h4>{{ $t('Clipboard Expiration Time') }}</h4>
      <p>
        {{ $t('When you copy a password, Keepass Cat clears the clipboard again after the timeout you choose.') }}
      </p>
    </div>
    <div
      class="box-bar roomy lighter clipboard-expire-controls"
      :class="{ 'is-disabled': !clipboardExpireEnabled }"
    >
      <div class="switch">
        <label>
          <input
            v-model="clipboardExpireEnabled"
            type="checkbox"
            :aria-label="$t('Clipboard Expiration Time')"
          >
          <span class="lever" />
          <span class="switch-text">{{ $t('Enable clipboard expiration clearing') }}</span>
        </label>
      </div>
      <div class="expire-row">
        <span class="expire-label">{{ $t('Expiration time') }}</span>
        <select
          v-model="expireTime"
          :disabled="!clipboardExpireEnabled"
          style="display: inline-block;"
        >
        <option value="15">
          {{ $t('15 seconds') }}
        </option>
        <option value="30">
          {{ $t('30 seconds') }}
        </option>
        <option value="60">
          {{ $t('1 minute') }}
        </option>
        <option value="180">
          {{ $t('3 minutes') }}
        </option>
        <option value="300">
          {{ $t('5 minutes') }}
        </option>
        <option value="600">
          {{ $t('10 minutes') }}
        </option>
        </select>
      </div>
    </div>

    <div class="box-bar roomy">
      <h4>{{ $t('In-page fill icon') }}</h4>
    </div>
    <div class="box-bar roomy lighter">
      <div class="switch">
        <label>
          <input
            v-model="inlineIconEnabled"
            type="checkbox"
            @change="saveInlineIconEnabled"
          >
          <span class="lever" />
          {{ $t('Show the fill icon on login fields') }}
        </label>
      </div>
      <p class="totp-note">
        {{ $t('Adds a small key button to the username field of login forms, so an entry can be filled without opening the extension.') }}
      </p>
    </div>

    <div class="box-bar roomy">
      <h4>{{ $t('Auto-fill on page load') }}</h4>
    </div>
    <div class="box-bar roomy lighter">
      <div class="switch">
        <label>
          <input
            v-model="autoFillOnLoad"
            type="checkbox"
            @change="saveAutoFillOnLoad"
          >
          <span class="lever" />
          {{ $t('Fill when exactly one entry matches') }}
        </label>
      </div>
      <p class="totp-note">
        {{ $t('A login page is filled as soon as it finishes loading, but only when one entry matches and the fields are still empty. Pages that match several entries are left alone.') }}
      </p>
    </div>

    <div class="box-bar roomy">
      <h4>{{ $t('Autofill Shortcut') }}</h4>
    </div>
    <div class="box-bar roomy lighter">
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
      <p class="totp-note">
        {{ $t('Default shortcut:') }} Ctrl + Shift + Space
      </p>
      <p class="shortcut-hint">
        <template v-if="isFirefox()">
          {{ $t('Customize shortcuts in Firefox: toolbar menu (top-right) → Add-ons and themes → gear icon (top-right) → Manage Extension Shortcuts.') }}
        </template>
        <template v-else>
          <a href="#" @click.prevent="openShortcuts">{{ $t('Open Chrome shortcut settings') }}</a>
        </template>
      </p>
    </div>

    <div class="box-bar roomy">
      <h4>{{ $t('OTP Automation') }}</h4>
      <p>{{ $t('Choose how Keepass Cat automates one-time passwords (OTP).') }}</p>
    </div>
    <div class="box-bar roomy lighter">
      <div>
        <p class="totp-note">
          {{ $t('Copies the code and also fills it into the focused input field on the current page when you click the OTP button.') }}
        </p>
        <div class="switch">
          <label>
            <input
              v-model="fillTotpEnabled"
              type="checkbox"
            >
            <span class="lever" />
            {{ $t('Fill OTP at cursor') }}
          </label>
        </div>
        <p class="totp-note">
          {{ $t('Copies the code to the clipboard whenever you autofill an entry that has an OTP.') }}
        </p>
        <div class="switch">
          <label>
            <input
              v-model="copyTotpOnAutofill"
              type="checkbox"
            >
            <span class="lever" />
            {{ $t('Copy OTP on autofill') }}
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
  </div>
</template>

<style lang="scss">
// Materialize's h4 is 2.28rem (about 36px), which in a settings page reads as a
// page title rather than a section label. 20px puts it just above the body text
// without competing with the nav bar.
.advanced-settings h4 {
  font-size: 20px;
  line-height: 1.35;
  margin: 0 0 6px;
}

// The switch labels are the option names, not headings: one step down from the
// section title keeps the hierarchy readable (body text is 14px).
.advanced-settings .switch label {
  font-size: 14px;
}

// The interval label sits in the same row as a switch and is the same level of
// information, so it drops to that size too instead of inheriting .box-bar's 18px.
.advanced-settings .expire-label {
  font-size: 14px;
}

// The shortcut hint sits directly under the switch it explains.
.shortcut-hint {
  margin: 8px 0 0;
}

// The interval picker is meaningless while the feature is switched off.
.clipboard-expire-controls {
  transition: opacity 0.15s ease;

  // The master switch sits on its own line, directly above the interval picker.
  .switch {
    display: block;
    margin: 0 0 8px;
  }

  .switch-text {
    vertical-align: middle;
  }

  .expire-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .expire-label {
    flex-shrink: 0;
  }

  &.is-disabled {
    opacity: 0.5;

    select {
      pointer-events: none;
    }
  }
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
