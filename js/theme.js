(function (root) {
  function syncSystemTheme() {
    if (!window.matchMedia) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-color-mode", dark ? "dark" : "light");
  }

  function bind(client) {
    function sync(theme) {
      if (theme === "light" || theme === "dark") {
        document.documentElement.setAttribute("data-color-mode", theme);
      }
    }
    if (!client) {
      syncSystemTheme();
      return function () {};
    }
    try {
      const ctx = client.getContext && client.getContext();
      if (ctx && ctx.theme) sync(ctx.theme);
      else if (ctx && ctx.initialTheme) sync(ctx.initialTheme);
      else syncSystemTheme();
      if (typeof client.subscribeToThemeChanges !== "function") return function () {};
      return client.subscribeToThemeChanges(sync);
    } catch (error) {
      syncSystemTheme();
      return function () {};
    }
  }

  root.TimeTheme = { bind: bind };
})(typeof self !== "undefined" ? self : this);
