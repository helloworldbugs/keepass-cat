<template>
  <div id="router-view">
    <!-- SVG Defs -->
    <svg-defs />
    <!-- Router View -->
    <startup
      v-if="show.startup.visible"
      id="/"
      :settings="settings"
      :password-file-store-registry="passwordFileStoreRegistry"
    />
    <file-picker
      v-if="show.filePicker.visible"
      id="/choose"
      :password-file-store-registry="passwordFileStoreRegistry"
      :settings="settings"
      :links="links"
    />
    <unlock
      v-if="show.unlock.visible"
      id="/unlock/:provider/:title"
      :unlocked-state="unlockedState"
      :secure-cache="secureCache"
      :links="links"
      :settings="settings"
      :keepass-service="keepassService"
    />
    <entry-edit
      v-if="show.entryEdit.visible"
      id="/entry-edit/:entryId"
      :unlocked-state="unlockedState"
      :secure-cache="secureCache"
      :keepass-service="keepassService"
      :settings="settings"
      :links="links"
    />
    <!-- End Router View -->
  </div>
</template>

<script setup>
/* beautify preserve:start */
// Singletons
import { Settings } from '$services/settings.js';
import { ProtectedMemory } from '$services/protectedMemory';
import { KeepassHeader } from '$services/keepassHeader.js';
import { KeepassReference } from '$services/keepassReference.js';
import { KeepassService } from '$services/keepassService.js';
import { UnlockedState } from '$services/unlockedState.js';
import { SecureCacheMemory } from '$services/secureCacheMemory.js';
import { PasswordFileStoreRegistry } from '$services/passwordFileStore.js';
import { Links } from '$services/links.js';
import { Notifications } from '$services/notifications.js';
// File Managers
import { WebdavFileManager } from '$services/webdavFileManager.js';
// Components
import Unlock from '@/components/Unlock.vue';
import Startup from '@/components/Startup.vue';
import FilePicker from '@/components/FilePicker.vue';
import EntryEdit from '@/components/EntryEdit.vue';
import SvgDefs from '@/components/SvgDefs.vue';
import { reactive } from 'vue';
import { useRouter } from '@/lib/useRouter.js';

const links = new Links();
const protectedMemory = new ProtectedMemory();
const secureCache = new SecureCacheMemory(protectedMemory);
const settings = new Settings(secureCache);
const keepassHeader = new KeepassHeader(settings);
const keepassReference = new KeepassReference();
const notifications = new Notifications(settings);

// File Managers
const webdavFileManager = new WebdavFileManager(settings);

const passwordFileStoreRegistry = new PasswordFileStoreRegistry(
  webdavFileManager
);
const keepassService = new KeepassService(
  keepassHeader,
  settings,
  passwordFileStoreRegistry,
  keepassReference
);
const unlockedState = new UnlockedState(keepassReference, settings, notifications);
/* beautify preserve:end */

const show = reactive({
  unlock: {
    visible: false,
  },
  startup: {
    visible: false,
  },
  filePicker: {
    visible: false,
  },
  entryEdit: {
    visible: false,
  },
});

const $router = useRouter();
$router.registerRoutes([
  {
    route: '/',
    var: show.startup,
  },
  {
    route: '/choose',
    var: show.filePicker,
  },
  {
    route: '/unlock/:provider/:title',
    var: show.unlock,
  },
  {
    route: '/entry-edit/:entryId',
    var: show.entryEdit,
  },
]);
$router.route('/');
</script>

<style lang="scss">
@import './styles/theme.scss';
@import './styles/shared.scss';

#router-view {
  width: 400px;
  margin: 0px auto;
  color: $text-color;
  background-color: $background-color;
}

body {
  margin: 0px;
  width: 100%;
  background-color: $background-color;
  color: $text-color;
  user-select: none;
}
</style>
