// Throwaway verification script (OS temp). No repo deps. Node 24 ESM.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const REPO = process.argv[2];
const PORT = 5595;
const CDP_PORT = 9397;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SCREENSHOT_DIR = join(REPO, 'verificacao-visual');
const SCREENSHOT = join(SCREENSHOT_DIR, 'provider-grid.png');

const consoleMsgs = [];
const cspViolations = [];
let server, chrome, userDir;

function log(...a) { console.log('[verify]', ...a); }

async function waitFor(fn, timeout, interval = 150) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const r = await fn(); if (r) return r; } catch (_) {}
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error('waitFor timeout');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = {}; }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
      } else if (msg.method && c.handlers[msg.method]) {
        c.handlers[msg.method](msg.params);
      }
    };
    return c;
  }
  on(method, fn) { this.handlers[method] = fn; }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

function recordConsole(params, kind) {
  let text = '';
  if (kind === 'consoleAPI') {
    text = (params.args || []).map(a => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ');
    consoleMsgs.push(`[${params.type}] ${text}`);
  } else {
    const e = params.entry;
    text = `${e.level}: ${e.text}` + (e.url ? ` (${e.url})` : '');
    consoleMsgs.push(`[log] ${text}`);
  }
  if (/content security policy|csp|refused to|violat/i.test(text)) cspViolations.push(text);
}

async function main() {
  server = spawn('node', [join(REPO, 'scripts/dev-server.mjs'), '--port', String(PORT)], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverUp = false;
  server.stdout.on('data', (d) => { if (/PlannerDuo rodando/i.test(d.toString())) serverUp = true; });
  server.stderr.on('data', (d) => log('server-err', d.toString().trim()));
  await waitFor(() => serverUp, 15000);
  log('server up on', PORT);

  userDir = mkdtempSync(join(tmpdir(), 'pd-chrome-'));
  chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDir}`,
    '--no-first-run', '--disable-extensions', '--window-size=1440,900',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  const wsUrl = await waitFor(async () => {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const j = await res.json();
    return j.webSocketDebuggerUrl;
  }, 15000);
  const browser = await CDP.connect(wsUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });

  browser.on('Runtime.consoleAPICalled', (p) => recordConsole(p, 'consoleAPI'));
  browser.on('Log.entryAdded', (p) => recordConsole(p, 'log'));

  const _send = browser.send.bind(browser);
  const S = (method, params = {}) => _send(method, { ...params, sessionId });

  await S('Runtime.enable');
  await S('Log.enable');
  await S('Page.enable');

  async function nav(url) { await S('Page.navigate', { url }); await new Promise(r => setTimeout(r, 900)); }
  async function evalp(expr, awaitPromise = true) {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error('eval exception: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails));
    return r.result.value;
  }

  await nav(`http://127.0.0.1:${PORT}/auth`);
  await waitFor(() => evalp(`!!document.querySelector('#setup-account-name')`), 8000);
  log('auth loaded');

  const filled = await evalp(`(function(){
    function setVal(el,v){ if(!el) return false; el.focus(); el.value=v; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; }
    const q=(s)=>document.querySelector(s);
    const r={};
    r.name=setVal(q('#setup-account-name'),'Tiago');
    r.email=setVal(q('#setup-account-email'),'tiago@local.test');
    r.pass=setVal(q('#setup-account-password'),'SenhaForte123');
    r.confirm=setVal(q('#setup-account-confirm'),'SenhaForte123');
    const nr=q('#setup-no-recovery'); if(nr && !nr.checked){ nr.click(); } r.noRecovery = nr?nr.checked:null;
    return r;
  })()`);
  log('form filled', JSON.stringify(filled));

  const sub = await evalp(`(function(){
    const form=document.querySelector('#setup-vault-form');
    if(form){ if(form.requestSubmit){ form.requestSubmit(); } else { const b=form.querySelector('button[type=submit]'); b&&b.click(); } return 'submitted'; }
    return 'no-form';
  })()`);
  log('submit', sub);

  await waitFor(async () => /app/.test(await evalp(`location.pathname`)), 12000)
    .catch(() => log('WARN: pathname not /app'));
  await new Promise(r => setTimeout(r, 900));
  log('location now', await evalp(`location.pathname`));

  const ob = await evalp(`(function(){
    const b=document.querySelector('[data-action="dismiss-setup"]');
    if(b){ b.click(); return 'dismiss-click'; }
    const dlg=document.querySelector('dialog[open]');
    if(dlg){ try{dlg.close();}catch(e){} return 'dialog-close'; }
    return 'none';
  })()`);
  log('onboarding', ob);
  await new Promise(r => setTimeout(r, 500));

  const nt = await evalp(`(function(){
    const b=document.querySelector('[data-view="trips"]');
    if(b){ b.click(); return 'trips-click'; }
    return 'no-trips-btn';
  })()`);
  log('nav trips', nt);
  await new Promise(r => setTimeout(r, 1300));

  const sc = await evalp(`(function(){
    const g=document.querySelector('#travel-provider-grid');
    if(g){ g.scrollIntoView({block:'center'}); return 'scrolled'; }
    return 'no-grid';
  })()`);
  log('scroll', sc);
  await new Promise(r => setTimeout(r, 1600));

  const result = await evalp(`(function(){
    const out={};
    out.hasWindowObj = (typeof window.PlannerProviderIcons==='object' && window.PlannerProviderIcons!==null);
    out.entriesLength = (window.PlannerProviderIcons && Array.isArray(window.PlannerProviderIcons.entries)) ? window.PlannerProviderIcons.entries.length : null;
    const imgs=[...document.querySelectorAll('#travel-provider-grid img.travel-provider-img')];
    out.imgCount=imgs.length;
    out.broken=imgs.filter(i=>!(i.naturalWidth>0)).map(i=>{ const t=i.closest('[data-provider]'); return t?t.getAttribute('data-provider'):(i.getAttribute('alt')||'?'); });
    out.allLocal=imgs.every(i=>{ const s=i.getAttribute('src')||''; return s.startsWith('assets/providers/'); });
    out.externalSrcs=imgs.filter(i=>{ const s=i.getAttribute('src')||''; return !s.startsWith('assets/providers/'); }).map(i=>i.getAttribute('src'));
    const azulTile=document.querySelector('[data-provider="azul"]');
    out.azulFound=!!azulTile;
    if(azulTile){
      out.azulSwatch=!!azulTile.querySelector('.travel-provider-swatch');
      out.azulImg=!!azulTile.querySelector('img.travel-provider-img');
      const strong=azulTile.querySelector('.travel-provider-copy strong');
      out.azulName=strong?strong.textContent.trim():(azulTile.textContent||'').trim();
      out.azulHasName=/azul/i.test(azulTile.textContent||'');
    }
    out.vaultVisible=/cofre|vault/i.test(document.body.innerText||'');
    out.sampleProviders=[...document.querySelectorAll('#travel-provider-grid [data-provider]')].slice(0,30).map(t=>t.getAttribute('data-provider'));
    return out;
  })()`);
  log('RESULT', JSON.stringify(result, null, 2));

  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const clip = await evalp(`(function(){
    const g=document.querySelector('#travel-provider-grid');
    if(!g) return null;
    const r=g.getBoundingClientRect();
    return {x:Math.max(0,Math.floor(r.x)), y:Math.max(0,Math.floor(r.y)), width:Math.floor(Math.min(1440,r.width)), height:Math.floor(Math.min(2200,r.height)), scale:1};
  })()`);
  const shotParams = { format: 'png' };
  if (clip && clip.width > 0 && clip.height > 0) shotParams.clip = clip;
  const shot = await S('Page.captureScreenshot', shotParams);
  writeFileSync(SCREENSHOT, Buffer.from(shot.data, 'base64'));
  log('screenshot written', SCREENSHOT, existsSync(SCREENSHOT), 'bytes', Buffer.from(shot.data, 'base64').length);

  console.log('===VERIFY_JSON_START===');
  console.log(JSON.stringify({
    entriesLength: result.entriesLength,
    hasWindowObj: result.hasWindowObj,
    imgCount: result.imgCount,
    broken: result.broken,
    allLocal: result.allLocal,
    externalSrcs: result.externalSrcs,
    azul: { found: result.azulFound, swatch: result.azulSwatch, img: result.azulImg, name: result.azulName, hasName: result.azulHasName },
    vaultVisible: result.vaultVisible,
    cspViolations,
    consoleCount: consoleMsgs.length,
    screenshot: SCREENSHOT,
    sampleProviders: result.sampleProviders,
  }, null, 2));
  console.log('===VERIFY_JSON_END===');
  console.log('===CONSOLE_MSGS===');
  console.log(consoleMsgs.slice(0, 80).join('\n'));
  console.log('===END_CONSOLE===');

  await S('Target.closeTarget', { targetId }).catch(()=>{});
}

async function cleanup() {
  try { if (chrome) chrome.kill(); } catch (_) {}
  try { if (server) server.kill(); } catch (_) {}
  await new Promise(r => setTimeout(r, 300));
  try { if (userDir) rmSync(userDir, { recursive: true, force: true }); } catch (_) {}
  log('cleanup done');
}

const globalTimeout = setTimeout(async () => {
  log('GLOBAL TIMEOUT reached');
  await cleanup();
  process.exit(2);
}, 66000);

main().then(async () => {
  clearTimeout(globalTimeout);
  await cleanup();
  process.exit(0);
}).catch(async (e) => {
  clearTimeout(globalTimeout);
  log('ERROR', e && e.stack || e);
  console.log('===CONSOLE_MSGS===');
  console.log(consoleMsgs.slice(0, 80).join('\n'));
  console.log('===END_CONSOLE===');
  await cleanup();
  process.exit(1);
});
