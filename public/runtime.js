// runtime.js — seleção de backend sem qualquer acesso à rede.
(function (global) {
  'use strict';

  const MODOS_VALIDOS = ['local', 'firebase'];
  const override = MODOS_VALIDOS.includes(global.PLANNERDUO_MODO)
    ? global.PLANNERDUO_MODO
    : null;
  const hostname = String((global.location && global.location.hostname) || '').toLowerCase();
  const hostLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  const mode = override || (hostLocal ? 'local' : 'firebase');

  global.PlannerRuntime = Object.freeze({
    mode,
    isLocal: function () { return mode === 'local'; },
    isFirebase: function () { return mode === 'firebase'; },
  });
}(window));
