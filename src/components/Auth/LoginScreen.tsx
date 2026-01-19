import React from 'react';
import { GoogleIcon } from '../Core/icons';

interface LoginScreenProps {
  onLogin: () => void;
  onGuestLogin?: () => void; // Added for Demo Mode
  isLoading: boolean;
  error: string | null;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, onGuestLogin, isLoading, error }) => {
  return (
    <div className="flex flex-col items-center justify-center h-screen w-screen bg-solar-dark-bg text-gray-200 font-sans relative overflow-hidden">
      {/* Background Elements */}
      <div className="absolute inset-0 bg-gradient-to-br from-solar-dark-content via-solar-dark-bg to-solar-dark-bg opacity-50"></div>
      <div className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 bg-solar-accent/10 rounded-full filter blur-3xl animate-pulse-slow"></div>
      <div className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-yellow-400/10 rounded-full filter blur-3xl animate-pulse-slow animation-delay-4000"></div>

      <div className="relative z-10 flex flex-col items-center text-center p-8 max-w-md w-full bg-solar-dark-content/50 backdrop-blur-md rounded-xl border border-solar-dark-border shadow-2xl">
        <div className="w-16 h-16 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full mb-6 shadow-lg"></div>
        <h1 className="text-5xl font-bold text-white tracking-tight">Solaris</h1>
        <p className="mt-2 text-lg text-gray-400">Audiovisual Analysis Platform</p>
        
        <div className="w-full h-px bg-solar-dark-border my-8"></div>

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
          <span>{isLoading ? 'Connecting...' : 'Sign in with Google'}</span>
        </button>

        {/* Guest/Demo Button */}
        {onGuestLogin && (
            <button
              onClick={onGuestLogin}
              disabled={isLoading}
              className="mt-4 text-sm text-gray-400 hover:text-white transition-colors underline"
            >
              Continue as Guest (Demo Mode)
            </button>
        )}

        {error && (
          <div className="mt-6 p-3 bg-red-500/10 border border-red-500/30 rounded-md text-red-300 text-sm w-full">
            <p className="font-semibold">Authentication Error</p>
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