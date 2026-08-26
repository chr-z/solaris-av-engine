// Solaris v3 — F2 QoL — painel de conforto de mídia no player (spec A2:
// pular silêncio >2s configurável + volume normalize leve opcional).
//
// Popover com dois switches acessíveis (role=switch). Estado vem do
// useMediaComfort (mesma fonte canônica do player) e o ganho/pausas derivam
// da waveform REAL carregada no momento.

import React from 'react';
import Popover from '../Core/Popover';
import { useI18n } from '../../i18n/I18nContext';
import type { MediaComfortApi } from '../../features/qol/useMediaComfort';

export interface MediaComfortToggleProps {
  /** API compartilhada com o VideoPlayer (mesmo estado, zero duplicação). */
  api: MediaComfortApi;
}

const MediaComfortToggle: React.FC<MediaComfortToggleProps> = ({ api }) => {
  const { t } = useI18n();
  const { prefs, setPrefs } = api;
  const skipOn = prefs.silenceSkip === 'skip';

  const toggleSkip = () =>
    setPrefs({ ...prefs, silenceSkip: skipOn ? 'off' : 'skip' });
  const toggleNormalize = () =>
    setPrefs({ ...prefs, normalize: !prefs.normalize });

  return (
    <Popover
      contentClassName="w-64"
      trigger={
        <button
          type="button"
          data-testid="media-comfort-trigger"
          aria-label={t('mediaComfort.label')}
          title={t('mediaComfort.label')}
          className={`p-1 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-solar-accent ${
            skipOn || prefs.normalize
              ? 'text-amber-300'
              : 'text-white hover:bg-white/10'
          }`}
        >
          <span aria-hidden="true" className="text-sm font-bold">♪</span>
        </button>
      }
    >
      {(close) => (
        <div className="p-3 space-y-3" data-testid="media-comfort-panel">
          <p className="text-xs font-semibold text-gray-300">{t('mediaComfort.label')}</p>

          {/* Skip silêncio */}
          <label className="flex items-start justify-between gap-3 cursor-pointer">
            <span>
              <span className="block text-sm text-gray-200">{t('mediaComfort.skipSilence')}</span>
              <span className="block text-xs text-gray-400">
                {t('mediaComfort.minSilence', { seconds: String(prefs.minSilenceSeconds) })}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={skipOn}
              data-testid="media-skip-switch"
              aria-label={t('mediaComfort.skipSilence')}
              onClick={() => {
                toggleSkip();
                close();
              }}
              className={`mt-0.5 relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-solar-accent ${
                skipOn ? 'bg-solar-accent' : 'bg-gray-500/50'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  skipOn ? 'translate-x-[1.15rem]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>

          {/* Normalize */}
          <label className="flex items-start justify-between gap-3 cursor-pointer">
            <span>
              <span className="block text-sm text-gray-200">{t('mediaComfort.normalize')}</span>
              <span className="block text-xs text-gray-400">
                {t('mediaComfort.normalizeHint')}
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.normalize}
              data-testid="media-normalize-switch"
              aria-label={t('mediaComfort.normalize')}
              onClick={() => {
                toggleNormalize();
                close();
              }}
              className={`mt-0.5 relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-solar-accent ${
                prefs.normalize ? 'bg-solar-accent' : 'bg-gray-500/50'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  prefs.normalize ? 'translate-x-[1.15rem]' : 'translate-x-0.5'
                }
                `}
              />
            </button>
          </label>

          {!api.hasEnvelope && (
            <p data-testid="media-comfort-no-envelope" className="text-xs text-amber-400/90">
              {t('mediaComfort.noEnvelope')}
            </p>
          )}
        </div>
      )}
    </Popover>
  );
};

export default MediaComfortToggle;
