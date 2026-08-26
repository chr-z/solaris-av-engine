import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n/I18nContext';
import { LicenseProvider } from './licensing/LicenseContext';
import { registerServiceWorker } from './pwa/registerSW';
import { applyRemoteModeOpinion } from './config/runtimeMode';
import './styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Critical: Root element not found.");
}

// P3: o flag STANDALONE_MODE do ambiente (env/config via core Tauri ou
// solaris.config.json do deploy) precisa estar APLICADO antes do primeiro
// render — o modo é lido sincronamente durante a montagem (gates de UI).
// Consultas são best-effort com timeout curto: nunca derrubam o boot.
applyRemoteModeOpinion()
  .catch(() => undefined)
  .then(() => {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <I18nProvider>
          <LicenseProvider>
            <App />
          </LicenseProvider>
        </I18nProvider>
      </React.StrictMode>
    );

    // PWA: offline app shell (S2.1). Fire-and-forget; failures are logged, never fatal.
    registerServiceWorker();
  });
