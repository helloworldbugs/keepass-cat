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
    <div class="box-bar about roomy">
      <p>
        {{ $t('Tusk ') }}
        <b>{{ $t('requires') }}</b>
        {{ $t(' a WebDAV server to sync your keepass database with. Once the files appear below, they will be available to unlock within the popup window.') }}
      </p>
    </div>
    <webdav-provider :provider-manager="webdavManager" :settings="settings" />
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';
</style>
