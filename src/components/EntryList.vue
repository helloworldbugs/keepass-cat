<script>
import EntryRow from '@/components/EntryRow.vue';

// The popup router swaps whole screens, so opening an entry unmounts this list
// and its scroll offset would reset on the way back. Same approach as
// BrowseEntries: keep it outside the component for the popup session.
let listViewState = null;

export default {
  components: {
    EntryRow,
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
      // Where the entry list should scroll back to after returning from an entry.
      restoreScrollTop: 0,
      scrollRestored: false,
    };
  },
  computed: {
    // Nothing in the list matches the term: the same bottom strip the database view
    // shows, from the same shared style.
    searchEmpty() {
      const term = (this.searchTerm || '').trim().toLocaleLowerCase();
      if (!term) return false;
      return !(this.allEntries || []).some((entry) => {
        return (entry.filterKey || '').indexOf(term) > -1;
      });
    },
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
    // Firefox's popup panel takes keyboard focus asynchronously (Bug 1324255):
    // until the document actually has focus, element.focus() only sets
    // activeElement (the caret blinks) and typed keys go nowhere. Poll until the
    // document is focused instead of betting on a single focus event, which may
    // have fired before this component mounted, or may never fire at all.
    this.focusSearchbox = () => {
      this.$nextTick(() => {
        if (this.$refs.searchbox) this.$refs.searchbox.focus();
      });
    };
    {
      let attempt = 0;
      const focusWhenReady = () => {
        if (document.hasFocus() || attempt >= 20) {
          this.focusSearchbox();
          return;
        }
        attempt += 1;
        setTimeout(focusWhenReady, 50);
      };
      focusWhenReady();
    }
    // The search index (entry.filterKey) is built centrally by
    // unlockedState.cacheSet when allEntries enters the cache, so there is no
    // mount hook here to rebuild it.
    // Restore the search term if needed
    let st = this.unlockedState.cache.searchFilter;
    if (st !== undefined) this.searchTerm = st;
    let um = this.unlockedState.cacheGet('unlockedMessages');
    if (um !== undefined) this.allMessages = um;
    // The search term above re-renders the list on the next tick; put the scroll
    // back after that, so the restored offset lands on the same rows.
    if (listViewState) this.restoreScrollTop = listViewState.scrollTop || 0;
    this.$nextTick(this.restoreListScroll);
  },
  beforeUnmount() {
    // Runs while the DOM is still laid out, so this is the real offset.
    const list = this.$refs.listArea;
    listViewState = { scrollTop: list ? list.scrollTop : 0 };
  },
  methods: {
    // Same retry shape as the browse view: the list only has its final height
    // once the rows render, so this is safe to call more than once.
    restoreListScroll() {
      if (this.scrollRestored || !this.restoreScrollTop) return;
      const list = this.$refs.listArea;
      if (!list) return;
      list.scrollTop = this.restoreScrollTop;
      if (list.scrollTop > 0) this.scrollRestored = true;
    },
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
    <div class="list-body">
      <div class="entries" ref="listArea">
        <div v-if="allMessages.warn || allMessages.error || allMessages.success" class="no-match-msg">
          {{ allMessages.warn || allMessages.error || allMessages.success }}
        </div>
        <div v-if="priorityEntries && searchTerm.length == 0">
          <entry-row
            v-for="entry in priorityEntries"
            :key="entry.id"
            :entry="entry"
            :unlocked-state="unlockedState"
            show-group
          />
        </div>
        <div v-if="filteredEntries && searchTerm.length > 0">
          <entry-row
            v-for="entry in filteredEntries"
            :key="entry.id"
            :entry="entry"
            :unlocked-state="unlockedState"
            show-group
          />
        </div>
      </div>
      <div v-if="searchEmpty" class="bar-hint is-floating list-hint">
        {{ $t('No matching entries.') }}
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';
// The hint floats over the list's bottom edge, so the list needs a positioned box
// to float in and must not grow when the hint appears.
.list-body {
  position: relative;
}
.list-hint {
  z-index: 9;
}
.entries {
  border-bottom: 2px solid $light-gray;
  height: 350px;
  overflow-y: auto;
  overflow-x: hidden;
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
