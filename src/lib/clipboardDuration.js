import { i18n } from '@/services/i18n';

/*
 * The clipboard interval is stored in seconds, and both the settings dropdown and
 * the "copied to clipboard" notice have to say "15 秒" or "3 分钟". They share
 * these labels so the notice can never drift from the option that produced it.
 */
const CLIPBOARD_DURATION_LABELS = {
  15: '15 seconds',
  30: '30 seconds',
  60: '1 minute',
  180: '3 minutes',
  300: '5 minutes',
  600: '10 minutes',
};

export function clipboardDurationLabel(seconds) {
  const key = CLIPBOARD_DURATION_LABELS[seconds];
  return key ? i18n.t(key) : i18n.t('{0} seconds', seconds);
}
