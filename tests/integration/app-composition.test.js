/* TASK 18.3 — App composition: Central, orchestrator, runtime, palette, integrations.
 *
 * Testa helpers puros (buildCommands, filterCommands) e faz asserts estáticos
 * sobre os fontes (HTML e JS) para garantir a composição sem precisar iniciar
 * o DOM completo do app.js (IIFE + browser globals).
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const publicDir = join(root, 'public');

// Load the command-palette module (UMD, works with require)
const CommandPalette = require(join(publicDir, 'modules', 'ui', 'command-palette.js'));

// Read source files for static assertions
const appHtml = readFileSync(join(publicDir, 'app.html'), 'utf8');
const appJs = readFileSync(join(publicDir, 'app.js'), 'utf8');
const authJs = readFileSync(join(publicDir, 'auth.js'), 'utf8');

// ===================================================================
// buildCommands / filterCommands — testes determinísticos puros
// ===================================================================

describe('PlannerCommandPalette.buildCommands', () => {
  const commands = CommandPalette.buildCommands();

  it('retorna uma lista não vazia de comandos', () => {
    expect(commands.length).toBeGreaterThan(0);
  });

  it('cada comando tem id, label, keywords, kind e run', () => {
    for (const cmd of commands) {
      expect(cmd).toHaveProperty('id');
      expect(cmd).toHaveProperty('label');
      expect(Array.isArray(cmd.keywords)).toBe(true);
      expect(cmd.keywords.length).toBeGreaterThan(0);
      expect(['navigate', 'dialog', 'action']).toContain(cmd.kind);
      expect(typeof cmd.run).toBe('string');
    }
  });

  it('contém navegação para Assistente e Visão geral', () => {
    const ids = commands.map((c) => c.id);
    expect(ids).toContain('nav-central');
    expect(ids).toContain('nav-dashboard');
  });

  it('contém todas as views esperadas', () => {
    const navIds = commands.filter((c) => c.kind === 'navigate').map((c) => c.run);
    expect(navIds).toContain('central');
    expect(navIds).toContain('dashboard');
    expect(navIds).toContain('finances');
    expect(navIds).toContain('trips');
    expect(navIds).toContain('goals');
    expect(navIds).toContain('checklist');
    expect(navIds).toContain('decisions');
    expect(navIds).toContain('reports');
    expect(navIds).toContain('settings');
  });

  it('inclui comandos de diálogo e ação', () => {
    const dialogIds = commands.filter((c) => c.kind === 'dialog').map((c) => c.id);
    expect(dialogIds).toContain('new-transaction');
    expect(dialogIds).toContain('new-trip');
    const actionIds = commands.filter((c) => c.kind === 'action').map((c) => c.id);
    expect(actionIds).toContain('toggle-theme');
    expect(actionIds).toContain('add-participant');
  });

  it('NÃO contém comandos destrutivos ou de segurança', () => {
    const ids = commands.map((c) => c.id);
    const labels = commands.map((c) => CommandPalette.normalize(c.label));
    const runs = commands.map((c) => c.run);
    const dangerous = ['lock', 'delete', 'reset', 'password', 'backup', 'destroy', 'security', 'export', 'import', 'discard'];
    for (const d of dangerous) {
      expect(ids.some((id) => id.includes(d))).toBe(false);
      expect(runs.some((r) => r.includes(d))).toBe(false);
    }
    // Nenhum rótulo menciona apagar/excluir/bloquear/senha/backup
    const dangerousLabels = ['apagar', 'excluir', 'bloquear', 'senha', 'backup', 'destruir'];
    for (const d of dangerousLabels) {
      expect(labels.some((l) => l.includes(d))).toBe(false);
    }
  });
});

describe('PlannerCommandPalette.filterCommands', () => {
  const commands = CommandPalette.buildCommands();

  it('retorna todos quando a query está vazia', () => {
    expect(CommandPalette.filterCommands(commands, '').length).toBe(commands.length);
    expect(CommandPalette.filterCommands(commands, '  ').length).toBe(commands.length);
    expect(CommandPalette.filterCommands(commands, null).length).toBe(commands.length);
  });

  it('filtra por substring no label (case/accent insensitive)', () => {
    const result = CommandPalette.filterCommands(commands, 'financ');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].id).toBe('nav-finances');
  });

  it('filtra por keyword', () => {
    const result = CommandPalette.filterCommands(commands, 'gastos');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].id).toBe('nav-finances');
  });

  it('filtra com acentos', () => {
    const result = CommandPalette.filterCommands(commands, 'decisoes');
    expect(result.some((c) => c.id === 'nav-decisions')).toBe(true);
    const result2 = CommandPalette.filterCommands(commands, 'Decisões');
    expect(result2.some((c) => c.id === 'nav-decisions')).toBe(true);
  });

  it('prioriza correspondência no label sobre keywords', () => {
    const result = CommandPalette.filterCommands(commands, 'assist');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].id).toBe('nav-central');
  });

  it('retorna vazio quando nada combina', () => {
    expect(CommandPalette.filterCommands(commands, 'xyznonexistent')).toHaveLength(0);
  });
});

// ===================================================================
// Asserts estáticos sobre app.html
// ===================================================================

describe('app.html — composição estática', () => {
  it('contém data-view-panel="central"', () => {
    expect(appHtml).toContain('data-view-panel="central"');
  });

  it('contém nav item data-view="central"', () => {
    expect(appHtml).toContain('data-view="central"');
  });

  it('contém #central-root', () => {
    expect(appHtml).toContain('id="central-root"');
  });

  it('contém #command-palette', () => {
    expect(appHtml).toContain('id="command-palette"');
  });

  it('carrega places.js antes de app.js', () => {
    const placesIdx = appHtml.indexOf('src="modules/agents/places.js"');
    const appIdx = appHtml.indexOf('src="app.js"');
    expect(placesIdx).toBeGreaterThan(0);
    expect(placesIdx).toBeLessThan(appIdx);
  });

  it('carrega nlu.js antes de app.js', () => {
    const nluIdx = appHtml.indexOf('src="modules/agents/nlu.js"');
    const appIdx = appHtml.indexOf('src="app.js"');
    expect(nluIdx).toBeGreaterThan(0);
    expect(nluIdx).toBeLessThan(appIdx);
  });

  it('carrega orchestrator.js antes de app.js', () => {
    const orchIdx = appHtml.indexOf('src="modules/agents/orchestrator.js"');
    const appIdx = appHtml.indexOf('src="app.js"');
    expect(orchIdx).toBeGreaterThan(0);
    expect(orchIdx).toBeLessThan(appIdx);
  });

  it('carrega command-palette.js antes de app.js', () => {
    const cpIdx = appHtml.indexOf('src="modules/ui/command-palette.js"');
    const appIdx = appHtml.indexOf('src="app.js"');
    expect(cpIdx).toBeGreaterThan(0);
    expect(cpIdx).toBeLessThan(appIdx);
  });

  it('contém painel de integrações com id="integrations-panel"', () => {
    expect(appHtml).toContain('id="integrations-panel"');
  });

  it('contém toggle de consentimento AI com id="ai-consent-toggle"', () => {
    expect(appHtml).toContain('id="ai-consent-toggle"');
  });

  it('contém botão de comandos no sidebar', () => {
    expect(appHtml).toContain('data-action="open-command-palette"');
  });

  it('respeita ordem de scripts: skills > places > nlu > central-view > command-palette > orchestrator > manifest > app', () => {
    const order = [
      'planner-skills.js',
      'places.js',
      'nlu.js',
      'central-view.js',
      'command-palette.js',
      'orchestrator.js',
      'manifest.js',
      'app.js',
    ];
    let lastIdx = -1;
    for (const name of order) {
      const idx = appHtml.indexOf(`src="${name}"`) !== -1
        ? appHtml.indexOf(`src="${name}"`)
        : appHtml.indexOf(name);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it('CSP connect-src permanece none', () => {
    expect(appHtml).toContain("connect-src 'none'");
  });

  it('copy visível não contém "cofre" ou "vault"', () => {
    // Verificamos apenas o conteúdo de texto fora de ids/classes/scripts
    // Simplificação: verificar que não há "cofre" no HTML (exceto nomes internos)
    const htmlLower = appHtml.toLowerCase();
    // "cofre" não aparece como texto visível
    const textParts = appHtml.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '');
    expect(textParts.toLowerCase()).not.toContain('cofre');
    // "vault" pode aparecer em data-action="lock-vault" mas not as visible text
    const visibleVault = textParts.toLowerCase().includes('vault');
    expect(visibleVault).toBe(false);
  });
});

// ===================================================================
// Asserts estáticos sobre app.js
// ===================================================================

describe('app.js — composição do assistente', () => {
  it('chama PlannerOrchestrator.create', () => {
    expect(appJs).toContain('PlannerOrchestrator');
    expect(appJs).toContain('Orchestrator.create(');
  });

  it('chama PlannerCentralView.create', () => {
    expect(appJs).toContain('PlannerCentralView');
    expect(appJs).toContain('CentralView.create(');
  });

  it('chama orchestrator.clear() no caminho de bloqueio', () => {
    expect(appJs).toContain('orchestrator?.clear?.()');
  });

  it('chama runtime.reset() no caminho de bloqueio', () => {
    expect(appJs).toContain('runtime?.reset()');
  });

  it('reseta aiConsent no bloqueio', () => {
    expect(appJs).toContain('state.aiConsent = null');
  });

  it('desmarca ai-consent-toggle no bloqueio', () => {
    expect(appJs).toContain("document.getElementById('ai-consent-toggle')");
  });

  it('navega para central como padrão', () => {
    expect(appJs).toContain("navigate(validRequestedView ? requestedView : 'central'");
  });

  it('inclui central no loginTarget allowedViews', () => {
    expect(appJs).toContain("'central', 'dashboard'");
  });

  it('foca o compositor ao navegar para central', () => {
    expect(appJs).toContain('#central-root textarea');
  });

  it('registra Ctrl+K para abrir a paleta', () => {
    expect(appJs).toContain("event.key === 'k'");
    expect(appJs).toContain('openCommandPalette');
  });

  it('registra handler para ai-consent-toggle change', () => {
    expect(appJs).toContain("aiToggle.addEventListener('change'");
  });
});

// ===================================================================
// Asserts estáticos sobre auth.js
// ===================================================================

describe('auth.js — loginTarget allowlist', () => {
  it('inclui "central" na regex', () => {
    expect(authJs).toContain('central|dashboard');
  });
});
