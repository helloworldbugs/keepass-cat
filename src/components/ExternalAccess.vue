<script>
/*
 * External Access: pairing and policy for local AI clients (MCP bridge).
 *
 * Everything is decided here, once: which scopes exist, which groups are
 * visible, how long a token lives. There is deliberately no per-request
 * approval - the AI is a background tool, and the audit list below is the way
 * to notice it doing something unexpected.
 */
export default {
  props: {
    extAccess: Object,
    secureCache: Object,
  },
  data() {
    return {
      ready: false,
      config: null,
      clients: [],
      audit: [],
      groups: [],
      groupsLocked: false,
      groupsLoading: false,
      guideName: '',
      guideText: '',
      copiedHint: false,
      busyId: '',
      ttlOptions: [7, 14, 30],
    };
  },
  mounted() {
    this.reload();
  },
  methods: {
    async reload() {
      this.config = await this.extAccess.getConfig();
      this.clients = await this.extAccess.listClients();
      this.audit = await this.extAccess.getAudit();
      await this.loadGroups();
      this.ready = true;
    },
    // The group picker asks the background, which holds the authoritative
    // unlocked cache. Reading it through this page's own secure-cache port used
    // to fail silently (the port is only opened when the page is the active tab),
    // which is why an unlocked vault still said "unlock first".
    async loadGroups() {
      this.groupsLoading = true;
      try {
        const answer = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ m: 'extAccessGroups' }, (response) => {
            if (chrome.runtime.lastError || !response) resolve({ locked: true, groups: [] });
            else resolve(response);
          });
        });
        this.groupsLocked = !!answer.locked;
        this.groups = Array.isArray(answer.groups) ? answer.groups : [];
      } catch (e) {
        this.groupsLocked = true;
        this.groups = [];
      }
      this.groupsLoading = false;
    },
    async save(patch) {
      this.config = await this.extAccess.saveConfig(patch);
    },
    toggleEnabled() {
      this.save({ enabled: this.config.enabled });
    },
    toggleScope(key) {
      const scopes = Object.assign({}, this.config.scopes);
      scopes[key] = !scopes[key];
      this.save({ scopes });
    },
    setGroupMode(mode) {
      this.save({ groupMode: mode });
      // Switching to the picker re-reads the groups: the vault may have been
      // unlocked (or its cache lapsed) since this page was opened.
      if (mode === 'selected') this.loadGroups();
    },
    toggleGroup(uuid) {
      const ids = this.config.groupIds.slice();
      const ix = ids.indexOf(uuid);
      if (ix >= 0) ids.splice(ix, 1);
      else ids.push(uuid);
      this.save({ groupIds: ids });
    },
    saveTtl() {
      this.save({ tokenTtlDays: this.config.tokenTtlDays });
    },
    savePort() {
      let port = parseInt(this.config.port, 10);
      if (!(port >= 1024 && port <= 65535)) port = 19455;
      this.config.port = port;
      this.save({ port });
    },
    saveRateLimit() {
      let rate = parseInt(this.config.rateLimitPerMin, 10);
      if (!(rate >= 1 && rate <= 600)) rate = 60;
      this.config.rateLimitPerMin = rate;
      this.save({ rateLimitPerMin: rate });
    },
    scopeSummary() {
      const s = this.config.scopes;
      const on = [];
      if (s.groups) on.push(this.$t('group list'));
      if (s.entries) on.push(this.$t('entry metadata (title / username / URL)'));
      if (s.otp) on.push(this.$t('current OTP codes'));
      if (s.secrets) on.push(this.$t('passwords, notes and custom fields'));
      return on.join(', ');
    },
    async generateGuide() {
      const name = (this.guideName || '').trim() || 'AI client';
      const { code } = await this.extAccess.createBootstrap(name);
      const bridgeUrl = 'https://raw.githubusercontent.com/helloworldbugs/keepass-cat/main/bridge/keepass-cat-mcp.mjs';
      const lines = [
        this.$t('Please set up MCP access to my Keepass Cat password vault:'),
        '',
        this.$t('1. Download the bridge script and save it somewhere stable:') + ' ' + bridgeUrl,
        this.$t('2. Add an MCP server to your configuration:'),
        '   - ' + this.$t('name') + ': keepass-cat',
        '   - ' + this.$t('command') + ': node <' + this.$t('path to keepass-cat-mcp.mjs') + '>',
        '   - ' + this.$t('environment variables') + ':',
        '     KEEPASS_CAT_BOOTSTRAP=' + code + '  (' + this.$t('one-time pairing code, expires in 15 minutes') + ')',
        '     KEEPASS_CAT_PORT=' + this.config.port,
        this.$t('3. Then call the keepass_status tool and tell me the result.'),
        '',
        this.$t('This access is read-only; I granted these scopes:') + ' ' + this.scopeSummary() + '.',
        this.$t('When the vault is locked, tools answer "locked" - just tell me to unlock it.'),
      ];
      this.guideText = lines.join('\n');
      this.copiedHint = false;
      try {
        await navigator.clipboard.writeText(this.guideText);
        this.copiedHint = true;
        setTimeout(() => (this.copiedHint = false), 2000);
      } catch (e) {
        // Clipboard unavailable: the text stays on screen for manual copying.
      }
    },
    async revoke(client) {
      this.busyId = client.id;
      await this.extAccess.revokeClient(client.id);
      this.clients = await this.extAccess.listClients();
      this.busyId = '';
    },
    // Re-pairing an existing client: the old token dies and a fresh bootstrap
    // code is generated under the same name.
    async regenerate(client) {
      this.busyId = client.id;
      await this.extAccess.revokeClient(client.id);
      this.guideName = client.name;
      await this.generateGuide();
      this.clients = await this.extAccess.listClients();
      this.busyId = '';
    },
    fmtTime(ts) {
      return ts ? new Date(ts).toLocaleString() : '—';
    },
    clientState(client) {
      if (client.revokedAt) return this.$t('revoked');
      if (client.expiresAt && client.expiresAt < Date.now()) return this.$t('expired');
      return this.$t('active');
    },
    async exportAudit() {
      const rows = this.audit.map((r) => ({
        time: new Date(r.ts).toISOString(),
        client: r.client,
        method: r.method,
        target: r.target,
        result: r.result,
      }));
      const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'keepass-cat-access-log.json';
      a.click();
      URL.revokeObjectURL(a.href);
    },
    async clearAudit() {
      await this.extAccess.clearAudit();
      this.audit = [];
    },
  },
};
</script>

<template>
  <div v-if="ready" class="external-access">
    <div class="box-bar roomy">
      <h4>{{ $t('External Access') }}</h4>
      <p>
        {{ $t('Let local AI tools (DeepSeek Harness, opencode, codex, Claude Code) read from the vault through a local MCP bridge. Everything is decided on this page; there is no per-request approval.') }}
      </p>
    </div>

    <div class="box-bar roomy lighter">
      <div class="switch">
        <label>
          <input v-model="config.enabled" type="checkbox" @change="toggleEnabled">
          <span class="lever" />
          <span class="switch-text">{{ $t('Enable external access') }}</span>
        </label>
      </div>
    </div>

    <template v-if="config.enabled">
      <div class="box-bar roomy">
        <h4>{{ $t('Scopes') }}</h4>
      </div>
      <div class="box-bar roomy lighter">
        <div class="switch" v-for="scope in ['groups', 'entries', 'otp', 'secrets']" :key="scope">
          <label>
            <input
              type="checkbox"
              :checked="config.scopes[scope]"
              @change="toggleScope(scope)"
            >
            <span class="lever" />
            <span :class="{ 'secrets-warn': scope === 'secrets' }">
              {{ $t('scope.' + scope) }}
            </span>
          </label>
        </div>
        <p class="totp-note">
          {{ $t('OTP tools only ever return the current code, never the OTP secret. Passwords, notes and custom field values are all behind the last switch.') }}
        </p>
      </div>

      <div class="box-bar roomy">
        <h4>{{ $t('Group restriction') }}</h4>
      </div>
      <div class="box-bar roomy lighter">
        <label class="radio-row">
          <input
            type="radio"
            name="ext-group-mode"
            :checked="config.groupMode === 'all'"
            @change="setGroupMode('all')"
          >
          <span>{{ $t('All groups') }}</span>
        </label>
        <label class="radio-row">
          <input
            type="radio"
            name="ext-group-mode"
            :checked="config.groupMode === 'selected'"
            @change="setGroupMode('selected')"
          >
          <span>{{ $t('Only the selected groups (sub-groups included)') }}</span>
        </label>
        <div v-if="config.groupMode === 'selected'" class="group-picker">
          <div class="group-picker-head">
            <span v-if="groupsLoading" class="totp-note">{{ $t('Reading groups…') }}</span>
            <span v-else-if="groupsLocked" class="totp-note">
              {{ $t('The vault is locked, or its unlock cache has lapsed. Open the extension, unlock the database, then read the groups again.') }}
            </span>
            <button class="btn btn-small" :disabled="groupsLoading" @click="loadGroups">
              {{ $t('Read groups again') }}
            </button>
          </div>
          <label v-for="g in groups" :key="g.uuid" class="group-row">
            <input
              type="checkbox"
              :checked="config.groupIds.indexOf(g.uuid) >= 0"
              @change="toggleGroup(g.uuid)"
            >
            <span>{{ g.path }}</span>
          </label>
        </div>
      </div>

      <div class="box-bar roomy">
        <h4>{{ $t('Validity and limits') }}</h4>
      </div>
      <div class="box-bar roomy lighter">
        <div class="field-row">
          <span class="field-label">{{ $t('Token lifetime') }}</span>
          <select v-model.number="config.tokenTtlDays" @change="saveTtl">
            <option v-for="d in ttlOptions" :key="d" :value="d">
              {{ $t('{0} days', d) }}
            </option>
          </select>
        </div>
        <div class="field-row">
          <span class="field-label">{{ $t('Bridge port') }}</span>
          <input
            v-model.number="config.port"
            type="number"
            min="1024"
            max="65535"
            @change="savePort"
          >
        </div>
        <div class="field-row">
          <span class="field-label">{{ $t('Rate limit (requests per minute)') }}</span>
          <input
            v-model.number="config.rateLimitPerMin"
            type="number"
            min="1"
            max="600"
            @change="saveRateLimit"
          >
        </div>
      </div>

      <div class="box-bar roomy">
        <h4>{{ $t('Pair a new client') }}</h4>
      </div>
      <div class="box-bar roomy lighter">
        <div class="pair-row">
          <input
            v-model="guideName"
            type="text"
            :placeholder="$t('Client name, e.g. Claude Code')"
          >
          <button class="btn" @click="generateGuide">
            {{ copiedHint ? $t('Copied!') : $t('Generate guide and copy') }}
          </button>
        </div>
        <p class="totp-note">
          {{ $t('Paste the guide to the AI; it configures its own MCP server. The pairing code in it expires in 15 minutes and works once - the long-lived token is created on first contact and never appears in the chat.') }}
        </p>
        <pre v-if="guideText" class="guide-text">{{ guideText }}</pre>
      </div>

      <div class="box-bar roomy" v-if="clients.length">
        <h4>{{ $t('Paired clients') }}</h4>
      </div>
      <div class="box-bar roomy lighter" v-if="clients.length">
        <div v-for="client in clients" :key="client.id" class="client-row" :class="{ inactive: client.revokedAt || (client.expiresAt && client.expiresAt < Date.now()) }">
          <div class="client-main">
            <span class="client-name">{{ client.name }}</span>
            <span class="client-state">{{ clientState(client) }}</span>
          </div>
          <div class="client-sub">
            {{ $t('paired') }} {{ fmtTime(client.createdAt) }} · {{ $t('expires') }} {{ fmtTime(client.expiresAt) }} · {{ $t('last used') }} {{ fmtTime(client.lastUsedAt) }}
          </div>
          <div class="client-actions" v-if="!client.revokedAt">
            <button class="btn btn-small" :disabled="busyId === client.id" @click="regenerate(client)">
              {{ $t('Re-pair') }}
            </button>
            <button class="btn btn-small" :disabled="busyId === client.id" @click="revoke(client)">
              {{ $t('Revoke') }}
            </button>
          </div>
        </div>
      </div>

      <div class="box-bar roomy">
        <h4>{{ $t('Access log') }}</h4>
      </div>
      <div class="box-bar roomy lighter">
        <div class="audit-actions">
          <button class="btn btn-small" :disabled="!audit.length" @click="exportAudit">
            {{ $t('Export') }}
          </button>
          <button class="btn btn-small" :disabled="!audit.length" @click="clearAudit">
            {{ $t('Clear') }}
          </button>
        </div>
        <p v-if="!audit.length" class="totp-note">{{ $t('No requests yet.') }}</p>
        <table v-else class="audit-table">
          <thead>
            <tr>
              <th>{{ $t('Time') }}</th>
              <th>{{ $t('Client') }}</th>
              <th>{{ $t('Method') }}</th>
              <th>{{ $t('Target') }}</th>
              <th>{{ $t('Result') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in audit" :key="row.ts + '-' + i">
              <td>{{ fmtTime(row.ts) }}</td>
              <td>{{ row.client }}</td>
              <td>{{ row.method }}</td>
              <td>{{ row.target }}</td>
              <td>{{ row.result }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
@import '../styles/settings.scss';

.external-access {
  .secrets-warn {
    color: var(--keepass-cat-delete-hover);
  }
  .totp-note {
    font-size: 12px;
    color: var(--keepass-cat-text-subtle);
    margin: 8px 0 0;
  }
  .radio-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    cursor: pointer;
  }
  .group-picker {
    margin-top: 8px;
    max-height: 220px;
    overflow-y: auto;
  }
  .group-picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
    .totp-note {
      margin: 0;
    }
  }
  .group-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    cursor: pointer;
    font-size: 13px;
  }
  .field-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    .field-label {
      flex: 1 1 auto;
      font-size: 13px;
    }
    input[type='number'] {
      width: 90px;
    }
  }
  .pair-row {
    display: flex;
    gap: 8px;
    input[type='text'] {
      flex: 1 1 auto;
    }
  }
  .guide-text {
    margin-top: 10px;
    padding: 10px;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--keepass-cat-highlight-bg);
    border-radius: 4px;
    user-select: text;
  }
  .client-row {
    padding: 8px 0;
    border-bottom: 1px solid $light-gray;
    &.inactive .client-name {
      color: var(--keepass-cat-text-subtle);
      text-decoration: line-through;
    }
  }
  .client-main {
    display: flex;
    gap: 8px;
    align-items: baseline;
    .client-name {
      font-weight: 600;
    }
    .client-state {
      font-size: 11px;
      color: var(--keepass-cat-text-subtle);
    }
  }
  .client-sub {
    font-size: 11px;
    color: var(--keepass-cat-text-subtle);
    margin-top: 2px;
  }
  .client-actions {
    margin-top: 6px;
    display: flex;
    gap: 8px;
  }
  .audit-actions {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }
  .audit-table {
    width: 100%;
    font-size: 11px;
    border-collapse: collapse;
    th,
    td {
      text-align: left;
      padding: 3px 6px 3px 0;
      border-bottom: 1px solid $light-gray;
      vertical-align: top;
    }
    th {
      color: var(--keepass-cat-text-subtle);
      font-weight: 600;
    }
  }
}
</style>
