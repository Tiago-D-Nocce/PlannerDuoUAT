/* PlannerDuo — PlannerCommandPalette: paleta de comandos Ctrl+K.
 *
 * UMD como os demais módulos (global PlannerCommandPalette). Sem dependências
 * externas. Exporta helpers puros para construção e filtragem da lista de
 * comandos, consumidos por app.js e testáveis isoladamente.
 *
 * SEGURANÇA: nenhum comando destrutivo (apagar, bloquear, senha, backup) é
 * exposto pela paleta. Cada comando referencia uma ação existente na UI.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object') root.PlannerCommandPalette = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Remove acentos e normaliza para comparação insensível.
   * @param {string} s
   * @returns {string}
   */
  function normalize(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  /**
   * Monta a lista estática de comandos disponíveis na paleta.
   * Cada item tem: id, label, keywords (array de strings para busca),
   * kind ('navigate' | 'dialog' | 'action') e run (nome da ação, não
   * a função em si — app.js resolve e executa).
   *
   * @returns {Array<{id:string, label:string, keywords:string[], kind:string, run:string}>}
   */
  function buildCommands() {
    return [
      { id: 'nav-central',    label: 'Assistente',            keywords: ['assistente', 'central', 'chat', 'ia'],                 kind: 'navigate', run: 'central' },
      { id: 'nav-dashboard',  label: 'Visão geral',           keywords: ['visao', 'geral', 'dashboard', 'inicio', 'home'],       kind: 'navigate', run: 'dashboard' },
      { id: 'nav-finances',   label: 'Finanças',              keywords: ['financas', 'transacoes', 'dinheiro', 'gastos'],         kind: 'navigate', run: 'finances' },
      { id: 'nav-trips',      label: 'Viagens',               keywords: ['viagens', 'roteiros', 'passagens'],                    kind: 'navigate', run: 'trips' },
      { id: 'nav-goals',      label: 'Metas',                 keywords: ['metas', 'objetivos', 'planos'],                        kind: 'navigate', run: 'goals' },
      { id: 'nav-checklist',  label: 'Checklist',             keywords: ['checklist', 'lista', 'itens', 'tarefas'],              kind: 'navigate', run: 'checklist' },
      { id: 'nav-decisions',  label: 'Decisões',              keywords: ['decisoes', 'votacao', 'votar'],                        kind: 'navigate', run: 'decisions' },
      { id: 'nav-reports',    label: 'Relatórios',            keywords: ['relatorios', 'graficos', 'historico'],                  kind: 'navigate', run: 'reports' },
      { id: 'nav-settings',   label: 'Configurações',         keywords: ['configuracoes', 'ajustes', 'participantes', 'perfil'], kind: 'navigate', run: 'settings' },
      { id: 'new-transaction', label: 'Nova transação',       keywords: ['nova', 'transacao', 'despesa', 'receita', 'lancar'],   kind: 'dialog',   run: 'transaction-dialog' },
      { id: 'new-trip',       label: 'Planejar viagem',       keywords: ['planejar', 'viagem', 'roteiro', 'nova viagem'],        kind: 'dialog',   run: 'trip-dialog' },
      { id: 'add-participant', label: 'Adicionar participante', keywords: ['participante', 'adicionar', 'pessoa', 'nome'],       kind: 'action',   run: 'add-participant' },
      { id: 'toggle-theme',   label: 'Alternar tema',         keywords: ['tema', 'escuro', 'claro', 'dark', 'light', 'modo'],   kind: 'action',   run: 'toggle-theme' },
    ];
  }

  // IDs de comandos destrutivos/sensíveis que NUNCA entram na paleta.
  var EXCLUDED_IDS = new Set([
    'lock', 'delete', 'reset', 'password', 'backup', 'destroy',
    'security', 'export', 'import', 'discard',
  ]);

  /**
   * Filtra e ordena comandos com base na query.
   * - Comparação case/accent-insensível (substring).
   * - Correspondências no label têm prioridade sobre keywords.
   *
   * @param {Array} commands - lista de buildCommands()
   * @param {string} query - texto digitado
   * @returns {Array} comandos filtrados e ordenados
   */
  function filterCommands(commands, query) {
    if (!query || !query.trim()) return commands.slice();
    var q = normalize(query.trim());
    var scored = [];
    for (var i = 0; i < commands.length; i++) {
      var cmd = commands[i];
      var labelN = normalize(cmd.label);
      var labelMatch = labelN.indexOf(q) !== -1;
      var kwMatch = false;
      if (!labelMatch) {
        for (var k = 0; k < cmd.keywords.length; k++) {
          if (normalize(cmd.keywords[k]).indexOf(q) !== -1) { kwMatch = true; break; }
        }
      }
      if (labelMatch || kwMatch) {
        scored.push({ cmd: cmd, priority: labelMatch ? 0 : 1, pos: labelMatch ? labelN.indexOf(q) : 99 });
      }
    }
    scored.sort(function (a, b) {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.pos - b.pos;
    });
    return scored.map(function (s) { return s.cmd; });
  }

  return Object.freeze({
    buildCommands: buildCommands,
    filterCommands: filterCommands,
    EXCLUDED_IDS: EXCLUDED_IDS,
    normalize: normalize,
  });
});
