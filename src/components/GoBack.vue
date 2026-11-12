<script>
export default {
  props: {
    message: String,
  },
};
</script>

<template>
  <div class="box-bar">
    <!-- Only the label goes back. The bar used to carry the click, so the empty
         space between the label and Save returned too, which read as a stray
         click losing the form. -->
    <span class="back-label" @click="$router.goBack">
      <i class="fa fa-chevron-left" aria-hidden="true" />
      {{ message }}
    </span>
    <span class="extra">
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
  // A hit area around the label, not the whole bar. The negative margin lets the
  // padding grow the target without moving the text off the bar's left edge.
  padding: 4px 6px;
  margin: -4px -6px -4px 0;
  cursor: pointer;
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
