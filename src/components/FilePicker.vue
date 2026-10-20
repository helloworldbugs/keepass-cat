<script>
export default {
  props: {
    passwordFileStoreRegistry: Object,
    settings: Object,
    links: Object,
  },
  data() {
    return {
      databases: [],
    };
  },
  mounted() {
    this.passwordFileStoreRegistry.listFileManagers('listDatabases').forEach((provider) => {
      provider
        .listDatabases()
        .then((databases) => {
          if (databases && databases.length) {
            databases.forEach((database) => {
              database.provider = provider;
            });
            this.databases = this.databases.concat(databases);
          }
        })
        .catch((err) => {
          console.error('Error when trying to listDatabases');
          console.error(err);
        });
    });
  },
  methods: {
    selectDatabase(i) {
      if (i !== undefined) {
        let database = this.databases[i];
        let info = database.provider.getDatabaseChoiceData(database);
        this.settings.saveCurrentDatabaseChoice(info, database.provider).then((nil) => {
          this.$router.route(
            '/unlock/' + database.provider.key + '/' + encodeURIComponent(database.title)
          );
        });
      } else {
        // TODO
      }
    },
  },
};
</script>

<template>
  <div class="chooseFilePage">
    <div
      v-for="(db, index) in databases"
      :key="index"
      class="chooseFile selectable"
      role="button"
      tabindex="0"
      @click="selectDatabase(index)"
      @keydown.enter.prevent="selectDatabase(index)"
      @keydown.space.prevent="selectDatabase(index)"
    >
      <svg class="chooseFile-icon" viewBox="0 0 1 1" aria-hidden="true">
        <use v-bind="{ 'xlink:href': '#' + db.provider.icon }" />
      </svg>
      <span class="chooseFile-name">{{ db.title }}</span>
      <i class="fa fa-chevron-right chooseFile-arrow" aria-hidden="true" />
    </div>
    <div
      class="chooseFile chooseFile-manage selectable"
      role="button"
      tabindex="0"
      @click="links.openOptionsDatabases"
      @keydown.enter.prevent="links.openOptionsDatabases"
      @keydown.space.prevent="links.openOptionsDatabases"
    >
      <i class="fa fa-wrench chooseFile-icon" aria-hidden="true" />
      <span class="chooseFile-name">{{ $t('Manage Database Files') }}</span>
      <i class="fa fa-chevron-right chooseFile-arrow" aria-hidden="true" />
    </div>
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';

// Rows mirror the .databaseChoose row on the unlock page: same 16px bold
// name, blue icon, roomy padding and hairline separators, so picking a
// database file here feels like the same screen as unlocking it.
.chooseFile {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px $wall-padding;
  background: $light-background-color;
  border-bottom: 1px solid $light-gray;
  color: $text-color;
  text-align: left;

  .chooseFile-icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    font-size: 16px;
    line-height: 1;
    color: $blue;
    fill: $blue;
    text-align: center;
  }

  .chooseFile-name {
    flex: 1;
    min-width: 0;
    font-size: 16px;
    font-weight: 700;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: clip;
    // Dissolve the cut like the entry rows rather than truncating with dots.
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 1.5em), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - 1.5em), transparent);
  }

  .chooseFile-arrow {
    flex-shrink: 0;
    font-size: 12px;
    color: $blue;
    opacity: 0.55;
    transition:
      transform 0.15s ease,
      opacity 0.15s ease;
  }

  &:hover,
  &:focus-visible {
    background: var(--keepass-cat-bg-hover);

    .chooseFile-arrow {
      opacity: 1;
      transform: translateX(2px);
    }
  }

  &:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px $blue;
  }

  &:active {
    background: $dark-background-color;
  }
}

// Managing files is a secondary action, not another database: keep the same
// geometry but step the type and accents down one notch. No extra margin, so the
// rows stay a single contiguous list like the unlock screen.
.chooseFile-manage {
  border-top: 1px solid $light-gray;
  background: $light-background-color;

  .chooseFile-icon {
    font-size: 14px;
    color: $blue;
    opacity: 0.8;
  }

  .chooseFile-name {
    font-size: 14px;
    font-weight: 600;
  }

  .chooseFile-arrow {
    font-size: 10px;
    opacity: 0.35;
  }

  &:hover,
  &:focus-visible {
    .chooseFile-icon {
      opacity: 1;
    }

    .chooseFile-arrow {
      opacity: 0.8;
    }
  }
}
</style>
