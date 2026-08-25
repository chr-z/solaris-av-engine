import React from 'react';
import { GoogleIcon } from '../Core/icons';
import SolarisLogo from '../Core/SolarisLogo';
import { useI18n } from '../../i18n/I18nContext';
import LanguageSwitcher from '../../i18n/LanguageSwitcher';

interface LoginScreenProps {
  onLogin: () => void;
  onGuestLogin?: () => void; // Added for Demo Mode
  isLoading: boolean;
  error: string | null;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, onGuestLogin, isLoading, error }) => {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center h-screen w-screen bg-bg text-gray-200 font-sans relative overflow-hidden">
      {/* Background Elements */}
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
              className="mt-4 text-sm text-gray-400 hover:text-white transition-colors underline"
            >
              {t('login.continueAsGuest')}
            </button>
        )}

        {error && (
          <div className="mt-6 p-3 bg-red-500/10 border border-red-500/30 rounded-md text-red-300 text-sm w-full" role="alert">
            <p className="font-semibold">{t('login.authError')}</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        )}
      </div>
      <style>{`
        .animate-pulse-slow {
          animation: pulse 8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        .animation-delay-4000 {
          animation-delay: -4s;
        }
      `}</style>
    </div>
  );
};

export default LoginScreen;
