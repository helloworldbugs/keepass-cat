<script>
import { parseUrl } from '@/lib/utils.js';
import { Otp } from '@/lib/otp.js';
export default {
  props: {
    entry: Object,
    unlockedState: Object,
  },
  data() {
    return {
      otpTimeleft: 0,
      otpPeriod: 30,
      otpLoop: undefined,
    };
  },
  computed: {
    header: function () {
      if (this.entry.title.length > 0) return this.entry.title;
      return this.entry.url;
    },
    hasTotp: function () {
      return (
        this.entry.protectedData !== undefined &&
        'otp' in this.entry.protectedData &&
        this.entry['tuskTotpEnabled'] !== 'false'
      );
    },
  },
  watch: {
    // When the element becomes active, scroll it into view.
    'entry.view_is_active': function (val) {
      if (val)
        this.$el.scrollIntoView({
          block: 'end',
          inline: 'nearest',
          behavior: 'smooth',
        });
    },
  },
  mounted() {
    if (this.hasTotp) this.setupOtpCountdown();
  },
  beforeUnmount() {
    clearInterval(this.otpLoop);
  },
  methods: {
    details(e) {
      e.stopPropagation();
      this.$router.route('/entry-details/' + this.entry.id);
    },
    autofill(e) {
      e.stopPropagation();
      this.unlockedState.autofill(this.entry);
    },
    copy(e) {
      e.stopPropagation();
      this.unlockedState.copyPassword(this.entry);
    },
    copyUser(e) {
      e.stopPropagation();
      this.unlockedState.copyUsername(this.entry);
    },
    openUrl(e) {
      e.stopPropagation();
      if (this.entry.url) chrome.tabs.create({ url: this.entry.url });
    },
    edit(e) {
      e.stopPropagation();
      this.$router.route('/entry-edit/' + this.entry.id);
    },
    copyOtp(e) {
      e.stopPropagation();
      let url = this.unlockedState.getDecryptedAttribute(this.entry, 'otp');
      try {
        let otpobj = Otp.parseUrl(url);
        otpobj.next((_, code) => {
          if (!code) return;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).catch(() => {});
          } else {
            let ta = document.createElement('textarea');
            ta.value = code;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
        });
      } catch (e) {
        console.warn('[copyOtp] failed:', e);
      }
    },
    setupOtpCountdown() {
      let period = 30;
      try {
        let url = this.unlockedState.getDecryptedAttribute(this.entry, 'otp');
        period = Otp.parseUrl(url).period || 30;
      } catch (e) {}
      this.otpPeriod = period;
      this.otpTimeleft = this.secondsLeft();
      this.otpLoop = setInterval(() => {
        this.otpTimeleft = this.secondsLeft();
      }, 1000);
    },
    secondsLeft() {
      let ms = this.otpPeriod * 1000;
      return Math.ceil((ms - (Date.now() % ms)) / 1000);
    },
  },
};
</script>

<template>
    <div
    class="entry-list-item selectable between flair"
    :class="{ active: entry.view_is_active }"
    @click="autofill"
  >
    <div class="text-info" :class="{ strike: entry.is_expired }">
      <span class="header">{{ header }}</span>
      <br />
      <span class="user">
        {{ entry.userName || $t('(empty)') }}
      </span>
      <span v-if="entry.groupName" class="group-label">{{ entry.groupName }}</span>
    </div>
    <div class="buttons">
      <span v-if="hasTotp" class="otp-countdown">{{ otpTimeleft }}s</span>
      <span v-if="hasTotp" class="fa-stack copy-otp" @click="copyOtp" :title="$t('Copy code')">
        <i class="fa fa-circle fa-stack-2x" />
        <i class="fa fa-clock-o fa-stack-1x fa-inverse" />
      </span>
      <span class="fa-stack url" @click="openUrl" :title="$t('Open URL')">
        <i class="fa fa-circle fa-stack-2x" />
        <i class="fa fa-external-link fa-stack-1x fa-inverse" />
      </span>
      <span class="fa-stack copy-user" @click="copyUser" :title="$t('Copy username')">
        <i class="fa fa-circle fa-stack-2x" />
        <i class="fa fa-user fa-stack-1x fa-inverse" />
      </span>
      <span class="fa-stack copy" @click="copy" :title="$t('Copy password')">
        <i class="fa fa-circle fa-stack-2x" />
        <i class="fa fa-clipboard fa-stack-1x fa-inverse" />
      </span>
      <span class="fa-stack edit" @click="edit" :title="$t('Edit entry')">
        <i class="fa fa-circle fa-stack-2x" />
        <i class="fa fa-pencil fa-stack-1x fa-inverse" />
      </span>
    </div>
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';
.entry-list-item {
  transition: all 0.3s ease;
  width: 100%;
  padding: 10px $wall-padding;
  box-sizing: border-box;
  border-bottom: 1px solid $light-gray;
  background-color: $light-background-color;
  display: flex;
  .header {
    font-size: 16px;
  }
  .user {
    font-size: 12px;
  }
  .group-label {
    display: block;
    font-size: 10px;
    color: var(--tusk-text-muted);
    margin-top: 1px;
  }
  .buttons {
    font-size: 18px;
    display: flex;
    justify-content: space-between;
    box-sizing: border-box;
    min-width: 80px;
  }
  .copy,
  .copy-user,
  .copy-otp,
  .edit,
  .url {
    opacity: 0.35;
  }
  .copy:hover,
  .copy-user:hover,
  .copy-otp:hover,
  .edit:hover,
  .url:hover {
    opacity: 0.8;
  }
  .otp-countdown {
    font-size: 11px;
    color: var(--tusk-text-subtle);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 22px;
  }
  @media (prefers-color-scheme: dark) {
    .copy,
    .copy-user,
    .copy-otp,
    .edit,
    .url {
      opacity: 0.7;
    }
    .copy:hover,
    .copy-user:hover,
    .copy-otp:hover,
    .edit:hover,
    .url:hover {
      opacity: 0.4;
    }
  }
  &.active {
    background-color: $highlighted;
    padding-left: 20px;
  }
}

.strike {
  text-decoration: line-through;
}
</style>
