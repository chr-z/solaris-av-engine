import React from 'react';
import { GoogleIcon } from '../Core/icons';
import SolarisLogo from '../Core/SolarisLogo';
import { useI18n } from '../../i18n/I18nContext';
import { isFirebaseConfigured } from '../../config/firebase';
import LanguageSwitcher from '../../i18n/LanguageSwitcher';
import { humanizeAuthError } from '../../utils/humanErrors';

interface LoginScreenProps {
  onLogin: () => void;
  onGuestLogin?: () => void; // Added for Demo Mode
  isLoading: boolean;
  error: string | null;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, onGuestLogin, isLoading, error }) => {
  const { t } = useI18n();
  return (
    <main className="flex flex-col items-center justify-center h-screen w-screen bg-solar-dark-bg text-gray-200 font-sans relative overflow-hidden">      {/* Background Elements */}
      <div className="absolute inset-0 bg-gradient-to-br from-surface via-bg to-bg opacity-50"></div>
      <div className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 bg-accent/10 rounded-full filter blur-3xl animate-pulse-slow"></div>
      <div className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-yellow-400/10 rounded-full filter blur-3xl animate-pulse-slow animation-delay-4000"></div>

      {/* Language selector — fixed top-right */}
      <div className="absolute top-4 right-4 z-20 bg-bg/60 rounded-md backdrop-blur-sm">
        <LanguageSwitcher />
      </div>

      <div className="relative z-10 flex flex-col items-center text-center p-8 max-w-md w-full bg-surface/50 backdrop-blur-md rounded-xl border border-hairline shadow-2xl">
        <SolarisLogo size={64} alwaysAnimate className="mb-6" />
        <h1 className="text-5xl font-bold text-white tracking-tight">Solaris</h1>
        <p className="mt-2 text-lg text-ink-secondary">{t('login.tagline')}</p>

        <div className="w-full h-px bg-hairline my-8"></div>

        <button
          onClick={onLogin}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-3 px-6 py-3 rounded-lg bg-white text-gray-800 font-semibold hover:bg-gray-200 transition-colors focus:outline-none focus:ring-4 focus:ring-solar-accent/50 disabled:opacity-50 disabled:cursor-wait"
        >
          {isLoading ? (
            <div className="w-6 h-6 border-2 border-solar-accent border-t-transparent rounded-full animate-spin"></div>
          ) : (
            <GoogleIcon className="w-6 h-6" />
          )}
          <span>{isLoading ? t('login.connecting') : t('login.signInGoogle')}</span>
        </button>

        {/* Guest/Demo Button */}
        {onGuestLogin && (
            <button
              onClick={onGuestLogin}
              disabled={isLoading}
              className="btn btn-ghost mt-4 w-full text-sm"
            >
              {t('login.continueAsGuest')}
            </button>
        )}

        {/* turbo-web: offline/demo builds carry no Firebase env vars */}
        {!isFirebaseConfigured() && (
            <p className="mt-4 text-xs text-gray-400" data-testid="demo-mode-notice">
              {t('login.demoNotice')}
            </p>
        )}

        {error && (() => {
          // R3: erro humano — nunca o raw error do provider.
          const he = humanizeAuthError(error);
          return (
            <div className="mt-6 p-3 bg-fail/10 border border-fail/30 rounded-md w-full" role="alert">
              <div className="flex items-start gap-2.5 text-left">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="flex-shrink-0 mt-0.5">
                  <circle cx="10" cy="10" r="8" stroke="var(--color-fail)" strokeWidth="1.5" />
                  <path d="M10 6v5" stroke="var(--color-fail)" strokeWidth="1.8" strokeLinecap="round" />
                  <circle cx="10" cy="13.8" r="1" fill="var(--color-fail)" />
                </svg>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-fail leading-snug">{he.title}</p>
                  <p className="text-xs text-ink-secondary mt-1 leading-relaxed">{he.hint}</p>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
      <style>{`
        .animate-pulse-slow {
          animation: pulse 8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .animation-delay-4000 {
          animation-delay: -4s;
        }
      `}</style>
    </main>
  );
};

export default LoginScreen;
