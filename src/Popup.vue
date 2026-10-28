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

    <unlock
      v-if="show.unlock.visible"
      id="/unlock/:provider/:title"
      :unlocked-state="unlockedState"
      :secure-cache="secureCache"
      :links="links"
      :settings="settings"
      :keepass-service="keepassService"
      :password-file-store-registry="passwordFileStoreRegistry"
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
import { LocalFileManager } from '$services/localFileManager.js';
// Components
import Unlock from '@/components/Unlock.vue';
import Startup from '@/components/Startup.vue';
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
const localFileManager = new LocalFileManager(settings);

const passwordFileStoreRegistry = new PasswordFileStoreRegistry(
  webdavFileManager,
  localFileManager
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
    route: '/unlock/:provider/:title',
    var: show.unlock,
  },
  {
    route: '/entry-edit/:entryId',
    var: show.entryEdit,
  },
]);
const LAST_UNLOCK_ROUTE_KEY = 'keepassCat.lastUnlockRoute';

// Open straight into the unlock screen the user last used, so the popup is the
// right size from the first paint. The choice is checked afterwards and only
// corrected when it no longer matches (database removed / different file picked).
let initialRoute = '/';
try {
  const stored = localStorage.getItem(LAST_UNLOCK_ROUTE_KEY);
  if (stored && $router.parse(stored)) initialRoute = stored;
} catch (e) {
  // localStorage can be unavailable; fall back to the startup screen.
}
$router.route(initialRoute);

if (initialRoute !== '/') {
  settings
    .getCurrentDatabaseChoice()
    .then((info) => {
      const current = $router.getRoute();
      // The user already navigated somewhere else; never yank the screen.
      if (!current || current._path !== '/unlock/:provider/:title') return;
      if (!info) {
        $router.route('/');
        return;
      }
      const target =
        '/unlock/' + info.providerKey + '/' + encodeURIComponent(info.passwordFile.title);
      if ('/unlock/' + current.provider + '/' + current.title !== target) {
        $router.route(target);
      }
    })
    .catch(() => {});
}
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
  /* The popup is a control surface, not a document: dragging across entries should
     never produce a text selection. Form controls keep normal selection so text
     inside them can still be edited and copied. */
  user-select: none;

  input,
  textarea {
    user-select: text;
  }
}
</style>
