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
        this.entry['keepassCatTotpEnabled'] !== 'false'
      );
    },
  },
  mounted() {
    if (this.hasTotp) this.setupOtpCountdown();
  },
  beforeUnmount() {
    clearInterval(this.otpLoop);
  },
  methods: {
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
      this.unlockedState.copyTotp(this.entry);
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
    @click="autofill"
  >
    <div class="text-info" :class="{ strike: entry.is_expired }">
      <span class="header" :title="header">{{ header }}</span>
      <br />
      <span class="user" :title="entry.userName || ''">
        {{ entry.userName || $t('(empty)') }}
      </span>
      <span
        v-if="entry.groupName"
        class="group-label"
        :title="entry.groupName"
      >{{ entry.groupName }}</span>
    </div>
    <div class="buttons" :class="{ 'no-otp': !hasTotp }">
      <span v-if="hasTotp" class="otp-countdown">{{ otpTimeleft }}s</span>
      <span v-if="hasTotp" class="fa-stack copy-otp" @click="copyOtp" :title="$t('Copy TOTP code')">
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
  overflow-x: hidden;
  .text-info {
    flex: 1 1 auto;
    min-width: 0;
    // Every line is a block now, so the <br> that separated the header from
    // the username would only add an empty extra line. Drop it.
    br {
      display: none;
    }
    .header,
    .user,
    .group-label {
      display: block;
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: clip;
      // Dissolve the cut instead of clipping hard or showing an ellipsis.
      -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 1.5em), transparent);
      mask-image: linear-gradient(to right, #000 calc(100% - 1.5em), transparent);
    }
  }
  .header {
    font-size: 16px;
  }
  .user {
    font-size: 12px;
  }
  .group-label {
    display: block;
    font-size: 10px;
    color: var(--keepass-cat-text-muted);
    margin-top: 1px;
  }
  .buttons {
    flex: 0 0 auto;
    flex-wrap: nowrap;
    font-size: 18px;
    display: flex;
    justify-content: space-between;
    box-sizing: border-box;
    min-width: calc(60em / 7 + 22px);
    &.no-otp {
      min-width: calc(48em / 7);
    }
    > .fa-stack {
      min-width: calc(12em / 7);
    }
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
    color: var(--keepass-cat-text-subtle);
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
}

.strike {
  text-decoration: line-through;
}
</style>
