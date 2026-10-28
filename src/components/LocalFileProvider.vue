<!--
  LocalFileProvider:
  One or more .kdbx files on this computer, each read and written in place with
  the File System Access API. The parent only mounts this component when
  providerManager.isSupported() is true (Chrome), so Firefox never sees it.

  Every file gets a stable id when it is added; the id is what the unlock screen
  remembers and what a save is written back to. The name shown here comes from the
  picker: the File System Access API exposes no path, so two files with the same
  name in different folders are indistinguishable - the second one gets a numbered
  suffix when it is added, and the name itself is not editable.

  The rows deliberately mirror ManageKeyfiles: one bar per file, with the remove
  icon right behind the name instead of pushed to the far edge of the row.
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
      // Whether the provider is switched on. Deliberately separate from "files
      // have been added": switching on must not open the file picker by itself.
      enabled: false,
      files: [],
      // id -> 'granted' | 'prompt' | 'denied' | 'unsupported' | 'none'
      permission: {},
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
    needsPermission(id) {
      const state = this.permission[id];
      return !!state && state !== 'granted' && state !== 'unsupported';
    },
    async refresh() {
      this.busy = true;
      this.error = '';
      try {
        this.enabled = await this.providerManager.isEnabled();
        this.files = await this.providerManager.listFiles();
        const permission = {};
        for (const file of this.files) {
          permission[file.id] = await this.providerManager.getFilePermission(file.id);
        }
        this.permission = permission;
      } catch (err) {
        this.error = this.messageFor(err);
      } finally {
        this.busy = false;
      }
    },
    async addFiles() {
      if (this.busy) return;
      this.busy = true;
      this.error = '';
      try {
        await this.providerManager.addFiles();
      } catch (err) {
        this.error = this.messageFor(err);
        this.busy = false;
        return;
      }
      await this.refresh();
    },
    async reauthorise(file) {
      this.busy = true;
      this.error = '';
      try {
        this.permission = Object.assign({}, this.permission, {
          [file.id]: await this.providerManager.requestPermission(this.dbInfoFor(file)),
        });
      } catch (err) {
        this.error = this.messageFor(err);
      } finally {
        this.busy = false;
      }
    },
    dbInfoFor(file) {
      return {
        serverId: 'localfile',
        title: file.alias,
        path: file.id,
        cacheId: file.cacheId,
      };
    },
    isSameChoice(choice, file) {
      const passwordFile = (choice && choice.passwordFile) || {};
      return (
        passwordFile.path === file.id ||
        passwordFile.cacheId === file.cacheId ||
        passwordFile.title === file.alias
      );
    },
    async removeFile(file) {
      if (this.busy) return;
      this.busy = true;
      this.error = '';
      try {
        const current = await this.settings.getCurrentDatabaseChoice();
        if (current && current.providerKey === 'localfile' && this.isSameChoice(current, file)) {
          // This file was the selected database: forget its secrets *and* the
          // selection, so the popup falls back to another database instead of
          // pointing at a file that no longer exists.
          await this.settings.disableDatabaseProvider(this.providerManager);
        } else {
          await this.settings.forgetDatabaseSecrets({
            providerKey: 'localfile',
            passwordFile: this.dbInfoFor(file),
          });
        }
        await this.providerManager.removeFile(file.id);
      } catch (err) {
        this.error = this.messageFor(err);
        this.busy = false;
        return;
      }
      await this.refresh();
    },
    async toggleLogin() {
      if (this.enabled) {
        // Off: persisted, so the database picker stops offering the local files, and
        // the controls collapse. The handles stay until the files are removed.
        this.enabled = false;
        await this.providerManager.disable();
        this.settings.disableDatabaseProvider(this.providerManager);
      } else {
        // On: reveal the controls only; adding a file stays a separate click.
        this.enabled = true;
        await this.providerManager.enable();
      }
    },
  },
};
</script>

<template>
  <div id="local-file-manager">
    <div class="box-bar roomy database-manager">
      <generic-provider-ui
        :busy="busy"
        :databases="[]"
        :logged-in="enabled"
        :error="error"
        :provider-manager="providerManager"
        :toggle-login="toggleLogin"
        :removeable="false"
      />
      <template v-if="enabled">
        <p class="description">{{ $t(providerManager.chooseDescription) }}</p>
        <p v-if="!files.length" class="description">{{ $t('No local files added yet.') }}</p>
      </template>
    </div>
    <!-- The file bars are part of what the switch turns on: switching the provider
         off has to fold the list away with the rest of the controls, otherwise the
         names stay on screen for a provider the picker no longer offers. -->
    <template v-if="enabled">
      <div v-for="file in files" :key="file.id" class="box-bar roomy small lighter">
        <span>
          <!-- Read-only, like the key-file rows: the name is the one the picker
               reported, and a duplicate gets a numbered suffix when it is added. -->
          <span class="local-file-name" :title="file.alias">{{ file.alias }}</span>
          <i
            class="fa fa-times-circle selectable"
            aria-hidden="true"
            :title="$t('remove')"
            @click="removeFile(file)"
          />
          <a
            v-if="needsPermission(file.id)"
            class="selectable local-file-badge"
            @click="reauthorise(file)"
            >{{ $t('Re-authorise') }}</a
          >
        </span>
      </div>
    </template>
    <div v-if="enabled" class="box-bar roomy">
      <a class="waves-effect waves-light btn" :class="{ disabled: busy }" @click="addFiles">{{
        $t('Add .kdbx files')
      }}</a>
    </div>
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';

#local-file-manager {
  /* Same treatment as the key-file rows: a long, space-less name must not widen the
     row, and the remove icon stays right behind it. No ellipsis - the name is
     clipped and the full value is in the tooltip.
     Weight and colour stay at the description's: the list is body text, not a
     heading, so it must not read as heavier than the paragraph above it. */
  .local-file-name {
    display: inline-block;
    max-width: calc(100% - 40px);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: clip;
    vertical-align: bottom;
    font-weight: 400;
  }

  .local-file-badge {
    margin-left: 8px;
    font-size: 12px;
    font-weight: 400;
    color: var(--keepass-cat-keyfile-active);
  }
}
</style>
