(function () {
  const msg = document.getElementById("msg");
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!params.has("token")) {
    msg.textContent = "No authorization result. Return to Trello and click Allow read access.";
    return;
  }
  const token = params.get("token") || "";
  // This is a standalone popup, not a Trello iframe. Send the result to the
  // SDK's origin/source-checked message handler; it saves member-private data.
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  let delivered = false;
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(token, window.location.origin);
      delivered = true;
    }
  } catch (error) { /* Fall back when sign-in or the desktop app loses the opener. */ }
  if (!delivered) {
    try {
      if (token) window.localStorage.setItem("trello_token", token);
      else window.localStorage.removeItem("trello_token");
      delivered = true;
    } catch (error) { /* Storage may be unavailable in this browser. */ }
  }
  msg.textContent = !token
    ? "Read access was not granted. Return to Trello to try again."
    : delivered
      ? "Read access granted. Return to your Trello board."
      : "Could not return authorization to Trello. Reopen the board and try Allow read access again.";
  if (delivered) window.setTimeout(function () { window.close(); }, 500);
})();
