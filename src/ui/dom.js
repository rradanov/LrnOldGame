// Малки помощни функции за DOM.
import { T } from '../i18n/bg.js';

/** h('div', {class: 'x', onclick: fn}, 'текст', childNode) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    // T013-D8: CSSOM вместо атрибут style — CSP не разрешава inline стилове.
    else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else Object.assign(el.style, v); }
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Изтегля текст като файл (бекъп). */
export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function screenHeader(title) {
  return h('h1', { class: 'screen-title', tabindex: '-1' }, title);
}

/**
 * Асинхронно съдържание на екран: показва „Зареждане…“, после fill(box).
 * При грешка показва съобщение и „Опитай пак“. isAlive() пази от писане в
 * екран, който вече е сменен.
 */
export function asyncBlock(root, load, fill, isAlive = () => true) {
  const box = h('div', { class: 'async' }, h('p', { class: 'hint loading' }, T.loading));
  root.append(box);
  const run = () => {
    load().then((v) => {
      if (!isAlive()) return;
      box.replaceChildren();
      fill(box, v);
    }, (err) => {
      if (!isAlive()) return;
      console.error(err);
      const retry = () => {
        globalThis.removeEventListener?.('online', onOnline);
        if (!isAlive() || !box.isConnected) return;
        box.replaceChildren(h('p', { class: 'hint loading' }, T.loading));
        run();
      };
      const onOnline = () => retry();
      // Без мрежа (напр. първо отваряне в самолетен режим): ясно съобщение и сам повторен опит,
      // когато връзката се върне.
      const offline = globalThis.navigator?.onLine === false || (err?.name === 'DataError' && /Няма връзка/.test(err.message || ''));
      if (offline) globalThis.addEventListener?.('online', onOnline, { once: true });
      box.replaceChildren(
        h('div', { class: 'error-box', role: 'alert' },
          h('p', { class: 'error' }, T.dataError, ' ', offline ? '' : (err?.message ? `(${err.message})` : '')),
          offline ? h('p', { class: 'hint', id: 'offline-first' }, T.offlineFirst) : null,
          h('button', { type: 'button', class: 'btn secondary', onclick: retry }, T.retry)),
      );
    });
  };
  run();
  return box;
}
