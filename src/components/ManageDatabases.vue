<script>
import WebdavProvider from '@/components/WebdavProvider.vue';
import LocalFileProvider from '@/components/LocalFileProvider.vue';
export default {
  components: {
    WebdavProvider,
    LocalFileProvider,
  },
  props: {
    webdavManager: Object,
    localFileManager: Object,
    settings: Object,
  },
  data() {
    return {
      // The File System Access API is Chrome-only; hide the provider elsewhere
      // instead of rendering a control that cannot work.
      localFileSupported: false,
    };
  },
  mounted() {
    this.localFileSupported = !!(this.localFileManager && this.localFileManager.isSupported());
  },
};
</script>

<template>
  <div>
    <local-file-provider
      v-if="localFileSupported"
      :provider-manager="localFileManager"
      :settings="settings"
    />
    <webdav-provider :provider-manager="webdavManager" :settings="settings" />
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';
</style>
