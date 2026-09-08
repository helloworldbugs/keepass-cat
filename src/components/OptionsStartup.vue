<script>
export default {
  props: {},
};
</script>

<template>
  <div>
    <div class="box-bar roomy">
      <div class="unlockLogo stack-item optionsheader">
        <img src="@/assets/icons/exported/logo.png" width="256px" height="256px" />
        <span>{{ $t('Getting Started with Keepass Cat') }}</span>
      </div>

      <p>
        {{ $t('Keepass Cat helps you keep track of all your accounts by storing your passwords in an encrypted file called a Keepass Database. You choose where this file is stored - most people keep them on a WebDAV server for easy access and syncing between laptops, desktops, and phones. To use Keepass Cat, you should first enable the WebDAV provider below.') }}
      </p>

      <a class="waves-effect waves-light btn" @click="$router.route('/manage/databases')"
        >{{ $t('1. Cloud Storage Setup') }}</a
      >

      <p>
        {{ $t('Optionally, you may also import any required keyfiles. A keyfile can be used together with a password to provide even better security, or even used instead of one.') }}
      </p>

      <a class="waves-effect waves-light btn" @click="$router.route('/manage/keyfiles')"
        >{{ $t('2. Keyfile Setup (optional)') }}</a
      >

      <p>
        {{ $t('That\'s it! Keepass Cat will automatically discover any Keepass databases that your have in your cloud storage, and allow you to switch between databases from the browser popup.') }}
      </p>

      <p>
        {{ $t('If you are a new Keepass user, you will be prompted to create a new database from the popup window after you enable a cloud storage provider. Most people keep all their passwords in a single database, so you will only need to do this once.') }}
      </p>
    </div>

    <div class="box-bar roomy lighter">
      <h4>{{ $t('Support Keepass Cat') }}</h4>
      <p>
        {{ $t('If you like Keepass Cat, please consider ') }}
        <a
          href="https://chrome.google.com/webstore/detail/keepass-tusk-a-better-pas/fmhmiaejopepamlcjkncpgpdjichnecm"
          >{{ $t('leaving a review on the google web store') }}</a
        >
        {{ $t(' or ') }}
        <a href="https://addons.mozilla.org/en-US/firefox/addon/keepass-tusk/"
          >{{ $t('firefox addon store') }}</a
        >
        {{ $t('. If you find a problem or are dissatisfied, please instead open an issue on the ') }}
        <a href="https://github.com/suBDavis/Tusk/issues">{{ $t('issue tracker') }}</a>
        {{ $t(' so we can make Keepass Cat better.') }}
      </p>
    </div>
  </div>
</template>

<style lang="scss">
@import '../styles/settings.scss';
.optionsheader {
  text-align: left;
  font-size: 28px;
}
</style>
