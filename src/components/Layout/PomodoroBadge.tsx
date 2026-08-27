// Solaris v3 — F2 QoL — badge do timer de pausa (Pomodoro) no Header (spec A2).
//
// Botão discreto: ☕ ocioso · relógio correndo · ⏰ expirado (âmbar = lembrete
// gentil). O popover traz status + ações. Estado via subscrição ao
// PomodoroController (singleton); recarregar a página NÃO reinicia o bloco —
// resume() rearma o aviso do mesmo fim persistido (crash-safe).

import React, { useEffect, useState } from 'react';
import Popover from '../Core/Popover';
import {
  PomodoroController,
  formatPomodoroClock,
  type PomodoroSnapshot,
} from '../../features/qol/pomodoro';
import { useI18n } from '../../i18n/I18nContext';

let singleton: PomodoroController | null = null;

/** Controller padrão do app (aviso gentil também via evento de janela). */
export function getPomodoroController(): PomodoroController {
  if (!singleton) {
    singleton = new PomodoroController({
      onExpire: () => {
        try {
          window.dispatchEvent(new Event('solaris:pomodoro-expired'));
        } catch {
          // ambiente sem window — ignora
        }
      },
    });
  }
  return singleton;
}

export interface PomodoroBadgeProps {
  /** Injeção p/ testes; padrão = singleton do app. */
  controller?: PomodoroController;
}

const PomodoroBadge: React.FC<PomodoroBadgeProps> = ({ controller }) => {
  const c = controller ?? getPomodoroController();
  const { t } = useI18n();
  const [snap, setSnap] = useState<PomodoroSnapshot>(() => c.snapshot());

  // Mount: assina e rearma bloco persistido (reload/crash). O snapshot
  // correto JÁ veio no useState inicial; aqui só sincronizamos com o sistema
  // externo (sem setState no corpo do effect).
  useEffect(() => {
    const unsub = c.subscribe(setSnap);
    c.resume();
    return () => {
      unsub();
    };
  }, [c]);

  // Tick do relógio somente enquanto rodando (zero custo fora dele).
  useEffect(() => {
    if (snap.phase !== 'running') return;
    const id = window.setInterval(() => setSnap(c.snapshot()), 500);
    return () => window.clearInterval(id);
  }, [snap.phase, c]);

  const expired = snap.phase === 'expired';
  const running = snap.phase === 'running';

  return (
    <Popover
      contentClassName="w-56"
      trigger={
        <button
          type="button"
          data-testid="pomodoro-badge"
          aria-label={t('pomodoro.label')}
          title={
            running
              ? t('pomodoro.runningTitle')
              : expired
                ? t('pomodoro.expiredTitle')
                : t('pomodoro.label')
          }
          className={`px-2 py-1 rounded-md text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-solar-accent ${
            expired
              ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-500/10 hover:text-gray-800 dark:hover:text-gray-200'
          }`}
        >
          <span aria-hidden="true">{running ? formatPomodoroClock(snap.remainingSeconds) : expired ? '⏰' : '☕'}</span>
        </button>
      }
    >
      {(close) => (
        <div className="p-3" data-testid="pomodoro-popover">
          <p className="text-xs font-semibold text-gray-300 mb-2">{t('pomodoro.label')}</p>
          <p role="status" data-testid="pomodoro-status" className="text-sm text-gray-200 mb-3">
            {running && (
              <>
                <span className="font-mono text-lg" data-testid="pomodoro-clock">
                  {formatPomodoroClock(snap.remainingSeconds)}
                </span>{' '}
                — {t('pomodoro.runningTitle')}
              </>
            )}
            {expired && t('pomodoro.expiredTitle')}
            {snap.phase === 'idle' && t('pomodoro.start')}
          </p>
          {!running && (
            <button
              type="button"
              data-testid="pomodoro-start"
              onClick={() => {
                setSnap(c.start());
                close();
              }}
              className="w-full text-left px-3 py-2 text-sm rounded-md text-gray-200 hover:bg-gray-500/20 transition-colors"
            >
              {expired ? t('pomodoro.restart') : t('pomodoro.start')}
            </button>
          )}
          {running && (
            <button
              type="button"
              data-testid="pomodoro-stop"
              onClick={() => {
                setSnap(c.stop());
                close();
              }}
              className="w-full text-left px-3 py-2 text-sm rounded-md text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors"
            >
              {t('pomodoro.stop')}
            </button>
          )}
        </div>
      )}
    </Popover>
  );
};

export default PomodoroBadge;
