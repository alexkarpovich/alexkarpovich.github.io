(function (root) {
  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    const props = attrs || {};
    Object.keys(props).forEach(function (key) {
      const value = props[key];
      if (value == null || value === false) return;
      if (key === "class") node.className = value;
      else if (key.indexOf("on") === 0 && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, String(value));
    });
    const list = Array.isArray(children) ? children : children == null ? [] : [children];
    list.forEach(function (child) {
      if (child == null || child === false) return;
      node.appendChild(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function download(filename, text, type) {
    const blob = text instanceof Blob ? text : new Blob(["\uFEFF" + text], { type: type || "application/vnd.ms-excel;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  root.TimeDom = { h: h, clear: clear, download: download };
})(typeof self !== "undefined" ? self : this);
