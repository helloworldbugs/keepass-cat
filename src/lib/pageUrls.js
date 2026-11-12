/*
 * The URLs a page's credentials may legitimately be matched against.
 *
 * A login form is sometimes embedded from another origin (email.163.com keeps its
 * form in a dl.reg.163.com frame), so matching only against the tab's URL loses
 * that entry. Matching every frame is just as wrong in the other direction: pages
 * embed third-party widgets everywhere (Cloudflare Turnstile, captchas, payment
 * frames), and a widget's origin would then offer its own saved login on a site
 * that merely uses it.
 *
 * So a frame counts only when its own content script reports fillable credential
 * fields. Frames without one - and frames whose content script cannot answer -
 * are ignored, which keeps both matching and the badge honest.
 */
function credentialFrameUrls(tabId) {
  return new Promise(function (resolve) {
    if (
      typeof tabId !== 'number' ||
      !chrome.webNavigation ||
      typeof chrome.webNavigation.getAllFrames !== 'function' ||
      !chrome.tabs ||
      typeof chrome.tabs.sendMessage !== 'function'
    ) {
      resolve([]);
      return;
    }
    chrome.webNavigation.getAllFrames({ tabId: tabId }, function (frames) {
      if (chrome.runtime.lastError || !frames) {
        resolve([]);
        return;
      }
      var candidates = frames.filter(function (frame) {
        return frame && frame.frameId !== 0 && /^https?:/i.test(frame.url || '');
      });
      if (!candidates.length) {
        resolve([]);
        return;
      }
      var urls = [];
      var pending = candidates.length;
      candidates.forEach(function (frame) {
        var finish = function () {
          pending -= 1;
          if (pending === 0) resolve(urls);
        };
        try {
          chrome.tabs.sendMessage(
            tabId,
            { m: 'hasCredentialFields' },
            { frameId: frame.frameId },
            function (response) {
              if (!chrome.runtime.lastError && response && response.has) {
                if (urls.indexOf(frame.url) < 0) urls.push(frame.url);
              }
              finish();
            }
          );
        } catch (e) {
          finish();
        }
      });
    });
  });
}

export { credentialFrameUrls };
