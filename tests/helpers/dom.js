// A small in-memory DOM for interaction tests. Layout remains a browser check.
const fs = require("node:fs");
const vm = require("node:vm");
function createDom() {
  let document;
  function matches(node, selector) {
    if (!node.tagName) return false;
    if (selector === ":focus") return document.activeElement === node;
    const last = selector.endsWith(":last-child");
    selector = selector.replace(":last-child", "");
    if (last && (!node.parentNode || node.parentNode.children.at(-1) !== node)) return false;
    const attr = selector.match(/\[([^=\]]+)(?:=["']?([^"'\]]*)["']?)?\]/);
    if (attr && (attr[2] == null ? !node.hasAttribute(attr[1]) : node.getAttribute(attr[1]) !== attr[2])) return false;
    selector = selector.replace(/\[[^\]]+\]/, "");
    const cls = selector.match(/\.([\w-]+)/), id = selector.match(/#([\w-]+)/), tag = selector.match(/^[\w-]+/);
    return (!cls || node.className.split(/\s+/).includes(cls[1])) && (!id || node.id === id[1]) && (!tag || node.tagName === tag[0].toLowerCase());
  }
  class Element {
    constructor(tag) { this.tagName = tag; this.attrs = {}; this.childNodes = []; this.events = {}; this._value = ""; this.checked = false; this.hidden = false; this.disabled = false; this.style = {}; this.className = ""; }
    get children() { return this.childNodes.filter(node => node.tagName); }
    get firstChild() { return this.childNodes[0]; }
    get value() { return this._value; } set value(v) { this._value = String(v); }
    setAttribute(key, value) { this.attrs[key] = String(value); if (["id", "type", "name", "value", "tabindex"].includes(key)) this[key] = String(value); if (["hidden", "disabled", "required", "checked"].includes(key)) this[key] = true; }
    getAttribute(key) { return key === "class" ? this.className : this.attrs[key] ?? null; }
    hasAttribute(key) { return this.getAttribute(key) !== null; }
    removeAttribute(key) { delete this.attrs[key]; }
    appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; }
    prepend(child) { child.parentNode = this; this.childNodes.unshift(child); }
    removeChild(child) { this.childNodes.splice(this.childNodes.indexOf(child), 1); child.parentNode = null; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    set textContent(text) { this.childNodes = []; if (text) this.appendChild({ textContent: String(text) }); }
    get textContent() { return this.childNodes.map(node => node.textContent).join(""); }
    set innerHTML(value) { this.markup = value; }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    async fire(type, extra = {}) { if (this.disabled) return; const event = { key: "", target: this, preventDefault() {}, ...extra }; for (const fn of this.events[type] || []) await fn(event); }
    click() { return this.fire("click"); }
    focus() { document.activeElement = this; }
    select() {}
    scrollIntoView() {}
    matches(selector) { return matches(this, selector); }
    querySelectorAll(selector) {
      const all = node => node.children.flatMap(child => [child, ...all(child)]);
      return all(this).filter(node => selector.split(/,\s*/).some(part => {
        const segments = part.trim().split(/\s+(?=[^\]]*(?:\[|$))/);
        if (!matches(node, segments.pop())) return false;
        let parent = node.parentNode;
        while (segments.length) { const segment = segments.pop(); while (parent && !matches(parent, segment)) parent = parent.parentNode; if (!parent) return false; parent = parent.parentNode; }
        return true;
      }));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get classList() { return { contains: value => this.className.split(" ").includes(value), add: value => { if (!this.className.split(" ").includes(value)) this.className += " " + value; }, remove: value => { this.className = this.className.split(" ").filter(item => item !== value).join(" "); } }; }
  }
  const body = new Element("body");
  document = { body, activeElement: null, createElement: tag => new Element(tag), createElementNS: (ns, tag) => new Element(tag), createTextNode: text => ({ textContent: String(text) }), getElementById: id => body.querySelector("#" + id) };
  const window = { TimeDuration: require("../../js/duration"), TimeModel: require("../../js/model"), TimeEpic: require("../../js/epic"), TimeTimeline: require("../../js/timeline") };
  const context = vm.createContext({ window, self: window, document, console, TextEncoder, Blob, crypto });
  function run(file) { vm.runInContext(fs.readFileSync(require.resolve("../../js/" + file), "utf8"), context); }
  run("dom.js");
  return { document, window, context, run, host: () => { const host = new Element("div"); body.appendChild(host); return host; } };
}
module.exports = { createDom };
