'use strict';

//simple service to link to the options page
function Links() {
  var my = {
    openOptions: openOptions,
    openOptionsStartup: openOptionsStartup,
    openOptionsKeyfiles: openOptionsKeyfiles,
    openOptionsDatabases: openOptionsDatabases,
  };

  function openOptionsPath(path) {
    // A hack to figure out what the browser uses to point to us.
    // For example, chrome says we will always be chrome-extension://fmhmiaejopepamlcjkncpgpdjichnecm/...
    let loc = window.location.origin;
    chrome.tabs.create({
      url: loc + path,
    });
  }

  function openOptions() {
    openOptionsWelcome();
  }

  function openOptionsWelcome() {
    chrome.runtime.openOptionsPage();
  }

  // A first-run user is sent to the guide, not to the provider list: the guide
  // explains what to do and offers the two ways in. The hash is explicit so an
  // options tab that is already open elsewhere cannot decide the landing tab.
  function openOptionsStartup() {
    openOptionsPath('/dist/options.html#/');
  }

  function openOptionsDatabases() {
    openOptionsPath('/dist/options.html#/manage/databases');
  }

  function openOptionsKeyfiles() {
    openOptionsPath('/dist/options.html#/manage/keyfiles');
  }

  return my;
}
export { Links };
