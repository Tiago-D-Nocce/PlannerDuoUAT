/* mini-dom.mjs — DOM mínimo e sem dependências para testar builders de UI.
 *
 * Implementa só o necessário para central-view.js: createElement, textContent,
 * setAttribute/getAttribute, append/appendChild, classList, addEventListener,
 * dispatchEvent, querySelector/querySelectorAll (por tag, .classe, #id e
 * [attr="v"]), value/focus para campos e KeyboardEvent/MouseEvent simples.
 *
 * CRÍTICO: NÃO existe innerHTML/outerHTML/insertAdjacentHTML. Se o código sob
 * teste tentar escrever HTML como string, o teste quebra — exatamente o que
 * queremos para garantir renderização só por textContent/createElement.
 */

let idSeq = 0;

class ClassList {
  constructor(el) { this._el = el; this._set = new Set(); }
  _sync() { if (this._el) this._el.attributes.class = this.value; }
  _loadFrom(value) {
    this._set = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  add(...names) { names.forEach((n) => { if (n) this._set.add(n); }); this._sync(); }
  remove(...names) { names.forEach((n) => this._set.delete(n)); this._sync(); }
  toggle(name, force) {
    const has = this._set.has(name);
    const on = force === undefined ? !has : Boolean(force);
    if (on) this._set.add(name); else this._set.delete(name);
    this._sync();
    return on;
  }
  contains(name) { return this._set.has(name); }
  get value() { return Array.from(this._set).join(' '); }
  toString() { return this.value; }
}

export class MiniEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = Boolean(init.bubbles);
    this.cancelable = Boolean(init.cancelable);
    this.defaultPrevented = false;
    this.isTrusted = init.isTrusted === undefined ? true : Boolean(init.isTrusted);
    this.target = null;
    this.currentTarget = null;
    Object.assign(this, init);
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this._stopped = true; }
}

export class MiniElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument || null;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    this.classList = new ClassList(this);
    this.listeners = Object.create(null);
    this.style = {};
    this._text = '';
    this._value = '';
    this.focused = false;
    this.nodeType = 1;
    this._id = `n${idSeq++}`;
  }

  // ---- texto ----
  get textContent() {
    if (this.childNodes.length === 0) return this._text;
    return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join('');
  }
  set textContent(v) {
    this._text = String(v);
    this.childNodes = []; // substitui qualquer filho — como no DOM real
  }

  // ---- NÃO suportado de propósito: innerHTML etc. ----
  set innerHTML(_v) { throw new Error('mini-dom: innerHTML é proibido no builder'); }
  get innerHTML() { throw new Error('mini-dom: innerHTML é proibido no builder'); }
  insertAdjacentHTML() { throw new Error('mini-dom: insertAdjacentHTML é proibido'); }

  // ---- atributos ----
  setAttribute(name, value) {
    const v = String(value);
    this.attributes[name] = v;
    if (name === 'id') this.id = v;
    if (name === 'value') this._value = v;
    if (name === 'class') this.classList._loadFrom(v);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  get className() { return this.classList.value; }
  set className(v) { this.classList._loadFrom(v); this.attributes.class = this.classList.value; }

  // ---- value (textarea/input) ----
  get value() { return this._value; }
  set value(v) { this._value = String(v); this.attributes.value = this._value; }

  // ---- árvore ----
  appendChild(node) {
    if (node == null) return node;
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  append(...nodes) {
    nodes.forEach((n) => {
      if (n == null) return;
      if (typeof n === 'string') { this.appendChild(this.ownerDocument.createTextNode(n)); return; }
      this.appendChild(n);
    });
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) { this.childNodes.splice(i, 1); node.parentNode = null; }
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = [];
    this.append(...nodes);
  }

  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get lastElementChild() {
    const els = this.children;
    return els[els.length - 1] || null;
  }
  get childElementCount() { return this.children.length; }

  // ---- eventos ----
  addEventListener(type, handler) {
    (this.listeners[type] || (this.listeners[type] = [])).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this.listeners[type];
    if (!list) return;
    const i = list.indexOf(handler);
    if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(evt) {
    evt.target = evt.target || this;
    let node = this;
    while (node) {
      evt.currentTarget = node;
      const list = node.listeners[evt.type];
      if (list) list.slice().forEach((h) => h.call(node, evt));
      if (evt._stopped || !evt.bubbles) break;
      node = node.parentNode;
    }
    return !evt.defaultPrevented;
  }
  // ergonomia para os testes
  click() { this.dispatchEvent(new MiniEvent('click', { bubbles: true, cancelable: true })); }
  focus() { this.focused = true; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() { this.focused = false; }

  // ---- consultas ----
  _matches(sel) {
    sel = sel.trim();
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    if (sel.startsWith('#')) return this.getAttribute('id') === sel.slice(1);
    const tagAttr = sel.match(/^([a-zA-Z]+)\[([a-zA-Z-]+)=["']?([^"'\]]*)["']?\]$/);
    if (tagAttr) {
      return this.tagName === tagAttr[1].toUpperCase() && this.getAttribute(tagAttr[2]) === tagAttr[3];
    }
    const attr = sel.match(/^\[([a-zA-Z-]+)(?:=["']?([^"'\]]*)["']?)?\]$/);
    if (attr) {
      if (attr[2] === undefined) return this.hasAttribute(attr[1]);
      return this.getAttribute(attr[1]) === attr[2];
    }
    return this.tagName === sel.toUpperCase();
  }
  _walk(cb) {
    this.children.forEach((c) => { cb(c); c._walk(cb); });
  }
  querySelector(sel) {
    const parts = sel.split(',').map((s) => s.trim());
    let found = null;
    this._walk((el) => { if (!found && parts.some((p) => el._matches(p))) found = el; });
    return found;
  }
  querySelectorAll(sel) {
    const parts = sel.split(',').map((s) => s.trim());
    const out = [];
    this._walk((el) => { if (parts.some((p) => el._matches(p))) out.push(el); });
    return out;
  }
}

class MiniText {
  constructor(data) { this.nodeType = 3; this.data = String(data); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

export class MiniDocument {
  constructor() {
    this.activeElement = null;
    this.documentElement = new MiniElement('html', this);
    this.body = new MiniElement('body', this);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag) { return new MiniElement(tag, this); }
  createTextNode(data) { return new MiniText(data); }
  createDocumentFragment() { return new MiniElement('#fragment', this); }
}

export function makeKeyEvent(key, init = {}) {
  return new MiniEvent('keydown', Object.assign({ key, bubbles: true, cancelable: true }, init));
}
export function makeClickEvent(init = {}) {
  return new MiniEvent('click', Object.assign({ bubbles: true, cancelable: true, isTrusted: true }, init));
}
export function makeSubmitEvent(init = {}) {
  return new MiniEvent('submit', Object.assign({ bubbles: true, cancelable: true }, init));
}

export function createMiniDom() {
  const doc = new MiniDocument();
  return { document: doc, MiniEvent, makeKeyEvent, makeClickEvent, makeSubmitEvent };
}
