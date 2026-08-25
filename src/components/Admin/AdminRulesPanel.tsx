// Solaris v3 — AdminConsole rules editor.
//
// CRUD over the versioned RulesConfig (create/edit/deactivate inconformities,
// grades, per-year scores) + JSON export/import. Pure state lives in React;
// persistence goes through the provided storage adapter (localStorage default),
// so tests inject an in-memory store.

import React, { useMemo, useState } from 'react';
import {
  validateRulesConfig,
  type RulesConfig,
  type ScoredRule,
} from '../../engine/scoring';
import { SEED_RULES_CONFIG } from '../../config/scoringRules';
import {
  loadRulesConfig,
  persistRulesConfig,
  resetRulesToSeed,
  localRulesStorage,
  type RulesStorage,
} from '../../services/rulesStorage';

interface AdminRulesPanelProps {
  storage?: RulesStorage;
}

const emptyDraft = (categories: Array<{ id: string }>): ScoredRule => ({
  id: '',
  name: '',
  categoryId: categories[0]?.id ?? 'OUTROS',
  definition: '',
  analystAction: '',
  grade: 1,
  scoresByYear: { '2025': 0 },
  active: true,
});

const AdminRulesPanel: React.FC<AdminRulesPanelProps> = ({ storage = localRulesStorage }) => {
  const [config, setConfig] = useState<RulesConfig>(() => loadRulesConfig(storage));
  const [status, setStatus] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null); // null = no form
  const [draft, setDraft] = useState<ScoredRule>(() => emptyDraft(SEED_RULES_CONFIG.categories));
  const [importText, setImportText] = useState('');

  const problems = useMemo(() => validateRulesConfig(config), [config]);

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 3000);
  };

  const commit = (next: RulesConfig, msg: string) => {
    setConfig(next);
    persistRulesConfig(next, storage);
    flash(msg);
  };

  const startCreate = () => {
    setEditingId('__new__');
    setDraft(emptyDraft(config.categories));
  };

  const startEdit = (rule: ScoredRule) => {
    setEditingId(rule.id);
    setDraft(JSON.parse(JSON.stringify(rule)) as ScoredRule); // deep copy
  };

  const saveDraft = () => {
    const id = draft.id.trim() || draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const rule = { ...draft, id };
    if (!rule.name.trim()) { flash('Nome é obrigatório.'); return; }
    if (config.version < 1 || !Number.isInteger(config.version)) {
      flash('Versão inválida.'); return;
    }
    const exists = config.rules.some((r) => r.id === rule.id);
    if (editingId !== rule.id && exists) { flash(`Já existe uma regra com id "${rule.id}".`); return; }

    const nextVersion = config.version + 1;
    const next: RulesConfig = exists
      ? {
          ...config,
          version: nextVersion,
          rules: config.rules.map((r) => (r.id === rule.id ? rule : r)),
        }
      : { ...config, version: nextVersion, rules: [...config.rules, rule] };
    commit(next, exists ? `Regra "${rule.name}" atualizada (v${nextVersion}).` : `Regra criada (v${nextVersion}).`);
    setEditingId(null);
  };

  const toggleActive = (ruleId: string) => {
    const nextVersion = config.version + 1;
    const next: RulesConfig = {
      ...config,
      version: nextVersion,
      rules: config.rules.map((r) =>
        r.id === ruleId ? { ...r, active: !r.active } : r,
      ),
    };
    const target = next.rules.find((r) => r.id === ruleId);
    commit(next, `"${target?.name}" ${target?.active ? 'reativada' : 'desativada'} (v${nextVersion}).`);
  };

  const removeRule = (ruleId: string) => {
    const target = config.rules.find((r) => r.id === ruleId);
    if (!window.confirm(`Remover definitivamente "${target?.name}"? (Preferível desativar para manter histórico)`)) return;
    const nextVersion = config.version + 1;
    const next: RulesConfig = {
      ...config,
      version: nextVersion,
      rules: config.rules.filter((r) => r.id !== ruleId),
    };
    commit(next, `Regra removida (v${nextVersion}).`);
    setEditingId(null);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `solaris-scoring-rules-v${config.version}.json`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Config exportada.');
  };

  const importJson = () => {
    try {
      const parsed = JSON.parse(importText) as RulesConfig;
      const problems = validateRulesConfig(parsed);
      if (problems.length > 0) {
        flash(`Import inválido: ${problems[0]}`);
        return;
      }
      commit(parsed, `Importado ${parsed.rules.length} regras (v${parsed.version}).`);
      setImportText('');
    } catch {
      flash('JSON malformado.');
    }
  };

  const resetSeed = () => {
    if (!window.confirm('Descartar edições locais e voltar ao seed do MVP?')) return;
    setConfig(resetRulesToSeed(storage));
    flash('Seed restaurado.');
  };

  return (
    <div className="p-6 max-w-5xl mx-auto text-gray-200" data-testid="admin-rules-panel">
      <header className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">Painel de Pontuações</h1>
          <p className="text-sm text-gray-400">
            Regras versionadas — v{config.version} · vigência {config.effectiveFrom} ·{' '}
            {config.rules.filter((r) => r.active).length}/{config.rules.length} ativas
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={startCreate} className="btn btn-primary px-3 py-1.5 text-sm">
            Nova regra
          </button>
          <button onClick={exportJson} className="px-3 py-1.5 rounded-md border border-solar-accent/60 text-solar-accent hover:bg-solar-accent/10 text-sm">
            Exportar JSON
          </button>
          <button onClick={resetSeed} className="px-3 py-1.5 rounded-md border border-gray-500 text-gray-300 hover:bg-gray-500/10 text-sm">
            Restaurar seed
          </button>
        </div>
      </header>

      {status && (
        <div role="status" className="mb-4 px-4 py-2 rounded-md bg-solar-accent/20 text-solar-accent text-sm">
          {status}
        </div>
      )}
      {problems.length > 0 && (
        <div role="alert" className="mb-4 px-4 py-2 rounded-md bg-red-900/40 text-red-300 text-sm">
          Config inválida: {problems[0]}
        </div>
      )}

      {/* Draft editor */}
      {editingId !== null && (
        <section aria-label="Editor de regra" className="mb-6 p-4 rounded-lg bg-solar-dark-content/70 border border-hairline space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Nome (coluna na planilha)
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="mt-1 w-full bg-surface border border-hairline rounded-md px-2 py-1"
              />
            </label>
            <label className="text-sm">
              Categoria
              <select
                value={draft.categoryId}
                onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                className="mt-1 w-full bg-surface border border-hairline rounded-md px-2 py-1"
              >
                {config.categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.id}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Grau de impacto (1–3)
              <select
                value={draft.grade}
                onChange={(e) => setDraft({ ...draft, grade: Number(e.target.value) })}
                className="mt-1 w-full bg-surface border border-hairline rounded-md px-2 py-1"
              >
                {[1, 2, 3].map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <label className="text-sm">
              Ativa
              <select
                value={String(draft.active)}
                onChange={(e) => setDraft({ ...draft, active: e.target.value === 'true' })}
                className="mt-1 w-full bg-surface border border-hairline rounded-md px-2 py-1"
              >
                <option value="true">Sim</option>
                <option value="false">Não</option>
              </select>
            </label>
          </div>

          <fieldset className="text-sm">
            <legend className="text-gray-400 mb-1">Pontos por vigência</legend>
            <div className="flex flex-wrap gap-2 items-center">
              {Object.entries(draft.scoresByYear).map(([year, score]) => (
                <label key={year} className="flex items-center gap-1">
                  <input
                    value={year}
                    readOnly
                    className="w-16 bg-surface border border-hairline rounded-md px-2 py-1"
                    title="Ano da vigência"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={score}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        scoresByYear: { ...draft.scoresByYear, [year]: Number(e.target.value) },
                      })
                    }
                    className="w-24 bg-surface border border-hairline rounded-md px-2 py-1"
                  />
                </label>
              ))}
              <AddYearButton onAdd={(y) =>
                setDraft({ ...draft, scoresByYear: { ...draft.scoresByYear, [y]: 0 } })
              } />
            </div>
          </fieldset>

          <div className="flex gap-2 pt-2">
            <button onClick={saveDraft} className="px-4 py-1.5 rounded-md bg-solar-accent text-bg hover:bg-solar-accent-hover text-sm">
              Salvar
            </button>
            <button onClick={() => setEditingId(null)} className="px-4 py-1.5 rounded-md border border-gray-500 text-gray-300 text-sm">
              Cancelar
            </button>
            {editingId !== '__new__' && (
              <button onClick={() => removeRule(draft.id)} className="ml-auto px-4 py-1.5 rounded-md border border-red-500/60 text-red-400 hover:bg-red-500/10 text-sm">
                Remover regra
              </button>
            )}
          </div>
        </section>
      )}

      {/* Rules table */}
      <section aria-label="Lista de regras">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-hairline">
              <th className="py-2 pr-2">Inconformidade</th>
              <th className="py-2 pr-2">Categoria</th>
              <th className="py-2 pr-2">Grau</th>
              <th className="py-2 pr-2">2024</th>
              <th className="py-2 pr-2">2025</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {config.rules.map((rule) => (
              <tr key={rule.id} className={`border-b border-hairline/50 ${rule.active ? '' : 'opacity-50'}`}>
                <td className="py-2 pr-2">{rule.name}</td>
                <td className="py-2 pr-2">{rule.categoryId}</td>
                <td className="py-2 pr-2">{rule.grade}</td>
                <td className="py-2 pr-2">{rule.scoresByYear['2024'] ?? '—'}</td>
                <td className="py-2 pr-2">{rule.scoresByYear['2025'] ?? '—'}</td>
                <td className="py-2 pr-2">{rule.active ? 'Ativa' : 'Desativada'}</td>
                <td className="py-2 flex gap-2">
                  <button onClick={() => startEdit(rule)} className="px-2 py-1 rounded border border-solar-accent/60 text-solar-accent hover:bg-solar-accent/10 text-xs">
                    Editar
                  </button>
                  <button onClick={() => toggleActive(rule.id)} className="px-2 py-1 rounded border border-gray-500 text-gray-300 hover:bg-gray-500/10 text-xs">
                    {rule.active ? 'Desativar' : 'Reativar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Import */}
      <section aria-label="Importar JSON" className="mt-8 p-4 rounded-lg bg-solar-dark-content/70 border border-hairline">
        <h2 className="font-semibold mb-2">Importar JSON de regras</h2>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder='{ "version": 2, "effectiveFrom": "...", "categories": [...], "rules": [...] }'
          rows={5}
          className="w-full bg-surface border border-hairline rounded-md px-2 py-1 font-mono text-xs"
        />
        <button onClick={importJson} disabled={!importText.trim()} className="mt-2 btn btn-primary px-4 py-1.5 text-sm disabled:opacity-50">
          Validar e importar
        </button>
      </section>
    </div>
  );
};

const AddYearButton: React.FC<{ onAdd: (year: string) => void }> = ({ onAdd }) => {
  const [year, setYear] = useState('');
  return (
    <span className="flex items-center gap-1">
      <input
        value={year}
        onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
        placeholder="ano"
        className="w-20 bg-surface border border-hairline rounded-md px-2 py-1"
      />
      <button
        type="button"
        onClick={() => { if (year.length === 4) { onAdd(year); setYear(''); } }}
        className="px-2 py-1 rounded border border-solar-accent/60 text-solar-accent text-xs hover:bg-solar-accent/10"
      >
        + vigência
      </button>
    </span>
  );
};

export default AdminRulesPanel;
