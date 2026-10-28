<script>
export default {
  props: {
    providerManager: Object,
    busy: Boolean,
    databases: Array,
    error: String,
    loggedIn: Boolean,
    toggleLogin: Function,
    removeable: Boolean,
    removeFunction: Function,
  },
};
</script>

<template>
  <div>
    <div class="between">
      <div class="title" style="display: flex; align-items: center">
        <span>
          <svg class="icon" viewBox="0 0 1 1">
            <use v-bind="{ 'xlink:href': '#' + providerManager.icon }" />
          </svg>
          {{ $t(providerManager.chooseTitle) }}
        </span>
        <span v-show="error.length" class="error pill">{{ error }}</span>
      </div>
      <div>
        <div class="switch">
          <label>
            <input :disabled="busy" type="checkbox" :checked="loggedIn" @change.prevent="toggleLogin" />
            <span class="lever" />
          </label>
        </div>
      </div>
    </div>
    <!-- The discovered databases belong to the provider being on: with the switch
         off the picker no longer offers them, so their names fold away too. -->
    <div v-if="loggedIn" style="display: flex; flex-wrap: wrap">
      <span
        v-for="(db, index) in databases"
        class="chip"
        style="margin-bottom: 5px"
        :title="db.title"
      >
        <span class="chip-label">{{ db.title }}</span>
        <i
          v-if="removeable"
          class="fa fa-times-circle selectable"
          aria-hidden="true"
          @click="removeFunction(index)"
        />
      </span>
    </div>
  </div>
</template>
