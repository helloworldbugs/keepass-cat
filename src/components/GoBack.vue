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
  .fa {
    font-size: 14px;
    line-height: 1;
  }
}
</style>
