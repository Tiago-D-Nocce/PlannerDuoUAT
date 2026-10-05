import { describe, expect, it, afterEach, vi } from 'vitest';
import { loadAuth } from './helpers/auth-harness.mjs';

/*
 * Tarefa 13.3 — mapeamento de erros de acesso de public/auth.js sobre os códigos
 * emitidos por public/local.js. Cada caso simula a falha, dispara o submit real
 * do formulário num DOM mínimo (node:vm) e prova que:
 *   - o status visível traz a mensagem pt-BR ESPECÍFICA do código, e nunca a
 *     genérica "Não foi possível concluir a operação com segurança.";
 *   - o botão de submit é restaurado (habilitado, sem spinner/estado "loading");
 *   - o foco é sensato e não houve redirecionamento (location.replace);
 *   - nenhum texto visível contém "cofre" ou "vault".
 */

const GENERIC = 'Não foi possível concluir a operação com segurança.';

function rejectWith(code) {
  return vi.fn(() => Promise.reject({ code }));
}

// Nenhum texto exposto ao usuário pode citar a implementação ("cofre"/"vault").
function assertNoVaultWording(harness) {
  const visible = harness.statusEl.textContent || '';
  expect(visible.toLowerCase()).not.toContain('cofre');
  expect(visible.toLowerCase()).not.toContain('vault');
}

// O botão de submit foi restaurado: habilitado e sem o spinner de carregamento.
function assertButtonRestored(button) {
  expect(button).toBeTruthy();
  expect(button.disabled).toBe(false);
  expect(button.innerHTML).not.toContain('button-spinner');
}

describe('access-errors — mapeamento de erros de criação de conta', () => {
  afterEach(() => vi.restoreAllMocks());

  const createCases = [
    {
      code: 'vault/locks-unavailable',
      message: 'Atualize o navegador: o bloqueio seguro entre abas não está disponível.',
    },
    {
      code: 'vault/crypto-unavailable',
      message: 'Atualize o navegador e acesse o app por localhost para usar criptografia.',
    },
    {
      code: 'local/storage-unavailable',
      message: 'Permita armazenamento local para criar ou abrir sua conta.',
    },
    {
      code: 'vault/already-exists',
      message: 'Esta conta já existe neste navegador. Faça login.',
    },
    {
      code: 'local/write-failed',
      message: 'Não há espaço suficiente para criptografar os dados. A cópia atual foi preservada.',
    },
  ];

  it.each(createCases)('createVault rejeita $code → mensagem específica, botão restaurado, sem redirect', async ({ code, message }) => {
    const createVault = rejectWith(code);
    const harness = loadAuth({ auth: { createVault } });
    const button = harness.setupForm.submitButton;

    await harness.submit(harness.setupForm).run();

    // Mensagem específica — e explicitamente NÃO a genérica.
    expect(harness.statusEl.textContent).toBe(message);
    expect(harness.statusEl.textContent).not.toBe(GENERIC);
    expect(harness.statusEl.textContent).not.toContain(GENERIC);
    // Classe de erro aplicada (estado visível de falha).
    expect(harness.statusEl.className).toContain('error');
    // Botão restaurado.
    assertButtonRestored(button);
    // Sem redirecionamento.
    expect(harness.locationReplace).not.toHaveBeenCalled();
    // Sem jargão de implementação.
    assertNoVaultWording(harness);
    expect(createVault).toHaveBeenCalledTimes(1);
  });

  it('vault/already-exists usa a copy rebatizada e não cita "cofre"', async () => {
    const harness = loadAuth({ auth: { createVault: rejectWith('vault/already-exists') } });
    await harness.submit(harness.setupForm).run();
    expect(harness.statusEl.textContent).toBe('Esta conta já existe neste navegador. Faça login.');
    expect(harness.statusEl.textContent).not.toMatch(/cofre/i);
    expect(harness.statusEl.textContent).not.toContain(GENERIC);
  });

  it('local/write-failed informa preservação da cópia atual dos dados', async () => {
    const harness = loadAuth({ auth: { createVault: rejectWith('local/write-failed') } });
    await harness.submit(harness.setupForm).run();
    expect(harness.statusEl.textContent).toContain('espaço');
    expect(harness.statusEl.textContent).toContain('cópia atual foi preservada');
    expect(harness.statusEl.textContent).not.toContain(GENERIC);
  });
});

describe('access-errors — desbloqueio (unlock)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('unlock rejeita vault/invalid-credentials → mensagem específica, contador sobe, senha limpa e refocada', async () => {
    const unlock = rejectWith('vault/invalid-credentials');
    const harness = loadAuth({
      status: { exists: true, account: { name: 'Pessoa Teste', email: 'teste@exemplo.com' } },
      auth: { unlock },
    });
    const passwordField = harness.ensure('unlock-password');
    passwordField.value = 'senha-que-estava-digitada';
    const button = harness.unlockForm.submitButton;

    await harness.submit(harness.unlockForm).run();

    expect(harness.statusEl.textContent).toBe('E-mail ou senha incorretos.');
    expect(harness.statusEl.textContent).not.toContain(GENERIC);
    expect(harness.statusEl.className).toContain('error');
    // Campo de senha limpo e refocado.
    expect(passwordField.value).toBe('');
    expect(passwordField.focus).toHaveBeenCalled();
    // Botão restaurado, sem redirecionamento.
    assertButtonRestored(button);
    expect(harness.locationReplace).not.toHaveBeenCalled();
    assertNoVaultWording(harness);
    expect(unlock).toHaveBeenCalledTimes(1);
  });

  it('cinco rejeições acionam o cooldown de 10 s e depois reabilitam o botão', async () => {
    vi.useFakeTimers();
    try {
      const unlock = rejectWith('vault/invalid-credentials');
      const harness = loadAuth({
        status: { exists: true, account: { name: 'Pessoa Teste', email: 'teste@exemplo.com' } },
        auth: { unlock },
        fakeTimers: true,
      });
      const button = harness.unlockForm.submitButton;

      // Cinco tentativas falhas incrementam failedAttempts até 5.
      for (let i = 0; i < 5; i += 1) {
        harness.ensure('unlock-password').value = 'tentativa';
        await harness.submit(harness.unlockForm).run();
      }
      expect(harness.statusEl.textContent).toBe('E-mail ou senha incorretos.');

      // A sexta tentativa cai no caminho de bloqueio: botão desabilitado e aviso.
      await harness.submit(harness.unlockForm).run();
      expect(button.disabled).toBe(true);
      expect(harness.statusEl.textContent).toContain('Muitas tentativas');
      expect(harness.statusEl.textContent).not.toContain(GENERIC);

      // Após 10 s o cooldown libera o botão e zera o contador.
      vi.advanceTimersByTime(10000);
      expect(button.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('access-errors — regressão de sucesso', () => {
  afterEach(() => vi.restoreAllMocks());

  it('createVault resolve → mensagem de sucesso, form.reset() e redirect, sem erro genérico', async () => {
    const createVault = vi.fn(() => Promise.resolve({ migrated: false }));
    const harness = loadAuth({ auth: { createVault } });

    // currentTarget zera quando o await resolve, como no navegador real.
    const { event, run } = harness.submit(harness.setupForm);
    createVault.mockImplementation(() => Promise.resolve().then(() => {
      event._ct = null;
      return { migrated: false };
    }));
    await run();

    expect(harness.setupForm.reset).toHaveBeenCalledTimes(1);
    expect(harness.statusEl.textContent).toBe('Conta criada, abrindo…');
    expect(harness.statusEl.textContent).not.toContain(GENERIC);
    expect(harness.locationReplace).toHaveBeenCalledWith('app.html');
    assertNoVaultWording(harness);
  });

  it('createVault resolve com migrated:true → mensagem de migração protegida', async () => {
    const harness = loadAuth({ auth: { createVault: vi.fn(() => Promise.resolve({ migrated: true })) } });
    await harness.submit(harness.setupForm).run();
    expect(harness.statusEl.textContent).toBe('Dados existentes protegidos, abrindo…');
    expect(harness.statusEl.textContent).not.toContain(GENERIC);
    expect(harness.locationReplace).toHaveBeenCalledWith('app.html');
  });
});

describe('access-errors — fallback genérico ainda existe para erro desconhecido', () => {
  afterEach(() => vi.restoreAllMocks());

  it('createVault rejeita código desconhecido → cai na mensagem genérica (fallback preservado)', async () => {
    const harness = loadAuth({ auth: { createVault: rejectWith('vault/boom-desconhecido') } });
    const button = harness.setupForm.submitButton;
    await harness.submit(harness.setupForm).run();
    expect(harness.statusEl.textContent).toBe(GENERIC);
    assertButtonRestored(button);
    expect(harness.locationReplace).not.toHaveBeenCalled();
  });

  it('nenhum dos códigos mapeados cai no texto genérico', async () => {
    const mapped = [
      'vault/locks-unavailable',
      'vault/crypto-unavailable',
      'local/storage-unavailable',
      'vault/already-exists',
      'local/write-failed',
      'vault/invalid-credentials',
      'vault/invalid-email',
      'vault/invalid-name',
      'vault/weak-password',
      'vault/legacy-invalid',
    ];
    for (const code of mapped) {
      const harness = loadAuth({ auth: { createVault: rejectWith(code) } });
      await harness.submit(harness.setupForm).run();
      expect(harness.statusEl.textContent, `código ${code} não deveria usar o texto genérico`).not.toBe(GENERIC);
      expect(harness.statusEl.textContent.length).toBeGreaterThan(0);
    }
  });
});
