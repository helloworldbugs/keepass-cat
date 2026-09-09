<script>
import WebdavProvider from '@/components/WebdavProvider.vue';
export default {
  components: {
    WebdavProvider,
  },
  props: {
    webdavManager: Object,
    settings: Object,
  },
};
</script>

<template>
  <div>
    <webdav-provider :provider-manager="webdavManager" :settings="settings" />
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';
</style>
