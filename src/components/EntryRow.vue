<script>
import { Otp, entryHasTotp } from '@/lib/otp.js';
import { entryIsExpired } from '@/lib/entryExpiry.js';

/*
 * One entry, as a row. Shared by the match list (EntryList) and the database view
 * (BrowseEntries): the two screens differ in how they collect and order entries,
 * not in how an entry looks, so the row lives here once.
 */
export default {
  props: {
    entry: Object,
    unlockedState: Object,
    // The match list shows which group an entry belongs to; the browse view already
    // groups its rows, so the label would repeat the header above it.
    showGroup: Boolean,
    // Appended to the edit route so the editor knows where to go back to.
    editQuery: { type: String, default: '' },
    // Set by a parent that owns a single ticker for many rows (the browse view can
    // hold hundreds of entries). Null means this row keeps its own interval, which
    // is fine for the handful of rows a match list shows.
    otpSeconds: { type: Number, default: null },
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
    // Only a real http(s) address can be opened in a tab; the field may also hold a
    // regex: pattern, a bare host name or nothing at all.
    canOpenUrl: function () {
      try {
        const url = new URL(String(this.entry.url || '').trim());
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch (e) {
        return false;
      }
    },
    hasTotp: function () {
      return entryHasTotp(this.entry);
    },
    isExpired: function () {
      return entryIsExpired(this.entry);
    },
    displayedSeconds: function () {
      return this.otpSeconds === null ? this.otpTimeleft : this.otpSeconds;
    },
  },
  mounted() {
    if (this.hasTotp && this.otpSeconds === null) this.setupOtpCountdown();
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
      if (!this.canOpenUrl) return;
      chrome.tabs.create({ url: String(this.entry.url).trim() });
    },
    edit(e) {
      e.stopPropagation();
      this.$router.route('/entry-edit/' + this.entry.id + this.editQuery);
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
    class="entry-row selectable between flair"
    :class="{ 'is-expired': isExpired }"
    @click="autofill"
  >
    <div class="text-info" :class="{ strike: isExpired }">
      <span class="header" :title="header">{{ header }}</span>
      <br />
      <span class="user" :title="entry.userName || ''">
        {{ entry.userName || $t('(empty)') }}
      </span>
      <span v-if="isExpired" class="expired-tag">{{ $t('Expired') }}</span>
      <span v-if="showGroup && entry.groupName" class="group-label" :title="entry.groupName">{{
        entry.groupName
      }}</span>
    </div>
    <div class="buttons" :class="{ 'no-otp': !hasTotp }">
      <span v-if="hasTotp" class="otp-countdown">{{ displayedSeconds }}s</span>
      <span v-if="hasTotp" class="fa-stack copy-otp" @click="copyOtp" :title="$t('Copy OTP code')">
        <i class="fa fa-circle fa-stack-2x" />
        <i class="fa fa-clock-o fa-stack-1x fa-inverse" />
      </span>
      <span
        class="fa-stack url"
        :class="{ 'is-disabled': !canOpenUrl }"
        @click="openUrl"
        :title="canOpenUrl ? $t('Open URL') : $t('No URL to open')"
      >
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

.entry-row {
  // Only the hover tint changes; `transition: all` made every hover animate every
  // property.
  transition: background-color 0.12s ease;
  width: 100%;
  // 6px: the popup's match list is height-constrained and this is the one density
  // both lists use - a shared row should not look tighter in one of them.
  padding: 6px $wall-padding;
  box-sizing: border-box;
  border-bottom: 1px solid $light-gray;
  background-color: $light-background-color;
  display: flex;
  overflow-x: hidden;
  // A group can hold hundreds of rows; let the browser skip rendering the ones
  // outside the scroller. The intrinsic size is the measured row height so the
  // scrollbar does not jump.
  content-visibility: auto;
  contain-intrinsic-size: auto 52px;

  .text-info {
    flex: 1 1 auto;
    min-width: 0;
    // Every line is a block, so the <br> that separated the header from the
    // username would only add an empty extra line. Drop it.
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
      // Materialize's 1.15 line-height is shorter than the font's glyph box, and
      // `overflow: hidden` then cut the descender off every "g", "y" and "p" in
      // the title and username. Give the line box room for them.
      line-height: 1.4;
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
  // A struck-through row alone is easy to miss; the tag says why. Only expired
  // entries get the extra line.
  .expired-tag {
    display: inline-block;
    margin-top: 3px;
    padding: 0 4px;
    border-radius: 3px;
    font-size: 10px;
    line-height: 1.6;
    color: var(--keepass-cat-text-muted);
    background: var(--keepass-cat-bg-hover);
  }
  .buttons {
    flex: 0 0 auto;
    flex-wrap: nowrap;
    font-size: 18px;
    display: flex;
    justify-content: space-between;
    box-sizing: border-box;
    min-width: calc(60em / 7 + 22px);
    // Only the pointer's row shows its actions. `visibility` also keeps the icons
    // out of the paint step while they are hidden; the reserved min-width above
    // means the row never reflows when they appear.
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.12s ease, visibility 0s linear 0.12s;
    &.no-otp {
      min-width: calc(48em / 7);
    }
    > .fa-stack {
      min-width: calc(12em / 7);
    }
  }
  &:hover .buttons {
    opacity: 1;
    visibility: visible;
    transition: opacity 0.12s ease, visibility 0s;
  }
  // Devices without hover (touch) would never reveal the actions otherwise.
  @media (hover: none) {
    .buttons {
      opacity: 1;
      visibility: visible;
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
  // A URL that cannot be opened (a regex: pattern, a bare host, or empty) stays
  // visible but reads as disabled: muted colour, lower contrast, no hover lift.
  .url.is-disabled,
  .url.is-disabled:hover {
    color: var(--keepass-cat-text-muted);
    opacity: 0.45;
    cursor: default;
  }
}

.strike {
  text-decoration: line-through;
}
</style>
