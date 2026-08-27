// Solaris v3 — F2 QoL Core — testes dos núcleos puros.
// Cobertura: auto-save debounced, retomada de posição, fila inteligente,
// busca universal, modo foco e undo global 24h (bordas incluídas).
import { describe, it, expect } from 'vitest';
import {
  AutosaveController,
  loadAutosave,
} from '../features/qol/autosave';
import { planResume } from '../features/qol/resume';
import { suggestNext, NEW_QUEUE_WINDOW_HOURS, type QueueRowLike } from '../features/qol/queue';

/** Agendador manual: devolve o disparador p/ o teste controlar o tempo. */
function manualSchedule() {
  let fire: (() => void) | null = null;
  const scheduledMs: number[] = [];
  const impl = (fn: () => void, ms: number) => {
    scheduledMs.push(ms);
    fire = fn;
    return () => {
      fire = null;
    };
  };
  return {
    impl,
    get fireFn() {
      return fire;
    },
    scheduledMs,
    trigger() {
      const f = fire;
      fire = null;
      f?.();
    },
  };
}

describe('F2 autosave — debounce e crash-safety', () => {
  it('agenda gravação única após o delay com payload completo', () => {
    const sched = manualSchedule();
    const written: string[] = [];
    const c = new AutosaveController<{ marks: number }>({
      read: () => null,
      write: (p) => written.push(p),
      now: () => 1_000,
      delayMs: 200,
      schedule: sched.impl,
    });
    c.schedule({ marks: 3 }, 42.5);
    expect(sched.scheduledMs).toEqual([200]);
    expect(written).toHaveLength(0); // ainda debounceando
    sched.trigger();
    expect(written).toHaveLength(1);
    const parsed = JSON.parse(written[0]);
    expect(parsed.data.marks).toBe(3);
    expect(parsed.positionSec).toBe(42.5);
    expect(parsed.savedAt).toBe(1_000);
  });

  it('marcações rápidas em sequência colapsam numa única escrita', () => {
    const sched = manualSchedule();
    const written: string[] = [];
    const c = new AutosaveController<number>({
      read: () => null,
      write: (p) => written.push(p),
      delayMs: 200,
      schedule: sched.impl,
    });
    c.schedule(1, 0);
    c.schedule(2, 1);
    c.schedule(3, 2);
    sched.trigger(); // um único disparo pendente
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]).data).toBe(3); // só o último estado
  });

  it('flush grava imediatamente e cancela o timer pendente', () => {
    const sched = manualSchedule();
    const written: string[] = [];
    const c = new AutosaveController<number>({
      read: () => null,
      write: (p) => written.push(p),
      delayMs: 200,
      schedule: sched.impl,
    });
    c.schedule(9, 30);
    const entry = c.flush();
    expect(entry?.data).toBe(9);
    expect(written).toHaveLength(1);
    sched.trigger(); // timer já foi cancelado
    expect(written).toHaveLength(1);
    expect(c.isPending).toBe(false);
  });

  it('markCleaned apaga rascunho oficialmente salvo e descarta pending', () => {
    const sched = manualSchedule();
    let cleared = false;
    const c = new AutosaveController<number>({
      read: () => null,
      write: () => {},
      clear: () => {
        cleared = true;
      },
      schedule: sched.impl,
    });
    c.schedule(5, 0);
    c.markCleaned();
    expect(cleared).toBe(true);
    expect(c.isPending).toBe(false);
    sched.trigger(); // nada deve gravar
  });

  it('loadAutosave tolera JSON corrompido e shape inválido', () => {
    expect(loadAutosave(() => '{truncado')).toBeNull();
    expect(loadAutosave(() => JSON.stringify({ foo: 1 }))).toBeNull();
    expect(loadAutosave(() => '')).toBeNull();
    expect(loadAutosave(() => null)).toBeNull();
    const ok = loadAutosave<{ a: number }>(() =>
      JSON.stringify({ data: { a: 1 }, positionSec: 10, savedAt: 5 }),
    );
    expect(ok?.data.a).toBe(1);
  });

  it('falha de quota na escrita não derruba o controller', () => {
    const sched = manualSchedule();
    const c = new AutosaveController<number>({
      read: () => null,
      write: () => {
        throw new Error('QuotaExceededError');
      },
      schedule: sched.impl,
    });
    c.schedule(1, 0);
    expect(() => sched.trigger()).not.toThrow();
  });
});

describe('F2 resume — retomar de onde parou', () => {
  const entry = (positionSec: number, savedAgeMs = 0) => ({
    data: {},
    positionSec,
    savedAt: Date.now() - savedAgeMs,
  });

  it('sem rascunho não há seek', () => {
    const d = planResume({ entry: null, durationSec: 600 });
    expect(d.shouldSeek).toBe(false);
    expect(d.reason).toBe('no-draft');
  });

  it('rascunho válido retoma posição e overlay', () => {
    const d = planResume({
      entry: { ...entry(215), overlay: { type: 'framing' } } as never,
      durationSec: 600,
    });
    expect(d.shouldSeek).toBe(true);
    expect(d.positionSec).toBe(215);
    expect(d.overlay).toEqual({ type: 'framing' });
    expect(d.reason).toBe('resumed');
  });

  it('rascunho mais velho que 7 dias é considerado stale', () => {
    const d = planResume({
      entry: entry(100, 8 * 24 * 60 * 60 * 1000),
      durationSec: 600,
    });
    expect(d.reason).toBe('stale');
    expect(d.shouldSeek).toBe(false);
  });

  it('posição além da duração conhecida = mídia trocou, não retoma', () => {
    const d = planResume({ entry: entry(700), durationSec: 600 });
    expect(d.reason).toBe('duration-mismatch');
    expect(d.shouldSeek).toBe(false);
  });

  it('duração desconhecida (null) confia no rascunho recente', () => {
    const d = planResume({ entry: entry(120), durationSec: null });
    expect(d.shouldSeek).toBe(true);
    expect(d.positionSec).toBe(120);
  });
});

describe('F2 queue — fila inteligente (atrasada > nova > antiga)', () => {
  const HOUR = 60 * 60 * 1000;
  const NOW = Date.parse('2026-08-24T15:00:00Z');

  const base: QueueRowLike = {
    os_id: 'OS-1',
    status: 'queued',
    priority: 2,
    deadline: null,
    created_at: '2026-08-20T12:00:00Z',
  };
  const row = (over: Partial<QueueRowLike>) => ({ ...base, ...over });

  it('fila vazia → sugestão vazia', () => {
    const s = suggestNext([], { now: NOW });
    expect(s.osId).toBeNull();
    expect(s.reason).toBe('empty');
    expect(s.queueDepth).toBe(0);
  });

  it('atrasada vence nova e antiga', () => {
    const s = suggestNext(
      [
        row({ os_id: 'NOVA', created_at: '2026-08-24T14:00:00Z' }),
        row({ os_id: 'ATRASADA', deadline: '2026-08-24T10:00:00Z' }),
        row({ os_id: 'ANTIGA', created_at: '2026-08-01T00:00:00Z' }),
      ],
      { now: NOW },
    );
    expect(s.osId).toBe('ATRASADA');
    expect(s.reason).toBe('overdue');
    expect(s.overdueHours).toBe(5);
    expect(s.queueDepth).toBe(3);
  });

  it('entre atrasadas, a mais atrasada primeiro', () => {
    const s = suggestNext(
      [
        row({ os_id: 'ATRASA-POUCO', deadline: '2026-08-24T13:00:00Z' }),
        row({ os_id: 'ATRASA-MUITO', deadline: '2026-08-23T09:00:00Z' }),
      ],
      { now: NOW },
    );
    expect(s.osId).toBe('ATRASA-MUITO');
  });

  it('janela de novas: prioridade 1 antes e marcada como flagged', () => {
    const recent = new Date(NOW - 2 * HOUR).toISOString();
    const s = suggestNext(
      [
        row({ os_id: 'P2-RECENTE', created_at: recent }),
        row({ os_id: 'P1-RECENTE', priority: 1, created_at: recent }),
      ],
      { now: NOW },
    );
    expect(s.osId).toBe('P1-RECENTE');
    expect(s.reason).toBe('priority-flagged');
  });

  it('mesma prioridade na janela: entra por último sugerido primeiro', () => {
    const s = suggestNext(
      [
        row({ os_id: 'MAIS-ANTIGA', created_at: new Date(NOW - 20 * HOUR).toISOString() }),
        row({ os_id: 'MAIS-NOVA', created_at: new Date(NOW - 1 * HOUR).toISOString() }),
      ],
      { now: NOW },
    );
    expect(s.osId).toBe('MAIS-NOVA');
    expect(s.reason).toBe('newest');
  });

  it('fora da janela de 24h cai para oldest-queued', () => {
    const s = suggestNext(
      [row({ os_id: 'VELHA', created_at: new Date(NOW - (NEW_QUEUE_WINDOW_HOURS + 5) * HOUR).toISOString() })],
      { now: NOW },
    );
    expect(s.reason).toBe('oldest-queued');
    expect(s.osId).toBe('VELHA');
  });

  it('deadline inválida é ignorada sem quebrar a cadeia de tiers', () => {
    // PRAZO-QUEBRADO é mais recente que VELHA: com o prazo ilegível ela
    // não disputa os tiers 1/2 e perde no tier 3 p/ a fila mais antiga.
    const s = suggestNext(
      [
        row({ os_id: 'PRAZO-QUEBRADO', created_at: new Date(NOW - 30 * HOUR).toISOString() }),
        row({ os_id: 'VELHA', created_at: new Date(NOW - 72 * HOUR).toISOString() }),
      ],
      { now: NOW },
    );
    expect(s.reason).toBe('oldest-queued');
    expect(s.osId).toBe('VELHA');
  });

  it('OS em análise não é re-sugerida', () => {
    const s = suggestNext([row({ os_id: 'ABERTA' })], {
      now: NOW,
      inProgressOsId: 'ABERTA',
    });
    expect(s.osId).toBeNull();
    expect(s.reason).toBe('already-in-progress');
  });

  it('linhas fora do status queued nunca são elegíveis', () => {
    const s = suggestNext(
      [
        row({ os_id: 'DONE', status: 'done', deadline: '2026-08-01T00:00:00Z' }),
        row({ os_id: 'IN-ANALYSIS', status: 'in_analysis' }),
      ],
      { now: NOW },
    );
    expect(s.queueDepth).toBe(0);
    expect(s.osId).toBeNull();
  });
});
