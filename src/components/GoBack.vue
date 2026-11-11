<script>
export default {
  props: {
    message: String,
  },
};
</script>

<template>
  <div class="box-bar selectable" @click="$router.goBack">
    <span class="back-label">
      <i class="fa fa-chevron-left" aria-hidden="true" />
      {{ message }}
    </span>
    <span class="extra" @click.stop>
      <slot name="extra"></slot>
    </span>
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';
.box-bar .extra { float: right; }
// A chevron sits better against the 18px label than the old long arrow; a small
// gap keeps the two from touching at this size.
.box-bar .back-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  // The whole top bar (except the Save slot) goes back, so the label grows to
  // cover that area: hovering anywhere left of Save nudges it, matching the click.
  flex: 1 1 auto;
  align-self: stretch;
  // A small nudge left on hover, matching the 0.12s easing used across the UI.
  transition: transform 0.12s ease;
  &:hover {
    transform: translateX(-3px);
  }
  .fa {
    font-size: 14px;
    line-height: 1;
    // The chevron's ink sits above the CJK glyphs' optical centre; nudge it down
    // so the arrow and the label line up.
    position: relative;
    top: 2px;
  }
}
</style>
