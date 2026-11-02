<script>
import { requestLocalFileExpansion } from '@/lib/onboarding.js';

export default {
  props: {
    localFileManager: Object,
  },
  data() {
    return {
      // The local-file provider needs the File System Access API, which Firefox
      // does not have: the "create one here" path only makes sense where the
      // database settings can actually create a file.
      localFileSupported: false,
    };
  },
  mounted() {
    this.localFileSupported = !!(this.localFileManager && this.localFileManager.isSupported());
  },
  methods: {
    // The section's create button only exists while the provider is switched on,
    // so the hand-off asks it to switch on when it renders.
    startLocalDatabase() {
      requestLocalFileExpansion();
      this.$router.route('/manage/databases');
    },
  },
};
</script>

<template>
  <div class="getting-started">
    <div class="box-bar roomy">
      <div class="unlockLogo stack-item optionsheader">
        <img src="@/assets/icons/exported/logo.png" width="256px" height="256px" />
        <span>{{ $t('Getting Started with Keepass Cat') }}</span>
      </div>

      <p>
        {{ $t('KeePass is the oldest and most trusted open-source password manager: over twenty years of development, with your passwords kept in an encrypted file (.kdbx) that you own rather than on a company\'s server.') }}
      </p>

      <p>
        {{ $t('Keepass Cat brings that file into the browser: it reads the .kdbx you already have and fills in your logins as you browse. The file stays with you - we upload nothing, and there is no account to create.') }}
      </p>

      <template v-if="localFileSupported">
        <p>
          {{ $t('Never used KeePass? Create a local password database with the button below and you can try it out in a minute.') }}
        </p>

        <div class="settings-actions">
          <a class="waves-effect waves-light btn" @click="startLocalDatabase">{{
            $t('New local database')
          }}</a>
        </div>
      </template>

      <p v-if="localFileSupported">
        {{ $t('Already using KeePass with a .kdbx of your own? Add it with the button below. Keep it on this machine, or on a WebDAV server so several devices share one database - once it is added, autofill works here in the browser.') }}
      </p>
      <p v-else>
        {{ $t('Already using KeePass with a .kdbx of your own? Add it with the button below, on a WebDAV server so several devices share one database - once it is added, autofill works here in the browser.') }}
      </p>

      <div class="settings-actions">
        <a class="waves-effect waves-light btn" @click="$router.route('/manage/databases')">{{
          $t('Manage Databases')
        }}</a>
      </div>

      <p>
        {{ $t('Keepass Cat runs entirely on your machine: there is no server and no account. The database is only read into memory while it is unlocked, the master password is not remembered by default, and a copied password is cleared from the clipboard when its timer runs out.') }}
      </p>
    </div>

    <div class="box-bar roomy lighter">
      <h4>{{ $t('Support Keepass Cat') }}</h4>
      <p>
        {{ $t('If the Keepass Cat project helps you, please consider leaving a review on the ') }}
        <a
          href="https://chromewebstore.google.com/detail/keepass-cat/mafedpebfdpojojcgdmgkljcboehlegf"
          target="_blank"
          rel="noopener noreferrer"
          >{{ $t('Chrome Web Store') }}</a
        >
        {{ $t(' or the ') }}
        <a
          href="https://addons.mozilla.org/firefox/addon/keepass-cat/"
          target="_blank"
          rel="noopener noreferrer"
          >{{ $t('Firefox add-on store') }}</a
        >
        {{ $t(', or clicking a Star on my ') }}
        <a
          href="https://github.com/helloworldbugs/keepass-cat"
          target="_blank"
          rel="noopener noreferrer"
          >{{ $t('GitHub repo') }}</a
        >{{ $t('. If you run into any problem, please open an ') }}
        <a
          href="https://github.com/helloworldbugs/keepass-cat/issues"
          target="_blank"
          rel="noopener noreferrer"
          >{{ $t('issue') }}</a
        >{{ $t(' so we can improve Keepass Cat.') }}
      </p>
    </div>
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';

.optionsheader {
  text-align: left;
  font-size: 28px;
}

.getting-started {
  p {
    margin: 0 0 16px 0;
  }

  /* The button belongs to the paragraph above it, so it sits closer to that than
     to the next section. */
  .settings-actions {
    margin: 4px 0 24px 0;
  }
}
</style>
