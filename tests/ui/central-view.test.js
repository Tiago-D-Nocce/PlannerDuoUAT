/* TASK 15.x — Central view: compositor, atividade, log e blocos tipados.
 *
 * DOM sem dependências (tests/helpers/mini-dom.mjs). Garante que a renderização é
 * segura (sem innerHTML) e que cada tipo de bloco vira exatamente um nó do tipo
 * certo com role/texto corretos. Determinístico.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMiniDom, makeKeyEvent, makeClickEvent } from '../helpers/mini-dom.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const PlannerCentralView = require(join(here, '..', '..', 'public', 'modules', 'ui', 'central-view.js'));

// Orquestrador falso: registra listeners e expõe emit() para os testes.
function fakeOrchestrator() {
  const handlers = Object.create(null);
  return {
    handled: [],
    acted: [],
    handle(text) { this.handled.push(text); },
    act(blockId, action, gesture) { this.acted.push({ blockId, action, gesture }); },
    on(event, fn) {
      (handlers[event] || (handlers[event] = [])).push(fn);
      return function off() {
        const list = handlers[event];
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      };
    },
    emit(event, payload) { (handlers[event] || []).forEach((fn) => fn(payload)); },
  };
}

function setup() {
  const { document } = createMiniDom();
  const mount = document.body;
  const orchestrator = fakeOrchestrator();
  const actions = [];
  const view = PlannerCentralView.create({
    mount,
    orchestrator,
    onAction: (info) => actions.push(info),
  });
  return { document, mount, orchestrator, actions, view };
}

describe('central-view — compositor', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it('monta role="log" e role="status"', () => {
    expect(ctx.mount.querySelector('[role="log"]')).not.toBeNull();
    expect(ctx.mount.querySelector('[role="status"]')).not.toBeNull();
  });

  it('submit do form chama orchestrator.handle com o texto e limpa o campo', () => {
    const field = ctx.mount.querySelector('.cv-field');
    const form = ctx.mount.querySelector('.cv-composer');
    field.value = 'Gastei 150 no mercado';
    // dispatch real do submit:
    const submitEvt = { type: 'submit', preventDefault() {}, bubbles: true };
    form.dispatchEvent(Object.assign(submitEvt, { target: form, currentTarget: form }));
    expect(ctx.orchestrator.handled).toContain('Gastei 150 no mercado');
    expect(field.value).toBe('');
  });

  it('Enter envia e Shift+Enter não', () => {
    const field = ctx.mount.querySelector('.cv-field');
    field.value = 'oi';
    field.dispatchEvent(makeKeyEvent('Enter', { shiftKey: true }));
    expect(ctx.orchestrator.handled.length).toBe(0); // Shift+Enter = nova linha
    field.value = 'oi';
    field.dispatchEvent(makeKeyEvent('Enter', { shiftKey: false }));
    expect(ctx.orchestrator.handled).toContain('oi');
  });

  it('texto vazio é ignorado', () => {
    const field = ctx.mount.querySelector('.cv-field');
    field.value = '   ';
    field.dispatchEvent(makeKeyEvent('Enter'));
    expect(ctx.orchestrator.handled.length).toBe(0);
  });

  it('chip de sugestão preenche o compositor', () => {
    const chip = ctx.mount.querySelector('.cv-suggestions').querySelector('.cv-chip');
    expect(chip).not.toBeNull();
    chip.click();
    const field = ctx.mount.querySelector('.cv-field');
    expect(field.value.length).toBeGreaterThan(0);
  });
});

function blockOf(type, payload, extra) {
  return Object.assign({ id: 'b1', turnId: 't1', agent: 'orchestrator', type, payload: payload || {} }, extra || {});
}

describe('central-view — renderização por tipo de bloco', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  function logChildren() {
    const log = ctx.mount.querySelector('[role="log"]');
    return log.children.filter((c) => c.classList.contains('cv-block'));
  }

  it('text → 1 parágrafo com o texto', () => {
    ctx.orchestrator.emit('block', blockOf('text', { message: 'Olá mundo' }));
    const blocks = logChildren();
    expect(blocks.length).toBe(1);
    expect(blocks[0].getAttribute('data-type')).toBe('text');
    expect(blocks[0].textContent).toContain('Olá mundo');
  });

  it('question → prompt + chips a partir de block.actions', () => {
    ctx.orchestrator.emit('block', blockOf('question', { prompt: 'Qual mês?' }, {
      actions: [{ id: 'c0', label: 'Dezembro', value: 'dezembro' }],
    }));
    const [node] = logChildren();
    expect(node.getAttribute('data-type')).toBe('question');
    expect(node.textContent).toContain('Qual mês?');
    const chip = node.querySelector('.cv-chip');
    expect(chip.textContent).toBe('Dezembro');
    chip.click(); // preenche e envia
    expect(ctx.orchestrator.handled).toContain('dezembro');
  });

  it('links → <a> seguro só para http(s); url inerte vira texto', () => {
    ctx.orchestrator.emit('block', blockOf('links', {
      links: [
        { providerId: 'kayak', name: 'KAYAK', url: 'https://kayak.com/x' },
        { providerId: 'evil', name: 'Evil', url: 'javascript:alert(1)' },
      ],
    }));
    const [node] = logChildren();
    const a = node.querySelector('a');
    expect(a).not.toBeNull();
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('href')).toBe('https://kayak.com/x');
    // o link javascript: NÃO vira <a>
    const anchors = node.querySelectorAll('a');
    expect(anchors.length).toBe(1);
    expect(node.textContent).toContain('Evil');
  });

  it('flights → card com companhia em texto, +1, escalas e ações', () => {
    ctx.orchestrator.emit('block', blockOf('flights', {
      results: [{
        carrier: 'LATAM', carrierCode: 'LA123', departTime: '08:10', arriveTime: '06:30',
        arrivalNextDay: true, duration: '22h20', stops: [{ airport: 'GRU', connection: '2h' }],
        baggage: '1 mala', flexibility: 'Flexível', price: '3200', currency: 'BRL',
        labels: ['Melhor custo'], reasons: ['Menos escalas'], honesty: 'Preço estimado.',
      }],
    }));
    const [node] = logChildren();
    expect(node.getAttribute('data-type')).toBe('flights');
    expect(node.textContent).toContain('LATAM');
    expect(node.textContent).toContain('LA123');
    expect(node.textContent).toContain('+1');
    expect(node.textContent).toContain('GRU');
    expect(node.querySelector('.cv-honesty')).not.toBeNull();
    expect(node.querySelector('.cv-card-actions')).not.toBeNull();
  });

  it('stays → card com nota/10, noites e ações', () => {
    ctx.orchestrator.emit('block', blockOf('stays', {
      results: [{
        name: 'Hotel Central', rating: 8.6, reviews: 420, nights: 3,
        total: '900', perNight: '300', currency: 'BRL', board: 'Café da manhã',
        refundable: true, honesty: 'Confirme no site.',
      }],
    }));
    const [node] = logChildren();
    expect(node.getAttribute('data-type')).toBe('stays');
    expect(node.textContent).toContain('Hotel Central');
    expect(node.textContent).toContain('8.6/10');
    expect(node.querySelector('.cv-card-actions')).not.toBeNull();
  });

  it('summary (kv) e summary (list)', () => {
    ctx.orchestrator.emit('block', blockOf('summary', { kind: 'generic', data: { Gastos: 'R$ 150', Saldo: 'R$ 50' } }));
    ctx.orchestrator.emit('block', blockOf('summary', { kind: 'list', data: { items: ['Viagem A', 'Viagem B'] } }, { id: 'b2' }));
    const blocks = logChildren();
    expect(blocks.length).toBe(2);
    expect(blocks[0].querySelector('.cv-summary-kv')).not.toBeNull();
    expect(blocks[1].querySelector('.cv-summary-list')).not.toBeNull();
    expect(blocks[1].textContent).toContain('Viagem A');
  });

  it('receipt → mensagem + botão Desfazer ligado a orchestrator.act', () => {
    ctx.orchestrator.emit('block', blockOf('receipt', { message: 'Lançamento criado', id: 'fin-9' }, {
      actions: [{ id: 'undo', label: 'Desfazer', value: 'fin-9' }],
    }));
    const [node] = logChildren();
    expect(node.getAttribute('data-type')).toBe('receipt');
    const undo = node.querySelector('.cv-action-secondary');
    undo.click();
    expect(ctx.orchestrator.acted.some((a) => a.blockId === 'b1' && a.action === 'undo')).toBe(true);
  });

  it('confirmation → botões Confirmar/Cancelar chamam act com id e gesto', () => {
    ctx.orchestrator.emit('block', blockOf('confirmation', {
      title: 'Criar lançamento', message: 'Confirme para executar.',
      fields: [{ label: 'Valor', value: 'R$ 150' }],
    }, { id: 'conf-1', actions: [{ id: 'confirm', label: 'Confirmar' }, { id: 'cancel', label: 'Cancelar' }] }));
    const [node] = logChildren();
    expect(node.getAttribute('data-type')).toBe('confirmation');
    const confirm = node.querySelector('.cv-action-primary');
    confirm.click();
    const entry = ctx.orchestrator.acted.find((a) => a.action === 'confirm');
    expect(entry).toBeTruthy();
    expect(entry.blockId).toBe('conf-1');
    expect(entry.gesture).toBeTruthy(); // o evento real é passado como gesto
    expect(entry.gesture.type).toBe('click');
  });

  it('error → mensagem + Tentar de novo, role="alert"', () => {
    ctx.orchestrator.emit('block', blockOf('error', { message: 'Falhou' }, {
      actions: [{ id: 'retry', label: 'Tentar de novo', value: 'ping' }],
    }));
    const [node] = logChildren();
    expect(node.getAttribute('data-type')).toBe('error');
    expect(node.getAttribute('role')).toBe('alert');
    expect(node.textContent).toContain('Falhou');
    node.querySelector('.cv-action-secondary').click();
    expect(ctx.actions.some((a) => a.type === 'retry')).toBe(true);
  });
});

describe('central-view — segurança de renderização (sem HTML injetado)', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it('string maliciosa em text vira texto literal (sem <img>)', () => {
    const evil = '<img src=x onerror=alert(1)>';
    ctx.orchestrator.emit('block', blockOf('text', { message: evil }));
    const node = ctx.mount.querySelector('.cv-block-text');
    // nenhum elemento filho chamado IMG foi criado
    const imgs = node.querySelectorAll('img');
    expect(imgs.length).toBe(0);
    // o conteúdo literal está presente como texto
    expect(node.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('string maliciosa em summary vira texto literal', () => {
    const evil = '<script>alert(1)</script>';
    ctx.orchestrator.emit('block', blockOf('summary', { kind: 'generic', data: { Nota: evil } }));
    const node = ctx.mount.querySelector('.cv-block-summary');
    expect(node.querySelectorAll('script').length).toBe(0);
    expect(node.textContent).toContain('<script>alert(1)</script>');
  });
});

describe('central-view — atividade, estado e volume', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it('activity anuncia uma vez por mudança', () => {
    const status = ctx.mount.querySelector('[role="status"]');
    ctx.orchestrator.emit('activity', { id: 'travel.flights.search', title: 'Buscando voos', status: 'running' });
    expect(status.textContent).toContain('Buscando voos');
    const before = status.textContent;
    ctx.orchestrator.emit('activity', { id: 'travel.flights.search', title: 'Buscando voos', status: 'running' });
    expect(status.textContent).toBe(before); // mesma mudança não re-anuncia
  });

  it('empty state some após o primeiro bloco e volta em cleared', () => {
    expect(ctx.mount.querySelector('.cv-empty')).not.toBeNull();
    ctx.orchestrator.emit('block', blockOf('text', { message: 'oi' }));
    expect(ctx.mount.querySelector('.cv-empty')).toBeNull();
    ctx.orchestrator.emit('cleared', {});
    expect(ctx.mount.querySelector('.cv-empty')).not.toBeNull();
  });

  it('skeleton aparece em turn:start e some em turn:end', () => {
    const sk = ctx.mount.querySelector('.cv-skeleton');
    ctx.orchestrator.emit('turn:start', { turnId: 't1' });
    expect(sk.hasAttribute('hidden')).toBe(false);
    ctx.orchestrator.emit('turn:end', { turnId: 't1' });
    expect(sk.hasAttribute('hidden')).toBe(true);
  });

  it('30 cards renderizam sem erro', () => {
    const results = [];
    for (let i = 0; i < 30; i++) results.push({ carrier: 'C' + i, departTime: '08:00', arriveTime: '10:00', stops: [] });
    ctx.orchestrator.emit('block', blockOf('flights', { results }));
    const node = ctx.mount.querySelector('.cv-block-flights');
    expect(node.querySelectorAll('.cv-flight-card').length).toBe(30);
  });

  it('destroy remove a raiz e desinscreve', () => {
    ctx.view.destroy();
    expect(ctx.mount.querySelector('.cv-root')).toBeNull();
    // após destroy, novos eventos não quebram
    ctx.orchestrator.emit('block', blockOf('text', { message: 'tarde demais' }));
    expect(ctx.mount.querySelector('.cv-block')).toBeNull();
  });
});
