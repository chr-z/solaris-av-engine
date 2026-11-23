import React from 'react';
import { GoogleIcon } from '../Core/icons';
import SolarisLogo from '../Core/SolarisLogo';
import { useI18n } from '../../i18n/I18nContext';
import { isFirebaseConfigured } from '../../config/firebase';
import LanguageSwitcher from '../../i18n/LanguageSwitcher';
import { humanizeAuthError } from '../../utils/humanErrors';
import './login.css';

interface LoginScreenProps {
  onLogin: () => void;
  onGuestLogin?: () => void; // Added for Demo Mode
  /** Optional: brings the Arrival tour back. */
  onReplayTour?: () => void;
  isLoading: boolean;
  error: string | null;
}

/** Decorative scope glyphs for the spec panel. */
const ScopeGlyphs: React.FC = () => (
  <svg viewBox="0 0 240 96" className="login__glyphs" aria-hidden="true" fill="none">
    {[0, 1, 2].map((col) => (
      <g key={col} transform={`translate(${col * 80 + 8} 8)`}>
        <rect x="0.5" y="0.5" width="63" height="79" stroke="currentColor" strokeOpacity="0.18" />
        {[0, 1, 2, 3].map((i) => (
          <line key={i} x1="0" y1={16 * (i + 1)} x2="64" y2={16 * (i + 1)} stroke="currentColor" strokeOpacity="0.1" />
        ))}
        {col === 0 &&
          Array.from({ length: 26 }).map((_, i) => (
            <line
              key={i}
              x1={4 + i * 2.2}
              y1={70 - Math.sin(i * 0.7) * 12 - (i % 5) * 2}
              x2={4 + i * 2.2}
              y2={70 - Math.sin(i * 0.7) * 12 + 6}
              stroke="currentColor"
              strokeOpacity="0.55"
            />
          ))}
        {col === 1 &&
          Array.from({ length: 18 }).map((_, i) => (
            <line
              key={i}
              x1={4 + i * 3.2}
              y1={72 - (i % 7) * 7}
              x2={4 + i * 3.2}
              y2={40 + (i % 4) * 6}
              stroke="currentColor"
              strokeOpacity="0.45"
            />
          ))}
        {col === 2 && (
          <>
            <circle cx="32" cy="40" r="24" stroke="currentColor" strokeOpacity="0.35" />
            <line x1="8" y1="40" x2="56" y2="40" stroke="currentColor" strokeOpacity="0.18" />
            <line x1="32" y1="16" x2="32" y2="64" stroke="currentColor" strokeOpacity="0.18" />
            <circle cx="22" cy="30" r="1.6" fill="currentColor" fillOpacity="0.8" />
            <circle cx="30" cy="26" r="1.2" fill="currentColor" fillOpacity="0.6" />
            <circle cx="38" cy="34" r="1.4" fill="currentColor" fillOpacity="0.7" />
          </>
        )}
      </g>
    ))}
  </svg>
);

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, onGuestLogin, onReplayTour, isLoading, error }) => {
  const { t } = useI18n();

  return (
    <main className="login">
      <header className="login__top">
        <a className="login__brand" href="https://chr-z.dev/">
          <SolarisLogo size={20} />
          <span>Solaris</span>
          <em>by chr-z</em>
        </a>
        <div className="login__top-right">
          <LanguageSwitcher />
          {onReplayTour && (
            <button type="button" className="login__tour" onClick={onReplayTour}>
              Tour <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </header>

      <div className="login__body">
        <section className="login__card">
          <p className="label login__label">{t('login.tagline')}</p>
          <h1 className="login__title">Solaris</h1>

          <button
            onClick={onLogin}
            disabled={isLoading}
            className="btn btn-primary login__google"
          >
            {isLoading ? (
              <span className="login__spinner" aria-hidden="true" />
            ) : (
              <GoogleIcon className="w-5 h-5" />
            )}
            <span>{isLoading ? t('login.connecting') : t('login.signInGoogle')}</span>
          </button>

          {onGuestLogin && (
            <button onClick={onGuestLogin} disabled={isLoading} className="btn btn-ghost login__guest">
              {t('login.continueAsGuest')}
            </button>
          )}

          {!isFirebaseConfigured() && (
            <p className="login__notice" data-testid="demo-mode-notice">
              {t('login.demoNotice')}
            </p>
          )}

          {error && (() => {
            // R3: erro humano — nunca o raw error do provider.
            const he = humanizeAuthError(error);
            return (
              <div className="cta__error" role="alert">
                <strong>{he.title}</strong>
                <span>{he.hint}</span>
              </div>
            );
          })()}
        </section>

        <aside className="login__spec" aria-hidden="true">
          <ScopeGlyphs />
          <ul className="login__list">
            <li><span>RGB parade</span><em>per-channel exposure</em></li>
            <li><span>Waveform</span><em>luma vs. safe range</em></li>
            <li><span>Vectorscope</span><em>hue and saturation</em></li>
            <li><span>Spectrogram</span><em>hum, hiss, dead air</em></li>
            <li><span>QC report</span><em>timecode, signed, PDF</em></li>
          </ul>
        </aside>
      </div>
    </main>
  );
};

export default LoginScreen;
