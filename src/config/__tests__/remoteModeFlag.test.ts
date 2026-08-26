import { describe, it, expect } from 'vitest';
import {
  normalizeCommandPayload,
  normalizeDeployConfigBody,
  opinionToApply,
  noOpinion,
  fetchCoreModeOpinion,
} from '../remoteModeFlag';

describe('remoteModeFlag — normalização das fontes', () => {
  it('payload do core vira opinião legível (env/file)', () => {
    expect(normalizeCommandPayload({ standalone: true, source: 'env' })).toEqual({
      standalone: true,
      origin: 'env (core)',
    });
    expect(normalizeCommandPayload({ standalone: false, source: 'file' })).toEqual({
      standalone: false,
      origin: 'file (core)',
    });
  });

  it('payload sem opinião (null) ou lixo vira sem opinião', () => {
    expect(normalizeCommandPayload(null)).toEqual(noOpinion());
    expect(normalizeCommandPayload(undefined)).toEqual(noOpinion());
    expect(normalizeCommandPayload('lixo')).toEqual(noOpinion());
    expect(normalizeCommandPayload({ standalone: 'sim' })).toEqual(noOpinion());
    expect(normalizeCommandPayload({ standalone: null })).toEqual(noOpinion());
    // source desconhecida ainda carrega a opinião booleana.
    expect(normalizeCommandPayload({ standalone: true, source: 42 })).toEqual({
      standalone: true,
      origin: 'core',
    });
  });

  it('corpo do solaris.config.json só fala com boolean de verdade', () => {
    expect(normalizeDeployConfigBody({ standaloneMode: true })).toEqual({
      standalone: true,
      origin: 'deploy config.local',
    });
    expect(normalizeDeployConfigBody({ standaloneMode: false }).standalone).toBe(false);
    expect(normalizeDeployConfigBody({})).toEqual(noOpinion());
    expect(normalizeDeployConfigBody({ standaloneMode: 'true' })).toEqual(noOpinion());
    expect(normalizeDeployConfigBody(null)).toEqual(noOpinion());
    expect(normalizeDeployConfigBody([1, 2])).toEqual(noOpinion());
  });
});

describe('remoteModeFlag — guarda anti-rebaixamento', () => {
  it('opinião standalone se aplica sempre (liga em qualquer artefato)', () => {
    expect(opinionToApply({ standalone: true, origin: 'x' }, false)).toBe(true);
    expect(opinionToApply({ standalone: true, origin: 'x' }, true)).toBe(true);
  });

  it('opinião cloud NUNCA desliga quem já nasceu standalone', () => {
    expect(opinionToApply({ standalone: false, origin: 'x' }, true)).toBeNull();
  });

  it('opinião cloud vale quando o local é cloud por padrão', () => {
    expect(opinionToApply({ standalone: false, origin: 'x' }, false)).toBe(false);
  });

  it('sem opinião não decide nada', () => {
    expect(opinionToApply(noOpinion(), false)).toBeNull();
    expect(opinionToApply(noOpinion(), true)).toBeNull();
  });
});

describe('remoteModeFlag — consulta ao core é best-effort', () => {
  it('sem ponte Tauri resolve sem opinião (web pura/testes)', async () => {
    const opinion = await fetchCoreModeOpinion();
    expect(opinion.standalone).toBeNull();
    expect(opinion.origin).toBeNull();
  });
});
