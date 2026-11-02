<!--
  LocalFileProvider:
  One or more .kdbx files on this computer, each read and written in place with
  the File System Access API. The parent only mounts this component when
  providerManager.isSupported() is true (Chrome), so Firefox never sees it — and
  that includes the "new database" flow below, which needs the save picker.

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
import { createLocalDatabase, changeLocalDatabasePassword } from '$services/localDatabaseOps.js';

const KEEP_CURRENT_KEYFILE = '__keep__';

function emptyForm() {
  return {
    name: '',
    password: '',
    confirm: '',
    currentPassword: '',
    currentKeyName: '',
    newPassword: '',
    newConfirm: '',
    newKeyName: KEEP_CURRENT_KEYFILE,
  };
}

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
      notice: '',
      // 'create' | 'change' | null
      dialog: null,
      dialogBusy: false,
      dialogError: '',
      form: emptyForm(),
      changingFile: null,
      // Managed key files, shared with the key-file screen.
      keyFiles: [],
      keepCurrentKeyFile: KEEP_CURRENT_KEYFILE,
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
    permissionLabel(file) {
      const state = this.permission[file.id];
      if (!state || state === 'none' || state === 'unsupported') return '—';
      return state === 'granted' ? this.$t('Authorised') : this.$t('Needs permission');
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

    /* ------------------------------------------------------------ dialogs */

    async loadKeyFiles() {
      try {
        this.keyFiles = (await this.settings.getKeyFiles()) || [];
      } catch (e) {
        this.keyFiles = [];
      }
    },
    keyFileByName(name) {
      if (!name) return null;
      return this.keyFiles.find((keyFile) => keyFile.name === name) || null;
    },
    openCreateDialog() {
      this.form = emptyForm();
      this.dialogError = '';
      this.dialog = 'create';
    },
    openChangeDialog(file) {
      this.form = emptyForm();
      this.form.name = file.alias;
      this.loadKeyFiles();
      this.changingFile = file;
      this.dialogError = '';
      this.dialog = 'change';
    },
    closeDialog() {
      if (this.dialogBusy) return;
      this.dialog = null;
      this.changingFile = null;
      this.dialogError = '';
    },
    validatePasswords(password, confirm) {
      if (!password) return this.$t('The password cannot be empty.');
      if (password !== confirm) return this.$t('The two passwords do not match.');
      return '';
    },
    async submitCreate() {
      if (this.dialogBusy) return;
      const name = (this.form.name || '').trim();
      if (!name) {
        this.dialogError = this.$t('Give the database a name.');
        return;
      }
      const invalid = this.validatePasswords(this.form.password, this.form.confirm);
      if (invalid) {
        this.dialogError = invalid;
        return;
      }
      this.dialogBusy = true;
      this.dialogError = '';
      try {
        const record = await createLocalDatabase(this.providerManager, {
          name: name,
          password: this.form.password,
        });
        if (!record) {
          // Save dialog dismissed: keep the form open, nothing was written.
          this.dialogBusy = false;
          return;
        }
        // Make the new database the current one, so the popup opens it directly.
        const info = this.dbInfoFor(record);
        await this.settings.saveCurrentDatabaseChoice(info, this.providerManager);
        this.notice = this.$t('Database created. Open the extension to add your passwords.');
        this.dialog = null;
        await this.refresh();
      } catch (err) {
        console.error('[localfile] create failed:', err);
        this.dialogError = this.messageFor(err);
      } finally {
        this.dialogBusy = false;
      }
    },
    async submitChange() {
      if (this.dialogBusy || !this.changingFile) return;
      const invalid = this.validatePasswords(this.form.newPassword, this.form.newConfirm);
      if (invalid) {
        this.dialogError = invalid;
        return;
      }
      const keepCurrent = this.form.newKeyName === this.keepCurrentKeyFile;
      const nextKeyFile = keepCurrent
        ? this.keyFileByName(this.form.currentKeyName)
        : this.keyFileByName(this.form.newKeyName);
      if (!this.form.newPassword && !nextKeyFile) {
        this.dialogError = this.$t('The password cannot be empty.');
        return;
      }

      this.dialogBusy = true;
      this.dialogError = '';
      const dbInfo = this.dbInfoFor(this.changingFile);
      try {
        await changeLocalDatabasePassword(this.providerManager, dbInfo, {
          currentPassword: this.form.currentPassword,
          currentKeyFile: this.keyFileByName(this.form.currentKeyName),
          newPassword: this.form.newPassword,
          newKeyFile: nextKeyFile,
        });
        // The cached master password belongs to the old key: drop it so the next
        // unlock asks for the new one instead of failing with "wrong password".
        await this.settings.forgetDatabaseSecrets({
          providerKey: 'localfile',
          passwordFile: dbInfo,
        });
        this.notice = this.$t('Unlock password changed. Enter it once in the popup.');
        this.dialog = null;
        this.changingFile = null;
        await this.refresh();
      } catch (err) {
        console.error('[localfile] change password failed:', err);
        // A load failure here means the current password / key file is wrong; say
        // so, because that is the only recoverable cause the user can act on.
        this.dialogError = /invalid|key|signature|corrupt/i.test(this.messageFor(err))
          ? this.$t('The current password or key file does not unlock this database.')
          : this.messageFor(err);
      } finally {
        this.dialogBusy = false;
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
      <table v-if="files.length" class="kdbx-table">
        <thead>
          <tr>
            <th>{{ $t('File name') }}</th>
            <th>{{ $t('Status') }}</th>
            <th>{{ $t('Actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="file in files" :key="file.id">
            <td :title="file.alias">{{ file.alias }}</td>
            <td
              class="kdbx-table-status"
              :class="needsPermission(file.id) ? 'is-warn' : 'is-ok'"
            >
              {{ permissionLabel(file) }}
            </td>
            <td>
              <a class="selectable kdbx-table-action" @click="openChangeDialog(file)">{{
                $t('Change password')
              }}</a>
              <a class="selectable kdbx-table-action" @click="removeFile(file)">{{
                $t('remove')
              }}</a>
              <a
                v-if="needsPermission(file.id)"
                class="selectable kdbx-table-action local-file-badge"
                @click="reauthorise(file)"
                >{{ $t('Re-authorise') }}</a
              >
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <div v-if="enabled" class="box-bar roomy local-file-actions">
      <a class="waves-effect waves-light btn" :class="{ disabled: busy }" @click="addFiles">{{
        $t('Add .kdbx files')
      }}</a>
      <a
        class="waves-effect waves-light btn local-file-new"
        :class="{ disabled: busy }"
        @click="openCreateDialog"
        >{{ $t('New password database') }}</a
      >
    </div>
    <p v-if="notice" class="box-bar roomy small local-file-notice">{{ notice }}</p>

    <!-- One dialog for both flows: creating a database and changing its unlock
         password take the same fields, and a native <dialog> keeps the form out of
         the page flow without pulling in materialize's modal JS. -->
    <div v-if="dialog" class="local-dialog-backdrop" @click.self="closeDialog">
      <div class="local-dialog">
        <h5>
          {{ dialog === 'create' ? $t('New password database') : $t('Change password') }}
        </h5>

        <div v-if="dialog === 'create'" class="field">
          <label for="local-db-name">{{ $t('Database name') }}</label>
          <input id="local-db-name" v-model="form.name" type="text" :placeholder="$t('My passwords')" />
        </div>

        <template v-if="dialog === 'change'">
          <div class="field">
            <label for="local-db-current">{{ $t('Current unlock password') }}</label>
            <input id="local-db-current" v-model="form.currentPassword" type="password" autocomplete="off" />
          </div>
          <div class="field">
            <label for="local-db-current-key">{{ $t('Current key file') }}</label>
            <select id="local-db-current-key" v-model="form.currentKeyName">
              <option value="">{{ $t('No key file') }}</option>
              <option v-for="keyFile in keyFiles" :key="keyFile.name" :value="keyFile.name">
                {{ keyFile.name }}
              </option>
            </select>
          </div>
        </template>

        <div class="field">
          <label for="local-db-password">{{ dialog === 'create' ? $t('Unlock password') : $t('New unlock password') }}</label>
          <input
            v-if="dialog === 'create'"
            id="local-db-password"
            v-model="form.password"
            type="password"
            autocomplete="new-password"
          />
          <input
            v-else
            id="local-db-password"
            v-model="form.newPassword"
            type="password"
            autocomplete="new-password"
          />
        </div>
        <div class="field">
          <label for="local-db-confirm">{{ $t('Confirm password') }}</label>
          <input
            v-if="dialog === 'create'"
            id="local-db-confirm"
            v-model="form.confirm"
            type="password"
            autocomplete="new-password"
          />
          <input
            v-else
            id="local-db-confirm"
            v-model="form.newConfirm"
            type="password"
            autocomplete="new-password"
          />
        </div>

        <div v-if="dialog === 'change'" class="field">
          <label for="local-db-new-key">{{ $t('Key file') }}</label>
          <select id="local-db-new-key" v-model="form.newKeyName">
            <option :value="keepCurrentKeyFile">{{ $t('Keep the current one') }}</option>
            <option value="">{{ $t('No key file') }}</option>
            <option v-for="keyFile in keyFiles" :key="keyFile.name" :value="keyFile.name">
              {{ keyFile.name }}
            </option>
          </select>
        </div>

        <p v-if="dialogError" class="local-dialog-error">{{ dialogError }}</p>
        <p class="local-dialog-hint">
          {{ $t('There is no way to recover a forgotten password: keep it somewhere safe.') }}
        </p>

        <div class="local-dialog-actions">
          <a class="selectable" @click="closeDialog">{{ $t('Cancel') }}</a>
          <button
            type="button"
            class="btn local-dialog-primary"
            :disabled="dialogBusy"
            @click="dialog === 'create' ? submitCreate() : submitChange()"
          >
            {{ dialog === 'create' ? $t('Create') : $t('Save') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';

#local-file-manager {
  .local-file-badge {
    color: var(--keepass-cat-keyfile-active);
  }

  .local-file-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .local-file-notice {
    font-size: 13px;
    color: var(--keepass-cat-text-subtle);
  }

  /* The dialog is rendered here rather than through materialize's modal module: it
     is one form in two variants, and the page never needs the JS initialisation. */
  .local-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .local-dialog {
    width: 100%;
    max-width: 420px;
    max-height: 90vh;
    overflow-y: auto;
    padding: 20px 24px 16px;
    background: var(--keepass-cat-bg-light, #fff);
    color: var(--keepass-cat-text, #2c3e50);
    border-radius: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    box-sizing: border-box;

    h5 {
      margin: 0 0 16px;
      font-size: 18px;
      font-weight: 600;
    }

    .field {
      margin-bottom: 12px;
    }

    label {
      display: block;
      margin-bottom: 4px;
      font-size: 13px;
      color: var(--keepass-cat-text-subtle, #666);
    }

    input,
    select {
      display: block;
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid var(--keepass-cat-border, #e7e8ea);
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font-size: 14px;
    }

    .local-dialog-error {
      margin: 8px 0 0;
      font-size: 13px;
      color: #c0392b;
    }

    .local-dialog-hint {
      margin: 10px 0 0;
      font-size: 12px;
      color: var(--keepass-cat-text-muted, #999);
    }

    .local-dialog-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 16px;
      margin-top: 18px;

      .selectable {
        font-weight: 500;
      }

      /* options.scss only colours `a.btn`; the dialog's primary action is a real
         <button>, so it gets the same blue here. */
      .local-dialog-primary {
        background-color: $blue;
        color: $background-color;
        box-shadow: none;

        &:hover,
        &:focus {
          background-color: $blue;
          opacity: 0.85;
        }

        &:disabled {
          opacity: 0.5;
          cursor: default;
        }
      }
    }
  }
}
</style>
