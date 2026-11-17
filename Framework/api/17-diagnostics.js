/* SpotiKit theme diagnostics */
(function (SpotiKit) {
  "use strict";
  if (!SpotiKit || !SpotiKit._internal) return;
  var hooks = {
    navigation: '.global-nav-bar',
    content: '.main-view-panel',
    player: '.now-playing-bar-area',
  };
  function themeSupport() {
    var missing = Object.keys(hooks).filter(function (name) { return !document.querySelector(hooks[name]); });
    return {
      scope: 'core-layout',
      profile: SpotiKit.mappingProfile,
      sourceSpotifyVersion: SpotiKit.mappingSourceVersion,
      fallback: SpotiKit.mappingIsFallback,
      verified: !!SpotiKit.mappingProfile && !SpotiKit.mappingIsFallback,
      build: SpotiKit.build,
      mappedClasses: Object.keys(SpotiKit.classMap).length,
      missing: missing,
      ready: !!SpotiKit.mappingProfile && missing.length === 0,
    };
  }
  SpotiKit.Diagnostics = { themeSupport: themeSupport };
  SpotiKit._internal.signals.platform.on(function () {
    setTimeout(function () {
      var support = themeSupport();
      if (support.fallback) SpotiKit._internal.log.warn('Using the closest Spotify theme map for this build', support);
      else if (!support.ready) SpotiKit._internal.log.warn('Theme support is incomplete for this Spotify build', support);
    }, 3000);
  });
})(window.SpotiKit);
