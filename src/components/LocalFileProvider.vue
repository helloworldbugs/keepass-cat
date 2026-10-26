<!--
  LocalFileProvider:
  A single .kdbx file on this computer, read and written in place with the
  File System Access API. The parent only mounts this component when
  providerManager.isSupported() is true (Chrome), so Firefox never sees it.
-->
<script>
import GenericProviderUi from '@/components/GenericProviderUi.vue';

export default {
  components: {
    GenericProviderUi,
  },
  props: {
    providerManager: Object,
    settings: Object,
  },
  data() {
    return {
      busy: false,
      // Whether the provider is switched on. Deliberately separate from "a file has
      // been picked": switching on must not open the file picker by itself.
      enabled: false,
      loggedIn: false,
      permission: 'none',
      fileName: '',
      databases: [],
      error: '',
    };
  },
  mounted() {
    this.refresh();
  },
  methods: {
    messageFor(err) {
      return (err && err.message) || String(err);
    },
    async refresh() {
      this.busy = true;
      this.error = '';
      try {
        this.loggedIn = await this.providerManager.isLoggedIn();
        this.enabled = await this.providerManager.isEnabled();
        this.databases = this.loggedIn ? await this.providerManager.listDatabases() : [];
        this.fileName = this.databases.length ? this.databases[0].title : '';
        this.permission = this.loggedIn ? await this.providerManager.getPermissionState() : 'none';
      } catch (err) {
        this.error = this.messageFor(err);
      } finally {
        this.busy = false;
      }
    },
    async chooseFile() {
      this.busy = true;
      this.error = '';
      try {
        await this.providerManager.login();
        await this.refresh();
      } catch (err) {
        this.error = this.messageFor(err);
        this.busy = false;
      }
    },
    async reauthorise() {
      this.busy = true;
      this.error = '';
      try {
        this.permission = await this.providerManager.requestPermission();
      } catch (err) {
        this.error = this.messageFor(err);
      } finally {
        this.busy = false;
      }
    },
    forgetFile() {
      this.settings.disableDatabaseProvider(this.providerManager);
      this.busy = true;
      this.error = '';
      this.providerManager
        .logout()
        .then(() => this.refresh())
        .catch((err) => {
          this.error = this.messageFor(err);
          this.busy = false;
        });
    },
    async toggleLogin() {
      if (this.enabled) {
        // Off: persisted, so the database picker stops offering the local file, and the
        // controls collapse. The picked handle stays until "Forget file".
        this.enabled = false;
        await this.providerManager.disable();
        this.settings.disableDatabaseProvider(this.providerManager);
      } else {
        // On: reveal the controls only; choosing a file stays a separate click.
        this.enabled = true;
        await this.providerManager.enable();
      }
    },
  },
};
</script>

<template>
  <div class="box-bar roomy database-manager">
    <generic-provider-ui
      :busy="busy"
      :databases="databases"
      :logged-in="enabled"
      :error="error"
      :provider-manager="providerManager"
      :toggle-login="toggleLogin"
      :removeable="false"
    />
    <p v-if="enabled" class="description">{{ $t(providerManager.chooseDescription) }}</p>
    <div v-if="enabled" class="local-file-actions">
      <a class="waves-effect waves-light btn" :class="{ disabled: busy }" @click="chooseFile">{{
        $t('Choose .kdbx file')
      }}</a>
      <a
        v-if="permission === 'prompt'"
        class="waves-effect waves-light btn"
        :class="{ disabled: busy }"
        @click="reauthorise"
        >{{ $t('Re-authorise') }}</a
      >
      <a v-if="loggedIn" class="selectable local-file-forget" @click="forgetFile">
        <i class="fa fa-times-circle" aria-hidden="true" /> {{ $t('Forget file') }}</a
      >
    </div>
    <p v-if="enabled && fileName" class="description">
      {{ $t('Selected file:') }} <b>{{ fileName }}</b>
    </p>
    <p v-if="enabled && permission === 'denied'" class="error">
      {{ $t('File permission was denied. Choose the file again to grant access.') }}
    </p>
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/settings.scss';

.local-file-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 12px 0;

  .btn {
    margin: 0;
  }
}

.local-file-forget {
  font-size: 13px;
}
</style>
