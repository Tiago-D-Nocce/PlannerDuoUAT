// ============================================================
// PLANNERDUO — app.js v3.0
// Dois usuários com logins próprios, dados 100% compartilhados
// ============================================================

// ── Firebase Config ──────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyAywzg4yDP0p15RpnFwPc2Y2MGoT2U5l4M",
    authDomain: "plannerduo.firebaseapp.com",
    projectId: "plannerduo",
    storageBucket: "plannerduo.firebasestorage.app",
    messagingSenderId: "355035332668",
    appId: "1:355035332668:web:9c91fb300c4b601dfc4339",
    measurementId: "G-GFCLFVXP4E"
};

// ── Modo de operação ─────────────────────────────────────────
// PlannerRuntime detecta loopback como local e qualquer outro host como
// Firebase. O fallback mantém compatibilidade com harnesses que injetam apenas
// PLANNERDUO_MODO, sem tornar hosts remotos locais por padrão.
const _modoExplicito = typeof window !== 'undefined' && ['local', 'firebase'].includes(window.PLANNERDUO_MODO)
    ? window.PLANNERDUO_MODO
    : null;
const _host = typeof window !== 'undefined' && window.location ? String(window.location.hostname || '').toLowerCase() : '';
const MODO = (typeof window !== 'undefined' && window.PlannerRuntime && window.PlannerRuntime.mode)
    || _modoExplicito
    || (['localhost', '127.0.0.1', '::1', '[::1]'].includes(_host) ? 'local' : 'firebase');
const ehModoLocal = () => MODO === 'local';

// Inicialização do Firebase sob demanda: nenhum acesso a `firebase.*` ocorre no
// topo do módulo. `iniciarFirebase()` só roda no caminho firebase, então em
// modo local a ausência dos SDKs não quebra a carga do app.js.
let auth = null;
let db   = null;
function iniciarFirebase() {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db   = firebase.firestore();
}

// A política SESSION pertence somente ao fluxo que cria uma nova autenticação
// em auth.html. Nesta página, uma sessão já estabelecida deve ser observada
// diretamente; repetir setPersistence aqui bloquearia a própria restauração.

// ── Estado Global ─────────────────────────────────────────────
// O identificador do Espaço_Casal (casalId) é resolvido dinamicamente
// a partir da identidade do Usuário logado (ver Auth.resolverCasalId).
const Estado = {
    usuarioUid:  null,
    usuarioEmail: null,
    usuarioNome: null,   // displayName do Google
    nomeUsuario: null,   // nome da pessoa logada (lido do doc)
    casalId: null,       // resolvido dinamicamente (Decisão D1)
    nome1: null,         // sem fallback fixo (null até carregar)
    nome2: null,
    membros: {},         // mapa e-mail -> nome do espaço atual
    viagens:    [],
    financas:   [],
    metas:      [],
    checklist:  [],
    orcamentos: {},      // map categoria -> valor limite mensal
    historicoBuscas: [], // últimas buscas de viagem (max 8, localStorage)
    unsubscribe: null,   // listener ativo do Firestore ou storage local
    primeiroSnapshot: false, // true após o 1º onSnapshot com dados da nuvem
    _localRevision: 0,   // revisão observada do documento local
    _localFieldRevisions: {} // última revisão observada de cada campo local
};

// ============================================================
// UTILITÁRIOS
// ============================================================
const Utils = {
    id: () => crypto.randomUUID ? crypto.randomUUID() : '_' + Math.random().toString(36).substr(2, 9),

    moeda: (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0),

    data: (s) => {
        if (!s) return '';
        const [a, m, d] = s.split('-');
        return `${d}/${m}/${a}`;
    },

    hoje: () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    },

    diasAte: (dateStr) => {
        if (!dateStr) return null;
        const hoje = new Date(); hoje.setHours(0,0,0,0);
        const alvo = new Date(dateStr + 'T12:00:00');
        if (isNaN(alvo.getTime())) return null;
        alvo.setHours(0,0,0,0);
        return Math.ceil((alvo - hoje) / 86400000);
    },

    slug: (t) => String(t || '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-'),

    inicial: (nome) => {
        const s = String(nome || '').trim();
        return (s || '?')[0].toUpperCase();
    },

    // ── Escape de HTML ───────────────────────────────────────
    // Todo texto vindo do usuário (descrições, destinos, notas, títulos)
    // passa por aqui antes de ser interpolado via innerHTML. Sem isso um
    // simples `<` ou `"` numa descrição quebra a tabela/os cards inteiros.
    esc: (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),

    // Só devolve o link se for http(s); evita `javascript:` em href.
    urlSegura: (u) => {
        const s = String(u || '').trim();
        return /^https?:\/\//i.test(s) ? s : '';
    },

    // ── Nomes do casal com fallback estável (nunca null/"null") ──
    // Retorna sempre nomes utilizáveis para gravação, comparação e labels.
    nomesCasal: () => ({
        p1: Estado.nome1 || 'Pessoa 1',
        p2: Estado.nome2 || 'Pessoa 2'
    }),

    // Rótulo da segunda pessoa do espaço. O cadastro cria só a conta individual,
    // então `nome2` costuma vir vazio; nesse caso deriva do outro membro do mapa
    // `membros`, que é preenchido quando o parceiro(a) aceita o convite.
    nome2De: (dados, nome1) => {
        if (dados && dados.nome2) return dados.nome2;
        const membros = (dados && dados.membros) || {};
        return Object.values(membros).find(n => n && n !== nome1) || null;
    },

    // Identifica a página a partir do pathname, aceitando tanto `/app.html`
    // quanto `/app`: os rewrites do Hosting (e do dev-server e do Live Server)
    // servem app.html em `/app`. Comparar por sufixo `.html` fazia isApp/isAuth
    // virarem false em `/app`, e o ramo sem sessão deixava de redirecionar para
    // o login — o loader ficava preso para sempre.
    rotaDe: (pathname) => {
        const ultimo = String(pathname || '')
            .split('?')[0]
            .split('#')[0]
            .replace(/\/+$/, '')
            .split('/')
            .pop()
            .toLowerCase();
        if (ultimo === 'app'  || ultimo === 'app.html')  return 'app';
        if (ultimo === 'auth' || ultimo === 'auth.html') return 'auth';
        return 'landing';
    },

    // ── Responsável: value estável do select (p1/p2) <-> nome ─
    // As options de #fin-resp / #edit-fin-resp têm value fixo p1/p2 e
    // apenas o textContent muda com os nomes do casal. Assim o valor
    // gravado nunca depende do texto renderizado no momento do clique.
    respDeValor: (valor) => {
        const { p1, p2 } = Utils.nomesCasal();
        return valor === 'p2' ? p2 : p1;
    },

    valorDeResp: (nome) => {
        const { p2 } = Utils.nomesCasal();
        return nome === p2 ? 'p2' : 'p1';
    },

    // ── Parse de valor monetário pt-BR ───────────────────────
    // Aceita '100,50', '1.234,56' e '100.50'. Se houver vírgula, trata
    // pontos como separador de milhar e a vírgula como decimal; senão
    // usa parseFloat direto. Retorna NaN se inválido.
    parseValor: (str) => {
        if (str == null) return NaN;
        let s = String(str).trim();
        if (s === '') return NaN;
        if (s.indexOf(',') !== -1) {
            s = s.replace(/\./g, '').replace(',', '.');
        }
        return parseFloat(s);
    },

    catInfo: (cat) => {
        const mapa = {
            alimentacao: { emoji:'🍔', label:'Alimentação', cor:'#f97316' },
            transporte:  { emoji:'🚗', label:'Transporte',  cor:'#3b82f6' },
            moradia:     { emoji:'🏠', label:'Moradia',     cor:'#8b5cf6' },
            lazer:       { emoji:'🎟️', label:'Lazer',       cor:'#ec4899' },
            saude:       { emoji:'💊', label:'Saúde',       cor:'#10b981' },
            viagem:      { emoji:'✈️', label:'Viagem',      cor:'#06b6d4' },
            educacao:    { emoji:'📚', label:'Educação',    cor:'#f59e0b' },
            vestuario:   { emoji:'👗', label:'Vestuário',   cor:'#a855f7' },
            salario:     { emoji:'💼', label:'Salário',     cor:'#22c55e' },
            investimento:{ emoji:'📈', label:'Investimento',cor:'#14b8a6' },
            outros:      { emoji:'🏷️', label:'Outros',      cor:'#94a3b8' },
        };
        return mapa[cat] || mapa.outros;
    },

    inferirCat: (desc) => {
        const d = String(desc || '').toLowerCase();
        if (/(uber|99|onibus|passagem|gasolina|estac|voo|combustivel)/.test(d)) return 'transporte';
        if (/(ifood|burger|pizza|mercado|padaria|restaurante|lanche|açai|sushi|delivery)/.test(d)) return 'alimentacao';
        if (/(netflix|spotify|internet|luz|agua|aluguel|condominio|energia)/.test(d)) return 'moradia';
        if (/(cinema|festa|show|ingresso|cerveja|bar|balada|teatro)/.test(d)) return 'lazer';
        if (/(farmacia|remedio|médico|consulta|plano de saude|dentist)/.test(d)) return 'saude';
        if (/(viagem|hotel|hostel|airbnb|booking|passagem aerea)/.test(d)) return 'viagem';
        if (/(curso|faculdade|livro|escola|mensalidade)/.test(d)) return 'educacao';
        if (/(roupa|sapato|calca|camisa|vestido|tenis)/.test(d)) return 'vestuario';
        if (/(salario|pagamento|freelance|renda|comissao)/.test(d)) return 'salario';
        return 'outros';
    },

    // ── Vínculo despesa ↔ viagem ─────────────────────────────
    // Soma todas as despesas (tipo==='despesa') vinculadas a uma viagem.
    gastosDaViagem: (viagemId) => {
        if (!viagemId) return 0;
        return Estado.financas
            .filter(f => f.tipo === 'despesa' && f.viagemId === viagemId)
            .reduce((s, f) => s + (f.valor || 0), 0);
    },

    // ── Motor de busca: códigos IATA ─────────────────────────
    // Mapa de cidades brasileiras comuns → código IATA do aeroporto.
    IATA: {
        'belo horizonte':'CNF','sao paulo':'GRU','rio de janeiro':'GIG','brasilia':'BSB',
        'salvador':'SSA','recife':'REC','fortaleza':'FOR','porto alegre':'POA',
        'curitiba':'CWB','florianopolis':'FLN','natal':'NAT','maceio':'MCZ',
        'vitoria':'VIX','cuiaba':'CGB','goiania':'GYN','belem':'BEL','manaus':'MAO',
        'joao pessoa':'JPA','aracaju':'AJU','campo grande':'CGR','sao luis':'SLZ',
        'teresina':'THE','palmas':'PMW','porto seguro':'BPS','foz do iguacu':'IGU',
        'navegantes':'NVT','cabo frio':'CFB'
    },

    // Normaliza a cidade (minúsculas, sem acento) e retorna o IATA ou null.
    iata: (cidade) => {
        if (!cidade) return null;
        const chave = cidade.trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return Utils.IATA[chave] || null;
    }
};

// ============================================================
// UI — HELPERS VISUAIS
// ============================================================
const UI = {
    abrirModal: (id) => {
        // form.reset() ao fechar apaga a data; repõe "hoje" a cada abertura,
        // senão da segunda transação em diante o campo abre vazio.
        if (id === 'modal-financa') {
            const d = document.getElementById('fin-data');
            if (d && !d.value) d.value = Utils.hoje();
        }
        document.getElementById(id)?.classList.add('ativa');
    },
    fecharModal: (id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('ativa');
        const form = el.querySelector('form');
        if (form) {
            form.reset();
        } else {
            // Modais sem <form> (orçamento, cofrinho, depósito, convite) não
            // eram limpos ao fechar e reabriam com o valor anterior.
            el.querySelectorAll('.modal-body input:not([type="hidden"])')
              .forEach(i => { i.value = ''; });
        }
    },

    toast: (titulo, corpo = '', tipo = 'sucesso') => {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const icones = { sucesso: 'fa-check-circle', erro: 'fa-circle-exclamation', aviso: 'fa-triangle-exclamation', info: 'fa-circle-info' };
        const t = document.createElement('div');
        t.className = `toast ${tipo}`;
        // Título e corpo frequentemente carregam texto digitado pelo usuário
        // (descrição da transação, destino da viagem) — escapa antes de injetar.
        t.innerHTML = `
            <div class="toast-icon"><i class="fa-solid ${icones[tipo] || icones.info}"></i></div>
            <div class="toast-msg">
                <div class="toast-title">${Utils.esc(titulo)}</div>
                ${corpo ? `<div class="toast-body">${Utils.esc(corpo)}</div>` : ''}
            </div>`;
        container.appendChild(t);
        setTimeout(() => {
            t.classList.add('saindo');
            setTimeout(() => t.remove(), 300);
        }, 3500);
    },

    // Alias para código legado
    mostrarToast: (msg, tipo = 'sucesso') => UI.toast(msg, '', tipo),

    setupNav: () => {
        document.querySelectorAll('.nav-item[data-alvo]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                navegarPara(item.getAttribute('data-alvo'));
                // fecha sidebar no mobile
                fecharSidebar();
            });
        });
    },

    atualizarNomes: () => {
        // Selectboxes de responsável nos modais — usa fallback estável
        // para nunca escrever 'null' no textContent das options.
        const { p1, p2 } = Utils.nomesCasal();
        ['fin-resp-p1','edit-fin-resp-p1','rel-p1-opt'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = p1;
        });
        ['fin-resp-p2','edit-fin-resp-p2','rel-p2-opt'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = p2;
        });
        document.getElementById('rel-col-p1') && (document.getElementById('rel-col-p1').textContent = p1);
        document.getElementById('rel-col-p2') && (document.getElementById('rel-col-p2').textContent = p2);
        // Avatares do split
        document.getElementById('split-nome1') && (document.getElementById('split-nome1').textContent = p1);
        document.getElementById('split-nome2') && (document.getElementById('split-nome2').textContent = p2);
        document.getElementById('split-av1')   && (document.getElementById('split-av1').textContent   = Utils.inicial(p1));
        document.getElementById('split-av2')   && (document.getElementById('split-av2').textContent   = Utils.inicial(p2));
    }
};

// ============================================================
// NAVEGAÇÃO
// ============================================================
function navegarPara(alvo) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('ativo'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('ativa'));
    const navItem = document.querySelector(`.nav-item[data-alvo="${alvo}"]`);
    if (navItem) navItem.classList.add('ativo');
    const view = document.getElementById(alvo);
    if (view) view.classList.add('ativa');

    // Triggers específicos por view
    if (alvo === 'dashboard')  Render.dashboard();
    if (alvo === 'financas')   Render.financas();
    if (alvo === 'metas')      Render.metas();
    if (alvo === 'viagens')    Render.viagens();
    if (alvo === 'checklist')  Render.checklist();
    if (alvo === 'relatorios') Relatorios.atualizar();
}

function abrirSidebar() {
    document.getElementById('sidebar')?.classList.add('aberta');
    document.getElementById('sidebar-overlay')?.classList.add('ativo');
}
function fecharSidebar() {
    document.getElementById('sidebar')?.classList.remove('aberta');
    document.getElementById('sidebar-overlay')?.classList.remove('ativo');
}
function toggleTema() {
    const html  = document.documentElement;
    const atual = html.getAttribute('data-theme');
    const novo  = atual === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', novo);
    localStorage.setItem('pd-tema', novo);
    const icon = document.getElementById('btn-tema')?.querySelector('i');
    const mIcon = document.getElementById('mobile-tema-icon');
    if (icon)  icon.className  = novo === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    if (mIcon) mIcon.className = novo === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    Charts.destruirTodos();
    setTimeout(() => Charts.renderizarTodos(), 50);
}

// ============================================================
// AUTENTICAÇÃO
// ============================================================
const Auth = {
    _navegando: false,

    // Marca se o observer de autenticação já emitiu o primeiro estado. Enquanto
    // for false na página do app, o watchdog abaixo é a única saída garantida
    // caso o SDK do Firebase demore demais para o primeiro callback.
    _observerDisparou: false,

    // Id do watchdog de login automático (setTimeout). Guardado para permitir
    // cancelamento assim que o observer disparar.
    _timerFallbackLogin: null,

    _iniciarFase: (nome, timeoutMs) => {
        const supervisor = window.PlannerBootstrap;
        if (supervisor && typeof supervisor.iniciarFase === 'function') {
            supervisor.iniciarFase(nome, timeoutMs);
        }
    },

    // Agenda/cancela o watchdog usando os timers da window quando disponíveis
    // (navegador real) e caindo para os globais no contexto vm dos testes.
    _agendar: (fn, ms) => {
        const agendar = (typeof window !== 'undefined' && typeof window.setTimeout === 'function')
            ? window.setTimeout
            : setTimeout;
        return agendar(fn, ms);
    },

    _cancelar: (id) => {
        if (id == null) return;
        const cancelar = (typeof window !== 'undefined' && typeof window.clearTimeout === 'function')
            ? window.clearTimeout
            : clearTimeout;
        cancelar(id);
    },

    // Marca o primeiro disparo do observer e cancela o watchdog. Chamado ANTES
    // de processar o estado, para que um observer que dispara logo neutralize o
    // fallback antes de qualquer navegação própria.
    _registrarPrimeiroEstado: () => {
        Auth._observerDisparou = true;
        Auth._cancelar(Auth._timerFallbackLogin);
        Auth._timerFallbackLogin = null;
    },

    iniciarObserver: () => {
        // Orçamento generoso: se o primeiro estado de auth não chegar dentro
        // dele na página do app, assumimos ausência de sessão (uma sessão real
        // seria restaurada rapidamente do storage local) e vamos ao login em
        // vez de deixar o usuário preso na tela de demora.
        Auth._observerDisparou = false;
        Auth._timerFallbackLogin = Auth._agendar(() => {
            if (Auth._observerDisparou) return;
            if (Utils.rotaDe(window.location.pathname) !== 'app') return;
            Auth._redirecionar('auth.html');
        }, 12000);

        try {
            return auth.onAuthStateChanged(
                (user) => {
                    Auth._registrarPrimeiroEstado();
                    Auth._processarEstado(user).catch(() => {
                        Auth._falharBootstrap('inicializacao');
                    });
                },
                (err) => {
                    Auth._registrarPrimeiroEstado();
                    PlannerAuthErrors.registrarErroAuth(err, 'autenticacao');
                    Auth._falharBootstrap('autenticacao');
                }
            );
        } catch (err) {
            PlannerAuthErrors.registrarErroAuth(err, 'autenticacao');
            Auth._falharBootstrap('autenticacao');
            return null;
        }
    },

    _processarEstado: async (user) => {
        const rota      = Utils.rotaDe(window.location.pathname);
        const isApp     = rota === 'app';
        const isAuth    = rota === 'auth';
        const isLanding = rota === 'landing';

        if (!user) {
            if (isApp) Auth._redirecionar('auth.html');
            return;
        }

        Estado.usuarioUid   = user.uid;
        Estado.usuarioEmail = user.email;

        if (isAuth || isLanding) {
            Auth._redirecionar('app.html');
            return;
        }
        if (!isApp) return;

        Estado.usuarioNome = user.displayName || null;
        // A restauração de dados tem contrato próprio. O fallback de 6 s
        // continua decidindo o casalId sem herdar o tempo gasto por SDK/Auth.
        Auth._iniciarFase('dados-compartilhados', 6500);
        try {
            Estado.casalId = await Auth._comTimeout(Auth.resolverCasalId(user), 6000);
        } catch (err) {
            // O app continua offline-first sem registrar código, mensagem,
            // caminho de documento ou qualquer payload bruto do Firestore.
            console.warn('[PlannerDuo firestore]', {
                evento: 'casal-id-fallback',
                erroRecebido: Boolean(err),
            });
            try {
                Estado.casalId = localStorage.getItem('pd-casalId') || user.uid;
            } catch (_) {
                Estado.casalId = user.uid;
            }
        }

        if (!Estado.casalId) Estado.casalId = user.uid;
        try { localStorage.setItem('pd-casalId', Estado.casalId); } catch {}
        // A montagem síncrona também avança a fase, limpando qualquer aviso de
        // demora dos dados antes de tornar o shell visível.
        Auth._iniciarFase('renderizacao', 5000);
        // Qualquer exceção síncrona da montagem do shell sobe para o catch do
        // observer, que troca o loader por uma falha recuperável.
        Auth._entrarNoApp(user);
    },

    _redirecionar: (destino) => {
        if (Auth._navegando) return false;
        Auth._navegando = true;
        // A página atual continua supervisionada até que o navegador realmente
        // a abandone. Se ele permanecer aqui, a fase vira demora acionável.
        Auth._iniciarFase('navegacao', 5000);
        try {
            if (!window.location) throw new Error('navigation-unavailable');
            if (typeof window.location.replace === 'function') {
                window.location.replace(destino);
            } else {
                window.location.href = destino;
            }
            return true;
        } catch (_) {
            Auth._navegando = false;
            Auth._falharBootstrap('inicializacao');
            return false;
        }
    },

    _falharBootstrap: (categoria) => {
        console.warn('[PlannerDuo bootstrap]', {
            evento: 'app-init-failure',
            categoria: ['autenticacao', 'firestore', 'inicializacao'].includes(categoria)
                ? categoria
                : 'inicializacao',
        });
        if (window.PlannerBootstrap) {
            window.PlannerBootstrap.falhar(categoria);
            return;
        }
        // Fallback caso o próprio supervisor local não tenha sido carregado.
        const mensagem = document.getElementById('loader-msg');
        const acoes = document.getElementById('loader-acoes');
        if (mensagem) mensagem.textContent = 'Não foi possível iniciar o PlannerDuo. Verifique sua conexão e tente novamente.';
        if (acoes) {
            acoes.hidden = false;
            acoes.style.display = 'flex';
        }
    },

    // Corrida com cancelamento do timer: resolve/rejeita exatamente como a
    // promessa original e nunca mantém um timeout órfão após a conclusão.
    _comTimeout: (promessa, ms) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        Promise.resolve(promessa).then(
            (valor) => {
                clearTimeout(timer);
                resolve(valor);
            },
            (err) => {
                clearTimeout(timer);
                reject(err);
            }
        );
    }),

    // Entrada local exige uma sessão criada em auth.html. Nenhuma identidade
    // sintética é fabricada: cada conta mantém seu próprio espaço e cache.
    _entrarModoLocal: () => {
        let user = null;
        try { user = window.PlannerLocal.auth.currentUser(); } catch (_) {}
        if (!user) {
            Auth._redirecionar('auth.html');
            return;
        }

        Estado.usuarioUid = user.uid;
        Estado.usuarioEmail = user.email;
        Estado.usuarioNome = user.displayName || null;
        try {
            Estado.casalId = PlannerCore.resolverCasalId(window.PlannerLocal.store, user);
            const dados = window.PlannerLocal.store.getDoc('casais', Estado.casalId) || {};
            Estado.membros = dados.membros || {};
            Estado.nome1 = dados.nome1 || user.displayName || PlannerCore.nomePadrao(user.email);
            Estado.nome2 = Utils.nome2De(dados, Estado.nome1);
            Estado.nomeUsuario = Estado.membros[user.email] || user.displayName || PlannerCore.nomePadrao(user.email);
            localStorage.setItem('pd-casalId', Estado.casalId);
            Auth._entrarNoApp(user);
        } catch (_) {
            Auth._falharBootstrap('inicializacao');
        }
    },

    _entrarNoApp: (user) => {
        // Sidebar: nome + inicial
        const email = typeof user.email === 'string' ? user.email : '';
        const nome = Estado.nomeUsuario || user.displayName || email.split('@')[0] || 'Usuário';
        Estado.nomeUsuario = nome;
        document.getElementById('sidebar-user-name').textContent = nome;
        document.getElementById('sidebar-avatar').textContent    = Utils.inicial(nome);
        const status = document.querySelector('.sidebar-user-status');
        if (status) status.textContent = ehModoLocal() ? 'Dados locais' : 'Online';

        // Atualizar nomes nos selects
        UI.atualizarNomes();

        // Carregar cache local primeiro (offline-first)
        DB.carregarCache();

        // Popular select de mês nas finanças (depende dos dados já carregados)
        Render.popularSelectMes();

        // No backend local o cache já é a fonte de verdade, portanto recorrências
        // podem ser materializadas imediatamente sem risco de snapshot posterior.
        if (ehModoLocal()) Controladores.processarRecorrentes();

        // Popular selects de viagem e histórico de buscas
        Render.popularSelectViagens();
        ServicoBusca.carregarHistorico();

        // Ouvir Firestore em tempo real sem bloquear o modo offline quando a
        // criação do listener falhar de forma síncrona.
        try {
            DB.ouvirNuvem();
        } catch (err) {
            console.warn('[PlannerDuo firestore]', {
                evento: 'listener-nao-iniciado',
                erroRecebido: Boolean(err),
            });
        }

        // Restaurar tema salvo (armazenamento pode estar bloqueado pelo navegador).
        let temaSalvo = null;
        try { temaSalvo = localStorage.getItem('pd-tema'); } catch {}
        if (temaSalvo) {
            document.documentElement.setAttribute('data-theme', temaSalvo);
            const icon = document.getElementById('btn-tema')?.querySelector('i');
            if (icon) icon.className = temaSalvo === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        }

        // O loader só termina depois que toda a montagem síncrona conclui. Se
        // qualquer etapa lançar, o observer mantém o shell oculto e exibe as
        // ações de recuperação do supervisor.
        UI.setupNav();
        Render.tudo();

        const estadoBootstrap = window.PlannerBootstrap
            ? window.PlannerBootstrap.estadoAtual().estado
            : 'pendente';
        if (estadoBootstrap === 'erro') return;
        Auth._esconderLoader();
        if (window.PlannerBootstrap) window.PlannerBootstrap.concluir();
    },

    _esconderLoader: () => {
        const loader = document.getElementById('loader-tela');
        if (loader) {
            loader.classList.add('saindo');
            setTimeout(() => { loader.style.display = 'none'; }, 500);
        }
        const app = document.getElementById('tela-app');
        if (app) app.style.opacity = '1';
    },

    // Resolve o casalId do Usuário autenticado (Decisão D1). Implementação
    // ASSÍNCRONA sobre o Firestore v8 que replica a lógica pura de core.js:
    //   - `casais/{uid}` não existe   -> cria novo Espaço_Casal, casalId = uid;
    //   - tem `casalIdRef` (ponteiro)  -> casalId = casalIdRef;
    //   - caso contrário               -> casalId = uid (espaço próprio).
    // Retorna o identificador sem alterar Estado: se o timeout vencer, a
    // promessa do Firestore pode terminar depois, mas não pode trocar o espaço
    // que já foi escolhido pelo fallback e usado para abrir listeners/escritas.
    // Requirements: 2.1, 2.2, 2.3, 2.6, 6.2
    resolverCasalId: async (user) => {
        const ref  = db.collection('casais').doc(user.uid);
        const snap = await ref.get();
        if (!snap.exists) {
            const nome = user.displayName || PlannerCore.nomePadrao(user.email);
            await ref.set({
                membros: { [user.email]: nome },
                nome1: nome,
                nome2: null,
                viagens: [], financas: [], metas: [], checklist: [],
                criadoEm: new Date().toISOString()
            });
            return user.uid;
        }
        const data = snap.data();
        return data.casalIdRef || user.uid;
    },

    // O listener e os caches pertencem à sessão autenticada. Só os encerramos
    // depois que o Firebase confirmar o sign-out; cada etapa é best effort para
    // que uma falha de limpeza não impeça a navegação após uma saída bem-sucedida.
    _limparSessaoAposLogout: () => {
        try {
            if (Estado.unsubscribe) Estado.unsubscribe();
        } catch {}
        Estado.unsubscribe = null;
        try { localStorage.removeItem(DB.chaveCache()); } catch {}
        try { localStorage.removeItem('pd-casalId'); } catch {}
    },

    _finalizarLogout: (destino) => {
        try {
            Auth._limparSessaoAposLogout();
        } finally {
            window.location.href = destino;
        }
    },

    _finalizarLogoutLocal: (destino) => {
        try {
            if (Estado.unsubscribe) Estado.unsubscribe();
        } catch (_) {}
        Estado.unsubscribe = null;
        Estado.usuarioUid = null;
        Estado.usuarioEmail = null;
        Estado.usuarioNome = null;
        Estado.nomeUsuario = null;
        Estado.casalId = null;
        Estado._localRevision = 0;
        Estado._localFieldRevisions = {};
        Estado.historicoBuscas = [];
        try { localStorage.removeItem('pd-casalId'); } catch (_) {}
        window.location.href = destino;
    },

    _tratarFalhaLogout: (err) => {
        try {
            PlannerAuthErrors.registrarErroAuth(err, 'logout');
        } finally {
            UI.toast(
                'Não foi possível sair',
                'Sua sessão continua ativa. Tente novamente.',
                'erro'
            );
        }
    },

    logout: () => {
        if (!confirm('Deseja encerrar a sessão?')) return;
        if (ehModoLocal()) {
            return window.PlannerLocal.auth.signOut().then(
                () => Auth._finalizarLogoutLocal('auth.html'),
                () => UI.toast('Não foi possível sair', 'Sua sessão local continua ativa. Tente novamente.', 'erro')
            );
        }
        return auth.signOut().then(
            () => Auth._finalizarLogout('auth.html'),
            Auth._tratarFalhaLogout
        );
    },

    // Sai do sistema pela logo e retorna à landing page pública (index.html)
    sairParaLanding: () => {
        if (!confirm('Deseja mesmo sair do PlannerDuo?')) return;
        if (ehModoLocal()) {
            return window.PlannerLocal.auth.signOut().then(
                () => Auth._finalizarLogoutLocal('index.html'),
                () => UI.toast('Não foi possível sair', 'Sua sessão local continua ativa. Tente novamente.', 'erro')
            );
        }
        return auth.signOut().then(
            () => Auth._finalizarLogout('index.html'),
            Auth._tratarFalhaLogout
        );
    }
};

// ============================================================
// BANCO DE DADOS (FIRESTORE)
// ============================================================
const DB = {
    // Chave de Cache_Local derivada do casalId atual (Req 2.6, 7.1).
    chaveCache: () => PlannerCore.chaveCache(Estado.casalId),

    // ── Saneamento na fronteira de entrada ───────────────────
    // Toda a renderização assume `valor` numérico, `data` no formato
    // YYYY-MM-DD e `resp` textual. Registros legados (ou gravados por
    // versões antigas do app) podem violar isso e produzir NaN nos
    // totais ou TypeError nos filtros. Em vez de espalhar guards por
    // dezenas de reduces, normalizamos uma única vez ao carregar.
    _num: (v) => {
        const n = typeof v === 'number' ? v : Utils.parseValor(v);
        return isNaN(n) ? 0 : n;
    },

    _dataValida: (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? d : '',

    _resp: (r) => {
        const s = String(r == null ? '' : r).trim();
        return (s === '' || s === 'null' || s === 'undefined') ? Utils.nomesCasal().p1 : s;
    },

    normalizar: (dados) => {
        const d = dados || {};
        return {
            // Só entram finanças com data utilizável — sem isso o select de
            // meses, os filtros e os gráficos por período quebram.
            financas: (Array.isArray(d.financas) ? d.financas : [])
                .filter(f => f && DB._dataValida(f.data))
                .map(f => ({
                    ...f,
                    id: f.id || Utils.id(),
                    tipo: f.tipo === 'receita' ? 'receita' : 'despesa',
                    resp: DB._resp(f.resp),
                    desc: String(f.desc == null ? '' : f.desc),
                    valor: DB._num(f.valor),
                    data: DB._dataValida(f.data),
                    cat: f.cat || Utils.inferirCat(String(f.desc || ''))
                })),
            viagens: (Array.isArray(d.viagens) ? d.viagens : [])
                .filter(v => v)
                .map(v => ({
                    ...v,
                    id: v.id || Utils.id(),
                    destino: String(v.destino == null ? '' : v.destino),
                    ida: DB._dataValida(v.ida),
                    volta: DB._dataValida(v.volta),
                    orcamento: DB._num(v.orcamento),
                    guardado: DB._num(v.guardado)
                })),
            metas: (Array.isArray(d.metas) ? d.metas : [])
                .filter(m => m)
                .map(m => ({
                    ...m,
                    id: m.id || Utils.id(),
                    titulo: String(m.titulo == null ? '' : m.titulo),
                    alvo: DB._num(m.alvo),
                    atual: DB._num(m.atual),
                    prazo: DB._dataValida(m.prazo)
                })),
            checklist: (Array.isArray(d.checklist) ? d.checklist : [])
                .filter(c => c)
                .map(c => ({
                    ...c,
                    id: c.id || Utils.id(),
                    texto: String(c.texto == null ? '' : c.texto),
                    cat: c.cat || 'outros',
                    feito: !!c.feito
                })),
            orcamentos: Object.entries(d.orcamentos || {})
                .reduce((acc, [cat, v]) => {
                    const n = DB._num(v);
                    if (n > 0) acc[cat] = n;
                    return acc;
                }, {})
        };
    },

    _aplicar: (dados) => {
        const n = DB.normalizar(dados);
        Estado.financas   = n.financas;
        Estado.viagens    = n.viagens;
        Estado.metas      = n.metas;
        Estado.checklist  = n.checklist;
        Estado.orcamentos = n.orcamentos;
    },

    _revisionDe: (dados) => {
        const revisao = Number(dados && dados._revision);
        return Number.isInteger(revisao) && revisao >= 0 ? revisao : 0;
    },

    _fieldRevisionsDe: (dados) => {
        const origem = dados && dados._fieldRevisions;
        if (!origem || typeof origem !== 'object' || Array.isArray(origem)) return {};
        return Object.entries(origem).reduce((acc, [campo, valor]) => {
            const revisao = Number(valor);
            if (Number.isInteger(revisao) && revisao >= 0) acc[campo] = revisao;
            return acc;
        }, {});
    },

    _aplicarDocumentoLocal: (dados) => {
        Estado.membros = dados.membros && typeof dados.membros === 'object' ? dados.membros : {};
        if (dados.nome1) Estado.nome1 = dados.nome1;
        const nome2 = Utils.nome2De(dados, Estado.nome1);
        if (nome2) Estado.nome2 = nome2;
        if (Estado.usuarioEmail && Estado.membros[Estado.usuarioEmail]) {
            Estado.nomeUsuario = Estado.membros[Estado.usuarioEmail];
            const elNome = document.getElementById('sidebar-user-name');
            const elAv = document.getElementById('sidebar-avatar');
            if (elNome) elNome.textContent = Estado.nomeUsuario;
            if (elAv) elAv.textContent = Utils.inicial(Estado.nomeUsuario);
        }
        DB._aplicar(dados);
        Estado._localRevision = DB._revisionDe(dados);
        Estado._localFieldRevisions = DB._fieldRevisionsDe(dados);
    },

    _renderizarAtualizacaoLocal: () => {
        UI.atualizarNomes();
        Render.popularSelectMes();
        Render.popularSelectViagens();
        Render.tudo();
    },

    carregarCache: () => {
        try {
            const raw = localStorage.getItem(DB.chaveCache());
            if (!raw) return;
            const dados = JSON.parse(raw);
            DB._aplicarDocumentoLocal(dados);
        } catch {}
    },

    ouvirNuvem: () => {
        if (Estado.unsubscribe) Estado.unsubscribe();
        Estado.unsubscribe = null;

        if (ehModoLocal()) {
            const chaveObservada = DB.chaveCache();
            const receber = (evento) => {
                if (!evento || evento.key !== chaveObservada || !evento.newValue) return;
                let dados;
                try { dados = JSON.parse(evento.newValue); } catch (_) { return; }
                if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return;
                if (DB._revisionDe(dados) <= Estado._localRevision) return;
                DB._aplicarDocumentoLocal(dados);
                DB._renderizarAtualizacaoLocal();
            };
            window.addEventListener('storage', receber);
            Estado.unsubscribe = () => window.removeEventListener('storage', receber);
            return;
        }
        Estado.primeiroSnapshot = false;
        Estado.unsubscribe = db.collection('casais').doc(Estado.casalId)
            .onSnapshot((doc) => {
                if (!doc.exists) {
                    // Documento ainda não propagou — segue com o cache local.
                    return;
                }
                const dados = doc.data();
                Estado.membros = dados.membros && typeof dados.membros === 'object' ? dados.membros : {};
                if (dados.nome1) {
                    Estado.nome1 = dados.nome1;
                    // Atualiza nome do usuário logado pelo campo membros
                    if (dados.membros && dados.membros[Estado.usuarioEmail]) {
                        Estado.nomeUsuario = dados.membros[Estado.usuarioEmail];
                        const elNome = document.getElementById('sidebar-user-name');
                        const elAv   = document.getElementById('sidebar-avatar');
                        if (elNome) elNome.textContent = Estado.nomeUsuario;
                        if (elAv)   elAv.textContent   = Utils.inicial(Estado.nomeUsuario);
                    }
                }
                // Só sobrescreve quando há um nome utilizável: atribuir null
                // apagaria um nome já conhecido de um snapshot anterior.
                const nome2Nuvem = Utils.nome2De(dados, Estado.nome1);
                if (nome2Nuvem) Estado.nome2 = nome2Nuvem;
                UI.atualizarNomes();

                // Substitui o estado pelos dados da nuvem, já saneados.
                DB._aplicar(dados);
                try { localStorage.setItem(DB.chaveCache(), JSON.stringify(dados)); } catch {}

                // Recorrentes só são processadas DEPOIS do primeiro snapshot:
                // rodar antes disso opera sobre cache possivelmente vazio e as
                // cópias geradas seriam sobrescritas por este mesmo snapshot.
                if (!Estado.primeiroSnapshot) {
                    Estado.primeiroSnapshot = true;
                    Controladores.processarRecorrentes();
                }

                Render.popularSelectMes();
                Render.tudo();
            }, (err) => {
                console.warn('[PlannerDuo firestore]', {
                    evento: 'snapshot-indisponivel',
                    erroRecebido: Boolean(err),
                });
                // Não trava o app — continua com dados do cache
            });
    },

    _camposPersistiveis: ['financas', 'viagens', 'metas', 'checklist', 'orcamentos', 'nome1', 'nome2', 'membros'],

    _salvarLocal: (campos) => {
        const solicitados = [...new Set(campos)].filter(campo => DB._camposPersistiveis.includes(campo));
        if (!solicitados.length) return true;
        try {
            const atual = window.PlannerLocal.store.getDoc('casais', Estado.casalId);
            if (!atual || typeof atual !== 'object') throw new Error('Documento local ausente');

            const revisaoAtual = DB._revisionDe(atual);
            const revisoesAtuais = DB._fieldRevisionsDe(atual);
            const temMapaRevisoes = atual._fieldRevisions && typeof atual._fieldRevisions === 'object'
                && !Array.isArray(atual._fieldRevisions);
            const revisoesObservadas = Estado._localFieldRevisions || {};
            const conflito = solicitados.some((campo) => {
                const revisaoCampoAtual = Object.prototype.hasOwnProperty.call(revisoesAtuais, campo)
                    ? revisoesAtuais[campo]
                    : (!temMapaRevisoes && revisaoAtual > Estado._localRevision ? revisaoAtual : 0);
                return revisaoCampoAtual > (Number(revisoesObservadas[campo]) || 0);
            });

            if (conflito) {
                DB._aplicarDocumentoLocal(atual);
                DB._renderizarAtualizacaoLocal();
                UI.toast('Dados atualizados em outra aba. Repita sua alteração.', '', 'aviso');
                return false;
            }

            const novaRevisao = Math.max(revisaoAtual, Estado._localRevision) + 1;
            const payload = {};
            solicitados.forEach((campo) => { payload[campo] = Estado[campo]; });
            payload._revision = novaRevisao;
            payload._updatedAt = new Date().toISOString();
            payload._fieldRevisions = { ...revisoesAtuais };
            solicitados.forEach((campo) => { payload._fieldRevisions[campo] = novaRevisao; });

            window.PlannerLocal.store.updateDoc('casais', Estado.casalId, payload);
            const incorporado = { ...atual, ...payload };
            const haviaAtualizacaoExterna = revisaoAtual > Estado._localRevision;
            DB._aplicarDocumentoLocal(incorporado);
            if (haviaAtualizacaoExterna) DB._renderizarAtualizacaoLocal();
            return true;
        } catch (_) {
            UI.toast('Erro ao salvar', 'Não foi possível persistir os dados neste navegador.', 'erro');
            return false;
        }
    },

    salvar: async (campo) => {
        if (ehModoLocal()) return DB._salvarLocal([campo]);
        try {
            await db.collection('casais').doc(Estado.casalId)
                .set({ [campo]: Estado[campo] }, { merge: true });
        } catch (err) {
            UI.toast('Erro ao salvar', 'Não foi possível sincronizar os dados. Tente novamente.', 'erro');
        }
    },

    salvarVarios: async (campos) => {
        if (ehModoLocal()) return DB._salvarLocal(campos);
        const payload = {};
        campos.forEach(c => payload[c] = Estado[c]);
        try {
            await db.collection('casais').doc(Estado.casalId).set(payload, { merge: true });
        } catch (err) {
            UI.toast('Erro ao salvar', 'Não foi possível sincronizar os dados. Tente novamente.', 'erro');
        }
    }
};

// ============================================================
// CONVITES — ingresso de parceiro(a) no Espaço_Casal
// ============================================================
// Reutiliza a geração/validação pura de core.js, mas com I/O assíncrono
// no Firestore v8 (as funções puras são síncronas e não podem ser usadas
// diretamente aqui).
const Convites = {
    // Gera um convite para o Espaço_Casal atual, grava convites/{codigo}
    // com validade de 72h e exibe o código no modal. Requirements: 4.1, 4.2, 4.3
    criar: async () => {
        const agora = Date.now();
        let codigo;
        try {
            if (ehModoLocal()) {
                codigo = PlannerCore.criarConvite(
                    window.PlannerLocal.store,
                    Estado.casalId,
                    Estado.usuarioEmail,
                    agora
                );
            } else {
                codigo = PlannerCore.gerarCodigo();
                await db.collection('convites').doc(codigo).set({
                    casalId: Estado.casalId,
                    criadoPor: Estado.usuarioEmail,
                    criadoEm: new Date(agora).toISOString(),
                    expiraEm: new Date(agora + 72 * 60 * 60 * 1000).toISOString()
                });
            }
        } catch (_) {
            UI.toast('Erro ao gerar convite', 'Não foi possível salvar o convite.', 'erro');
            return null;
        }
        const campo = document.getElementById('convite-codigo-gerado');
        if (campo) campo.textContent = codigo;
        const validade = document.getElementById('convite-validade');
        if (validade) validade.textContent = 'Válido até ' + Utils.data(
            new Date(agora + 72 * 60 * 60 * 1000).toISOString().slice(0, 10)
        );
        UI.toast('Convite gerado!', 'Compartilhe o código com seu parceiro(a).', 'sucesso');
        return codigo;
    },

    // Valida e processa o aceite de um convite (ordem de curto-circuito:
    // invalido -> expirou -> cheio -> ja_membro -> sucesso). Requirements: 4.4-4.9
    aceitar: async (codigo) => {
        const user = ehModoLocal() ? window.PlannerLocal.auth.currentUser() : auth.currentUser;
        if (!user) return;
        const cod = (codigo || '').trim().toUpperCase();
        const mensagens = {
            invalido:  'Código inválido',
            expirou:   'Código expirou',
            cheio:     'Espaço do casal está cheio',
            ja_membro: 'Você já é membro',
            ja_vinculado: 'Você já participa de um espaço compartilhado.'
        };

        if (ehModoLocal()) {
            try {
                const agora = Date.now();
                const convite = window.PlannerLocal.store.getDoc('convites', cod);
                const conviteValido = convite && new Date(convite.expiraEm).getTime() >= agora;
                if (conviteValido && !window.PlannerLocal.store.canJoinSpace(user, convite.casalId)) {
                    UI.toast(mensagens.ja_vinculado, '', 'aviso');
                    return;
                }
                const resultado = PlannerCore.aceitarConvite(window.PlannerLocal.store, cod, user, agora);
                if (!resultado.ok) {
                    UI.toast(mensagens[resultado.erro] || 'Código inválido', '', resultado.erro === 'ja_membro' ? 'aviso' : 'erro');
                    return;
                }
                Estado.casalId = resultado.casalId;
                localStorage.setItem('pd-casalId', Estado.casalId);
                const dados = window.PlannerLocal.store.getDoc('casais', Estado.casalId) || {};
                DB._aplicarDocumentoLocal(dados);
                UI.atualizarNomes();
                Render.popularSelectMes();
                Render.popularSelectViagens();
                ServicoBusca.carregarHistorico();
                DB.ouvirNuvem();
                Render.tudo();
                UI.fecharModal('modal-convite-aceitar');
                UI.toast('Bem-vindo(a) ao espaço!', 'Vocês agora compartilham os dados locais.', 'sucesso');
            } catch (_) {
                UI.toast('Erro ao aceitar convite', 'Não foi possível processar o convite local.', 'erro');
            }
            return;
        }
        try {
            // 1. Existência.
            const conviteSnap = await db.collection('convites').doc(cod).get();
            if (!conviteSnap.exists) {
                UI.toast(mensagens.invalido, '', 'erro');
                return;
            }
            const convite = conviteSnap.data();

            // 2. Expiração.
            if (new Date(convite.expiraEm).getTime() < Date.now()) {
                UI.toast(mensagens.expirou, '', 'erro');
                return;
            }

            // 3. Lotação do Espaço_Casal (máx. 2 membros).
            const espacoSnap = await db.collection('casais').doc(convite.casalId).get();
            const espaco  = espacoSnap.exists ? espacoSnap.data() : {};
            const membros = espaco.membros || {};
            if (Object.keys(membros).length >= 2) {
                UI.toast(mensagens.cheio, '', 'erro');
                return;
            }

            // 4. Já é membro.
            if (membros[user.email]) {
                UI.toast(mensagens.ja_membro, '', 'aviso');
                return;
            }

            // 5. Sucesso: registra o membro no espaço e grava o ponteiro.
            const nome = user.displayName || PlannerCore.nomePadrao(user.email);
            const membrosAtualizado = Object.assign({}, membros, { [user.email]: nome });
            await db.collection('casais').doc(convite.casalId)
                .set({ membros: membrosAtualizado }, { merge: true });
            await db.collection('casais').doc(user.uid)
                .set({ casalIdRef: convite.casalId });

            // Re-resolve o casalId e recarrega os dados do novo espaço.
            Estado.casalId = convite.casalId;
            localStorage.setItem('pd-casalId', Estado.casalId);
            UI.fecharModal('modal-convite-aceitar');
            UI.toast('Bem-vindo(a) ao espaço!', 'Vocês agora compartilham os dados.', 'sucesso');
            DB.carregarCache();
            DB.ouvirNuvem();
        } catch (err) {
            UI.toast('Erro ao aceitar convite', 'Não foi possível processar o convite. Tente novamente.', 'erro');
        }
    },

    abrirGerar: () => {
        const campo = document.getElementById('convite-codigo-gerado');
        if (campo) campo.textContent = '—';
        const validade = document.getElementById('convite-validade');
        if (validade) validade.textContent = '';
        UI.abrirModal('modal-convite-gerar');
    },

    abrirAceitar: () => {
        const input = document.getElementById('convite-codigo-input');
        if (input) input.value = '';
        UI.abrirModal('modal-convite-aceitar');
    }
};

// ============================================================
// CONTROLADORES — CRUD
// ============================================================
const Controladores = {

    // ── Finanças ────────────────────────────────────────────
    adicionarFinanca: () => {
        const tipo  = document.getElementById('fin-tipo').value;
        const resp  = Utils.respDeValor(document.getElementById('fin-resp').value);
        const desc  = document.getElementById('fin-desc').value.trim();
        const valor = Utils.parseValor(document.getElementById('fin-valor').value);
        const data  = document.getElementById('fin-data').value;
        const cat   = document.getElementById('fin-categoria').value || Utils.inferirCat(desc);
        const obs   = document.getElementById('fin-obs')?.value.trim() || '';
        const viagemId   = document.getElementById('fin-viagem')?.value || '';
        let   recorrente = document.getElementById('fin-recorrente')?.value || '';
        const parcelas   = parseInt(document.getElementById('fin-parcelas')?.value) || 1;

        if (!desc || !data || isNaN(valor) || valor <= 0) return UI.toast('Preencha os campos corretamente', '', 'aviso');

        // Parcelamento e recorrência não se combinam: prioriza o parcelamento.
        if (parcelas > 1 && recorrente === 'mensal') {
            UI.toast('Parcelamento e recorrência não se combinam', 'Registrando apenas como parcelado.', 'aviso');
            recorrente = '';
        }

        // ── Parcelamento: divide o valor em N parcelas mensais ──
        if (parcelas > 1) {
            const grupoId    = Utils.id();
            const valorParc  = Math.round((valor / parcelas) * 100) / 100;
            const [ay, am, ad] = data.split('-').map(Number);
            for (let i = 0; i < parcelas; i++) {
                const d = new Date(ay, (am - 1) + i, ad);
                const dataParc = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                Estado.financas.push({
                    id: Utils.id(), tipo, resp,
                    desc: `${desc} (${i+1}/${parcelas})`,
                    valor: valorParc, data: dataParc, cat, obs,
                    viagemId, recorrente: '', geradaDe: '',
                    parcela: { atual: i+1, total: parcelas, grupoId }
                });
            }
            DB.salvar('financas');
            UI.fecharModal('modal-financa');
            UI.toast('Compra parcelada registrada!', `${Utils.catInfo(cat).emoji} ${desc} — ${parcelas}x de ${Utils.moeda(valorParc)}`);
            Render.financas();
            Render.dashboard();
            return;
        }

        Estado.financas.push({ id: Utils.id(), tipo, resp, desc, valor, data, cat, obs, viagemId, recorrente, parcela: null, geradaDe: '' });
        DB.salvar('financas');
        UI.fecharModal('modal-financa');
        UI.toast('Transação registrada!', `${Utils.catInfo(cat).emoji} ${desc} — ${Utils.moeda(valor)}`);
        Render.financas();
        Render.dashboard();
    },

    // ── Despesas recorrentes: gera cópias no mês atual ───────
    // Para cada despesa recorrente mensal cujo mês de referência já
    // passou, cria automaticamente uma cópia no mês atual (evitando
    // duplicar via campo geradaDe).
    processarRecorrentes: () => {
        const hoje    = new Date();
        const mesAtual = hoje.getMonth(), anoAtual = hoje.getFullYear();
        const originais = Estado.financas.filter(f =>
            f.recorrente === 'mensal' && !f.geradaDe
        );
        let criou = false;
        originais.forEach(orig => {
            const dOrig = new Date(orig.data + 'T12:00:00');
            // Só processa se a recorrente original é de um mês anterior
            const mesRefOrig = dOrig.getFullYear() * 12 + dOrig.getMonth();
            const mesRefAtual = anoAtual * 12 + mesAtual;
            if (mesRefOrig >= mesRefAtual) return;

            // Já existe cópia deste original no mês atual?
            const existe = Estado.financas.some(f => {
                if (f.geradaDe !== orig.id) return false;
                const d = new Date(f.data + 'T12:00:00');
                return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
            });
            if (existe) return;

            // Cria a cópia no mês atual, preservando o dia da recorrente.
            const dia = Math.min(dOrig.getDate(), new Date(anoAtual, mesAtual + 1, 0).getDate());
            const dataNova = `${anoAtual}-${String(mesAtual+1).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
            Estado.financas.push({
                id: Utils.id(),
                tipo: orig.tipo, resp: orig.resp, desc: orig.desc,
                valor: orig.valor, data: dataNova, cat: orig.cat, obs: orig.obs || '',
                viagemId: orig.viagemId || '', recorrente: 'mensal',
                parcela: null, geradaDe: orig.id
            });
            criou = true;
        });
        if (criou) {
            DB.salvar('financas');
            UI.toast('Despesas recorrentes lançadas', 'Copiadas para o mês atual.', 'info');
        }
    },

    editarFinanca: (id) => {
        const f = Estado.financas.find(f => f.id === id);
        if (!f) return;
        document.getElementById('edit-fin-id').value          = f.id;
        document.getElementById('edit-fin-tipo').value        = f.tipo;
        document.getElementById('edit-fin-resp').value        = Utils.valorDeResp(f.resp);
        document.getElementById('edit-fin-desc').value        = f.desc;
        document.getElementById('edit-fin-valor').value       = f.valor;
        document.getElementById('edit-fin-data').value        = f.data;
        document.getElementById('edit-fin-categoria').value   = f.cat || 'outros';
        const selViagem = document.getElementById('edit-fin-viagem');
        if (selViagem) selViagem.value = f.viagemId || '';
        UI.abrirModal('modal-editar-financa');
    },

    salvarEdicaoFinanca: () => {
        const id  = document.getElementById('edit-fin-id').value;
        const idx = Estado.financas.findIndex(f => f.id === id);
        if (idx === -1) return;

        const desc  = document.getElementById('edit-fin-desc').value.trim();
        const valor = Utils.parseValor(document.getElementById('edit-fin-valor').value);
        const data  = document.getElementById('edit-fin-data').value;

        // Mesma validação da criação: o modal não usa submit real, então
        // os atributos min/required do HTML não são aplicados.
        if (!desc || !data || isNaN(valor) || valor <= 0) {
            return UI.toast('Preencha os campos corretamente', '', 'aviso');
        }

        Estado.financas[idx] = {
            ...Estado.financas[idx],
            tipo:  document.getElementById('edit-fin-tipo').value,
            resp:  Utils.respDeValor(document.getElementById('edit-fin-resp').value),
            desc, valor, data,
            cat:   document.getElementById('edit-fin-categoria').value,
            viagemId: document.getElementById('edit-fin-viagem')?.value || '',
        };
        DB.salvar('financas');
        UI.fecharModal('modal-editar-financa');
        UI.toast('Transação atualizada!', '', 'sucesso');
        Render.financas();
        Render.dashboard();
    },

    // ── Viagens ─────────────────────────────────────────────
    adicionarViagem: () => {
        const destino  = document.getElementById('v-destino').value.trim();
        const emoji    = document.getElementById('v-emoji').value.trim() || '✈️';
        const ida      = document.getElementById('v-ida').value;
        const volta    = document.getElementById('v-volta').value;
        const orcamento= Utils.parseValor(document.getElementById('v-orcamento').value) || 0;
        const tipo     = document.getElementById('v-tipo').value;
        const link     = document.getElementById('v-link').value.trim();
        const notas    = document.getElementById('v-notas').value.trim();

        if (!destino || !ida || !volta) return UI.toast('Preencha destino e datas', '', 'aviso');

        Estado.viagens.push({ id: Utils.id(), destino, emoji, ida, volta, orcamento, tipo, link, notas, gastos: 0, guardado: 0 });
        DB.salvar('viagens');
        UI.fecharModal('modal-viagem');
        UI.toast('Viagem salva!', `${emoji} ${destino}`, 'sucesso');
        Render.viagens();
        Render.popularSelectViagens();
    },

    // ── Cofrinho de viagem (economia) ────────────────────────
    abrirCofrinhoViagem: (id) => {
        const v = Estado.viagens.find(v => v.id === id);
        if (!v) return;
        document.getElementById('cofrinho-viagem-id').value = id;
        document.getElementById('cofrinho-viagem-nome').textContent = `${v.emoji || '✈️'} ${v.destino}`;
        document.getElementById('cofrinho-valor').value = '';
        UI.abrirModal('modal-viagem-cofrinho');
    },

    guardarViagem: () => {
        const id    = document.getElementById('cofrinho-viagem-id').value;
        const valor = Utils.parseValor(document.getElementById('cofrinho-valor').value);
        if (isNaN(valor) || valor <= 0) return UI.toast('Informe um valor válido', '', 'aviso');
        const idx = Estado.viagens.findIndex(v => v.id === id);
        if (idx === -1) return;
        Estado.viagens[idx].guardado = (Estado.viagens[idx].guardado || 0) + valor;
        const v = Estado.viagens[idx];
        if (v.orcamento > 0 && v.guardado >= v.orcamento) {
            UI.toast('🎉 Orçamento alcançado!', `${v.destino} — já dá pra viajar!`, 'sucesso');
        } else {
            UI.toast('Guardado para a viagem!', `+${Utils.moeda(valor)} — ${v.destino}`, 'sucesso');
        }
        DB.salvar('viagens');
        UI.fecharModal('modal-viagem-cofrinho');
        Render.viagens();
        Render.dashboard();
    },

    abrirDetalheViagem: (id) => {
        const v = Estado.viagens.find(v => v.id === id);
        if (!v) return;
        document.getElementById('detalhe-titulo').textContent = `${v.emoji || '✈️'} ${v.destino}`;
        document.getElementById('detalhe-datas').textContent  = `${Utils.data(v.ida)} → ${Utils.data(v.volta)}`;

        // Despesas vinculadas a ESTA viagem (via viagemId)
        const despesasViagem = Estado.financas
            .filter(f => f.tipo === 'despesa' && f.viagemId === v.id)
            .sort((a, b) => new Date(b.data) - new Date(a.data));
        const gastoReal = Utils.gastosDaViagem(v.id);
        const saldoRestante = (v.orcamento || 0) - gastoReal;
        const guardado = v.guardado || 0;

        const pct     = v.orcamento > 0 ? Math.round(gastoReal / v.orcamento * 100) : 0;
        const pctBar  = Math.min(100, pct);
        const acima   = v.orcamento > 0 && gastoReal > v.orcamento;
        const barGasto = acima ? 'var(--grad-warm)' : 'var(--grad-brand)';
        const pctGuard = v.orcamento > 0 ? Math.min(100, Math.round(guardado / v.orcamento * 100)) : 0;

        const listaDespesas = despesasViagem.length
            ? despesasViagem.map(f => `
                <div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:.85rem">
                    <span style="color:var(--text-muted);white-space:nowrap">${Utils.data(f.data)}</span>
                    <span style="flex:1">${Utils.esc(f.desc)}</span>
                    <strong style="color:var(--brand-rose)">${Utils.moeda(f.valor)}</strong>
                </div>`).join('')
            : `<div style="font-size:.85rem;color:var(--text-muted);padding:8px 0">Nenhuma despesa vinculada ainda.</div>`;

        document.getElementById('modal-viagem-detalhe-body').innerHTML = `
            <div class="form-group">
                <div class="form-row">
                    <div>
                        <div class="form-label">Tipo</div>
                        <span class="badge badge-viagem">${Utils.esc(v.tipo || '—')}</span>
                    </div>
                    <div>
                        <div class="form-label">Orçamento</div>
                        <strong style="color:var(--brand-emerald)">${Utils.moeda(v.orcamento)}</strong>
                    </div>
                </div>
            </div>
            <div class="form-group">
                <div class="form-label">Gasto real ${acima ? '<span style="color:var(--brand-rose)">— Acima do orçamento!</span>' : ''}</div>
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
                    <strong style="color:${acima ? 'var(--brand-rose)' : 'var(--text-primary)'}">${Utils.moeda(gastoReal)} de ${Utils.moeda(v.orcamento)} (${pct}%)</strong>
                    <span style="font-size:.8rem;color:${saldoRestante >= 0 ? 'var(--brand-emerald)' : 'var(--brand-rose)'}">Saldo: ${Utils.moeda(saldoRestante)}</span>
                </div>
                <div class="progress-wrap"><div class="progress-bar" style="width:${pctBar}%;background:${barGasto}"></div></div>
            </div>
            <div class="form-group">
                <div class="form-label">🐷 Economizado</div>
                <div style="margin-bottom:6px"><strong>${Utils.moeda(guardado)} de ${Utils.moeda(v.orcamento)} (${pctGuard}%)</strong></div>
                <div class="progress-wrap"><div class="progress-bar" style="width:${pctGuard}%;background:var(--grad-success)"></div></div>
                <button class="btn btn-success btn-sm" style="margin-top:10px" onclick="Controladores.abrirCofrinhoViagem('${v.id}')"><i class="fa-solid fa-piggy-bank"></i> Guardar</button>
            </div>
            <div class="form-group">
                <div class="form-label">Despesas vinculadas</div>
                <div style="background:var(--surface-alt);padding:12px 14px;border-radius:var(--r-lg);border:1px solid var(--border)">${listaDespesas}</div>
            </div>
            ${Utils.urlSegura(v.link) ? `<div class="form-group"><a href="${Utils.esc(Utils.urlSegura(v.link))}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm"><i class="fa-solid fa-arrow-up-right-from-square"></i> Acessar Reserva</a></div>` : ''}
            ${v.notas ? `<div class="form-group"><div class="form-label">Notas / Roteiro</div><div style="background:var(--surface-alt);padding:14px;border-radius:var(--r-lg);font-size:.875rem;white-space:pre-wrap;border:1px solid var(--border)">${Utils.esc(v.notas)}</div></div>` : ''}
            <div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end">
                <button class="btn btn-danger btn-sm" onclick="Controladores.deletar('viagens','${v.id}');UI.fecharModal('modal-viagem-detalhe')">
                    <i class="fa-solid fa-trash"></i> Excluir
                </button>
            </div>`;
        UI.abrirModal('modal-viagem-detalhe');
    },

    // ── Metas ───────────────────────────────────────────────
    adicionarMeta: () => {
        const titulo = document.getElementById('meta-titulo').value.trim();
        const emoji  = document.getElementById('meta-emoji').value.trim() || '🎯';
        const cat    = document.getElementById('meta-cat').value;
        const alvo   = Utils.parseValor(document.getElementById('meta-alvo').value);
        const atual  = Utils.parseValor(document.getElementById('meta-atual').value) || 0;
        const prazo  = document.getElementById('meta-prazo').value;
        const desc   = document.getElementById('meta-desc')?.value.trim() || '';

        if (!titulo || isNaN(alvo) || alvo <= 0) return UI.toast('Preencha título e valor alvo', '', 'aviso');

        Estado.metas.push({ id: Utils.id(), titulo, emoji, cat, alvo, atual, prazo, desc });
        DB.salvar('metas');
        UI.fecharModal('modal-meta');
        UI.toast('Meta criada!', `${emoji} ${titulo} — Alvo: ${Utils.moeda(alvo)}`, 'sucesso');
        Render.metas();
        Render.dashboard();
    },

    depositarMeta: () => {
        const id    = document.getElementById('deposito-meta-id').value;
        const valor = Utils.parseValor(document.getElementById('deposito-valor').value);
        if (isNaN(valor) || valor <= 0) return UI.toast('Informe um valor válido', '', 'aviso');

        const idx = Estado.metas.findIndex(m => m.id === id);
        if (idx === -1) return;
        Estado.metas[idx].atual = (Estado.metas[idx].atual || 0) + valor;
        if (Estado.metas[idx].atual >= Estado.metas[idx].alvo) {
            UI.toast('🎉 Meta concluída!', `${Estado.metas[idx].titulo} — Parabéns!`, 'sucesso');
        } else {
            UI.toast('Guardado no cofrinho!', `+${Utils.moeda(valor)}`, 'sucesso');
        }
        DB.salvar('metas');
        UI.fecharModal('modal-meta-deposito');
        Render.metas();
        Render.dashboard();
    },

    abrirDeposito: (id) => {
        const m = Estado.metas.find(m => m.id === id);
        if (!m) return;
        document.getElementById('deposito-meta-id').value    = id;
        document.getElementById('deposito-meta-nome').textContent = `${m.emoji} ${m.titulo}`;
        document.getElementById('deposito-valor').value = '';
        UI.abrirModal('modal-meta-deposito');
    },

    // ── Depósito inline rápido (a partir do card de meta) ────
    _depositoInline: (id) => {
        const val = Utils.parseValor(document.getElementById(`dep-inline-${id}`)?.value);
        if (isNaN(val) || val <= 0) return UI.toast('Informe um valor', '', 'aviso');
        document.getElementById('deposito-meta-id').value = id;
        document.getElementById('deposito-valor').value   = val;
        Controladores.depositarMeta();
    },

    // ── Deletar genérico ─────────────────────────────────────
    deletar: (colecao, id) => {
        if (!confirm('Excluir permanentemente?')) return;
        Estado[colecao] = Estado[colecao].filter(i => i.id !== id);
        DB.salvar(colecao);
        Render.tudo();
        Render.popularSelectViagens();
        UI.toast('Item excluído.', '', 'info');
    }
};

// ============================================================
// ORÇAMENTOS MENSAIS POR CATEGORIA
// ============================================================
const Orcamentos = {
    // Define (ou remove, se valor<=0) o limite mensal de uma categoria.
    definir: (cat, valor) => {
        cat = cat || document.getElementById('orc-categoria')?.value;
        valor = (valor !== undefined) ? valor : Utils.parseValor(document.getElementById('orc-valor')?.value);
        if (!cat) return UI.toast('Selecione uma categoria', '', 'aviso');
        if (isNaN(valor) || valor <= 0) {
            delete Estado.orcamentos[cat];
            UI.toast('Limite removido', Utils.catInfo(cat).label, 'info');
        } else {
            Estado.orcamentos[cat] = valor;
            UI.toast('Limite definido!', `${Utils.catInfo(cat).label} — ${Utils.moeda(valor)}/mês`, 'sucesso');
        }
        DB.salvar('orcamentos');
        UI.fecharModal('modal-orcamento');
        Render.orcamentos();
    },

    remover: (cat) => {
        delete Estado.orcamentos[cat];
        DB.salvar('orcamentos');
        Render.orcamentos();
        UI.toast('Limite removido', '', 'info');
    }
};

// ============================================================
// BUSCA DE VIAGENS
// ============================================================
const ServicoBusca = {
    // ── Histórico de buscas ──────────────────────────────────
    _chaveHistorico: () => `pd-buscas:${Estado.casalId || 'sem-casal'}`,

    carregarHistorico: () => {
        try {
            let raw = localStorage.getItem(ServicoBusca._chaveHistorico());
            // Migração simples do histórico global legado para o espaço atual.
            if (!raw) {
                raw = localStorage.getItem('pd-buscas');
                if (raw) {
                    localStorage.setItem(ServicoBusca._chaveHistorico(), raw);
                    localStorage.removeItem('pd-buscas');
                }
            }
            Estado.historicoBuscas = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(Estado.historicoBuscas)) Estado.historicoBuscas = [];
        } catch { Estado.historicoBuscas = []; }
        ServicoBusca.renderHistorico();
    },

    _salvarHistorico: () => {
        try { localStorage.setItem(ServicoBusca._chaveHistorico(), JSON.stringify(Estado.historicoBuscas)); } catch {}
    },

    registrarBusca: (busca) => {
        if (!busca || !busca.destino) return;
        // Evita duplicar entradas idênticas consecutivas de destino
        Estado.historicoBuscas = Estado.historicoBuscas.filter(b =>
            !(b.destino === busca.destino && b.origem === busca.origem && b.dataIda === busca.dataIda)
        );
        Estado.historicoBuscas.unshift(busca);
        if (Estado.historicoBuscas.length > 8) Estado.historicoBuscas = Estado.historicoBuscas.slice(0, 8);
        ServicoBusca._salvarHistorico();
        ServicoBusca.renderHistorico();
    },

    limparHistorico: () => {
        Estado.historicoBuscas = [];
        ServicoBusca._salvarHistorico();
        ServicoBusca.renderHistorico();
    },

    aplicarHistorico: (i) => {
        const b = Estado.historicoBuscas[i];
        if (!b) return;
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        set('busca-origem', b.origem);
        set('busca-destino', b.destino);
        set('busca-data-ida', b.dataIda);
        set('busca-data-volta', b.dataVolta);
    },

    renderHistorico: () => {
        const el = document.getElementById('busca-historico');
        if (!el) return;
        if (!Estado.historicoBuscas.length) { el.innerHTML = ''; return; }
        const chips = Estado.historicoBuscas.map((b, i) => {
            const origem  = Utils.esc(b.origem || '');
            const destino = Utils.esc(b.destino || '');
            return `<button type="button" class="badge badge-viagem" style="cursor:pointer;border:none" onclick="ServicoBusca.aplicarHistorico(${i})" title="${origem} → ${destino}">${origem ? origem + ' → ' : ''}${destino}</button>`;
        }).join('');
        el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px">
            <span style="font-size:.78rem;color:rgba(255,255,255,.6)">Buscas recentes:</span>
            ${chips}
            <button type="button" class="btn btn-ghost btn-sm" style="padding:4px 8px;font-size:.72rem" onclick="ServicoBusca.limparHistorico()"><i class="fa-solid fa-trash"></i> Limpar</button>
        </div>`;
    },

    redirecionar: (plataforma) => {
        const origem    = document.getElementById('busca-origem').value.trim();
        const destino   = document.getElementById('busca-destino').value.trim();
        const dataIda   = document.getElementById('busca-data-ida').value;
        const dataVolta = document.getElementById('busca-data-volta').value;
        const pax       = document.getElementById('busca-passageiros').value;

        if (!destino) return UI.toast('Informe o destino', '', 'aviso');

        const oE = encodeURIComponent(origem);
        const dE = encodeURIComponent(destino);
        const oS = Utils.slug(origem);
        const dS = Utils.slug(destino);
        const oIATA = Utils.iata(origem);
        const dIATA = Utils.iata(destino);
        let url  = '';

        // Converte YYYY-MM-DD → DD-MM-YYYY (para plataformas que exigem)
        const toddmmyyyy = (s) => { if (!s) return ''; const [a,m,d] = s.split('-'); return `${d}-${m}-${a}`; };

        // Registra a busca no histórico
        ServicoBusca.registrarBusca({ origem, destino, dataIda, dataVolta, quando: new Date().toISOString() });

        switch (plataforma) {

            /* ── Voos ────────────────────────────────────────────────
               Google Flights: motor completo, usa IATA quando disponível.
               Azul / GOL: homepage (sem deep-link público estável).
               LATAM: parâmetros na URL, IATA quando disponível. ────── */

            case 'googleflights':
                if (oIATA && dIATA) {
                    url = `https://www.google.com/travel/flights?q=Flights%20to%20${dIATA}%20from%20${oIATA}${dataIda ? '%20on%20' + dataIda : ''}`;
                } else {
                    url = `https://www.google.com/travel/flights/search?q=voos+de+${oE}+para+${dE}`;
                }
                break;

            case 'azul':
                // Abre a Azul diretamente — sem deep-link público por cidade
                url = `https://www.voeazul.com.br`;
                break;

            case 'gol':
                // Abre a GOL diretamente — sem deep-link público por cidade
                url = `https://www.voegol.com.br`;
                break;

            case 'latam':
                if (oIATA && dIATA) {
                    url = `https://www.latamairlines.com/br/pt/oferta-voos`
                        + `?origin=${oIATA}&destination=${dIATA}`
                        + `&outbound=${dataIda || ''}&inbound=${dataVolta || ''}`
                        + `&adt=${pax}&chd=0&inf=0&trip=RT&cabin=Y&redemption=false`;
                } else {
                    url = `https://www.latamairlines.com/br/pt/oferta-voos`
                        + `?origin=${oE}&destination=${dE}`
                        + `&outbound=${dataIda || ''}&inbound=${dataVolta || ''}`
                        + `&adt=${pax}&chd=0&inf=0&trip=RT&cabin=Y&redemption=false`;
                }
                break;

            case 'kayak':
                if (oIATA && dIATA) {
                    url = `https://www.kayak.com.br/flights/${oIATA}-${dIATA}/${dataIda || ''}${dataVolta ? '/' + dataVolta : ''}`;
                } else {
                    url = `https://www.kayak.com.br/flights?destination=${dE}`;
                }
                break;

            case 'skyscanner': {
                // Skyscanner usa datas YYMMDD no path (não YYYY-MM-DD)
                const toYYMMDD = (s) => { if(!s) return ''; const [a,m,d]=s.split('-'); return a.slice(2)+m+d; };
                if (oIATA && dIATA) {
                    url = `https://www.skyscanner.com.br/transport/flights/${oIATA}/${dIATA}/${toYYMMDD(dataIda)}/${dataVolta ? toYYMMDD(dataVolta) + '/' : ''}`;
                } else {
                    url = `https://www.skyscanner.com.br/transporte/voos-para/${dS}/`;
                }
                break;
            }

            /* ── Hospedagem ──────────────────────────────────────────
               Airbnb e Booking: motor completo com destino + datas. ── */

            case 'airbnb':
                url = `https://www.airbnb.com.br/s/${dE}/homes?adults=${pax}`;
                if (dataIda)   url += `&checkin=${dataIda}`;
                if (dataVolta) url += `&checkout=${dataVolta}`;
                break;

            case 'booking':
                url = `https://www.booking.com/searchresults.pt-br.html?ss=${dE}&group_adults=${pax}`;
                if (dataIda)   url += `&checkin=${dataIda}`;
                if (dataVolta) url += `&checkout=${dataVolta}`;
                break;

            /* ── Ônibus ──────────────────────────────────────────────
               Buser: rota via slug, data YYYY-MM-DD.
               ClickBus: rota via slug, data DD-MM-YYYY. ──────────── */

            case 'buser':
                url = `https://www.buser.com.br/onibus/${oS}/${dS}`;
                if (dataIda) url += `?data=${dataIda}`;
                break;

            case 'clickbus':
                url = `https://www.clickbus.com.br/passagem-de-onibus/${oS}/${dS}`;
                if (dataIda) url += `?departureDate=${toddmmyyyy(dataIda)}`;
                if (dataVolta) url += `&returnDate=${toddmmyyyy(dataVolta)}`;
                break;

            /* ── Descoberta ──────────────────────────────────────────
               Maps e TripAdvisor: busca por nome do destino. ─────── */

            case 'maps':
                url = `https://www.google.com/maps/search/${dE}`;
                break;

            case 'tripadvisor':
                url = `https://www.tripadvisor.com.br/Search?q=${dE}`;
                break;
        }
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
    }
};

// ============================================================
// CHECKLIST
// ============================================================
const TEMPLATES = {
    praia: [
        { texto:'Passaporte / RG',      cat:'documentos' },
        { texto:'Passagens',             cat:'documentos' },
        { texto:'Reserva do hotel',      cat:'documentos' },
        { texto:'Protetor solar',        cat:'higiene' },
        { texto:'Óculos de sol',         cat:'outros' },
        { texto:'Biquíni / Sunga',       cat:'roupas' },
        { texto:'Toalha de praia',       cat:'roupas' },
        { texto:'Chinelo',               cat:'roupas' },
        { texto:'Câmera / carregador',   cat:'tecnologia' },
        { texto:'Repelente',             cat:'saude' },
    ],
    internacional: [
        { texto:'Passaporte válido',        cat:'documentos' },
        { texto:'Visto (se necessário)',     cat:'documentos' },
        { texto:'Seguro viagem',             cat:'documentos' },
        { texto:'Cartão de crédito internacional', cat:'documentos' },
        { texto:'Adaptador de tomada',       cat:'tecnologia' },
        { texto:'Celular desbloqueado',      cat:'tecnologia' },
        { texto:'Carregadores',              cat:'tecnologia' },
        { texto:'Remédios essenciais',       cat:'saude' },
        { texto:'Roupas para o frio/calor',  cat:'roupas' },
        { texto:'Mala pesada ≤ 23kg',        cat:'outros' },
    ],
    mochilao: [
        { texto:'Mochila 40-60L',            cat:'outros' },
        { texto:'Documentos + cópias',       cat:'documentos' },
        { texto:'Roupas leves e versáteis',  cat:'roupas' },
        { texto:'Kit primeiros socorros',    cat:'saude' },
        { texto:'Canivete / faca (no bagageiro)', cat:'outros' },
        { texto:'Cabo universal',            cat:'tecnologia' },
        { texto:'Powerbank',                 cat:'tecnologia' },
        { texto:'Cadeado p/ mochila',        cat:'outros' },
        { texto:'Sandália de borracha',      cat:'roupas' },
        { texto:'Saco de dormir leve',       cat:'outros' },
    ],
    cruzeiro: [
        { texto:'Passaporte',                cat:'documentos' },
        { texto:'Voucher do cruzeiro',       cat:'documentos' },
        { texto:'Cartão do plano de saúde',  cat:'documentos' },
        { texto:'Roupas formais (jantar)',    cat:'roupas' },
        { texto:'Fantasia (festa temática)',  cat:'roupas' },
        { texto:'Protetor solar SPF 50+',    cat:'higiene' },
        { texto:'Remédio para enjoo',        cat:'saude' },
        { texto:'Câmera à prova d`água',     cat:'tecnologia' },
        { texto:'Óculos de sol',             cat:'outros' },
        { texto:'Dinheiro em espécie',       cat:'documentos' },
    ]
};

const Checklist = {
    adicionar: () => {
        const texto = document.getElementById('check-item-texto').value.trim();
        const cat   = document.getElementById('check-item-cat').value;
        if (!texto) return UI.toast('Digite o item', '', 'aviso');
        Estado.checklist.push({ id: Utils.id(), texto, cat, feito: false });
        DB.salvar('checklist');
        UI.fecharModal('modal-checklist-item');
        UI.toast('Item adicionado!', '', 'sucesso');
        Render.checklist();
    },

    toggle: (id) => {
        const idx = Estado.checklist.findIndex(c => c.id === id);
        if (idx === -1) return;
        Estado.checklist[idx].feito = !Estado.checklist[idx].feito;
        DB.salvar('checklist');
        Render.checklist();
    },

    remover: (id) => {
        Estado.checklist = Estado.checklist.filter(c => c.id !== id);
        DB.salvar('checklist');
        Render.checklist();
    },

    marcarTodos: () => {
        Estado.checklist.forEach(c => c.feito = true);
        DB.salvar('checklist');
        Render.checklist();
    },

    desmarcarTodos: () => {
        Estado.checklist.forEach(c => c.feito = false);
        DB.salvar('checklist');
        Render.checklist();
    },

    limpar: () => {
        if (!confirm('Limpar todo o checklist?')) return;
        Estado.checklist = [];
        DB.salvar('checklist');
        Render.checklist();
    },

    aplicarTemplate: (nome) => {
        if (!confirm(`Adicionar template "${nome}" ao checklist atual?`)) return;
        const itens = TEMPLATES[nome] || [];
        itens.forEach(i => Estado.checklist.push({ id: Utils.id(), texto: i.texto, cat: i.cat, feito: false }));
        DB.salvar('checklist');
        Render.checklist();
        UI.toast(`Template "${nome}" aplicado!`, `${itens.length} itens adicionados`, 'sucesso');
    }
};

// ============================================================
// EXPORTAÇÃO
// ============================================================
const Exportacao = {
    gerarCSV: () => {
        if (!Estado.financas.length) return UI.toast('Sem dados para exportar', '', 'aviso');
        const cab  = 'Data,Descrição,Responsável,Tipo,Categoria,Valor\n';
        const esc  = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        const rows = Estado.financas
            .sort((a,b) => new Date(b.data) - new Date(a.data))
            .map(f => `${f.data},${esc(f.desc)},${esc(f.resp)},${f.tipo},${f.cat || ''},${f.valor}`)
            .join('\n');
        const blob = new Blob([cab + rows], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `plannerduo_${Date.now()}.csv`;
        a.click();
        UI.toast('CSV exportado!', '', 'sucesso');
    },

    gerarPDF: () => {
        window.print();
    }
};

// ============================================================
// CHARTS
// ============================================================
const _charts = {};
const Charts = {
    // Chart.js é um recurso visual opcional. Todas as rotas de renderização
    // passam por este único ponto para que CDN bloqueada/indisponível não
    // interrompa a montagem do shell nem a renderização textual dos relatórios.
    _criar: (ctx, config) => {
        const ChartCtor = typeof globalThis !== 'undefined' ? globalThis.Chart : null;
        if (!ctx || typeof ChartCtor !== 'function') return null;
        return new ChartCtor(ctx, config);
    },

    destruirTodos: () => {
        Object.keys(_charts).forEach(k => { try { _charts[k].destroy(); delete _charts[k]; } catch {} });
    },

    renderizarTodos: () => {
        Charts.fluxo();
        Charts.categorias();
        Charts.responsavel();
        Charts.catFin();
        Relatorios.atualizar();
    },

    _cores: (n) => {
        const paleta = ['#2563eb','#f97316','#10b981','#f43f5e','#8b5cf6','#f59e0b','#06b6d4','#ec4899','#14b8a6','#a855f7','#22c55e','#94a3b8'];
        return Array.from({ length: n }, (_, i) => paleta[i % paleta.length]);
    },

    _dark: () => document.documentElement.getAttribute('data-theme') === 'dark',

    _gridColor: () => Charts._dark() ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
    _textColor: () => Charts._dark() ? '#94a3b8' : '#64748b',

    _ultimos6Meses: () => {
        const meses = [];
        const hoje  = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
            meses.push({ mes: d.getMonth(), ano: d.getFullYear(), label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }) });
        }
        return meses;
    },

    fluxo: () => {
        const ctx = document.getElementById('chart-fluxo')?.getContext('2d');
        if (!ctx) return;
        if (_charts.fluxo) _charts.fluxo.destroy();

        const meses = Charts._ultimos6Meses();
        const receitas  = meses.map(m => Estado.financas.filter(f => { const d = new Date(f.data+'T12:00:00'); return f.tipo==='receita' && d.getMonth()===m.mes && d.getFullYear()===m.ano; }).reduce((s,f)=>s+f.valor,0));
        const despesas  = meses.map(m => Estado.financas.filter(f => { const d = new Date(f.data+'T12:00:00'); return f.tipo==='despesa' && d.getMonth()===m.mes && d.getFullYear()===m.ano; }).reduce((s,f)=>s+f.valor,0));

        _charts.fluxo = Charts._criar(ctx, {
            type: 'bar',
            data: {
                labels: meses.map(m => m.label),
                datasets: [
                    { label:'Receitas', data: receitas, backgroundColor: 'rgba(16,185,129,.75)', borderRadius: 6, borderSkipped: false },
                    { label:'Despesas', data: despesas, backgroundColor: 'rgba(244,63,94,.75)',  borderRadius: 6, borderSkipped: false }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: Charts._textColor(), font: { size: 11 } } } },
                scales: {
                    x: { grid: { color: Charts._gridColor() }, ticks: { color: Charts._textColor() } },
                    y: { grid: { color: Charts._gridColor() }, ticks: { color: Charts._textColor(), callback: v => 'R$' + (v/1000).toFixed(1)+'k' } }
                }
            }
        });
    },

    categorias: () => {
        const ctx = document.getElementById('chart-categorias')?.getContext('2d');
        if (!ctx) return;
        if (_charts.categorias) _charts.categorias.destroy();

        const agrupado = {};
        Estado.financas.filter(f => f.tipo === 'despesa').forEach(f => {
            const c = f.cat || Utils.inferirCat(f.desc);
            agrupado[c] = (agrupado[c] || 0) + f.valor;
        });
        const labels = Object.keys(agrupado).map(c => Utils.catInfo(c).emoji + ' ' + Utils.catInfo(c).label);
        const data   = Object.values(agrupado);

        _charts.categorias = Charts._criar(ctx, {
            type: 'doughnut',
            data: { labels, datasets: [{ data, backgroundColor: Charts._cores(data.length), borderWidth: 2, borderColor: Charts._dark() ? '#1a2235' : '#fff' }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'right', labels: { color: Charts._textColor(), font: { size: 11 }, padding: 10 } } }
            }
        });
    },

    responsavel: () => {
        const ctx = document.getElementById('chart-responsavel')?.getContext('2d');
        if (!ctx) return;
        if (_charts.responsavel) _charts.responsavel.destroy();

        const mes   = new Date().getMonth();
        const ano   = new Date().getFullYear();
        const { p1: n1, p2: n2 } = Utils.nomesCasal();
        const f1    = Estado.financas.filter(f => { const d=new Date(f.data+'T12:00:00'); return f.tipo==='despesa' && f.resp===n1 && d.getMonth()===mes && d.getFullYear()===ano; }).reduce((s,f)=>s+f.valor,0);
        const f2    = Estado.financas.filter(f => { const d=new Date(f.data+'T12:00:00'); return f.tipo==='despesa' && f.resp===n2 && d.getMonth()===mes && d.getFullYear()===ano; }).reduce((s,f)=>s+f.valor,0);

        _charts.responsavel = Charts._criar(ctx, {
            type: 'bar',
            data: {
                labels: [n1, n2],
                datasets: [{ data: [f1, f2], backgroundColor: ['rgba(37,99,235,.8)', 'rgba(249,115,22,.8)'], borderRadius: 8, borderSkipped: false }]
            },
            options: {
                responsive: true, maintainAspectRatio: false, indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: Charts._gridColor() }, ticks: { color: Charts._textColor(), callback: v => 'R$'+v } },
                    y: { grid: { display: false }, ticks: { color: Charts._textColor(), font: { weight: '600' } } }
                }
            }
        });
    },

    catFin: () => {
        const ctx = document.getElementById('chart-cat-fin')?.getContext('2d');
        if (!ctx) return;
        if (_charts.catFin) _charts.catFin.destroy();

        const mes = new Date().getMonth(), ano = new Date().getFullYear();
        const agrupado = {};
        Estado.financas.filter(f => { const d=new Date(f.data+'T12:00:00'); return f.tipo==='despesa' && d.getMonth()===mes && d.getFullYear()===ano; }).forEach(f => {
            const c = f.cat || Utils.inferirCat(f.desc);
            agrupado[c] = (agrupado[c] || 0) + f.valor;
        });
        const labels = Object.keys(agrupado).map(c => Utils.catInfo(c).emoji + ' ' + Utils.catInfo(c).label);
        const data   = Object.values(agrupado);

        _charts.catFin = Charts._criar(ctx, {
            type: 'doughnut',
            data: { labels, datasets: [{ data, backgroundColor: Charts._cores(data.length), borderWidth: 2, borderColor: Charts._dark() ? '#1a2235' : '#fff' }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'right', labels: { color: Charts._textColor(), font: { size: 11 }, padding: 8 } } }
            }
        });
    }
};

// ============================================================
// RELATÓRIOS
// ============================================================
const Relatorios = {
    atualizar: () => {
        const periodo = parseInt(document.getElementById('rel-periodo')?.value || 6);
        const pessoa  = document.getElementById('rel-pessoa')?.value || 'todos';

        // Gera meses
        const meses = [];
        const hoje  = new Date();
        for (let i = periodo - 1; i >= 0; i--) {
            const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
            meses.push({ mes: d.getMonth(), ano: d.getFullYear(), label: d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }) });
        }

        const { p1: relN1, p2: relN2 } = Utils.nomesCasal();
        const filtrarF = (f) => {
            if (pessoa === 'p1' && f.resp !== relN1) return false;
            if (pessoa === 'p2' && f.resp !== relN2) return false;
            return true;
        };

        // Tabela
        const tbody = document.getElementById('rel-tbody');
        if (tbody) {
            tbody.innerHTML = meses.map(m => {
                const fin = Estado.financas.filter(f => { const d=new Date(f.data+'T12:00:00'); return d.getMonth()===m.mes && d.getFullYear()===m.ano && filtrarF(f); });
                const rec = fin.filter(f=>f.tipo==='receita').reduce((s,f)=>s+f.valor,0);
                const dep = fin.filter(f=>f.tipo==='despesa').reduce((s,f)=>s+f.valor,0);
                const sal = rec - dep;
                const p1  = fin.filter(f=>f.tipo==='despesa'&&f.resp===relN1).reduce((s,f)=>s+f.valor,0);
                const p2  = fin.filter(f=>f.tipo==='despesa'&&f.resp===relN2).reduce((s,f)=>s+f.valor,0);
                return `<tr>
                    <td><strong>${m.label}</strong></td>
                    <td class="text-success fw-600">${Utils.moeda(rec)}</td>
                    <td class="text-danger  fw-600">${Utils.moeda(dep)}</td>
                    <td class="${sal>=0?'text-success':'text-danger'} fw-bold">${Utils.moeda(sal)}</td>
                    <td>${Utils.moeda(p1)}</td>
                    <td>${Utils.moeda(p2)}</td>
                </tr>`;
            }).join('');
        }

        // Gráfico evolução
        const ctxEv = document.getElementById('chart-rel-evolucao')?.getContext('2d');
        if (ctxEv) {
            if (_charts.relEvolucao) _charts.relEvolucao.destroy();
            const deps = meses.map(m => Estado.financas.filter(f=>{ const d=new Date(f.data+'T12:00:00'); return f.tipo==='despesa' && d.getMonth()===m.mes && d.getFullYear()===m.ano && filtrarF(f); }).reduce((s,f)=>s+f.valor,0));
            const recs = meses.map(m => Estado.financas.filter(f=>{ const d=new Date(f.data+'T12:00:00'); return f.tipo==='receita' && d.getMonth()===m.mes && d.getFullYear()===m.ano && filtrarF(f); }).reduce((s,f)=>s+f.valor,0));
            _charts.relEvolucao = Charts._criar(ctxEv, {
                type: 'line',
                data: {
                    labels: meses.map(m=>m.label),
                    datasets: [
                        { label:'Receitas', data:recs, borderColor:'#10b981', backgroundColor:'rgba(16,185,129,.1)', tension:.4, fill:true, pointRadius:4 },
                        { label:'Despesas', data:deps, borderColor:'#f43f5e', backgroundColor:'rgba(244,63,94,.1)',  tension:.4, fill:true, pointRadius:4 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: Charts._textColor(), font:{size:11} } } },
                    scales: {
                        x: { grid:{color:Charts._gridColor()}, ticks:{color:Charts._textColor()} },
                        y: { grid:{color:Charts._gridColor()}, ticks:{color:Charts._textColor(), callback:v=>'R$'+(v/1000).toFixed(1)+'k'} }
                    }
                }
            });
        }

        // Gráfico categorias
        const ctxCat = document.getElementById('chart-rel-categorias')?.getContext('2d');
        if (ctxCat) {
            if (_charts.relCat) _charts.relCat.destroy();
            const agrupado = {};
            Estado.financas.filter(f => {
                const d = new Date(f.data+'T12:00:00');
                const limit = new Date(hoje.getFullYear(), hoje.getMonth() - periodo + 1, 1);
                return f.tipo==='despesa' && d >= limit && filtrarF(f);
            }).forEach(f => {
                const c = f.cat || Utils.inferirCat(f.desc);
                agrupado[c] = (agrupado[c]||0) + f.valor;
            });
            const labels = Object.keys(agrupado).map(c => Utils.catInfo(c).emoji+' '+Utils.catInfo(c).label);
            const data   = Object.values(agrupado);
            _charts.relCat = Charts._criar(ctxCat, {
                type: 'doughnut',
                data: { labels, datasets: [{ data, backgroundColor: Charts._cores(data.length), borderWidth:2, borderColor: Charts._dark()?'#1a2235':'#fff' }] },
                options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right', labels:{ color:Charts._textColor(), font:{size:11}, padding:8 } } } }
            });
        }
    }
};

// ============================================================
// RENDERIZAÇÃO
// ============================================================
const Render = {
    tudo: () => {
        Render.dashboard();
        Render.popularSelectViagens();
        Render.orcamentos();
        // Renderiza a view ativa atual também
        const ativa = document.querySelector('.view.ativa')?.id;
        if (ativa === 'financas')   Render.financas();
        if (ativa === 'viagens')    Render.viagens();
        if (ativa === 'metas')      Render.metas();
        if (ativa === 'checklist')  Render.checklist();
        if (ativa === 'relatorios') Relatorios.atualizar();
    },

    // ── Popula os selects de viagem nos modais de finança ────
    popularSelectViagens: () => {
        const opts = '<option value="">Nenhuma</option>' +
            Estado.viagens.map(v => `<option value="${Utils.esc(v.id)}">${Utils.esc(v.emoji || '✈️')} ${Utils.esc(v.destino)}</option>`).join('');
        ['fin-viagem', 'edit-fin-viagem'].forEach(id => {
            const sel = document.getElementById(id);
            if (!sel) return;
            const atual = sel.value;
            sel.innerHTML = opts;
            // Preserva a seleção se a viagem ainda existir
            if (atual && Estado.viagens.some(v => v.id === atual)) sel.value = atual;
        });
    },

    // ── Orçamentos mensais por categoria ─────────────────────
    orcamentos: () => {
        const cont = document.getElementById('orcamentos-container');
        if (!cont) return;
        const cats = Object.keys(Estado.orcamentos || {});
        if (!cats.length) {
            cont.innerHTML = `<div class="empty-state" style="padding:20px">
                <div class="empty-state-icon">🎯</div>
                <h3>Nenhum limite definido</h3>
                <p>Defina limites mensais por categoria para acompanhar seus gastos.</p>
            </div>`;
            return;
        }

        const mes = new Date().getMonth(), ano = new Date().getFullYear();
        cont.innerHTML = cats.map(cat => {
            const limite = Estado.orcamentos[cat];
            const gasto = Estado.financas.filter(f => {
                const d = new Date(f.data + 'T12:00:00');
                return f.tipo === 'despesa' && (f.cat || Utils.inferirCat(f.desc)) === cat
                    && d.getMonth() === mes && d.getFullYear() === ano;
            }).reduce((s, f) => s + f.valor, 0);
            const pct    = limite > 0 ? Math.round(gasto / limite * 100) : 0;
            const pctBar = Math.min(100, pct);
            const ci     = Utils.catInfo(cat);
            let cor;
            if (pct >= 100)     cor = 'var(--grad-warm)';
            else if (pct >= 70) cor = 'linear-gradient(90deg,#f59e0b,#f97316)';
            else                cor = 'var(--grad-success)';
            const estourado = pct > 100;
            return `<div class="card" style="padding:16px;margin-bottom:12px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <strong>${ci.emoji} ${ci.label}</strong>
                    <div style="display:flex;gap:8px;align-items:center">
                        <span style="font-size:.85rem;color:${estourado ? 'var(--brand-rose)' : 'var(--text-muted)'}">${Utils.moeda(gasto)} / ${Utils.moeda(limite)} (${pct}%)</span>
                        <button class="btn-icon danger" style="width:26px;height:26px;font-size:.72rem" onclick="Orcamentos.remover('${cat}')" title="Remover limite"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                </div>
                <div class="progress-wrap"><div class="progress-bar" style="width:${pctBar}%;background:${cor}"></div></div>
                ${estourado ? `<div style="font-size:.78rem;color:var(--brand-rose);margin-top:6px"><i class="fa-solid fa-triangle-exclamation"></i> Orçamento de ${ci.label} estourado!</div>` : ''}
            </div>`;
        }).join('');
    },

    dashboard: () => {
        const hoje  = new Date(); hoje.setHours(0,0,0,0);
        const mes   = hoje.getMonth(), ano = hoje.getFullYear();

        // Próxima viagem
        const futuras = Estado.viagens
            .filter(v => new Date(v.ida+'T12:00:00') >= hoje)
            .sort((a,b) => new Date(a.ida) - new Date(b.ida));
        const prox = futuras[0];
        const elViagem = document.getElementById('stat-proxima-viagem');
        const elDelta  = document.getElementById('stat-proxima-delta');
        if (elViagem) elViagem.textContent = prox ? `${prox.emoji||'✈️'} ${prox.destino}` : '—';
        if (elDelta)  {
            if (prox) {
                const dias = Utils.diasAte(prox.ida);
                if (dias === null) {
                    elDelta.textContent = '—';
                    elDelta.className = 'stat-delta neu';
                } else {
                    elDelta.textContent = dias > 0 ? `Faltam ${dias} dias` : dias === 0 ? 'Hoje!' : 'Em andamento';
                    elDelta.className = 'stat-delta ' + (dias <= 7 ? 'up' : 'neu');
                }
            } else {
                elDelta.textContent = 'nenhuma planejada';
                elDelta.className = 'stat-delta neu';
            }
        }

        // Finanças do mês
        const finMes = Estado.financas.filter(f => {
            const d = new Date(f.data+'T12:00:00');
            return d.getMonth()===mes && d.getFullYear()===ano;
        });
        const rec = finMes.filter(f=>f.tipo==='receita').reduce((s,f)=>s+f.valor,0);
        const dep = finMes.filter(f=>f.tipo==='despesa').reduce((s,f)=>s+f.valor,0);
        const sal = rec - dep;

        const set = (id, txt) => { const e=document.getElementById(id); if(e) e.textContent=txt; };
        set('stat-despesas', Utils.moeda(dep));
        set('stat-receitas', Utils.moeda(rec));
        set('stat-saldo',    Utils.moeda(sal));

        const elSaldoDelta = document.getElementById('stat-saldo-delta');
        if (elSaldoDelta) {
            elSaldoDelta.textContent = sal >= 0 ? 'Saldo positivo ✓' : 'Saldo negativo';
            elSaldoDelta.className   = 'stat-delta ' + (sal >= 0 ? 'up' : 'down');
        }

        // Projeção do mês
        const diaAtual   = new Date().getDate();
        const diasNoMes  = new Date(ano, mes+1, 0).getDate();
        const projecao   = diaAtual > 0 ? (dep / diaAtual) * diasNoMes : 0;
        const elDep = document.getElementById('stat-despesas');
        if (elDep) elDep.setAttribute('data-tip', `Projeção p/ fim do mês: ${Utils.moeda(projecao)}`);

        const elDepDelta = document.getElementById('stat-despesas-delta');
        if (elDepDelta) { elDepDelta.textContent = `Projeção: ${Utils.moeda(projecao)}`; elDepDelta.className = 'stat-delta down'; }

        // Metas ativas
        const metasAtivas = Estado.metas.filter(m => m.atual < m.alvo).length;
        set('stat-metas', metasAtivas);
        const elMetaDelta = document.getElementById('stat-metas-delta');
        if (elMetaDelta) { elMetaDelta.textContent = `${Estado.metas.filter(m=>m.atual>=m.alvo).length} concluídas`; elMetaDelta.className='stat-delta neu'; }

        // Acerto de contas
        const { p1: nome1, p2: nome2 } = Utils.nomesCasal();
        const p1total = Estado.financas.filter(f=>f.tipo==='despesa'&&f.resp===nome1).reduce((s,f)=>s+f.valor,0);
        const p2total = Estado.financas.filter(f=>f.tipo==='despesa'&&f.resp===nome2).reduce((s,f)=>s+f.valor,0);
        const dif     = Math.abs(p1total - p2total) / 2;
        const elAcerto = document.getElementById('stat-acerto');
        const elAcertoDelta = document.getElementById('stat-acerto-delta');
        if (elAcerto) {
            if (dif < 0.01) {
                elAcerto.textContent = 'Quite! ✓';
                if (elAcertoDelta) { elAcertoDelta.textContent = 'Tudo equilibrado'; elAcertoDelta.className='stat-delta up'; }
            } else if (p1total > p2total) {
                elAcerto.textContent = `${nome2} deve ${Utils.moeda(dif)}`;
                if (elAcertoDelta) { elAcertoDelta.textContent = `a ${nome1}`; elAcertoDelta.className='stat-delta down'; }
            } else {
                elAcerto.textContent = `${nome1} deve ${Utils.moeda(dif)}`;
                if (elAcertoDelta) { elAcertoDelta.textContent = `a ${nome2}`; elAcertoDelta.className='stat-delta down'; }
            }
        }

        // Split visual
        const totalGlobal = p1total + p2total;
        set('split-valor1', Utils.moeda(p1total));
        set('split-valor2', Utils.moeda(p2total));
        set('split-pct1', totalGlobal > 0 ? Math.round(p1total/totalGlobal*100)+'% do total' : '0%');
        set('split-pct2', totalGlobal > 0 ? Math.round(p2total/totalGlobal*100)+'% do total' : '0%');
        const elSplit = document.getElementById('split-resultado');
        if (elSplit) {
            if (dif < 0.01) { elSplit.textContent = '✓ Tudo quite entre vocês!'; elSplit.className='split-result quite'; }
            else if (p1total > p2total) { elSplit.textContent = `${nome2} deve pagar ${Utils.moeda(dif)} para ${nome1}`; elSplit.className='split-result deve'; }
            else { elSplit.textContent = `${nome1} deve pagar ${Utils.moeda(dif)} para ${nome2}`; elSplit.className='split-result deve'; }
        }

        // Preview viagens no dashboard
        Render.dashViagensPreview();

        // Welcome banner
        const elWelcome = document.getElementById('welcome-msg');
        if (elWelcome && Estado.nomeUsuario) {
            const hr = new Date().getHours();
            const saudacao = hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite';
            elWelcome.textContent = `${saudacao}, ${Estado.nomeUsuario}! 👋`;
        }

        // Atualiza gráficos do dashboard
        Charts.fluxo();
        Charts.categorias();

        // Panorama unificado do casal
        Render.panorama();
    },

    panorama: () => {
        const el = document.getElementById('panorama-container');
        if (!el) return;

        const hoje = new Date(); hoje.setHours(0,0,0,0);
        const mes  = hoje.getMonth(), ano = hoje.getFullYear();

        const tituloMini = 'font-size:.72rem;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px';
        const valorGrande = "font-family:'Poppins',sans-serif;font-weight:700;font-size:1.6rem;line-height:1.1";
        const miniCard = 'border:1px solid var(--border);border-radius:var(--r-lg);padding:16px;background:var(--surface-alt)';

        // (a) SAÚDE FINANCEIRA — saldo do mês atual
        const finMes = Estado.financas.filter(f => {
            const d = new Date(f.data+'T12:00:00');
            return d.getMonth()===mes && d.getFullYear()===ano;
        });
        const rec = finMes.filter(f=>f.tipo==='receita').reduce((s,f)=>s+f.valor,0);
        const dep = finMes.filter(f=>f.tipo==='despesa').reduce((s,f)=>s+f.valor,0);
        const saldo = rec - dep;
        const medidor = saldo > 0 ? 'Saudável 💚' : saldo === 0 ? 'Equilibrado 💛' : 'Atenção ❤️‍🩹';
        const corSaldo = saldo > 0 ? 'var(--brand-emerald)' : saldo === 0 ? 'var(--brand-amber, #f59e0b)' : 'var(--brand-rose)';
        const pctDesp = rec > 0 ? Math.round(dep / rec * 100) : 0;
        const pctBar  = rec > 0 ? Math.min(100, pctDesp) : 0;
        const barCor  = pctDesp > 100 ? 'var(--grad-warm)' : 'var(--grad-brand)';

        const blocoSaude = `
            <div style="${miniCard}">
                <div style="${tituloMini}">Saúde Financeira</div>
                <div style="${valorGrande};color:${corSaldo}">${medidor}</div>
                <div style="font-size:.85rem;color:var(--text-muted);margin:8px 0 4px">
                    Saldo do mês: <strong style="color:${corSaldo}">${Utils.moeda(saldo)}</strong>
                </div>
                <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:8px">
                    ${rec > 0 ? `Despesas: ${pctDesp}% das receitas` : 'Sem receitas este mês'}
                </div>
                <div class="progress-wrap"><div class="progress-bar" style="width:${pctBar}%;background:${barCor}"></div></div>
            </div>`;

        // (b) PRÓXIMA VIAGEM — a futura mais próxima
        const futuras = Estado.viagens
            .filter(v => new Date(v.ida+'T12:00:00') >= hoje)
            .sort((a,b) => new Date(a.ida) - new Date(b.ida));
        const prox = futuras[0];

        let blocoViagem;
        if (prox) {
            const dias = Utils.diasAte(prox.ida);
            const diasTxt = dias === null ? '—' : dias > 0 ? `Faltam ${dias} dias` : dias === 0 ? 'É hoje! 🎉' : 'Em andamento';
            const guardado = prox.guardado || 0;
            const orc = prox.orcamento || 0;
            const pctCofre = orc > 0 ? Math.min(100, Math.round(guardado / orc * 100)) : 0;
            blocoViagem = `
                <div style="${miniCard}">
                    <div style="${tituloMini}">Próxima Viagem</div>
                    <div style="${valorGrande}">${Utils.esc(prox.emoji||'✈️')} ${Utils.esc(prox.destino)}</div>
                    <div style="font-size:.85rem;color:var(--text-muted);margin:8px 0 4px">${diasTxt}</div>
                    <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:8px">
                        🐷 ${Utils.moeda(guardado)}${orc > 0 ? ` de ${Utils.moeda(orc)} (${pctCofre}%)` : ''}
                    </div>
                    <div class="progress-wrap"><div class="progress-bar" style="width:${pctCofre}%;background:var(--grad-success)"></div></div>
                </div>`;
        } else {
            blocoViagem = `
                <div style="${miniCard}">
                    <div style="${tituloMini}">Próxima Viagem</div>
                    <div style="${valorGrande};color:var(--text-muted)">Nenhuma viagem planejada</div>
                    <button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="navegarPara('viagens')"><i class="fa-solid fa-plus"></i> Planejar</button>
                </div>`;
        }

        // (c) ECONOMIA TOTAL — metas + cofrinhos de viagem
        const totalMetas   = Estado.metas.reduce((s,m) => s + (m.atual || 0), 0);
        const totalCofrinhos = Estado.viagens.reduce((s,v) => s + (v.guardado || 0), 0);
        const economiaTotal = totalMetas + totalCofrinhos;
        const metasAtivas   = Estado.metas.filter(m => (m.atual || 0) < (m.alvo || 0)).length;
        const viagensComCofre = Estado.viagens.filter(v => (v.guardado || 0) > 0).length;

        const blocoEconomia = `
            <div style="${miniCard}">
                <div style="${tituloMini}">Economia Total</div>
                <div style="${valorGrande};color:var(--brand-emerald)">${Utils.moeda(economiaTotal)}</div>
                <div style="font-size:.82rem;color:var(--text-muted);margin-top:10px;display:flex;flex-direction:column;gap:4px">
                    <span><span class="badge badge-viagem">${metasAtivas}</span> ${metasAtivas === 1 ? 'meta ativa' : 'metas ativas'}</span>
                    <span><span class="badge badge-success">${viagensComCofre}</span> ${viagensComCofre === 1 ? 'viagem com cofrinho' : 'viagens com cofrinho'}</span>
                </div>
            </div>`;

        el.innerHTML = blocoSaude + blocoViagem + blocoEconomia;
    },

    dashViagensPreview: () => {
        const el = document.getElementById('dash-viagens-preview');
        if (!el) return;
        const hoje = new Date(); hoje.setHours(0,0,0,0);
        const proximas = Estado.viagens
            .filter(v => new Date(v.volta+'T12:00:00') >= hoje)
            .sort((a,b) => new Date(a.ida) - new Date(b.ida))
            .slice(0, 3);

        if (!proximas.length) {
            el.innerHTML = `<div class="empty-state" style="padding:24px">
                <div class="empty-state-icon">🗺️</div>
                <h3>Nenhuma viagem planejada</h3>
                <p>Planeje sua próxima aventura!</p>
            </div>`;
            return;
        }

        el.innerHTML = proximas.map(v => {
            const dias = Utils.diasAte(v.ida);
            const semData = dias === null;
            const statusTxt = semData ? '—' : dias > 0 ? `Faltam ${dias} dias` : dias === 0 ? 'Hoje!' : 'Em andamento';
            const badgeCls = semData ? 'badge-viagem' : dias <= 0 ? 'badge-success' : dias <= 30 ? 'badge-alerta' : 'badge-viagem';
            return `<div style="display:flex;align-items:center;gap:16px;padding:12px 0;border-bottom:1px solid var(--border)">
                <div style="width:42px;height:42px;border-radius:12px;background:var(--grad-cool);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">${Utils.esc(v.emoji||'✈️')}</div>
                <div style="flex:1">
                    <div style="font-weight:700">${Utils.esc(v.destino)}</div>
                    <div style="font-size:.78rem;color:var(--text-muted)">${Utils.data(v.ida)} → ${Utils.data(v.volta)}</div>
                </div>
                <span class="badge ${badgeCls}">${statusTxt}</span>
            </div>`;
        }).join('');
    },

    financas: () => {
        const tbody = document.getElementById('tbody-financas');
        if (!tbody) return;

        // Filtro ativo
        const filtroAtivo = document.querySelector('.filter-tab.ativo')?.dataset.filtro || 'todos';
        const busca       = (document.getElementById('fin-busca')?.value || '').toLowerCase();
        const mesFiltro   = document.getElementById('fin-mes')?.value || '';

        let lista = [...Estado.financas].sort((a,b) => new Date(b.data) - new Date(a.data));

        if (filtroAtivo !== 'todos') {
            if (filtroAtivo === 'despesa' || filtroAtivo === 'receita') {
                lista = lista.filter(f => f.tipo === filtroAtivo);
            } else {
                lista = lista.filter(f => (f.cat || Utils.inferirCat(f.desc)) === filtroAtivo);
            }
        }
        if (busca)     lista = lista.filter(f => (f.desc||'').toLowerCase().includes(busca) || (f.resp||'').toLowerCase().includes(busca));
        if (mesFiltro) lista = lista.filter(f => f.data && f.data.startsWith(mesFiltro));

        // Totais do mês vigente (independente do filtro)
        const mes = new Date().getMonth(), ano = new Date().getFullYear();
        const finMes = Estado.financas.filter(f => { const d=new Date(f.data+'T12:00:00'); return d.getMonth()===mes && d.getFullYear()===ano; });
        const totalRec = finMes.filter(f=>f.tipo==='receita').reduce((s,f)=>s+f.valor,0);
        const totalDep = finMes.filter(f=>f.tipo==='despesa').reduce((s,f)=>s+f.valor,0);
        const saldo    = totalRec - totalDep;

        const set = (id,txt,extra='') => { const e=document.getElementById(id); if(e){e.textContent=txt; if(extra) e.className=extra;} };
        set('fin-total-receitas', Utils.moeda(totalRec));
        set('fin-total-despesas', Utils.moeda(totalDep));
        set('fin-saldo', Utils.moeda(saldo), 'balance-value ' + (saldo >= 0 ? 'saldo' : 'negativo'));

        if (!lista.length) {
            tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-state-icon">💳</div><h3>Sem resultados</h3></div></td></tr>`;
            Charts.responsavel(); Charts.catFin();
            return;
        }

        tbody.innerHTML = lista.map(f => {
            const cat = f.cat || Utils.inferirCat(f.desc);
            const ci  = Utils.catInfo(cat);
            const badgeRec  = f.recorrente === 'mensal' ? ' <span class="badge badge-viagem" style="font-size:.65rem">🔁 Mensal</span>' : '';
            const badgeParc = f.parcela ? ` <span class="badge badge-alerta" style="font-size:.65rem">💳 ${f.parcela.atual}/${f.parcela.total}</span>` : '';
            return `<tr>
                <td style="white-space:nowrap">${Utils.data(f.data)}</td>
                <td><strong>${Utils.esc(f.desc)}</strong>${badgeRec}${badgeParc}</td>
                <td><span class="cat-pill">${ci.emoji} ${ci.label}</span></td>
                <td>${Utils.esc(f.resp)}</td>
                <td><span class="badge ${f.tipo==='receita'?'badge-receita':'badge-despesa'}">${f.tipo==='receita'?'Receita':'Despesa'}</span></td>
                <td><strong style="color:${f.tipo==='receita'?'var(--brand-emerald)':'var(--brand-rose)'}">${f.tipo==='receita'?'+':'-'} ${Utils.moeda(f.valor)}</strong></td>
                <td class="td-actions">
                    <div class="btn-group">
                        <button class="btn-icon" onclick="Controladores.editarFinanca('${f.id}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
                        <button class="btn-icon danger" onclick="Controladores.deletar('financas','${f.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        Charts.responsavel();
        Charts.catFin();
    },

    popularSelectMes: () => {
        const sel = document.getElementById('fin-mes');
        if (!sel) return;
        const meses = new Set(Estado.financas.filter(f => f.data).map(f => f.data.slice(0,7)));
        sel.innerHTML = '<option value="">Todos os meses</option>';
        [...meses].sort().reverse().forEach(m => {
            const [a, mo] = m.split('-');
            const label = new Date(parseInt(a), parseInt(mo)-1, 1).toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
            sel.innerHTML += `<option value="${m}">${label}</option>`;
        });
    },

    viagens: () => {
        const grid = document.getElementById('trip-grid');
        if (!grid) return;

        const filtroTab  = document.querySelector('[data-filtro-viagem].ativo')?.dataset.filtroViagem || 'todas';
        const busca      = (document.getElementById('viagem-busca')?.value || '').toLowerCase();
        const hoje       = new Date(); hoje.setHours(0,0,0,0);

        let lista = [...Estado.viagens].sort((a,b) => new Date(a.ida) - new Date(b.ida));

        lista = lista.filter(v => {
            const ida   = new Date(v.ida+'T12:00:00');   ida.setHours(0,0,0,0);
            const volta = new Date(v.volta+'T12:00:00'); volta.setHours(0,0,0,0);
            if (filtroTab === 'futura')    return ida > hoje;
            if (filtroTab === 'andamento') return ida <= hoje && volta >= hoje;
            if (filtroTab === 'concluida') return volta < hoje;
            return true;
        });

        if (busca) lista = lista.filter(v => (v.destino || '').toLowerCase().includes(busca));

        if (!lista.length) {
            grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
                <div class="empty-state-icon">🗺️</div>
                <h3>Nenhuma viagem encontrada</h3>
                <p>Experimente outro filtro ou adicione uma nova viagem.</p>
            </div>`;
            return;
        }

        // Gradients por tipo
        const gradMap = {
            praia:         'linear-gradient(135deg, #0891b2, #06b6d4)',
            cidade:        'linear-gradient(135deg, #4f46e5, #7c3aed)',
            natureza:      'linear-gradient(135deg, #16a34a, #15803d)',
            internacional: 'linear-gradient(135deg, #2563eb, #4f46e5)',
            cruzeiro:      'linear-gradient(135deg, #0e7490, #0891b2)',
            mochilao:      'linear-gradient(135deg, #b45309, #d97706)',
            outros:        'linear-gradient(135deg, #475569, #64748b)',
        };

        grid.innerHTML = lista.map(v => {
            const ida   = new Date(v.ida+'T12:00:00');   ida.setHours(0,0,0,0);
            const volta = new Date(v.volta+'T12:00:00'); volta.setHours(0,0,0,0);
            const dias  = Utils.diasAte(v.ida);
            const idaValida   = !isNaN(ida.getTime());
            const voltaValida = !isNaN(volta.getTime());
            let statusTxt, statusCls;
            if (voltaValida && volta < hoje)      { statusTxt = 'Concluída';     statusCls = 'concluida'; }
            else if (idaValida && ida <= hoje)    { statusTxt = 'Em andamento';  statusCls = 'andamento'; }
            else if (dias === null)               { statusTxt = '—';            statusCls = 'futura'; }
            else if (dias <= 30)                  { statusTxt = `${dias}d`;      statusCls = 'futura'; }
            else                                  { statusTxt = `${dias} dias`;  statusCls = 'futura'; }

            const grad  = gradMap[v.tipo] || gradMap.outros;
            const gastoReal = Utils.gastosDaViagem(v.id);
            const pctReal   = v.orcamento > 0 ? Math.round(gastoReal / v.orcamento * 100) : 0;
            const pctBar    = Math.min(100, pctReal);
            const acima     = v.orcamento > 0 && gastoReal > v.orcamento;
            const barGasto  = acima ? 'var(--grad-warm)' : 'var(--grad-brand)';
            const guardado  = v.guardado || 0;
            const pctGuard  = v.orcamento > 0 ? Math.min(100, Math.round(guardado / v.orcamento * 100)) : 0;

            const linkSeguro = Utils.urlSegura(v.link);

            return `<div class="trip-card" onclick="Controladores.abrirDetalheViagem('${v.id}')">
                <div class="trip-card-hero" style="background:${grad}" data-emoji="${Utils.esc(v.emoji||'✈️')}">
                    <span class="trip-status-badge ${statusCls}">${statusTxt}</span>
                    <div class="trip-destination">${Utils.esc(v.destino)}</div>
                </div>
                <div class="trip-card-body">
                    <div class="trip-dates">
                        <i class="fa-regular fa-calendar"></i>
                        ${Utils.data(v.ida)} → ${Utils.data(v.volta)}
                    </div>
                    <div class="trip-budget-row">
                        <span class="trip-budget-label">Orçamento</span>
                        <span class="trip-budget-value">${Utils.moeda(v.orcamento)}</span>
                    </div>
                    ${v.orcamento > 0 ? `
                        <div class="progress-wrap"><div class="progress-bar" style="width:${pctBar}%;background:${barGasto}"></div></div>
                        <div style="font-size:.7rem;color:${acima ? 'var(--brand-rose)' : 'var(--text-muted)'};margin-top:4px">${Utils.moeda(gastoReal)} de ${Utils.moeda(v.orcamento)} (${pctReal}%)${acima ? ' — Acima do orçamento!' : ''}</div>
                        <div class="progress-wrap" style="margin-top:8px"><div class="progress-bar" style="width:${pctGuard}%;background:var(--grad-success)"></div></div>
                        <div style="font-size:.7rem;color:var(--text-muted);margin-top:4px">🐷 Economizado: ${Utils.moeda(guardado)} de ${Utils.moeda(v.orcamento)} (${pctGuard}%)</div>
                    ` : ''}
                </div>
                <div class="trip-card-footer">
                    ${linkSeguro ? `<a href="${Utils.esc(linkSeguro)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="btn btn-ghost btn-sm"><i class="fa-solid fa-link"></i> Reserva</a>` : ''}
                    <button class="btn btn-success btn-sm" onclick="event.stopPropagation();Controladores.abrirCofrinhoViagem('${v.id}')"><i class="fa-solid fa-piggy-bank"></i> Guardar</button>
                    <button class="btn btn-icon danger" aria-label="Excluir viagem" title="Excluir viagem" onclick="event.stopPropagation();Controladores.deletar('viagens','${v.id}')"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');

        // Mantém os selects de viagem sincronizados quando as viagens mudam
        Render.popularSelectViagens();
    },

    metas: () => {
        const grid = document.getElementById('goals-grid');
        if (!grid) return;

        const hoje = new Date(); hoje.setHours(0,0,0,0);
        let total = Estado.metas.length;
        let concluidas = Estado.metas.filter(m => m.atual >= m.alvo).length;
        let emProgresso = total - concluidas;
        let guardado = Estado.metas.reduce((s,m) => s + (m.atual||0), 0);

        const set = (id,txt) => { const e=document.getElementById(id); if(e) e.textContent=txt; };
        set('meta-total',       total);
        set('meta-concluidas',  concluidas);
        set('meta-em-progresso',emProgresso);
        set('meta-guardado',    Utils.moeda(guardado));

        if (!Estado.metas.length) {
            grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
                <div class="empty-state-icon">🌟</div>
                <h3>Nenhuma meta ainda</h3>
                <p>Crie metas para transformar sonhos em realidade!</p>
            </div>`;
            return;
        }

        const catCores = { viagem:'var(--brand-blue)', emergencia:'var(--brand-emerald)', imovel:'var(--brand-purple)', veiculo:'var(--brand-orange)', educacao:'var(--brand-amber)', casamento:'var(--brand-rose)', investimento:'var(--brand-teal)', outros:'var(--text-muted)' };

        // Cópia antes de ordenar: `.sort()` mutaria Estado.metas, alterando a
        // ordem que será gravada na nuvem só por ter renderizado a tela.
        // Metas sem prazo vão para o fim em vez de virarem NaN na comparação.
        const ordenadas = [...Estado.metas].sort((a, b) => {
            if (!a.prazo && !b.prazo) return 0;
            if (!a.prazo) return 1;
            if (!b.prazo) return -1;
            return new Date(a.prazo) - new Date(b.prazo);
        });

        grid.innerHTML = ordenadas.map(m => {
            const pct      = Math.min(100, Math.round((m.atual||0) / m.alvo * 100));
            const concluida= m.atual >= m.alvo;
            const diasPrazo= m.prazo ? Utils.diasAte(m.prazo) : null;
            const atrasado = diasPrazo !== null && diasPrazo < 0 && !concluida;
            const cor      = catCores[m.cat] || catCores.outros;
            const barGrad  = concluida ? 'var(--grad-success)' : `linear-gradient(90deg, ${cor}, ${cor}99)`;

            let prazoHtml = '';
            if (m.prazo) {
                if (concluida)       prazoHtml = `<div class="goal-deadline"><i class="fa-solid fa-check-circle"></i> Meta concluída! 🎉</div>`;
                else if (atrasado)   prazoHtml = `<div class="goal-deadline goal-atrasado"><i class="fa-solid fa-circle-exclamation"></i> Atrasado — ${Utils.data(m.prazo)}</div>`;
                else if (diasPrazo === null) prazoHtml = `<div class="goal-deadline"><i class="fa-regular fa-calendar"></i> —</div>`;
                else if (diasPrazo === 0) prazoHtml = `<div class="goal-deadline"><i class="fa-regular fa-clock"></i> Vence hoje!</div>`;
                else                 prazoHtml = `<div class="goal-deadline"><i class="fa-regular fa-calendar"></i> ${Utils.data(m.prazo)} — faltam ${diasPrazo}d</div>`;
            }

            return `<div class="goal-card">
                <div class="goal-card-header">
                    <div style="display:flex;align-items:center;gap:10px">
                        <div class="goal-icon" style="background:${cor}20;color:${cor};font-size:1.2rem">${Utils.esc(m.emoji||'🎯')}</div>
                        <div>
                            <div class="goal-title">${Utils.esc(m.titulo)}</div>
                            ${m.desc ? `<div class="goal-desc">${Utils.esc(m.desc)}</div>` : ''}
                        </div>
                    </div>
                    <button class="btn-icon danger" aria-label="Excluir meta" title="Excluir meta" onclick="Controladores.deletar('metas','${m.id}')"><i class="fa-solid fa-trash"></i></button>
                </div>
                <div class="goal-amounts">
                    <div class="goal-current">${Utils.moeda(m.atual||0)}</div>
                    <div class="goal-target">de ${Utils.moeda(m.alvo)}</div>
                    <div class="goal-pct">${pct}%</div>
                </div>
                <div class="progress-wrap">
                    <div class="progress-bar" style="width:${pct}%;background:${barGrad}"></div>
                </div>
                ${prazoHtml}
                ${!concluida ? `<div class="savings-row"><input type="number" placeholder="Guardar R$..." min="0.01" step="0.01" id="dep-inline-${m.id}"><button class="btn btn-success btn-sm" aria-label="Guardar valor na meta" title="Guardar valor" onclick="Controladores._depositoInline('${m.id}')"><i class="fa-solid fa-piggy-bank"></i></button></div>` : `<div style="margin-top:10px"><span class="badge badge-success"><i class="fa-solid fa-check"></i> Concluída!</span></div>`}
            </div>`;
        }).join('');
    },

    checklist: () => {
        const wrap = document.getElementById('checklist-wrap');
        if (!wrap) return;

        const catAtiva = document.querySelector('[data-check-cat].ativo')?.dataset.checkCat || 'todos';
        let lista = Estado.checklist;
        if (catAtiva !== 'todos') lista = lista.filter(c => c.cat === catAtiva);

        const total   = Estado.checklist.length;
        const feitos  = Estado.checklist.filter(c => c.feito).length;
        const pct     = total > 0 ? Math.round(feitos / total * 100) : 0;

        const set = (id, txt) => { const e=document.getElementById(id); if(e) e.textContent=txt; };
        set('check-progresso-txt', `${feitos} / ${total} itens`);
        const bar = document.getElementById('check-progress-bar');
        if (bar) bar.style.width = pct + '%';

        if (!lista.length) {
            wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><h3>Nenhum item nesta categoria</h3></div>`;
            return;
        }

        wrap.innerHTML = lista.map(c => `
            <div class="checklist-item ${c.feito ? 'concluido' : ''}">
                <div class="check-toggle" onclick="Checklist.toggle('${c.id}')">
                    ${c.feito ? '<i class="fa-solid fa-check"></i>' : ''}
                </div>
                <span class="check-text">${Utils.esc(c.texto)}</span>
                <span class="check-category">${Utils.esc(c.cat)}</span>
                <button class="btn-icon danger" aria-label="Remover item" title="Remover item" style="width:28px;height:28px;font-size:.75rem" onclick="Checklist.remover('${c.id}')"><i class="fa-solid fa-xmark"></i></button>
            </div>`).join('');
    }
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    if (ehModoLocal()) {
        // Modo local: abre direto no painel, sem login e sem rede. Fase curta —
        // a montagem é síncrona e conclui o bootstrap sem esperar o Firebase.
        Auth._iniciarFase('local', 4000);
        Auth._entrarModoLocal();
    } else {
        // A página do app apenas observa a sessão já estabelecida. SESSION é
        // escolhida em auth.html antes de novas credenciais, sem um segundo gate.
        iniciarFirebase();
        Auth._iniciarFase('autenticacao', 10000);
        Auth.iniciarObserver();
    }

    // Filtros de finanças
    document.querySelectorAll('.filter-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('ativo'));
            btn.classList.add('ativo');
            Render.financas();
        });
    });

    // Busca finanças
    document.getElementById('fin-busca')?.addEventListener('input', Render.financas);
    document.getElementById('fin-mes')?.addEventListener('change', Render.financas);

    // Filtros viagens (tabs)
    document.querySelectorAll('[data-filtro-viagem]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-filtro-viagem]').forEach(b => b.classList.remove('ativo'));
            btn.classList.add('ativo');
            Render.viagens();
        });
    });
    document.getElementById('viagem-busca')?.addEventListener('input', Render.viagens);

    // Tabs do checklist
    document.querySelectorAll('[data-check-cat]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('[data-check-cat]').forEach(b => b.classList.remove('ativo'));
            btn.classList.add('ativo');
            Render.checklist();
        });
    });

    // Data padrão de hoje no modal de finança
    const finData = document.getElementById('fin-data');
    if (finData) finData.value = Utils.hoje();
});
