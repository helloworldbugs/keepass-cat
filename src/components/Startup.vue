<script>
/* beautify preserve:start */
import { Links } from '$services/links.js';
import Spinner from 'vue-simple-spinner';
/* beautify preserve:end */
export default {
  components: {
    Spinner,
  },
  props: {
    settings: Object,
    passwordFileStoreRegistry: Object,
  },
  data() {
    return {
      links: Links(),
      busy: true,
    };
  },
  mounted: function () {
    this.settings.getCurrentDatabaseChoice().then((info) => {
      //use the last chosen database
      if (info) {
        this.$router.route(
          '/unlock/' + info.providerKey + '/' + encodeURIComponent(info.passwordFile.title)
        );
        return;
      }

      // No database chosen yet (fresh install, or every provider was switched
      // off): use the first database a provider offers and go straight to its
      // unlock screen. There is no separate chooser page any more — the database
      // row on the unlock screen lists the others.
      const managers = this.passwordFileStoreRegistry.listFileManagers('listDatabases');
      const lookups = managers.map((provider) =>
        provider.listDatabases().then((files) =>
          (files || []).map((file) => {
            file.provider = provider;
            return file;
          })
        )
      );

      return Promise.all(lookups).then((filesArrays) => {
        const availableFiles = filesArrays.reduce((prev, curr) => prev.concat(curr), []);
        if (!availableFiles.length) {
          //no files available - allow the user to link to the options page
          this.busy = false;
          return;
        }

        const first = availableFiles[0];
        const choice = first.provider.getDatabaseChoiceData(first);
        return this.settings.saveCurrentDatabaseChoice(choice, first.provider).then(() => {
          this.$router.route(
            '/unlock/' + first.provider.key + '/' + encodeURIComponent(first.title)
          );
        });
      });
    });  },
};
</script>

<template>
  <div>
    <div class="box-bar plain">
      <div class="unlockLogo stack-item">
        <img src="@/assets/icons/exported/logo.png" />
        <span>{{ $t('Keepass Cat') }}</span>
      </div>
      <p>
        {{ $t("Keepass Cat is an extension that uses your existing KeePass database files to autofill passwords on websites. In order to continue, you must add your KeePass database file(s).") }}
      </p>
    </div>
    <div class="stack-item selectable">
      <button class="action-button selectable" :disabled="busy" @click="links.openOptions">
        {{ $t('Add a KeePass database file') }}
      </button>
    </div>
    <!-- The page keeps its full size while the database lookup runs; only this line
         changes, so the popup never flashes a smaller, spinner-only window. -->
    <div v-if="busy" class="box-bar plain startup-busy">
      <spinner size="small" />
    </div>
    <div v-else class="box-bar plain">
      <p>{{ $t("You can return here when you've enabled one of the database file providers.") }}</p>
    </div>
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';
p {
  width: 100%;
  margin: 10px 0px 0px 0px;
  font-size: 14px;
}

.startup-busy {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 44px;
}
</style>
