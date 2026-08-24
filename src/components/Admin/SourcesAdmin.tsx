import React, { useMemo, useState } from 'react';
import { useI18n } from '../../i18n/I18nContext';
import {
  SaturnoResponseMode,
  sanitizeConfigForLog,
} from '../../services/saturno';
import {
  SourcesConfig,
  loadSourcesConfig,
  saveSourcesConfig,
  validateSourcesConfig,
} from '../../services/sourcesConfig';

interface SourcesAdminProps {
  isOpen: boolean;
  onClose: () => void;
}

const inputCls =
  'w-full px-3 py-2 rounded-md bg-solar-dark-bg/60 border border-solar-light-border dark:border-solar-dark-border text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-solar-accent';

const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1';

/**
 * Admin → Fontes: Saturno (adapter API-key), Alfred (raiz on-premise) e
 * Planilha (fallback). Persistência local; a chave nunca é re-exibida
 * (placeholder fixo quando já configurada) nem vai pra telemetria.
 */
const SourcesAdmin: React.FC<SourcesAdminProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  // O Header só monta este componente quando isOpen=true, então os
  // initializers abaixo recarregam o storage a cada abertura (sem effects).
  const [cfg, setCfg] = useState<SourcesConfig>(() => loadSourcesConfig());
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const problems = useMemo(() => validateSourcesConfig(cfg), [cfg]);
  const canSave = problems.length === 0;

  if (!isOpen) return null;

  const patchSaturno = (patch: Partial<SourcesConfig['saturno']>) =>
    setCfg((c) => ({ ...c, saturno: { ...c.saturno, ...patch } }));

  const handleSave = () => {
    if (!canSave) return;
    const next: SourcesConfig = { ...cfg };
    if (apiKeyDraft.trim()) next.saturno.apiKey = apiKeyDraft.trim();
    saveSourcesConfig(next);
    setSavedAt(new Date().toLocaleTimeString());
    setApiKeyDraft('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('admin.sources.title')}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-solar-dark-border bg-solar-dark-content p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">{t('admin.sources.title')}</h2>
            <p className="text-sm text-gray-400">{t('admin.sources.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-2 text-gray-400 hover:bg-gray-500/20 hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        {!cfg.saturno.enabled && (
          <p className="mb-4 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
            {t('admin.sources.fallbackNotice')}
          </p>
        )}

        {/* ── Saturno ─────────────────────────────────────────────── */}
        <section className="mb-6 rounded-lg border border-solar-dark-border p-4">
          <header className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-gray-100">{t('admin.sources.saturno')}</h3>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={cfg.saturno.enabled}
                onChange={(e) => patchSaturno({ enabled: e.target.checked })}
                className="h-4 w-4 accent-[--solar-accent]"
              />
              {t('admin.sources.saturno.enabled')}
            </label>
          </header>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>{t('admin.sources.saturno.baseUrl')}</label>
              <input
                type="url"
                className={inputCls}
                placeholder="https://saturno.gran.example.br"
                value={cfg.saturno.baseUrl}
                onChange={(e) => patchSaturno({ baseUrl: e.target.value })}
              />
            </div>

            <div>
              <label className={labelCls}>{t('admin.sources.saturno.apiKey')}</label>
              <input
                type="password"
                autoComplete="off"
                className={inputCls}
                placeholder={
                  cfg.saturno.apiKey ? '•••••••• (configurada)' : 'cole a API key'
                }
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
              />
            </div>

            <div>
              <label className={labelCls}>{t('admin.sources.saturno.headerName')}</label>
              <input
                type="text"
                className={inputCls}
                placeholder="X-API-Key ou Authorization"
                value={cfg.saturno.headerName}
                onChange={(e) => patchSaturno({ headerName: e.target.value })}
              />
            </div>

            <div>
              <label className={labelCls}>
                {t('admin.sources.saturno.authScheme')}
              </label>
              <input
                type="text"
                className={inputCls}
                placeholder="Bearer (ou vazio = cru)"
                value={cfg.saturno.authScheme}
                onChange={(e) => patchSaturno({ authScheme: e.target.value })}
              />
            </div>

            <div>
              <label className={labelCls}>{t('admin.sources.timeout')}</label>
              <input
                type="number"
                min={1000}
                step={500}
                className={inputCls}
                value={cfg.saturno.timeoutMs}
                onChange={(e) => patchSaturno({ timeoutMs: Number(e.target.value) })}
              />
            </div>

            <div className="sm:col-span-2">
              <label className={labelCls}>
                {t('admin.sources.saturno.endpointTemplate')}
              </label>
              <input
                type="text"
                className={inputCls}
                placeholder="/api/os/{os_id}"
                value={cfg.saturno.endpointTemplate}
                onChange={(e) => patchSaturno({ endpointTemplate: e.target.value })}
              />
            </div>

            <div className="sm:col-span-2">
              <label className={labelCls}>
                {t('admin.sources.saturno.responseMode')}
              </label>
              <select
                className={inputCls}
                value={cfg.saturno.responseMode}
                onChange={(e) =>
                  patchSaturno({
                    responseMode: e.target.value as SaturnoResponseMode,
                  })
                }
              >
                <option value="json">{t('admin.sources.responseMode.json')}</option>
                <option value="saturno-quirky">
                  {t('admin.sources.responseMode.quirky')}
                </option>
              </select>
            </div>
          </div>
        </section>

        {/* ── Alfred ──────────────────────────────────────────────── */}
        <section className="mb-6 rounded-lg border border-solar-dark-border p-4">
          <h3 className="mb-3 font-semibold text-gray-100">
            {t('admin.sources.alfred')}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>{t('admin.sources.alfred.root')}</label>
              <input
                type="text"
                className={inputCls}
                placeholder={'\\\\ALFRED\\Producao  ou  D:\\Alfred'}
                value={cfg.alfred.root}
                onChange={(e) =>
                  setCfg((c) => ({
                    ...c,
                    alfred: { ...c.alfred, root: e.target.value },
                  }))
                }
              />
            </div>
            <div>
              <label className={labelCls}>{t('admin.sources.alfred.maxDepth')}</label>
              <input
                type="number"
                min={1}
                max={20}
                className={inputCls}
                value={cfg.alfred.maxDepth}
                onChange={(e) =>
                  setCfg((c) => ({
                    ...c,
                    alfred: { ...c.alfred, maxDepth: Number(e.target.value) },
                  }))
                }
              />
            </div>
            <div>
              <label className={labelCls}>{t('admin.sources.alfred.osRegex')}</label>
              <input
                type="text"
                className={inputCls}
                placeholder="os[-_ ]?(\d+)"
                value={cfg.alfred.osRegex}
                onChange={(e) =>
                  setCfg((c) => ({
                    ...c,
                    alfred: { ...c.alfred, osRegex: e.target.value },
                  }))
                }
              />
            </div>
          </div>
        </section>

        {/* ── Planilha (fallback) ─────────────────────────────────── */}
        <section className="mb-6 rounded-lg border border-solar-dark-border p-4">
          <h3 className="mb-3 font-semibold text-gray-100">
            {t('admin.sources.sheet')}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>{t('admin.sources.sheet.id')}</label>
              <input
                type="text"
                className={inputCls}
                value={cfg.sheet.spreadsheetId}
                onChange={(e) =>
                  setCfg((c) => ({
                    ...c,
                    sheet: { ...c.sheet, spreadsheetId: e.target.value },
                  }))
                }
              />
            </div>
            <div>
              <label className={labelCls}>{t('admin.sources.sheet.tab')}</label>
              <input
                type="text"
                className={inputCls}
                value={cfg.sheet.tabName}
                onChange={(e) =>
                  setCfg((c) => ({
                    ...c,
                    sheet: { ...c.sheet, tabName: e.target.value },
                  }))
                }
              />
            </div>
          </div>
        </section>

        {/* ── Validação + ações ───────────────────────────────────── */}
        {problems.length > 0 && (
          <ul className="mb-4 list-disc space-y-1 rounded-md border border-red-500/40 bg-red-500/10 px-5 py-3 text-sm text-red-300">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}

        <footer className="flex items-center justify-between gap-3">
          <span
            className="truncate font-mono text-[11px] text-gray-500"
            title={JSON.stringify(sanitizeConfigForLog(cfg.saturno))}
          >
            {cfg.saturno.apiKey ? 'API key: configurada' : 'API key: não definida'} ·{' '}
            {cfg.saturno.headerName || 'X-API-Key'}
          </span>
          <div className="flex items-center gap-2">
            {savedAt && (
              <span className="text-xs text-green-400">
                {t('admin.sources.savedAt', { time: savedAt })}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="rounded-md bg-solar-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-solar-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('admin.sources.save')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default SourcesAdmin;
