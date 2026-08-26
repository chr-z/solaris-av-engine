import { describe, it, expect } from 'vitest';
import { isLocalOnlySession } from '../cloudGuards';

describe('cloudGuards.isLocalOnlySession', () => {
  it('sessões locais conhecidas NUNCA tocam presence (guest e revisor local)', () => {
    expect(isLocalOnlySession({ id: 'guest-reviewer-id' })).toBe(true);
    expect(isLocalOnlySession({ id: 'local-reviewer' })).toBe(true);
  });

  it('sem perfil, sem id ou id vazio → sessão não é de nuvem', () => {
    expect(isLocalOnlySession(null)).toBe(true);
    expect(isLocalOnlySession(undefined)).toBe(true);
    expect(isLocalOnlySession({})).toBe(true);
    expect(isLocalOnlySession({ id: '' })).toBe(true);
    expect(isLocalOnlySession({ id: null })).toBe(true);
  });

  it('usuário Google real (id arbitrário) → presence permitido', () => {
    expect(isLocalOnlySession({ id: 'uid-firebase-123' })).toBe(false);
    expect(isLocalOnlySession({ id: 'x' })).toBe(false);
  });
});
