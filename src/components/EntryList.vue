<script>
import EntryListItem from '@/components/EntryListItem.vue';

export default {
  components: {
    EntryListItem,
  },
  props: {
    messages: Object,
    unlockedState: Object,
  },
  data() {
    return {
      searchTerm: '',
      filteredEntries: this.unlockedState.cacheGet('allEntries'),
      priorityEntries: this.unlockedState.cacheGet('priorityEntries'),
      allEntries: this.unlockedState.cacheGet('allEntries'),
      allMessages: this.messages,
    };
  },
  watch: {
    searchTerm(val) {
      this.unlockedState.cacheSet('searchFilter', val); // Causes cache refresh
      if (val.length) {
        this.filteredEntries = this.allEntries.filter((entry) => {
          let result = (entry.filterKey || '').indexOf(val.toLocaleLowerCase());
          return result > -1;
        });
      }
    },
  },
  mounted() {
    // Autofocus searchbox.
    // Firefox renders the browser_action popup in a panel that grabs keyboard
    // focus asynchronously (Bug 1324255): until then document.hasFocus() is
    // false and element.focus() only sets activeElement (the caret blinks)
    // without receiving key events. So on Firefox we wait for the popup
    // window's focus event instead of racing it in $nextTick.
    this.focusSearchbox = () => {
      this.$nextTick(() => {
        if (this.$refs.searchbox) this.$refs.searchbox.focus();
      });
    };
    if (document.hasFocus()) {
      this.focusSearchbox();
    } else {
      window.addEventListener('focus', this.focusSearchbox, { once: true });
    }
    // The search index (entry.filterKey) is built centrally by
    // unlockedState.cacheSet when allEntries enters the cache, so there is no
    // mount hook here to rebuild it.
    // Restore the search term if needed
    let st = this.unlockedState.cache.searchFilter;
    if (st !== undefined) this.searchTerm = st;
    let um = this.unlockedState.cacheGet('unlockedMessages');
    if (um !== undefined) this.allMessages = um;
  },
  beforeUnmount() {
    if (this.focusSearchbox) window.removeEventListener('focus', this.focusSearchbox);
  },
  methods: {
    newEntry() {
      var title = this.unlockedState.title || '';
      var url = this.unlockedState.fullUrl || this.unlockedState.url || '';
      // Drop both the query string and the URL fragment: neither belongs in a
      // saved entry URL (`#...` alone would otherwise slip through).
      url = url.split(/[?#]/)[0];
      var params = 'title=' + encodeURIComponent(title) + '&url=' + encodeURIComponent(url);
      this.$router.route('/entry-edit/new?' + params);
    },
  },
};
</script>

<template>
  <div>
    <div class="search">
      <i class="fa fa-search" />
      <input
        ref="searchbox"
        v-model="searchTerm"
        type="search"
        :placeholder="$t('search entire database...')"
      />
      <i class="fa fa-plus add-entry" @click="newEntry" :title="$t('New entry')" />
    </div>
    <div class="entries">
      <div v-if="allMessages.warn || allMessages.error || allMessages.success" class="no-match-msg">
        {{ allMessages.warn || allMessages.error || allMessages.success }}
      </div>
      <div v-if="priorityEntries && searchTerm.length == 0">
        <entry-list-item
          v-for="entry in priorityEntries"
          :key="entry.id"
          :entry="entry"
          :unlocked-state="unlockedState"
        />
      </div>
      <div v-if="filteredEntries && searchTerm.length > 0">
        <entry-list-item
          v-for="entry in filteredEntries"
          :key="entry.id"
          :entry="entry"
          :unlocked-state="unlockedState"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';
.entries {
  border-bottom: 2px solid $light-gray;
  height: 350px;
  overflow-y: auto;
}

.no-match-msg {
  padding: 10px $wall-padding;
  font-size: 12px;
  color: var(--keepass-cat-text-subtle);
  background: var(--keepass-cat-highlight-bg);
  border-bottom: 1px solid $light-gray;
}

.search {
  width: 100%;
  padding: 8px $wall-padding;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  border-bottom: 2px solid $light-gray;
  input {
    float: right;
    width: 96%;
    border: 0px;
    padding: 2px 0px;
    padding-left: 10px;
    font-size: 18px;
    color: $text-color;
    background-color: $background-color;
  }
  input:focus {
    outline: none;
  }
  .fa {
    width: 4%;
    font-size: 15px;
  }
  .add-entry {
    width: auto;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 3px;
    &:hover { background: $light-background-color; }
  }
}
</style>
