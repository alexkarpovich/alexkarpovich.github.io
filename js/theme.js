(function (root) {
  function bind(client) {
    if (!client || typeof client.subscribeToThemeChanges !== "function") return function () {};
    function sync(theme) {
      if (theme === "light" || theme === "dark") {
        document.documentElement.setAttribute("data-color-mode", theme);
      }
    }
    const ctx = client.getContext && client.getContext();
    if (ctx && ctx.theme) sync(ctx.theme);
    else if (ctx && ctx.initialTheme) sync(ctx.initialTheme);
    return client.subscribeToThemeChanges(sync);
  }

  root.TimeTheme = { bind: bind };
})(typeof self !== "undefined" ? self : this);
