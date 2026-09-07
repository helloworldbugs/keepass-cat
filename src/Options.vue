<template>
  <div id="popup-view">
    <svg-defs />
    <options-navbar :routes="routes" :initial-tab="initialTab" />
    <!-- Router View -->
    <div id="overflowbox">
      <div id="contentbox">
        <options-startup v-if="show.startup.visible" id="/" :settings="services.settings" />
        <manage-databases
          v-if="show.manageDatabases.visible"
          id="/manage/databases"
          :webdav-manager="services.webdavFileManager"
          :settings="services.settings"
        />
        <manage-keyfiles
          v-if="show.manageKeyfiles.visible"
          id="/manage/keyfiles"
          :settings="services.settings"
          :key-file-parser="services.keyFileParser"
        />
        <advanced-settings
          v-if="show.advanced.visible"
          id="/advanced"
          :settings="services.settings"
          :secure-cache-memory="services.secureCacheMemory"
        />
      </div>
    </div>
  </div>
</template>

<script>
/* beautify preserve:start */
// Singletons
import { Settings } from '$services/settings.js';
import { ProtectedMemory } from '$services/protectedMemory';
import { SecureCacheMemory } from '$services/secureCacheMemory.js';
import { PasswordFileStoreRegistry } from '$services/passwordFileStore.js';
import { KeyFileParser } from '$services/keyFileParser.js';
// File Managers
import { WebdavFileManager } from '$services/webdavFileManager.js';
// Components
import OptionsNavbar from '@/components/Navbar.vue';
import OptionsStartup from '@/components/OptionsStartup.vue';
import ManageDatabases from '@/components/ManageDatabases.vue';
import ManageKeyfiles from '@/components/ManageKeyfiles.vue';
import AdvancedSettings from '@/components/AdvancedSettings.vue';
import SvgDefs from '@/components/SvgDefs.vue';

const protectedMemory = new ProtectedMemory();
const secureCacheMemory = new SecureCacheMemory(protectedMemory);
const settings = new Settings(secureCacheMemory);
const keyFileParser = new KeyFileParser();

// File Managers
const webdavFileManager = new WebdavFileManager(settings);

/* beautify preserve:end */

export default {
  name: 'App',
  components: {
    OptionsNavbar,
    OptionsStartup,
    ManageDatabases,
    ManageKeyfiles,
    AdvancedSettings,
    SvgDefs,
  },
  data() {
    return {
      routes: [],
      initialTab: '/', // The tab to start on.
      services: {
        settings,
        keyFileParser,
        secureCacheMemory,
        webdavFileManager,
      },
      show: {
        startup: {
          visible: false,
        },
        manageDatabases: {
          visible: false,
        },
        manageKeyfiles: {
          visible: false,
        },
        advanced: {
          visble: false,
        },
      },
    };
  },
  mounted: function () {
    // Relies on the content of this.show
    this.$router.registerRoutes([
      {
        route: '/',
        name: 'Getting Started',
        var: this.show.startup,
      },
      {
        route: '/manage/databases',
        name: 'Manage Databases',
        var: this.show.manageDatabases,
      },
      {
        route: '/manage/keyfiles',
        name: 'Manage Keyfiles',
        var: this.show.manageKeyfiles,
      },
      {
        route: '/advanced',
        name: 'Advanced',
        var: this.show.advanced,
      },
    ]);
    this.routes = this.$router.routes; // HACK since Vue doesn't notice changes in
    let hashroute = this.$router.processHash(window.location.hash);
    if (hashroute) this.$router.route(hashroute);
    else this.$router.route(this.initialTab);
  },
};
</script>

<style lang="scss">
@import './styles/options.scss';

body {
  background-color: $background-color;
  user-select: none;
}

#overflowbox {
  overflow-y: auto;
  margin-top: 60px;
}

#contentbox {
  margin: 0px auto;
  width: $options-width;
  /* height: 490px; */
}
</style>
