import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n/I18nContext';
import { LicenseProvider } from './licensing/LicenseContext';
import { registerServiceWorker } from './pwa/registerSW';
import './styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Critical: Root element not found.");
}

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
