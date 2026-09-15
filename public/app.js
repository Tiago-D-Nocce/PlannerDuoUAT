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

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();

// SEGURANÇA: sessão válida apenas enquanto a aba estiver aberta. Ao fechar o
// navegador ou abrir de novo pela landing, é necessário logar outra vez.
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(() => {});

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
    viagens:    [],
    financas:   [],
    metas:      [],
    checklist:  [],
    orcamentos: {},      // map categoria -> valor limite mensal
    historicoBuscas: [], // últimas buscas de viagem (max 8, localStorage)
    unsubscribe: null    // listener ativo do Firestore
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

    slug: (t) => t.trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-z0-9\s-]/g,'').replace(/\s+/g,'-'),

    inicial: (nome) => (nome || '?')[0].toUpperCase(),

    // ── Nomes do casal com fallback estável (nunca null/"null") ──
    // Retorna sempre nomes utilizáveis para gravação, comparação e labels.
    nomesCasal: () => ({
        p1: Estado.nome1 || 'Pessoa 1',
        p2: Estado.nome2 || 'Pessoa 2'
    }),

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
        const d = desc.toLowerCase();
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
        document.getElementById(id)?.classList.add('ativa');
    },
    fecharModal: (id) => {
        document.getElementById(id)?.classList.remove('ativa');
        document.querySelector(`#${id} form`)?.reset();
    },

    toast: (titulo, corpo = '', tipo = 'sucesso') => {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const icones = { sucesso: 'fa-check-circle', erro: 'fa-circle-exclamation', aviso: 'fa-triangle-exclamation', info: 'fa-circle-info' };
        const t = document.createElement('div');
        t.className = `toast ${tipo}`;
        t.innerHTML = `
            <div class="toast-icon"><i class="fa-solid ${icones[tipo] || icones.info}"></i></div>
            <div class="toast-msg">
                <div class="toast-title">${titulo}</div>
                ${corpo ? `<div class="toast-body">${corpo}</div>` : ''}
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
    iniciarObserver: () => {
        auth.onAuthStateChanged((user) => {
            const path      = window.location.pathname;
            const isApp     = path.includes('app.html');
            const isAuth    = path.includes('auth.html');
            const isLanding = !isApp && !isAuth;

            if (user) {
                Estado.usuarioUid   = user.uid;
                Estado.usuarioEmail = user.email;

                if (isAuth || isLanding) {
                    window.location.href = 'app.html';
                    return;
                }

                if (isApp) {
                    Estado.usuarioNome = user.displayName || null;
                    // Resolve o casalId ANTES de entrar no app; se falhar, cai no
                    // último casalId conhecido (localStorage) para não travar.
                    Auth.resolverCasalId(user)
                        .catch((err) => {
                            console.warn('Falha ao resolver casalId:', err.code, err.message);
                            Estado.casalId = localStorage.getItem('pd-casalId') || user.uid;
                        })
                        .finally(() => {
                            localStorage.setItem('pd-casalId', Estado.casalId);
                            Auth._entrarNoApp(user);
                        });
                }
            } else {
                if (isApp) {
                    window.location.href = 'auth.html';
                }
            }
        });
    },

    _entrarNoApp: (user) => {
        // Sidebar: nome + inicial
        const nome = Estado.nomeUsuario || user.displayName || user.email.split('@')[0];
        Estado.nomeUsuario = nome;
        document.getElementById('sidebar-user-name').textContent = nome;
        document.getElementById('sidebar-avatar').textContent    = Utils.inicial(nome);

        // Atualizar nomes nos selects
        UI.atualizarNomes();

        // Popular select de mês nas finanças
        Render.popularSelectMes();

        // Carregar cache local primeiro (offline-first)
        DB.carregarCache();

        // Processar despesas recorrentes (gera cópias do mês atual)
        Controladores.processarRecorrentes();

        // Popular selects de viagem e histórico de buscas
        Render.popularSelectViagens();
        ServicoBusca.carregarHistorico();

        // Ouvir Firestore em tempo real
        DB.ouvirNuvem();

        // Esconder loader
        Auth._esconderLoader();
        const app = document.getElementById('tela-app');
        if (app) app.style.opacity = '1';

        // Restaurar tema salvo
        const temaSalvo = localStorage.getItem('pd-tema');
        if (temaSalvo) {
            document.documentElement.setAttribute('data-theme', temaSalvo);
            const icon = document.getElementById('btn-tema')?.querySelector('i');
            if (icon) icon.className = temaSalvo === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        }

        // Iniciar navegação
        UI.setupNav();
        Render.tudo();
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
    // Grava o resultado em Estado.casalId e retorna-o.
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
            Estado.casalId = user.uid;
            return user.uid;
        }
        const data = snap.data();
        Estado.casalId = data.casalIdRef || user.uid;
        return Estado.casalId;
    },

    logout: () => {
        if (!confirm('Deseja encerrar a sessão?')) return;
        if (Estado.unsubscribe) Estado.unsubscribe();
        try { localStorage.removeItem(DB.chaveCache()); } catch {}
        localStorage.removeItem('pd-casalId');
        auth.signOut().then(() => window.location.href = 'auth.html');
    },

    // Sai do sistema pela logo e retorna à landing page pública (index.html)
    sairParaLanding: () => {
        if (!confirm('Deseja mesmo sair do PlannerDuo?')) return;
        if (Estado.unsubscribe) Estado.unsubscribe();
        try { localStorage.removeItem(DB.chaveCache()); } catch {}
        localStorage.removeItem('pd-casalId');
        auth.signOut()
            .then(() => { window.location.href = 'index.html'; })
            .catch(() => { window.location.href = 'index.html'; });
    }
};

// ============================================================
// BANCO DE DADOS (FIRESTORE)
// ============================================================
const DB = {
    // Chave de Cache_Local derivada do casalId atual (Req 2.6, 7.1).
    chaveCache: () => PlannerCore.chaveCache(Estado.casalId),

    carregarCache: () => {
        try {
            const raw = localStorage.getItem(DB.chaveCache());
            if (!raw) return;
            const dados = JSON.parse(raw);
            Estado.viagens    = dados.viagens    || [];
            Estado.financas   = dados.financas   || [];
            Estado.metas      = dados.metas      || [];
            Estado.checklist  = dados.checklist  || [];
            Estado.orcamentos = dados.orcamentos || {};
            if (dados.nome1) Estado.nome1 = dados.nome1;
            if (dados.nome2) Estado.nome2 = dados.nome2;
        } catch {}
    },

    ouvirNuvem: () => {
        if (Estado.unsubscribe) Estado.unsubscribe();
        Estado.unsubscribe = db.collection('casais').doc(Estado.casalId)
            .onSnapshot((doc) => {
                if (!doc.exists) {
                    // Documento ainda não propagou — segue com o cache local.
                    return;
                }
                const dados = doc.data();
                Estado.viagens    = dados.viagens    || [];
                Estado.financas   = dados.financas   || [];
                Estado.metas      = dados.metas      || [];
                Estado.checklist  = dados.checklist  || [];
                Estado.orcamentos = dados.orcamentos || {};
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
                if (dados.nome2) Estado.nome2 = dados.nome2;
                UI.atualizarNomes();
                try { localStorage.setItem(DB.chaveCache(), JSON.stringify(dados)); } catch {}
                Render.tudo();
            }, (err) => {
                console.warn('Firestore onSnapshot erro:', err.code, err.message);
                // Não trava o app — continua com dados do cache
            });
    },

    salvar: async (campo) => {
        try {
            await db.collection('casais').doc(Estado.casalId)
                .set({ [campo]: Estado[campo] }, { merge: true });
        } catch (err) {
            UI.toast('Erro ao salvar', err.message, 'erro');
        }
    },

    salvarVarios: async (campos) => {
        const payload = {};
        campos.forEach(c => payload[c] = Estado[c]);
        try {
            await db.collection('casais').doc(Estado.casalId).set(payload, { merge: true });
        } catch (err) {
            UI.toast('Erro ao salvar', err.message, 'erro');
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
        const codigo = PlannerCore.gerarCodigo();
        const agora  = Date.now();
        try {
            await db.collection('convites').doc(codigo).set({
                casalId: Estado.casalId,
                criadoPor: Estado.usuarioEmail,
                criadoEm: new Date(agora).toISOString(),
                expiraEm: new Date(agora + 72 * 60 * 60 * 1000).toISOString()
            });
        } catch (err) {
            UI.toast('Erro ao gerar convite', err.message, 'erro');
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
        const user = auth.currentUser;
        if (!user) return;
        const cod = (codigo || '').trim().toUpperCase();
        const mensagens = {
            invalido:  'Código inválido',
            expirou:   'Código expirou',
            cheio:     'Espaço do casal está cheio',
            ja_membro: 'Você já é membro'
        };
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
            UI.toast('Erro ao aceitar convite', err.message, 'erro');
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
        let   resp  = document.getElementById('fin-resp').value;
        const desc  = document.getElementById('fin-desc').value.trim();
        const valor = Utils.parseValor(document.getElementById('fin-valor').value);
        const data  = document.getElementById('fin-data').value;
        const cat   = document.getElementById('fin-categoria').value || Utils.inferirCat(desc);
        const obs   = document.getElementById('fin-obs')?.value.trim() || '';
        const viagemId   = document.getElementById('fin-viagem')?.value || '';
        let   recorrente = document.getElementById('fin-recorrente')?.value || '';
        const parcelas   = parseInt(document.getElementById('fin-parcelas')?.value) || 1;

        // Responsável nunca pode ser gravado como "null" ou vazio.
        if (!resp || resp === 'null') resp = Utils.nomesCasal().p1;

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
        document.getElementById('edit-fin-resp').value        = f.resp;
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
        let respEdit = document.getElementById('edit-fin-resp').value;
        if (!respEdit || respEdit === 'null') respEdit = Utils.nomesCasal().p1;
        Estado.financas[idx] = {
            ...Estado.financas[idx],
            tipo:  document.getElementById('edit-fin-tipo').value,
            resp:  respEdit,
            desc:  document.getElementById('edit-fin-desc').value.trim(),
            valor: Utils.parseValor(document.getElementById('edit-fin-valor').value),
            data:  document.getElementById('edit-fin-data').value,
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
                    <span style="flex:1">${f.desc}</span>
                    <strong style="color:var(--brand-rose)">${Utils.moeda(f.valor)}</strong>
                </div>`).join('')
            : `<div style="font-size:.85rem;color:var(--text-muted);padding:8px 0">Nenhuma despesa vinculada ainda.</div>`;

        document.getElementById('modal-viagem-detalhe-body').innerHTML = `
            <div class="form-group">
                <div class="form-row">
                    <div>
                        <div class="form-label">Tipo</div>
                        <span class="badge badge-viagem">${v.tipo || '—'}</span>
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
            ${v.link ? `<div class="form-group"><a href="${v.link}" target="_blank" class="btn btn-ghost btn-sm"><i class="fa-solid fa-arrow-up-right-from-square"></i> Acessar Reserva</a></div>` : ''}
            ${v.notas ? `<div class="form-group"><div class="form-label">Notas / Roteiro</div><div style="background:var(--surface-alt);padding:14px;border-radius:var(--r-lg);font-size:.875rem;white-space:pre-wrap;border:1px solid var(--border)">${v.notas}</div></div>` : ''}
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
    carregarHistorico: () => {
        try {
            const raw = localStorage.getItem('pd-buscas');
            Estado.historicoBuscas = raw ? JSON.parse(raw) : [];
        } catch { Estado.historicoBuscas = []; }
        ServicoBusca.renderHistorico();
    },

    _salvarHistorico: () => {
        try { localStorage.setItem('pd-buscas', JSON.stringify(Estado.historicoBuscas)); } catch {}
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
        const chips = Estado.historicoBuscas.map((b, i) =>
            `<button type="button" class="badge badge-viagem" style="cursor:pointer;border:none" onclick="ServicoBusca.aplicarHistorico(${i})" title="${b.origem||''} → ${b.destino}">${b.origem ? b.origem + ' → ' : ''}${b.destino}</button>`
        ).join('');
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
        if (url) window.open(url, '_blank');
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

        _charts.fluxo = new Chart(ctx, {
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

        _charts.categorias = new Chart(ctx, {
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

        _charts.responsavel = new Chart(ctx, {
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

        _charts.catFin = new Chart(ctx, {
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
            _charts.relEvolucao = new Chart(ctxEv, {
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
            _charts.relCat = new Chart(ctxCat, {
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
            Estado.viagens.map(v => `<option value="${v.id}">${v.emoji || '✈️'} ${v.destino}</option>`).join('');
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
                    <div style="${valorGrande}">${prox.emoji||'✈️'} ${prox.destino}</div>
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
                <div style="width:42px;height:42px;border-radius:12px;background:var(--grad-cool);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">${v.emoji||'✈️'}</div>
                <div style="flex:1">
                    <div style="font-weight:700">${v.destino}</div>
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
                <td><strong>${f.desc}</strong>${badgeRec}${badgeParc}</td>
                <td><span class="cat-pill">${ci.emoji} ${ci.label}</span></td>
                <td>${f.resp}</td>
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

        if (busca) lista = lista.filter(v => v.destino.toLowerCase().includes(busca));

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

            return `<div class="trip-card" onclick="Controladores.abrirDetalheViagem('${v.id}')">
                <div class="trip-card-hero" style="background:${grad}" data-emoji="${v.emoji||'✈️'}">
                    <span class="trip-status-badge ${statusCls}">${statusTxt}</span>
                    <div class="trip-destination">${v.destino}</div>
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
                    ${v.link ? `<a href="${v.link}" target="_blank" onclick="event.stopPropagation()" class="btn btn-ghost btn-sm"><i class="fa-solid fa-link"></i> Reserva</a>` : ''}
                    <button class="btn btn-success btn-sm" onclick="event.stopPropagation();Controladores.abrirCofrinhoViagem('${v.id}')"><i class="fa-solid fa-piggy-bank"></i> Guardar</button>
                    <button class="btn btn-icon danger" onclick="event.stopPropagation();Controladores.deletar('viagens','${v.id}')"><i class="fa-solid fa-trash"></i></button>
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

        grid.innerHTML = Estado.metas.sort((a,b)=>new Date(a.prazo)-new Date(b.prazo)).map(m => {
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
                        <div class="goal-icon" style="background:${cor}20;color:${cor};font-size:1.2rem">${m.emoji||'🎯'}</div>
                        <div>
                            <div class="goal-title">${m.titulo}</div>
                            ${m.desc ? `<div class="goal-desc">${m.desc}</div>` : ''}
                        </div>
                    </div>
                    <button class="btn-icon danger" onclick="Controladores.deletar('metas','${m.id}')"><i class="fa-solid fa-trash"></i></button>
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
                ${!concluida ? `<div class="savings-row"><input type="number" placeholder="Guardar R$..." min="0.01" step="0.01" id="dep-inline-${m.id}"><button class="btn btn-success btn-sm" onclick="Controladores._depositoInline('${m.id}')"><i class="fa-solid fa-piggy-bank"></i></button></div>` : `<div style="margin-top:10px"><span class="badge badge-success"><i class="fa-solid fa-check"></i> Concluída!</span></div>`}
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
                <span class="check-text">${c.texto}</span>
                <span class="check-category">${c.cat}</span>
                <button class="btn-icon danger" style="width:28px;height:28px;font-size:.75rem" onclick="Checklist.remover('${c.id}')"><i class="fa-solid fa-xmark"></i></button>
            </div>`).join('');
    }
};

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    Auth.iniciarObserver();

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
