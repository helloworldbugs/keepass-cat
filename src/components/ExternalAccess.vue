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
      nameError: '',
      toast: '',
      toastTimer: null,
      busyId: '',
      ttlOptions: [3600, 28800, 86400, 259200, 604800, 1209600, 2592000],
      status: {
        connected: false,
        authenticated: false,
        clientId: '',
        clientName: '',
        connectedAt: 0,
        lastRequestAt: 0,
        error: '',
      },
      // Ticks once a second so the "connected for" counter keeps moving; the
      // underlying status itself arrives pushed from storage.
      now: Date.now(),
      ticker: null,
      statusListener: null,
    };
  },
  computed: {
    statusText() {
      if (!this.config || !this.config.enabled) return this.$t('External access is off');
      if (!this.status.connected) return this.$t('Waiting for the MCP bridge');
      if (!this.status.authenticated) return this.$t('Connected, waiting for authentication');
      const name = this.status.clientName || this.$t('an unknown client');
      return this.$t('Connected by {0}', name);
    },
    statusDetail() {
      if (!this.status.connected || !this.status.authenticated) return '';
      if (!this.status.connectedAt) return '';
      return this.$t('for {0}', this.duration(this.now - this.status.connectedAt));
    },
    statusClass() {
      if (!this.config || !this.config.enabled) return 'off';
      if (this.status.connected && this.status.authenticated) return 'online';
      if (this.status.connected) return 'pending';
      return 'offline';
    },
  },
  mounted() {
    this.reload();
    this.loadStatus();
    // Real-time: the background rewrites the status blob whenever the socket
    // opens, closes or authenticates, and storage.onChanged delivers it here.
    this.statusListener = (changes, area) => {
      if (area === 'session' && changes.extAccessStatus) {
        this.status = Object.assign({}, this.status, changes.extAccessStatus.newValue || {});
      }
      if (area === 'local' && changes.extAccessClients) {
        // A new client appears the moment pairing completes, without a reload.
        this.clients = changes.extAccessClients.newValue || [];
      }
      if (area === 'local' && changes.extAccessAudit) {
        this.audit = changes.extAccessAudit.newValue || [];
      }
    };
    chrome.storage.onChanged.addListener(this.statusListener);
    this.ticker = setInterval(() => {
      this.now = Date.now();
    }, 1000);
  },
  beforeDestroy() {
    if (this.statusListener) chrome.storage.onChanged.removeListener(this.statusListener);
    if (this.ticker) clearInterval(this.ticker);
    if (this.toastTimer) clearTimeout(this.toastTimer);
  },
  methods: {
    async loadStatus() {
      this.status = await this.extAccess.getStatus();
    },
    duration(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      if (h) return this.$t('{0}h {1}m', h, m);
      if (m) return this.$t('{0}m {1}s', m, s);
      return this.$t('{0}s', s);
    },
    ttlLabel(seconds) {
      if (seconds < 86400) return this.$t('{0} hours', seconds / 3600);
      const days = seconds / 86400;
      return days === 1 ? this.$t('1 day') : this.$t('{0} days', days);
    },
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
      this.save({ tokenTtlSeconds: this.config.tokenTtlSeconds });
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
      const name = (this.guideName || '').trim();
      // A client without a name would be indistinguishable in the list and in the
      // audit log, so the form refuses to continue without one.
      if (!name) {
        this.nameError = this.$t('A client name is required');
        return;
      }
      this.nameError = '';
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
        this.showToast(this.$t('Guide copied. Paste it to the AI to finish pairing.'));
      } catch (e) {
        // Clipboard unavailable: the text stays on screen for manual copying.
        this.showToast(this.$t('Copy failed - select the text below and copy it by hand.'));
      }
    },
    showToast(text) {
      this.toast = text;
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => (this.toast = ''), 2200);
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
    isInactive(client) {
      if (client.revokedAt) return true;
      return !!(client.expiresAt && client.expiresAt < Date.now());
    },
    inactiveCount() {
      return this.clients.filter((c) => this.isInactive(c)).length;
    },
    // Only inactive records can be removed; revoking is the way to retire a live
    // one, and that keeps the audit trail honest.
    async removeClient(client) {
      this.busyId = client.id;
      await this.extAccess.removeClient(client.id);
      this.clients = await this.extAccess.listClients();
      this.busyId = '';
    },
    async purgeInactive() {
      this.busyId = 'purge';
      await this.extAccess.purgeInactiveClients();
      this.clients = await this.extAccess.listClients();
      this.busyId = '';
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
        {{ $t('Let local AI tools (CodeX, Claude Code, DeepSeek Harness and more) read from the vault through a local MCP bridge.') }}
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

    <!-- Its own row, large enough to read at a glance: the point of the page is
         knowing who is in the vault right now. -->
    <div class="box-bar roomy status-bar" :class="statusClass">
      <div class="live-status">
        <i class="fa fa-circle" />
        <div class="status-text">
          <span class="status-main">{{ statusText }}</span>
          <span v-if="statusDetail" class="status-detail">{{ statusDetail }}</span>
          <div v-if="status.error" class="status-error">{{ $t('Last session ended:') }} {{ status.error }}</div>
        </div>
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
          <select v-model.number="config.tokenTtlSeconds" @change="saveTtl">
            <option v-for="s in ttlOptions" :key="s" :value="s">
              {{ ttlLabel(s) }}
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
            :class="{ invalid: nameError }"
            :placeholder="$t('Client name, e.g. Claude Code')"
            @input="nameError = ''"
          >
          <button class="btn" :disabled="!guideName.trim()" @click="generateGuide">
            {{ copiedHint ? $t('Copied!') : $t('Generate guide and copy') }}
          </button>
        </div>
        <p v-if="nameError" class="totp-note error-text">{{ nameError }}</p>
        <p class="totp-note">
          {{ $t('Paste the guide to the AI; it configures its own MCP server. The pairing code in it expires in 15 minutes and works once - the long-lived token is created on first contact and never appears in the chat.') }}
        </p>
        <pre v-if="guideText" class="guide-text">{{ guideText }}</pre>
      </div>

      <div class="box-bar roomy" v-if="clients.length">
        <h4>{{ $t('Paired clients') }}</h4>
      </div>
      <div class="box-bar roomy lighter" v-if="clients.length">
        <div class="clients-head">
          <button
            class="btn btn-small"
            :disabled="!inactiveCount() || busyId === 'purge'"
            @click="purgeInactive"
          >
            {{ $t('Remove inactive records') }}
          </button>
        </div>
        <div v-for="client in clients" :key="client.id" class="client-row" :class="{ inactive: isInactive(client) }">
          <div class="client-main">
            <span class="client-name">{{ client.name }}</span>
            <span class="client-state">{{ clientState(client) }}</span>
          </div>
          <div class="client-sub">
            {{ $t('paired') }} {{ fmtTime(client.createdAt) }} · {{ $t('expires') }} {{ fmtTime(client.expiresAt) }} · {{ $t('last used') }} {{ fmtTime(client.lastUsedAt) }}
          </div>
          <div class="client-actions">
            <template v-if="!isInactive(client)">
              <button class="btn btn-small" :disabled="busyId === client.id" @click="regenerate(client)">
                {{ $t('Re-pair') }}
              </button>
              <button class="btn btn-small" :disabled="busyId === client.id" @click="revoke(client)">
                {{ $t('Revoke') }}
              </button>
            </template>
            <button
              v-else
              class="btn btn-small"
              :disabled="busyId === client.id"
              @click="removeClient(client)"
            >
              {{ $t('Delete record') }}
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
    <transition name="toast">
      <div v-if="toast" class="copy-toast bar-hint is-floating">{{ toast }}</div>
    </transition>
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
  .clients-head {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 6px;
  }
  // Live bridge state, on its own row and big enough to read at a glance:
  // knowing who is in the vault right now is the point of the page.
  .status-bar {
    border-left: 4px solid $light-gray;
    &.online {
      border-left-color: #2e9e4f;
      .fa {
        color: #2e9e4f;
      }
    }
    &.pending {
      border-left-color: #d09b1c;
      .fa {
        color: #d09b1c;
      }
    }
    &.offline .fa {
      color: var(--keepass-cat-text-subtle);
    }
  }
  .live-status {
    display: flex;
    align-items: center;
    gap: 12px;
    .fa {
      font-size: 14px;
    }
    .status-main {
      display: block;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.3;
    }
    .status-detail {
      display: block;
      color: var(--keepass-cat-text-subtle);
      font-size: 13px;
      margin-top: 2px;
    }
    .status-error {
      color: var(--keepass-cat-text-subtle);
      font-size: 12px;
      margin-top: 4px;
    }
  }
  .error-text {
    color: var(--keepass-cat-delete-hover);
  }
  input.invalid {
    border-color: var(--keepass-cat-delete-hover);
  }
  // Transient confirmation for the guide copy: the same floating strip the
  // popup uses, so feedback does not depend on reading the button label.
  .copy-toast {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 50;
    border-radius: 4px;
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
