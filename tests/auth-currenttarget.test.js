import { describe, expect, it, afterEach, vi } from 'vitest';
import { loadAuth } from './helpers/auth-harness.mjs';
/*
 * Regressão: após `await Repository.auth.createVault(...)`, o navegador zera
 * `event.currentTarget` quando o despacho do evento termina. Se o handler lesse
 * `event.currentTarget` depois do await, chamaria `.reset()` sobre `null`,
 * lançaria TypeError, cairia no catch e mostraria a mensagem genérica em vez de
 * redirecionar — mesmo com a conta já criada.
 *
 * Este teste carrega public/auth.js num contexto node:vm com um DOM mínimo
 * (via tests/helpers/auth-harness.mjs) e dispara um 'submit' real em
 * #setup-vault-form. O evento sintético zera o seu próprio currentTarget assim
 * que o microtask do createVault resolve, simulando exatamente a semântica real
 * do navegador.
 */
describe('auth.js — referência estável do formulário após await', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('redireciona e usa reset() mesmo quando currentTarget vira null após o await', async () => {
    // createVault resolve só depois de um microtask, para que o currentTarget
    // já tenha sido zerado quando (num código bugado) fosse lido de novo.
    const createVault = vi.fn(() => Promise.resolve({ migrated: false }));
    const harness = loadAuth({ auth: { createVault } });

    const { handler, event, run } = harness.submit(harness.setupForm);
    expect(typeof handler).toBe('function');

    // Agenda o "zeramento" para logo após o await de createVault resolver — o
    // navegador zera currentTarget quando o dispatch termina.
    createVault.mockImplementation(() => Promise.resolve().then(() => {
      event._ct = null;
      return { migrated: false };
    }));

    await run();

    // Com a correção, reset() foi chamado via referência estável `form`.
    expect(harness.setupForm.reset).toHaveBeenCalledTimes(1);
    // E o redirecionamento ocorreu em vez da mensagem genérica de erro.
    expect(harness.locationReplace).toHaveBeenCalledWith('app.html');
    expect(harness.statusEl.textContent).toBe('Conta criada, abrindo…');
    expect(harness.statusEl.textContent).not.toContain('Não foi possível concluir a operação com segurança.');
    expect(createVault).toHaveBeenCalledTimes(1);
  });
});
