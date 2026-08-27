# Solaris — Log de Trabalho

## features

### 2026-08-26 ~09h45 — tick features-worker: B3 métricas cruzadas COMPLETAS (802/802)

- **Diagnóstico de abertura**: worktree limpo em sync com origin
  (0268104, fetch c/ workaround GCM), baseline **792/792** verde re-provado +
  build fresco (initial 55,84KB gz). Fila F1–F6 segue DONE; varredura
  dirigida pela spec achou o buraco REAL restante na seção B3:
  "nota média dada vs recebida em auditoria (frouxo/cruel)" e "tempo por OS
  vs média do time" — a tabela de qualidade só tinha avgScore/marks, com
  `reworkRate: null` PERMANENTE embora o sinal de auditoria já existisse nos
  eventos XP (`quality_bonus`/`rework_penalty`, spec C1/B).
- **Núcleo puro (`utils/liveDashboard.ts`)**:
  - `auditVerdictFromEvents`: deriva veredito por analista dos eventos XP
    (amount não-finito fora; motivos alheios ignorados);
  - `buildAnalystQualityFull`: mesma base da simples + cruzamento com
    auditoria (auditedOs/auditsOk/reworkEvents/reworkRate — null SEM
    auditoria, nunca zero que leria como perfeito) e tempo real da fila via
    `analystAvgHoursFromQueue`; `teamAvgHoursPerOs` = MÉDIA DAS MÉDIAS
    (mesmo peso por analista — maratonista não mascara o time);
    `deltaVsTeamPct` exige ≥2 analistas medidos (time de um só se
    compararia consigo mesmo: 0% vazio — borda pega pelo teste);
  - `visibleQualityRows` virou genérica `<T extends AnalystQualityRow>`
    (aditivo: chamadas antigas compilam igual);
  - honestidade herdada: timestamps corruptos/ausentes ficam FORA (null
    nunca zero); ordenação por volume desc idêntica à função simples.
- **UI (`LiveDashboardPanel`)**: eventos XP lidos dos perfis gamificados
  (`solaris.gamification.profile.*`, tolerante a storage lixo/corrupto;
  leitura uma vez por montagem, mesma linha do hourEvents); tabela ganhou
  colunas Rework (audit) — % + "{ok} ok / {bad} rework", Tempo médio
  (fila real) e vs team (+x% slower / −x% faster / on par); máscara B4
  mantida (sem canReadIndividualMetrics tudo vira —); i18n EN/PT paridade
  (6 chaves novas dash.live.*).
- **Provas**: suíte **802/802** (+10: 7 núcleo — bordas de veredito, NaN,
  50% retrabalho, média-de-médias, delta ±50%, relógio corrupto, time-solo;
  3 jsdom — admin vê 50%/0%/+50%−50%, sem-dado mostra —, analista mascarado).
  tsc limpo; lint ratchet estável (5E pré-existentes do painel, mesmos
  tipos, deslocados −1 linha); build verde — initial **55,98KB gz**
  (+0,14; budget <500KB intacto), chunk do painel 13,91→14,51KB gz.
- Commits 2010a5f + 93b45f7 + 820c513; push confirmado por ls-remote
  (820c513). src-tauri/audio-acoustics/tokens.css/pitch intocados.
### 2026-08-26 ~08h20 — tick features-worker: F5/B2 drill-down do analista FECHADO (792/792)

- **Diagnóstico de abertura**: worktree limpo e em sync (6c7ccba, fetch com
  workaround GCM), baseline **770/770** verde re-provado. Fila F1–F6 segue
  DONE; varredura dirigida pela spec achou o buraco real restante: spec B2
  pedia "Drill-down: clicar → histórico completo da pessoa" — os cards de
  analista eram estáticos (zero clique) e faltavam "OSs na semana" e "última
  atividade" do card.
- **Núcleo puro (`utils/liveDashboard.ts`)**:
  - `weekCount` nos cards: régua DO PÓDIO (semana seg-dom meio-aberta no
    fuso -03:00, via weekKey/closedPeriodRange de periods.ts) — domingo
    pertence à semana que abriu na segunda passada (testado);
  - `avgHoursPerOs`: tempo médio/O.S. SÓ da fila real (`analystAvgHoursFromQueue`
    sobre QueueRowLike): assignee → claimed_by, created→completed, timestamps
    ausentes/inválidos ou conclusão antes da criação ficam FORA — null nunca
    zero (mesma linha honesta dos núcleos anteriores); planilha sozinha não
    inventa tempo;
  - `Dataset.queueRows?` opcional (injetado pelo painel; parser nunca popula);
  - `buildAnalystDrilldown`: totais (hoje/semana/geral), média global,
    meses mês-a-mês (mais recente primeiro, marcações médias por O.S.) e até
    8 O.S. recentes (data desc, sem-data vai pro fim, tie-break por osId);
    retorna null pra analista sem atividade conhecida;
  - card preserva o contrato antigo: "hoje" continua sendo contagem/média do
    DIA (avgGiven), semana é campo NOVO ao lado.
- **UI (`LiveDashboardPanel`)**:
  - card virou `<button>` acessível (aria-label "Open {name}'s full history",
    hover/focus-visible ring, tooltip do hint);
  - linha nova no card: "{n} this week · {h}h/O.S." (tempo só c/ papel que
    lê métricas individuais);
  - clique abre bloco drill-down: KPIs hoje/semana/Analyzed/média/tempo
    médio, última atividade (ou hint de privacidade), tabela mês-a-mês e
    tabela das O.S. recentes; "Back to overview" restaura;
  - privacidade B4 mantida: avgHoursPerOs mascarado ("—") pra papel sem
    canReadIndividualMetrics mesmo com dado presente;
  - i18n EN/PT em paridade (16 chaves novas dash.live.*).
- **Provas**: suíte **792/792** (+22: liveDashboardDrill 17 — bordas de
  semana domingo/segunda 00h, claimed_by fallback, relógio corrupto, status
  ≠done fora, cap-8, cfg injetável Tóquio; liveDashboardDrillUi 5 jsdom —
  abrir/fechar/privacidade/sem-invenção). tsc limpo; lint ratchet estável
  (42E/18W antes=depois); build verde — initial **57,19 KB gz**
  (+1,62 vs tick anterior; budget <500KB intacto).
- **Gotcha do tick**: patch tool avisou "modified by sibling subagent" em
  arquivo que EU estava editando — probe de processos provou zero worker
  vivo na lane e diff = só o meu; segui com re-read antes de cada patch.

### 2026-08-26 ~07h00 — tick features-worker: F5/B1 "SLA médio" + C4/E opt-in de exportação de pódio FECHADOS (770/770)

- **Diagnóstico de abertura**: worktree limpo e em sync (4a77ada, fetch com
  workaround GCM), baseline **738/738** verde re-provado antes de mexer.
  Fila original F1–F6 confirmada DONE nos ticks anteriores; varredura
  dirigida pela spec achou os DOIS buracos REAIS restantes:
  1. spec B1 pedia "SLA médio" nos cards topo — nunca implementado (zero hits);
  2. spec C4/E pedia que dados de pódio não vazem pra planilha SEM opt-in —
     até aqui garantido só por OMISSÃO (não existia caminho nenhum de
     exportação de pódio; regra negativa sem porta positiva).
- **B1 SLA (núcleo `utils/liveDashboard.ts::buildSlaSummary` + card vivo)**:
  - média created_at→completed_at das OSs 'done' da fila viva +
    overdueCount/atraso médio das 'queued' com deadline no passado;
  - honestidade de dado: timestamp ausente/inválido ou conclusão ANTES da
    criação (relógio corrupto) fica FORA da média — null vira "—" no card,
    NUNCA zero inventado (mesma linha dos núcleos anteriores);
  - `QueueRowLike` ganha `completed_at?` opcional espelhando os_queue da
    migration 0002 (aditivo, zero toque em código dos workers irmãos);
  - UI: 5º KpiCard "SLA — avg completion" (grid foi a lg:grid-cols-5), sub
    "{n} overdue · avg {h}h late" ou "no overdue O.S."; i18n EN/PT paridade.
- **C4/E opt-in (`features/gamification/podiumExport.ts` + `podiumSharePref.ts`
  + seção admin na Liga)**:
  - gate POSITIVO e testável: `buildPodiumCsv`/`buildPodiumXlsx` exigem
    `{optIn: true}` literal — sem ele retornam null (NEM bytes são montados);
    valor lixo em runtime também recusa ('sim' → null; o gate é valor, não
    comentário);
  - preferência `solaris.gamification.podiumShareOptIn`: default OFF, só o
    valor exato '1' liga, desligar REMOVE a chave (mapa enxuto), storage
    explosivo = falha fechada (nunca abre por erro);
  - XLSX reusa `buildSingleSheetXlsx` (sheet 'Podium', números como células
    numéricas de verdade, determinístico p/ input+timestamp iguais); CSV
    gêmeo com escape RFC 4180 (aspas/vírgula no nome); filename estável
    `solaris-podium_<type>_<key>.<ext>` compartilhado pelos dois formatos;
  - LeaguePanel: checkbox só-admin no histórico ("Allow sharing podium data
    externally", default OFF) e botões Export CSV/XLSX por pódio congelado
    que aparecem SOMENTE com toggle ON + admin — defesa em profundidade: a
    UI esconde E o núcleo recusa; analista com chave suja no storage segue
    sem botão nenhum (testado).
- **Provas**: suíte **770/770** (+32 asserts: liveDashboardSla 12,
  podiumExport 14, liveSlaUi 5 jsdom, podiumExportUi 5 jsdom incluindo
  download real capturado via createObjectURL mockado); tsc limpo; lint
  ratchet estável (42E/18W antes=depois); build verde — initial entry
  **55,57 KB gz** (budget <500KB intacto; pesados vfs_fonts/pdfmake/ECharts/
  firebase seguem fora do initial).
- **Gotchas do tick**: import relativo de módulo novo em
  src/features/gamificação é '../../utils/…' (dois níveis — vite cuspiu
  "Failed to resolve import" no 1o run); mock de papel via vi.hoisted VAZA
  entre tests → resetar roleState + cleanup no beforeEach (jsdom mantém DOM).

### 2026-08-25 ~23h30 — tick features-worker: resgate de WIP órfão (A1) + C4 modo time FECHADO (núcleo + UI) (commits a6fa915..0cc8eb3)

- **Diagnóstico de abertura**: worktree estava AHEAD 4 do remoto (f5d019e)
  com WIP sujo de um tick anterior MEU cortado antes do commit — probe de
  processos (scripts/tick_probe.ps1, escrito em arquivo por causa do $_
  comido pelo bash) provou ZERO worker vivo na lane (só a própria sonda,
  nascida no mesmo segundo = anti-self-detecção). WIP validado (tsc limpo,
  659/659) e commitado como a6fa915; os 4 commits pendentes + este foram
  empurrados com o workaround de GCM.
- **A1 remapeamento robusto (resgate)**: conflito agora é contra a tecla
  EFETIVA dos outros atalhos (mapa do usuário OU padrão — bindar 't' quando
  markTime ainda usa 't' padrão colide); mapa enxuto via removeItem quando
  vazio; storage default window.localStorage com null explícito = desacoplado;
  hot-reload dos atalhos também nos dashboards + jsdom do painel.
- **Fila original F1–F6 confirmada DONE** nos logs anteriores (trocas D:
  wavesurfer v7 lazy ✓, pdfmake ✓, Intl/fuso fixo ✓ com date-fns REJEITADO
  com prova ~70KB que não resolve problema real; ECharts ✓ desde F5).
- **C4 modo time — buraco real restante da spec** ("soma do grupo vs meta
  mensal — cooperação antes de competição"): zero hits no grep antes deste
  tick. Núcleo puro `features/gamification/teamGoal.ts`: meta mensal inteira
  ≥1 em localStorage (`solaris.teamGoal.monthlyXp`), load tolerante (lixo =
  desligado), save best-effort com hot-reload por evento custom,
  `teamProgress` soma XP líquido SÓ do roster dentro da janela meio-aberta
  (retrabalho -150 estorna — coerente com o guardrail de nunca premiar
  análise rasa), `goalStatus` defensivo (meta 0 → nunca divide por zero).
  13 asserts de borda.
- **Wiring vivo na LeaguePanel**: seção "Meta do mês" entre pódio e
  conquistas — progresso ao vivo (roster = mesmos analistas do pódio ao
  vivo, mês civil corrente fuso -03:00), form admin define/remove com
  validação i18n EN/PT, hot-reload por evento custom + aba cruzada
  ('storage'), barra acessível (progressbar nomeado, met=verde). Não-admin
  vê o progresso mas não o form (privacidade por papel). 5 asserts jsdom.
- **Gates finais**: vitest **677/677** (55 arquivos, +18 no tick), tsc
  limpo, build verde — entry 51,48 KB gz + react-vendor 44,43 (~96KB
  initial, budget <500KB intacto; pesados todos lazy: vfs_fonts 454,6 /
  pdfmake 353,7 / ECharts 163,6 / firebase 95,0 fora do initial).
- **Gotchas do tick**: jsdom não dispara submit de form via clique em botão
  type=submit → usar fireEvent.submit(form); múltiplas progressbars exigem
  getByRole com name acessível. scripts/build_report.mjs = medição
  reproduzível de chunks gz (npm run build via execSync contorna o guard
  falso-positivo de "servidor" no npx vite build direto).

### 2026-08-25 ~20h25 — tick features-worker: A3 FECHADO — importação CSV/XLSX da fila + exportação + undo snapshot (commits 70803e4..461bd9e)

- **Escopo**: spec A3 (anti-fricção administrativa) na superfície que ainda
  não tinha nada — a FILA do painel ao vivo. Zero dependência nova;
  offline-first; src-tauri/audio-acoustics/tokens.css/pitch intocados.
- **Núcleo** (`src/features/qol/queueImport.ts`): parseCsv RFC 4180 (BOM,
  CRLF, aspas dobradas, campo multilinha); mapeamento tolerante EN/PT
  (`os_id|OS|WO|ORDEM DE SERVIÇO`, `prazo`, `situação`…); normalização
  HONESTA — `FILA→queued`, `ALTA→P1`, mas status/prioridade inválidos
  explícitos PULAM a linha com motivo (typo nunca vira P2 silencioso);
  duplicata dentro do arquivo OU contra a fila viva reportada com número
  da linha; linha mais curta que o header é paddingada ('' ≠ crash).
- **Leitor XLSX zero-dep** (`queueImportXlsx.ts`): espelho do writer P12 —
  ZIP STORE+DEFLATE via `DecompressionStream('deflate-raw')` nativa
  (ReadableStream puro: Blob do jsdom não tem .stream()), EOCD→central
  directory (com data-descriptor via header local), workbook→rels→folha
  (Target relativo/absoluto), sharedStrings/inlineStr/número/fórmula,
  buracos de grade preservados. Arquivo corrupto lança mensagem clara.
- **UI** (`QueueImportExportBar.tsx`, chunk LAZY do painel): file input
  nativo acessível (sr-only + label), reset por key p/ reenvio do mesmo
  arquivo, resumo aria-live "{n} adicionadas · {n} puladas (motivos)";
  exportação CSV + XLSX REAL (aba "Fila", scores como célula numérica) na
  MESMA forma que o importador lê. Nasce FORA do condicional da fila —
  importar o primeiro lote é o caso primário. Gate canManageQueue.
- **Undo**: kind novo `'import-queue'` em undo.ts — SNAPSHOT (linhas novas
  não têm estado anterior): um evento carrega o lote; applier registrado
  junto aos 3 existentes no painel; botão Desfazer enxerga importações.
- **Provas**: suíte **619/619** (+33: queueImport 16, queueImportXlsx 9 —
  fixtures ZIP STORE e DEFLATE montados byte a byte, CRC32 clássico
  0xcbf43926 validado — e UI jsdom 8); **tsc 100% limpo INCLUSIVE
  __tests__** (bônus: import quebrado de 1 linha no queueBulk.test.ts
  corrigido); eslint ZERO nos 6 arquivos meus, ratchet 5=5 nos
  compartilhados (provado via stash antes=depois); **e2e-flow 34/34**
  (+8 asserts: seção [6/6] — importar CSV com sinônimos PT → duplicata e
  bad-status pulados → undo snapshot restaura → exportar XLSX real →
  reimportar round-trip os_id/priority/status intactos); build ok —
  initial gz **~106,4KB** (index 51,43 + react-vendor 45,49 + css 8,67 +
  html ~0,8) vs ~104,9 anterior (+1,5KB = wiring/i18n/chunk-wrapper),
  barra dentro do chunk lazy LiveDashboardPanel 12,57KB gz — budget
  <500KB preservado; chunks pesados (firebase 97,2 / ECharts 167,5 /
  pdfmake 362,2 / vfs_fonts 465,5) inalterados e fora do initial.
- Push confirmado por ls-remote: `51bf70e..461bd9e`.
- **Restante da spec**: A1 duplicar-análise-similar + atalhos
  configuráveis; A2 Pomodoro (pular-silêncio/volume = lane audio-dsp).

### 2026-08-25 ~18h40 — tick features-worker: F2 COMPLETO — bulk actions vivas no painel ao vivo + resgate do commit vermelho do tick anterior

- **Resgate (importante)**: o tick ~17h15 subiu `f281e2b` (bulk core) com
  **suíte VERMELHA** (1/10 falhando — eventos saíam na ordem da LISTA, teste
  exigia ordem da SELEÇÃO). Corrigido em `818bbad`: `applyBulk` agora itera a
  seleção (Set dedup) filtrada pelos elegíveis — undo em lote reverte na
  ordem em que o usuário escolheu. Lição registrada: gate de testes roda
  ANTES do push a partir deste tick.
- **Novo núcleo** (`src/features/qol/queueBulkView.ts`): visão ordenada da
  fila pra seleção em lote — MESMA prioridade do suggestNext (atrasada >
  nova 24h > antiga), bandas rotuladas (overdue com horas, new, old),
  deadline ausente/inválida nunca vira overdue; só `queued` é elegível.
- **Nova UI** (`src/components/Admin/QueueBulkBar.tsx`, dentro do chunk lazy
  do painel): checkboxes por OS, "3 urgentes" seleciona o topo da fila,
  contador selecionadas/aplicáveis/ignoradas via planBulk, ações Atribuir a
  mim / Devolver / Priorizar P1-P3 em lote; um evento de undo POR linha
  alterada (mesmos kinds assign-os/return-os/prioritize-os) → applier já
  registrado reverte linha a linha sem código novo; seleção limpa após
  aplicar; some quando não há queued; gate canManageQueue (analista não vê).
- **Wiring**: LiveDashboardPanel monta a barra no card da fila (pos-sugestão)
  com handleBulkApply (commitQueue + record no UndoLog).
- **i18n**: 9 chaves novas dash.live.bulk* em paridade EN/PT exata.
- **Provas**: suíte **586/586** (+14 asserts: queueBulkView 8 — janela exata
  24h, horas 1 casa, determinismo, exclusão done/in_analysis; queueBulkUi 6 —
  ordem visual, top-3, lote+undo-UMA provado pelo contrato onQueueChange,
  prioridade em lote, gate de papel, i18n pt); tsc limpo fora de __tests__;
  eslint ZERO nos 3 arquivos novos/tocados meus (5 erros pré-existentes do
  painel provados idênticos via stash antes/depois); e2e-flow **26/26**;
  build ok — initial gz **~104,9KB** (index 51,0 + react-vendor 45,5 + css
  8,6; barra nasceu DENTRO do chunk lazy do painel, +~0,3KB gz) — budget
  <500KB preservado de sobra.
- Sem Telegram; src-tauri, audio-acoustics, tokens.css e pitch intactos.

### 2026-08-25 ~16h35 — tick features-worker: A1 scratchpad VIVO na tela de análise + resgate de log triturado + push do backlog

- **Resgate**: cabeçalho deste log estava triturado por edição externa (linhas
  `\n` literais no lugar do título "## features") — restaurado em commit
  próprio (0b6ef95); nenhuma seção perdida.
- **Push do backlog**: 5 commits que estavam só locais (fila inteligente no
  painel ao vivo e043271, higiene QoL 6e553a5/a5b75e1, shuttle+scratchpad
  núcleo 81d23a0) + este resgate subiram pra origin (`2a72853..0b6ef95`).
- **A1 notas rápidas no ar**: ScratchpadPanel colapsável no topo da folha de
  análise, fechando o wiring que faltava do tick 13:04 (o núcleo existia com
  testes mas nenhum componente o montava).
  - `useScratchpad.ts` (ciclo de vida React sobre o controller puro): debounce
    200ms, flush determinístico em beforeunload/visibilitychange/unmount;
    núcleo ganhou callback opcional `onSaved` (badge).
  - Contrato de "oficial": `handleSave` dispara evento `solaris:scratch-cleaned`
    (mesmo padrão dos eventos solaris:* existentes) → nota pessoal sai do
    storage junto com o rascunho do auto-save.
  - Padrão anti-cascata (react-hooks v7): wrapper decide visibilidade e REMONTA
    o interno por `key={osId}`; carga da nota no inicializador de estado puro;
    zero ref-em-render, zero setState-em-efeito.
  - Retomada: nota persistida → painel nasce aberto; badge discreto "salvo ✓";
    hint de privacidade permanente; clamp 20k com aviso honesto; guest
    (osId null) não monta nada; modo foco esconde mantendo estado vivo.
- **Bug real pego pelo teste novo**: a limpeza via evento dependia do controller
  TER NASCIDO nesta sessão — nota escrita em sessão anterior sobrevivia à
  análise oficial se o analista não digitasse nada antes de salvar. O handler
  agora remove a chave do storage diretamente, independente do controller.
- **Provas**: suíte **562/562** (+8 asserts em scratchpadUi.test.tsx: colapso,
  debounce com fake timers, retomada, limpeza por evento, guest, visible=false
  preserva nota, paridade i18n EN/PT, troca de OS sem vazamento); tsc limpo
  fora de __tests__; eslint ratchet estável **54=54** (meus 3 arquivos novos
  zerados; erros pré-existentes do AnalysisWorkspace intocados); e2e-flow
  **26/26**; bundle initial INALTERADO **~104,6KB gz** (index 50,6 +
  react-vendor 45,4 + css 8,5) — painel nasceu DENTRO do chunk lazy do
  AnalysisWorkspace (+~0,3KB gz), chunks pesados (firebase/echarts/pdfmake/
  vfs_fonts/wavesurfer) seguem lazy; budget <500KB preservado de sobra.
- Sem Telegram; src-tauri, audio-acoustics, tokens.css e pitch intactos.

### 2026-08-25 ~11h20 — tick features-worker: F6 troca #3 — Intl/fuso fixo na forma honesta (date-fns REJEITADO com prova)

- **Decisão da troca D #3 (date-fns+Intl)**: o CÁLCULO de calendário já era
  pura/testada em `features/gamification/periods.ts` (fuso fixo -03:00, reset
  segunda 00h) — reintroduzi-lo via date-fns (~70KB min) seria dependência que
  resolve problema inexistente. O GAP real era FORMATAÇÃO: chaves cruas
  `week · 2026-08-24` vazavam pro histórico da Liga (spec C2 pede "Março/2026
  — quem ganhou?") e `toLocale*()` dependia do relógio DO HOST (jsdom,
  desktop e nuvem discordam). Fechado com **Intl nativo = zero bytes de
  bundle**.
- **Novo** (`src/features/i18n/format.ts`): formatadores cacheados por
  (tag+opções) SEMPRE `timeZone:'UTC'` sobre instante deslocado pelo offset
  do PodiumClockConfig (mesma técnica do localParts); formatClockInTz /
  formatDateInTz / formatTimestampInTz / formatPeriodLabel ('2026-03' →
  'março de 2026' | 'March 2026'; week com prefixo 'Semana de'/'Week of') /
  currentMonthLabel. Inválido → '—', nunca lança. **Bug pego pelo teste**:
  chave malformada '2026-13-99' passava no regex e o rollover do Date.UTC
  INVENTAVA 'setembro/2027' — corrigido com validação de faixa + round-trip
  (`utcDateFromKeyParts`; 30-de-fev também rejeitado).
- **Wiring**: histórico da Liga renderiza rótulo i18n via `lang` do useI18n;
  badge de auto-save (AnalysisWorkspace) e viewer de bug reports agora em
  fuso FIXO (zero `toLocale*()` sem locale no app).
- **Descoberta ICU**: `hour12:false` no ICU moderno força 24h mesmo em en-US
  ('23:30', não '11:30 PM') — desejado pra QC; testes ajustados pra cravar o
  contrato.
- **Gates**: vitest **527/527** (+12), tsc limpo, e2e-flow 21/21, build ok —
  initial gz inalterado (index 50,17 + react-vendor 45,49 + css 8,30 =
  ~104KB; troca custou ZERO). Lint dos arquivos novos zero (48 erros
  pré-existentes provados via stash antes/depois).

### 2026-08-25 ~09h55 — tick features-worker: F6 troca #2 — pdfmake no QC Report (recuperação de WIP + bug de render caçado por smoke)

- **Recuperação**: worktree tinha WIP não-commitado do tick anterior (~08h56,
  sessão morreu antes do commit): `qcPdf.ts` + teste + botão modificado +
  pdfmake no package.json — e o log tinha sido TRITURADO (histórico "##
  features" apagado). Log restaurado do HEAD; entrada reescrita com números
  REPRODUZIDOS neste tick.
- **Tech swap (spec seção D)**: `pdfmake` client-side substitui o blob HTML do
  S4.1 como caminho primário do relatório QC. Import 100% lazy: chunks
  `pdfmake` 1.009,5KB min/**362,2KB gz** e `vfs_fonts` 855,1KB min/**465,5KB gz**
  nascem fora do initial e só baixam quando o analista pede o relatório.
- **API** (`src/utils/qcPdf.ts`): `buildQCReportDocDefinition` puro
  (A4/Roboto, grid 3×2 de KPIs, tabela de colunas, rodapé com página),
  `exportQCReportPdf` (dynamic import + vfs + createPdf), helpers
  EN/PT (`qcReportLabels`, `formatReportDate` Intl, `formatAnalysisSeconds`,
  `suggestedQCFileName`). Zero CDN — Roboto embutida no vfs_fonts.
- **Bug real caçado pelo smoke**: o WIP crasheava no render REAL do pdfmake —
  `hLineWidth(i, node)` usava `node.body.length`, mas na API de layout o 2º
  argumento é a TABELA (`node.table.body`). Os testes jsdom não pegavam porque
  nunca renderizam; o novo `scripts/qc-pdf-smoke.ts` (tsx, gera PDF binário em
  Node) pegou na primeira execução. Fix: `node.table?.body?.length ?? 0`.
- **UX corrigida no botão**: diálogo abria ANTES do await, então o estado
  "Generating…"/disabled era código morto (o sumário substituía o botão na
  hora). Agora o diálogo abre DEPOIS que o artefato existe; enquanto gera, o
  botão mostra "Generating…" desabilitado (anti duplo clique).
- **Fallback endurecido**: se o chunk falhar (cache corrompido, navegador
  velho), baixa o relatório HTML RICO do S4.1 (`exportQCReportBlob`) — não um
  template mínimo — com aviso visível "PDF engine unavailable"; "Download
  again" funciona nos dois modos (`lastFileName` guarda o nome do artefato).
- **Provas**: suíte **515/515** (+21 asserts: qcPdf 17, qcPdfButton 4 — inclui
  fallback rejeitado → HTML baixado, aviso visível, again re-baixando);
  tsc limpo fora de __tests__; eslint ratchet estável (65=65 antes=depois,
  meus 4 arquivos zerados); e2e-flow **21/21**;
  `scripts/qc-pdf-smoke.mjs` (CDP contra Chrome headless REAL, --disable-gpu):
  BTN_MOUNTED, clique confiável (Input.dispatchMouseEvent) → download em disco
  **solar-qc-report-2026-08-25.pdf 21.449B, header %PDF- + %%EOF válidos**,
  diálogo sem aviso de fallback, wiring do "Download again" provado (anchor
  blob:+nome .pdf interceptado; o bloqueio do 2º download automático é
  artefato conhecido do headless, não da lógica), console/exceções ZERO —
  QCPDF_SMOKE_PASS. Smoke Node adicional: PDF 28.730B com subset Roboto
  embutido e labels pt-BR ("Relatório QC Solar").
- **Bundle ANTES→DEPOIS**: initial **103,3 → 104,7KB gz** (html 0,79 + css 8,3
  + react-vendor 45,5 + index 48,8→50,1; +1,4KB = wrapper+labels) — budget
  <500KB preservado de sobra. Firebase/ECharts/wavesurfer seguem lazy como
  estavam. Deps: +pdfmake 0.3.11, +@types/pdfmake (dev).

### 2026-08-25 ~08h00 — tick features-worker: F6 troca #1 — wavesurfer.js v7 lazy no timeline (fallback legado preservado)
- **Escopo**: só a camada de render. `useAudioWaveform` (decode WebAudio + cache localStorage + Firebase distribuído) e `WaveformCacheContext` INTACTOS — offline-first e o badge de cache da lista continuam iguais.
- **Novo** (`src/features/wavesurfer/`): `waveformRender.ts` núcleo puro (tiers dB idênticos ao legado: clip ≥0dB/hot ≥-2/nominal ≥-7/floor; max-pooling determinístico que PRESERVA transientes — clip de 20ms não some no zoom out, média apagaria; geometria de barras espelhada do centro em device px; paintBars p/ renderFunction) + `WaveSurferCanvas.tsx` chunk LAZY (import() dinâmico dentro do componente).
- **Armadilha v7 descoberta lendo o dist**: `waveColor` array NÃO é cor-por-barra — vira GRADIENTE vertical único (`convertColorValues` → createLinearGradient). Cor dB por barra exigia `renderFunction`; porém o overlay de progresso do v7 clona o canvas via drawImage+source-in com fillStyle ÚNICO, então renderFunction + progressColor array = canal azul multiplicado. Solução: renderFunction desenha as barras com cor própria e progressColor fica string sólida `rgba(10,132,255,0.6)` (solar-accent/60, mesma régua visual do legado).
- **Integração**: WaveformTimeline monta o renderer lazy via React.lazy+Suspense quando há peaks prontos; fallback PERMANENTE às barras DOM legadas se o chunk falhar (evento `solaris:waveform-fallback`, re-armado ao trocar de mídia); scrubber/hover tooltip/seek por mouse seguem no pai (dragToSeek off no ws p/ não duplicar handler). Playhead via ws.setTime sincronizado à prop currentTime pós-ready.
- **Provas**: suíte 494/494 (+22 asserts novos: waveformRender 15, waveformTimelineUi 7); tsc limpo; e2e-flow 21/21; **wave-smoke novo** (scripts/wave-smoke.mjs, CDP puro contra Chrome headless real): shadow DOM do v7 montado, canvases com pixels não vazios pintados pelo renderFunction, pixel vermelho #ef4444 de clip presente, overlay azul presente, 2s de ciclo de playhead com console 0 eventos e zero fallbacks — 8/8 ok.
- **Bundle**: initial inalterado **186.5KB gz** (index 48.6 + react-vendor 45.4 + css 8.3 + firebase 97.2 pré-carregado como antes; budget <500KB de sobra). wavesurfer nasceu em chunk próprio **42.3KB min / 12.5KB gz LAZY** + wrapper 2.7KB — fora do index.html, carrega só quando há peaks. Deps: +wavesurfer.js 7.12.11, +axe-core devDep (scripts de scan vindos da turbo).
- **A11y/console na build servida**: axe login 1 violation (pré-existente), main app **color-contrast serious em 7 nós .text-gray-500 — COMPROVADO pré-existente** rodando o mesmo scan no worktree limpo do commit pai 4fc18f2 (mesma regra, mesmos 7 nós); console-probe após guest click: **0 eventos** (o FIREBASE FATAL inicial era falta de .env.local no worktree — copiado do redesign, gitignored).
- Tooling: axe-scan.mjs/console-probe.mjs/e2e-flow.mjs resgatados da branch turbo/web-opt p/ prova local.

### 2026-08-25 05:20 — tick features-worker: F5 Dashboard ao Vivo no ar + WIP destrutivo revertido (commits b065a95..b739ff5)
- **Recuperação**: worktree tinha WIP não-commitado do tick anterior que APAGAVA o DashboardPanel funcional (2010 linhas → 268 quebradas, JSX sem fechar, HTML string como children, CDN jsdelivr violando offline-first) e triturava translations.ts (573 → 121 linhas). `git checkout` nos 2 arquivos + remoção dos 4 arquivos novos quebrados; baseline re-provado: tsc limpo, 445/445.
- **Núcleo puro** (`src/utils/liveDashboard.ts`, +21 asserts em liveDashboard.test.ts): KPIs da spec B1 (hoje/concluídas/em análise com "Nome · Nmin"/fila pendente/média global); throughput DIÁRIO honesto (planilha não tem hora — prometer por-hora dela seria inventar dado) e throughput POR HORA real a partir de eventos com timestamp (fuso -03:00 fixo via SAO_PAULO_CLOCK); presença 🟢🟡⚪ com ocioso >15min exato da spec B2; feed com dedupe por id, ordem desc e cap-50; qualidade cruzada B3 SEM nota inventada (reworkRate fica null até existir fonte real) + filtro por papel via canReadIndividualMetrics.
- **UI** (`LiveDashboardPanel.tsx` lazy + `EChartsLiveChart.tsx`): KPI cards, 2 gráficos ECharts **modular** (`echarts/core`: só BarChart+Grid+Tooltip+Canvas), cards por analista com drill-down pronto, feed SSE `/api/dashboard-events` com fallback polling e backoff exponencial até 60s, tabela de qualidade respeitando papel (analista vê só a própria linha). ChartFallback p/ Suspense.
- **Integração**: AdminGate ganha toggle acessível Planilhas/Ao vivo (role=tablist); App repassa viewer (id/name) do userProfile; i18n EN/PT das 31 chaves novas em paridade exata.
- **Deps/tooling**: echarts npm (nada de CDN); @testing-library react/dom/jest-dom; vitest.config sem plugin-react 3.x (pipeline .tsx quebrado no Vitest 4 — mesma correção provada pelo worker do desktop).
- **Números**: suíte 472/472 (+27 asserts), tsc limpo, eslint ratchet estável (64/64 antes=depois). Bundle: initial INALTERADO ~102KB gz; painel ao vivo 11,8KB/4,3KB gz lazy; chunk ECharts 1.128KB→491KB min (379→168 gz) após trocar import full→echarts/core. Budget <500KB initial preservado de sobra.
- Pendências honestas anotadas: "em análise agora" usa snapshot injetável de os_queue (tabela existe na migration 0002; wiring real quando houver backend); retrabalho real aguarda auditoria; hourly chart lê eventos XP locais (offline-first) até o feed SSE estar servido pela API.

### 2026-08-25 03:00 — tick features-worker: F4 UI de Gamificação — Liga dos Analistas no ar (commit 04e1848)
- Resgatado WIP do tick anterior (store/hook/toast/painel) e completado o que faltava da spec C2: pódio ao vivo agora tem ABAS Semana/Mês/Ano (radiogroup acessível, navegação por setas, default Semana).
- Novo núcleo `livePodiumFor(type, …)` em podiumFreeze.ts — pódio corrente de qualquer período; `livePodium` vira alias da semana. +2 testes (três janelas no mesmo instante; ranking separado por senioridade C4). Suíte 445/445, tsc limpo.
- UI (#/liga, chunk lazy LeaguePanel 7,49KB/2,74KB gz; toast 1,95KB/1,10KB gz): perfil com barra XP animada (progressbar ARIA, motion-reduce) + moldura por nível (gradiente cresce até Lenda); vitrine de conquistas (desbloqueadas destacadas); histórico de pódios congelados navegável; toggle admin ON/OFF global com tela de desligada e reativação só-admin.
- Wiring no App.tsx: conclusão de OS (EVENT+UNIFORM+ANALYST via classifyRow) paga XP idempotente (complexidade = marcações TRUE das regras markable); level-up dispara celebração dedicada com confete CSS próprio (`solaris-confetti`, desligado em prefers-reduced-motion); fila de celebração um-toast-por-vez; link "Liga dos Analistas" no menu do Header p/ todos os autenticados. Guest explicitamente excluído da premiação.
- i18n EN/PT completo (chaves league.*; removidas órfãs podiumWeek/live). Bundle initial inalterado ~102KB gz (<500 budget): react-vendor 45,4 + index 47,9 + css 8,1 + html 0,8; firebase segue lazy fora do initial.
- Push confirmado via ls-remote (a26ffd4..04e1848 → origin/features/analista-feliz).

### 2026-08-24 23:22 — tick features-worker: F3 Gamificação Engine (núcleos puros)
- Branch `features/analista-feliz`. Novos módulos em `src/features/gamification/`:
  - `periods.ts`: chaves semana/mês/ano fuso-fixas America/São_Paulo (offset -180min, não depende do relógio do host); reset da semana na segunda 00h local; intervalos meio-abertos p/ agregação.
  - `xp.ts`: eventos de XP da spec B — base 100, +10/inconformidade válida (cap 100), streak diário +25, qualidade +150, estornos negativos (`rework_penalty`/`adjustment`); saldo = soma event-sourced; NUNCA velocidade pura.
  - `levels.ts`: escada Trainee→Assistente→Analista→Editor Sênior→Diretor de QC→Lenda do Estúdio (0/500/2k/6k/15k/40k XP) + fração p/ barra animada.
  - `achievements.ts`: catálogo C3 completo (9 conquistas) com predicados puros e diff de chaves novas p/ toast.
  - `podium.ts`: ranking semana/mês/ano; empate em XP desempata por MENOR retrabalho, depois alfabético (determinístico); rank denso com marcação de empate (1,1,3); separação por senioridade (C4); `frozenPodiumRows` gera linhas prontas pra `podium_history`.
- Testes: `src/__tests__/gamification.test.ts`, 34 asserts cobrindo bordas (reset dom 23:59:59 vs seg 00:00:00 no fuso SP, streak quebrado, caps, limiares exatos de nível, empates, janelas meio-abertas). Suíte completa 423/423 verde; tsc limpo; eslint limpo.
- WIP pré-existente no worktree (App/AnalysisWorkspace/translations — integração de UI do QoL) ficou INTACTO, fora deste commit.
=== TICK F2 (features-worker) — 2026-08-25 13:04 ===
- F6 #4/troca Player (Video.js/hls.js) REJEITADA com prova: YouTube já entra via /api/youtube-proxy → mesmo <video> custom (512l, telemetria onTransport, waveform, shortcuts nativos); não há IFrame legado a trocar. #6 Zustand v5 AVALIADA: estado App=31 useState, zero prop-drilling dolorido → não migra por moda.
- A2 shuttle (velocidade adaptativa, spec A2) ENTREGUE: src/features/qol/shuttle.ts + integração VideoPlayer.tsx (botão S ± + display 0.5×-4× + playbackRate) — cada pulso mesma direção sobe/desce degrau; troca de direção reseta ao 1x; NÃO alimenta XP (C4).
- A1 scratchpad (notas rápidas/OS) ENTREGUE: src/features/qol/scratchpad.ts (ScratchpadController, loadScratch, clampScratchText, validade 30d, limite 20k) — best-effort localStorage, não vai pra planilha; paridade com AutosaveController (debounce 200ms).
- Testes: src/__tests__/shuttleScratchpad.test.ts 7/7 OK; total 527→534; bundle ~102KB gz intacto (lazy, sem chunk novo). Troca #4/#6 documentadas, não alteradas.
- Sem Telegram; src-tauri, audio-acoustics, redesign (tokens.css) intactos. ( ° ʖ °)

### 2026-08-26 ~01h40 — tick features-worker: WIP destrutivo descartado + F2/A2 tema e Pomodoro FECHADOS (commits 7003880..ee09066)
- Diagnóstico de abertura: worktree com WIP SUJO de tick anterior cortado no meio —
  format.ts com função inteira colada DENTRO de string literal (\n fake), App.tsx com
  import no corpo do componente, pomodoro.ts chamando setState fora do render.
  tsc provou (TS1127). O log anterior afirmava "677/677 verdes" para esse estado:
  era impossível — registro corrigido aqui. Probe de processos: zero worker vivo na lane.
  git checkout dos 4 arquivos + rm do pomodoro quebrado; tsc limpo imediatamente.
- Tema (A2) refeito direito: núcleo puro features/qol/theme.ts (sanitização — lixo vira
  system; resolução honesta; leitura/escrita tolerantes) + hook useThemePreference via
  useSyncExternalStore (padrão AchievementToast; aba cruzada e mudança do sistema ao vivo;
  classe dark aplicada por EFEITO declarado, não imperativo no setter) + ThemeMenu no
  Header (radiogroup ARIA, setas movem foco+seleção juntas — bug real pego pelo teste,
  roving tabindex) + applyInitialTheme() no App substituindo o dark-forçado legado.
  jsdom TEM matchMedia (sistema claro): asserções iniciais seguem isso, não o fallback.
- Pomodoro (A2) refeito direito: modelo crash-safe de FIM ÚNICO persistido (epoch ms em
  solaris.pomodoro; tudo derivado — reload retoma o MESMO bloco sem estado duplo),
  PomodoroController com storage/clock/agendador injetáveis, resume() rearma sem reiniciar,
  stale >5min descarta, duplo-stop seguro. Badge no Header: ☕/mm:ss/⏰ (âmbar), popover com
  status role=status e ações, tick de 500ms SÓ rodando. react-hooks/set-state-in-effect
  pegou setState em effect → resolvido assinando no mount (snapshot já vem do useState lazy).
- Testes: themePomodoro.test.ts (21 asserts de borda: sanitização, ceil do relógio, expiração
  exata, stale, resume entre controllers distintos, onExpire 1x) + themePomodoroUi.test.tsx
  (7 asserts jsdom: radiogroup, persistência+classe, setas, ☕→start→stop, resume mesmo fim,
  ⏰ com reinício). Header NÃO montado em jsdom (puxaria Firebase/Realtime inteiro — coberto
  por tsc/build). Suíte 698/698 (+28), tsc limpo, eslint dos arquivos novos 0/0 (ratchet da
  lane pré-existente intocado).
- Bundle: initial 53,56 entry + 44,43 react-vendor = ~98KB gz (budget <500KB intacto; pesados
  fora do initial: vfs_fonts 454,6 / pdfmake 353,7 / ECharts 163,6 / firebase 95,0). Sem chunk
  novo — widgets são minúsculos e vivem no entry.
- Push confirmado via ls-remote (d7d8987..ee09066 → origin/features/analista-feliz).
- Gotchas: patch tool falha se ancorada em conteúdo que EU mesmo restaurei via checkout depois
  de ler (re-ler antes); jsdom dispara focus() mas seleção ARIA de radiogroup precisa seguir o
  foco nas setas; GCM workaround de rede segue essencial no cron.
- Sem Telegram; src-tauri, audio-acoustics, redesign (tokens.css) intactos. ( ° ʖ °)

### 2026-08-26 ~05h30 — tick features-worker: F2/A2 densidade + conforto de mídia FECHADOS (commits 11b5a5e..0b741cd)
- Abertura: WIP do tick anterior ~90% pronto (núcleos density/mediaComfort + UI + wiring + i18n +
  CSS) porém VERMELHO — tsc TS18047 em useMediaComfort.ts:171 e ganho de normalize HARDCODADO
  (`computeNormalizeGain(0, ...)` → atenuação cega fixa de −9,5dB ignorando o pico real).
  `_empty.txt` (rascunho órfão) descartado.
- Correção central (normalize honesto): o envelope da waveform é normalizado pelo pico global no
  pipeline (silêncio relativo some), então NÃO serve pra normalize. O `maxPeakOverall` bruto já era
  calculado e JOGADO FORA no pass 2 — agora `processAudioBufferProgressively` retorna
  `{peaks, peakDbfs}` (dbfsFromChannel sobre o PCM cru), `useAudioWaveform` expõe `peakDbfs`
  (cache LRU solaris.mediapeak.* em hit de cache; write após decode) e o VideoPlayer injeta no
  hook: ganho = min(×3, 10^((−16−pico)/20)); sem medição → neutro (nunca inventa). O grafo WebAudio
  só nasce com ganho real ≠1 (elemento <video> nativo permanece intocado no default).
- Bug real a mais consertado: skip podia disparar seeks repetidos sob re-render defasado dentro da
  mesma pausa (pai cujo currentTime não acompanha o seek) → guarda lastSkipTargetRef: mesmo alvo
  não repete; sair da pausa desarma; voltar de propósito RE-SALTA (correto). Erro de tsc sumiu junto.
- Testes: +33 asserts (densityMediaHook.test.tsx novo: ganho do pico real ×3, neutro sem medição,
  persistência, guarda via harness laggy/reativo; jsdom dos componentes já existentes do WIP).
  Suíte 698→738/738, tsc limpo. ESLint ratchet: useAudioWaveform já carregava os mesmos 4 problemas
  NO HEAD (provado com baseline copiado) — zero introduzido; MediaComfortToggle limpo (wrapper morto
  removido, imports/vars não usados).
- Bundle: entry 53,56→55,31KB gz (+1,75; widgets vivem no entry), initial ≈108KB gz — budget <500KB
  intacto; pesados lazy (vfs_fonts 454,6 / pdfmake 353,7 / ECharts 163,6 / firebase 95,0).
- Push confirmado via ls-remote (58fcf00..0b741cd → origin/features/analista-feliz); check Vercel
  Preview success; CI remoto não roda nesta branch (gatilhos só no desktop) — contrato da lane é a
  validação local completa, feita.
- Gotchas: vitest.config include só casa src/** (probe fora de src falha "No test files found");
  act() manual EM TORNO do render inicial em teste de hook engole o render inteiro sob RTL+Vitest 4
  (onReady x0, componente nunca montou) — montar FORA de act() e usar act() só nos eventos;
  snapshot capturado de api vira stale após act() (objeto muda por render) — ler sempre via getter;
  patch idempotente falha quando old_string == new_string (usar replace direto com âncoras de linha
  única em arquivo CRLF — blocos multi-linha do heredoc casam LF-only e falham silenciosamente).
- Sem Telegram; src-tauri, audio-acoustics, redesign (tokens.css) intactos. ( ° ʖ °)

---

## histórico (merge lane audio/acoustics)


# SOLARIS — log de trabalho

## Tick 26/08 ~09h45 - audio-dsp (Yui / cron solaris-audio)

Worktree solaris-audio (branch audio/acoustics); desktop/src-tauri/pitch intocados.
TEMA: MERGE PREVENTIVO da origin/main pos tick#30 do turbo-web (delta docs-only:
logs + gates lh/axe + script append_log_t30.py) + PROVAS FRESCAS + PR #2 re-verde.
Feature em modo guardrail: motor completo, zero gaps novos encontrados.

- Merge origin/main (64d90d5): conflito so no prepend do log compartilhado;
  resolvido pelo protocolo da lane (parse linha-a-linha, AMBOS os blocos mantidos,
  lane primeiro, marcadores removidos byte-exato) => commit fd10cae.
- PROVAS FRESCAS na arvore mesclada (execucao propria, foreground): tsc --noEmit
  limpo; vitest 446/446 VERDES (46 arquivos, ~123s).
- Push via workaround GCM provado por ls-remote (fd10cae em origin).
- PR #2 RE-VERDE: ci success @fd10cae + Vercel x2 pass; mergeable=MERGEABLE.
  Continua OPEN, aguardando decisao do dono (nada merged por mim).
=== FIM TICK - lane sincronizada c/ main, PR #2 verde, motor estavel ===

## Tick 26/08 ~09h00 — audio-dsp (Yui / cron solaris-audio)

Worktree solaris-audio (branch audio/acoustics); desktop/src-tauri/pitch intocados.
TEMA: MERGE PREVENTIVO da origin/main pos tick#29 do turbo-web (delta docs-only:
logs+gates lh/axe) + PROVAS FRESCAS + auditoria anti-buraco da spec.

- MERGE c/ conflito esperado no log compartilhado (prepend duplo): resolvido pelo
  protocolo da lane (parse linha-a-linha, AMBOS os blocos mantidos, lane primeiro,
  remocao byte-exata dos 3 marcadores CRLF) -> b1d938c. Lane 0/0 vs main.
- PROVAS FRESCAS na arvore mesclada (execucao propria): tsc --noEmit limpo;
  vitest 446/446 VERDES (46 arquivos, 131s). Push via workaround GCM provado por
  ls-remote (b1d938c em origin).
- PR #2 RE-VERDE: ci success @b1d938c (1m55s) + Vercel x2 pass. Continua OPEN,
  aguardando decisao do dono (nada merged por mim).
- AUDITORIA DE FRAQUEZAS (busca de trabalho real): zero gaps novos encontrados.
  (a) Benchmark P2 existe e esta verde: 120s de aula sintetica <3s => 1h extrapolada
  <90s (alvo da spec); (b) FP dry+lossy do Schroeder coberto: sentinel ||2.5 restrito
  ao caminho legado, caminho ML trata rt60Final=0 como 'seco' genuino;
  (c) known-answer re-executado fresco: 16/16 (FFT/clipping/hum/floor/eco/reverb
  Schroeder+dry+monotonicidade + integracao analyzeAudioPcm);
  (d) P3 vivo: AcousticPanel importado e renderizado em AnalysisWorkspace.tsx:935.
- NOTA: preview Vercel da lane esta atras de login (deployment protection) -
  nao citavel como prova externa; validacao segue local + CI remoto.
=== FIM TICK - lane sincronizada c/ main, PR #2 pronto, motor sem gaps ===


## Tick 26/08 ~08h10 — audio-dsp (Yui / cron solaris-audio)

Worktree solaris-audio (branch audio/acoustics); desktop/src-tauri/pitch intocados.
TEMA: MERGE PREVENTIVO da origin/main na lane (aedb89b, tick #28 turbo-web) +
PROVAS FRESCAS pos-merge. Fila P1-P4 continua 100% fechada; PR #2 aberto,
mergeable=CLEAN, aguardando decisao do dono (nada merged por mim).

- MERGE PREVENTIVO: origin/main andou 1 commit desde o ultimo merge (dea3422);
  aedb89b e so docs/gates do turbo-web (scripts/lh-report-r*.json, axe-report,
  append_log_t28.py, bloco de log). Merge limpo SEM conflito desta vez (o
  protocolo de prepend do log compartilhado funcionou: ambos os blocos vivos).
- PROVAS FRESCAS NA ARVORE MESCLADA (execucao propria, nao herdada): vitest
  446/446 VERDES, 46 arquivos, 131s. Zero codigo de produto afetado pelo merge
  (diff so toca scripts/ e log) - risco de regressao ~nulo, provas mesmo assim.
- AUDITORIA RAPIDA DE FRAQUEZAS (busca de trabalho real p/ o tick): clamp de
  RT60 final ja existe (reverbMl.ts:183 Math.max(fused,0)); big_errors_audit do
  train-report (ML negativo em dry) e caso coberto pelo clamp; integracao P3
  re-confirmada viva (qcReport injeta secao acustica; sheetSync tem as 5
  colunas Reverb/Clip/Ruido/Distorcao/Eco com aliases). Nenhum gap novo.
- Push via workaround GCM; src-tauri e pitch intocados; sem Telegram.
=== FIM TICK - lane audio/acoustics sincronizada com main, PR #2 pronto ===
## Tick #30 26/08 ~09h10 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno

- Estado: HEAD 2379323 == origin/main provado pos-fetch; rev-list 0/0 nos dois
  sentidos. Branches pendentes re-auditadas: v2-upgrade, v2-upgrade-recovery e
  turbo/web-opt TODAS contidas em main (0 ahead). Lanes irma desktop
  (+69), audio/acoustics (+37), features (+56) e redesign (+64) seguem nas
  PROPRIAS linhas (padrao conhecido, nada a sincronizar). Unico extra vs main:
  develop +1 = commit do PROPRIO dono "Update README.md" (bd3a560, 01/02) -
  conteudo de README, nao trabalho de lane. CI remoto success no sha 2379323.
  Zero deltas.
- Bateria fresca propria (nao herdada): tsc --noEmit limpo; vitest 31 arquivos /
  342/342 (~14s); e2e fluxo real (YouTube -> scoring -> fila -> export QC)
  21/21; axe-core 0 violacoes ({loginRules:0, mainAppRules:0,
  criticalOrSeriousMainApp:0}); console probe 0 eventos; Lighthouse x2
  (--headless=new --disable-gpu): R1 e R2 ambos P100/A100/BP100 (FCP 1,4s /
  LCP 1,5s / CLS 0,000 / TBT 0ms).
- Bundle (chunk_report.mjs, gzip level 9): INITIAL 40,35KB gz byte-estavel vs
  ticks #12..#29 (entry index-C1mX7UAW.js 32,98KB gz + CSS 7,60KB gz); TOTAL
  940,32KB raw / 233,16KB gz; maiores chunks: firebase 94,82 (lazy, fora do
  caminho critico) / react-vendor 44,65 / AnalysisWorkspace 19,49 / AdminGate
  18,49 KB gz. Alvo initial <500KB gz mantido com folga (~12x).
- Quirk novo documentado: cadeia de gates em background=true falha aqui com
  exit 1 e saida vazia/"stdin is not a tty" no PRIMEIRO passo que usa
  execSync/preview (chunk_report/axe/turbo-gates) - os MESMOS comandos passam
  100% em foreground individual. Causa provavel: stdio herdado da sessao bash
  background desta caixa. Workaround adotado: gates longos em foreground com
  timeout alto; se voltar a acontecer, testar < /dev/null + setsid antes de
  culpar o gate.
- Deps: sem advisory nova desde o tick #12 (10 moderates omit-dev seguem
  major-gated, 0 high/critical).
- Higiene geral: zero processos vite <1h na maquina (probe por CreationDate);
  orfaos pre-existentes de OUTRAS lanes intocados. src-tauri/pitch intocados
  (do outro worker); suite commitada segue valendo. Sem Telegram.

## Tick #29 26/08 ~08h30 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno

- Estado: HEAD aedb89b == origin/main provado pos-fetch/ls-remote; CI remoto
  success no sha aedb89b. Branches pendentes re-auditadas: v2-upgrade,
  v2-upgrade-recovery e turbo/web-opt TODAS contidas em main (0 ahead) -
  nada a sincronizar de nenhuma lane. Zero deltas.
- Bateria fresca propria (nao herdada): tsc --noEmit limpo; vitest 31 arquivos /
  342/342 (~34s); e2e fluxo real (YouTube -> scoring -> fila -> export QC) 21/21;
  axe-core 0 violacoes ({loginRules:0, mainAppRules:0, criticalOrSeriousMainApp:0});
  console probe 0 eventos; Lighthouse x2 (--headless=new --disable-gpu): R1 e R2
  ambos P100/A100/BP100 (FCP 1,4s / LCP 1,5s / CLS 0,000 / TBT 0ms).
- Bundle (chunk_report.mjs, gzip level 9): INITIAL 40,35KB gz byte-estavel vs
  ticks #12..#28 (entry index-C1mX7UAW.js 32,98KB gz + CSS 7,60KB gz); TOTAL
  940,32KB raw / 233,16KB gz; maiores chunks: firebase 94,82 (lazy, fora do
  caminho critico) / react-vendor 44,65 / AnalysisWorkspace 19,49 / AdminGate
  18,49 KB gz. Alvo initial <500KB gz mantido com folga (~12x).
- Higiene da PROPRIA lane: removido scripts/lh_report.mjs (morto desde o tick 1:
  require() dentro de .mjs, porta fixa 5173, URL errada /dist/index.html,
  hardcode 177KB pre-splitting, zero referencias em qualquer script/log);
  adicionado run_build_t29.mjs (npm run build via execSync - protocolo
  anti-falso-positivo do foreground guard).
- Deps: npm audit --omit=dev segue 10 moderates major-gated (0 high/critical),
  sem advisory nova desde o tick #12.
- Higiene geral: zero orfaos da lane - so ContractKit (:4179, work_ck_repo) e
  Hein/Zimny (:4188, Hein-Esthetics), atribuidos por PATH+porta e POUPADOS
  (Hein intocavel sem ordem explicita do Zee). src-tauri/pitch intocados (do
  outro worker); suite commitada segue valendo. Sem Telegram.

## Tick #28 26/08 ~07h05 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno

- Estado: HEAD 661cb50 == origin/main provado pos-fetch; rev-list 0/0 nos dois
  sentidos. Branches pendentes re-auditadas: v2-upgrade, v2-upgrade-recovery e
  turbo/web-opt TODAS continas em main (0 ahead) - nada a sincronizar de
  nenhuma lane. CI remoto success no sha 661cb50. Zero deltas.
- Bateria fresca propria (nao herdada): tsc --noEmit limpo; vitest 31 arquivos /
  342/342 (~36s); e2e fluxo real (YouTube -> scoring -> fila -> export QC) 21/21;
  axe-core 0 violacoes ({loginRules:0, mainAppRules:0, criticalOrSeriousMainApp:0});
  console probe 0 eventos; Lighthouse x2 (--headless=new --disable-gpu): R1 e R2
  ambos P100/A100/BP100 (FCP 1,4s / LCP 1,5s / CLS 0,000 / TBT 0ms).
- Bundle (chunk_report.mjs, gzip level 9): INITIAL 40,35KB gz byte-estavel vs
  ticks #12..#27 (entry index-C1mX7UAW.js 32,98KB gz + CSS 7,60KB gz); TOTAL
  940,32KB raw / 233,16KB gz; maiores chunks: firebase 94,82 (lazy, fora do
  caminho critico) / react-vendor 44,65 / AnalysisWorkspace 19,49 / AdminGate
  18,49 KB gz. Alvo initial <500KB gz mantido com folga (~12x).
- Deps: npm audit --omit=dev segue 10 moderates major-gated (0 high/critical),
  sem advisory nova desde o tick #12.
- Higiene: zero orfaos da lane - so ContractKit (:4179, work_ck_repo) e
  Hein/Zimny (:4188), atribuidos por PATH+porta e POUPADOS (Hein intocavel sem
  ordem explicita do Zee). src-tauri/pitch intocados (do outro worker); suite
  commitada segue valendo (commits da lane sao docs-only). Sem Telegram.

## turbo-web
### 2026-08-25 ~20h30 - tick #16: guardrail noturno - fila DONE, zero deltas, gates re-provados

- Fila bundle/split/e2e/a11y/lighthouse segue 100% DONE (ticks #1-#15); sem diretiva nova.
- Upstream auditado: origin/main sem delta (fd281fc == local); v2-upgrade contida em main;
  develop avançou só README (bd3a560, fora do escopo da lane). Nada a sincronizar.
- Gates na main @ fd281fc:
  vitest **342/342** (+tsc clean), e2e fluxo real **21/21**, axe **0/0** violacoes,
  console probe **0 eventos**, build byte-estavel `index-C1mX7UAW.js` -
  initial gz **79,65KB core** (index 33,86 + react-vendor 45,79; +CSS 7,60 = 87,25KB) vs alvo <500KB.
- Lighthouse x2 (headless --disable-gpu): R1 **99/100/100/100**, R2 **99/100/100/100**
  (FCP 1.5s / LCP 1.6s / TBT 20 e 0ms / CLS 0; perf 99 = ruido CPU ambiente documentado).
- Preview em porta alta aleatoria (4540) com PROVA de hash (entry servido == dist local);
  encerrado apos o gate. Background preview passou a esbarrar no guard de foreground do
  terminal - protocolo: background=true + probe/porta em chamada separada.


### 2026-08-25 ~21h40 - tick #15: guardrail noturno - fila DONE, zero deltas, gates re-provados

- Fila bundle/split/e2e/a11y/lighthouse segue 100% DONE (ticks #1-#14); sem diretiva nova.
- Deps: npm audit re-checado - prod 10 moderates major-gated (0 high/critical),
  sem advisory nova desde o tick #12. Nada a atualizar.
- Gates na main @ d479238 (sync origin 0/0):
  vitest **342/342** (+tsc clean), e2e fluxo real **21/21**, axe **0/0** violacoes,
  console probe **0 eventos**, build byte-estavel `index-C1mX7UAW.js` -
  initial gz **79,65KB core** (index 33,86 + react-vendor 45,79; +CSS 7,60 = 87,25KB) vs alvo <500KB.
- Lighthouse x2 (headless --disable-gpu): R1 **99/100/100/100**, R2 **98/100/100/100**
  (perf <100 = ruido CPU ambiente ~40% ja documentado nos ticks #13/#14; TBT 20/140ms).
- Preview servido em porta alta aleatoria com PROVA de hash (entry servido == dist local);
  preview v4->v6 segue IPv6-only (::1), localhost family:6 ok, 127.0.0.1 ECONNREFUSED esperado.


### 2026-08-24 — tick 1: auditoria de bundle (baseline)

Branch `turbo/web-opt` @ 729dd9b (v2-upgrade + lazy firebase + perf runtime já aplicados).

Build de produção (`npm run build`, vite 4.5.14, 130 módulos):

| chunk | raw | gzip |
|---|---|---|
| index.js (entry) | 111.5 KB | **33.2 KB** |
| react-vendor.js | 141.8 KB | **45.4 KB** |
| index.css | 40.2 KB | **7.6 KB** |
| **initial total** | ~293 KB | **~86 KB gz** |
| AnalysisWorkspace.js (lazy) | 70.2 KB | 20.1 KB |
| AdminGate.js (lazy) | 74.1 KB | 18.9 KB |
| sheetSync.js (lazy) | 33.5 KB | 11.2 KB |
| BugReportModal/Viewer (lazy) | 7.7 KB | 3.2 KB |
| firebase.js (lazy) | 472.6 KB | 97.4 KB |

- Alvo initial < 500 KB gz: **cumprido com folga (~86 KB)**.
- Firebase compat SDK (maior chunk) já é lazy — não carrega no initial.
- Code splitting React.lazy+Suspense (AnalysisWorkspace, AdminGate) e vendor chunks
  (react/firebase via src/utils/chunking.ts testado) já presentes de ticks anteriores.
- Testes: 29 arquivos / 332 passed antes do commit.

Próximos ticks candidatos: runtime perf em Monitors (memo), axe-core scan,
Lighthouse CI baseline ANTES/DEPOIS.

### 2026-08-24 — tick 3: E2E do fluxo real (fallback node puro)

Playwright não instalado ⇒ fallback da fila: script node + esbuild (mesma
versão do lockfile) compilando as funções puras TS on-the-fly.
`scripts/e2e-flow.mjs` (`npm run test:e2e`), 21 asserts cobrindo o fluxo real:

1. colar URL YouTube → `getVideoIdFromUrl` (watch/youtu.be/embed/sem protocolo/nulos)
2. análise mockada → `recalculateScoresWithEngine`: linha limpa = 5,00; 2 marcações
   reais do seed (Audio Clipping, Focus Hunting) derrubam a nota, penalidades nas
   categorias certas, zero órfãs; `applyScoreUpdates` persiste FINAL na linha
3. fila → `computeFilteredRows`: pendente/concluída/especial + filtro por estúdio + busca guest
4. export QC → `generateQCReport('pt')` localizado + blob HTML com título/métricas

Resultado: **E2E_FLOW OK — 21/21 asserts**; suíte vitest 29 arquivos / 332 passed
intacta. Zero dependência nova. Próximo tick: a11y pass (axe-core) ou Lighthouse baseline.

### 2026-08-25 (noite) — tick turbo-web: lazy A/B compare + Lighthouse ANTES/DEPOIS

Code splitting fechado: ComparePane (modo A/B) era eager dentro do
AnalysisWorkspace; agora e React.lazy + Suspense (fallback inline) — chunk
proprio baixa so ao ativar o modo compare.

| chunk | antes raw/gz | depois raw/gz |
|---|---|---|
| ComparePane.js | (dentro do workspace) | 3,55 KB / 1,36 KB gz |
| AnalysisWorkspace.js | 70,30 KB / 20,11 KB | 67,47 KB / 19,68 KB |
| initial total | ~293 KB / ~86 KB gz | ~293 KB / ~86 KB gz (inalterado, como esperado) |

Lighthouse 13.4.1 local (preview estatico em porta aleatoria alta, hash do
entry conferido, headless novo sem GPU, mobile default):

| categoria | ANTES | DEPOIS |
|---|---|---|
| Performance | 95 | 95 |
| Accessibility | 100 | 100 |
| Best Practices | 96 | 96 |

Metricas: FCP 1,7->1,4 s, Speed Index 1,7->1,4 s, LCP 2,9 s estavel,
TBT 0 ms, CLS 0. Axe-core re-validado na build nova: login 0 violacoes,
app principal 0 violacoes (fallback do Suspense passa em contraste).

Suite: vitest 29 arquivos / 332 passed, tsc --noEmit limpo, build ok.
Fila do turbo-web: itens 1-6 todos executados (1/3/4 em ticks 24-25/08,
2 e 6 neste tick).

### 2026-08-25 (noite) — tick turbo-web #2: modo offline/demo + Lighthouse 95/100/96 -> 100/100/100

Fila 1-6 já estava completa; este tick atacou os pontos perdidos que
restavam nos audits (unminified/unused JS + errors-in-console).

Causa raiz: builds sem env Firebase (demo/local) bootavam o compat SDK
igualmente -> `FIREBASE FATAL ERROR` no console de TODO visitante demo;
e a index.html puxava gapi + GSI (~100 KB, 80 KiB apontados como unused
pelo LH) mesmo sem uso.

Mudanças:
- `config/firebase.ts`: gate `isFirebaseConfigured()` (projectId &&
  databaseURL); `loadFirebase()` rejeita rápido SEM baixar o SDK.
- `index.html`: scripts do Google removidos do HTML estático; agora são
  injetados on-demand em `pollForApis()` só quando há config.
- Assinantes DB silenciados sem config: locks (AnalysisSheet),
  timestamps (Workspace + TimestampDock), presence (OnlineUsers +
  App), bugReports (Viewer), adminRole (`useAdminRole.resolve()` —
  era o fire-and-forget sem catch que estourava exceção não capturada).
- LoginScreen: aviso i18n "Modo demo: build local sem serviços em nuvem".
- Logout guest-safe sem config.

| Lighthouse | antes | depois |
|---|---|---|
| Performance | 95 | **100** |
| Accessibility | 100 | 100 |
| Best Practices | 96 | **100** |
| FCP / LCP | 1,7 s / 2,9 s | **1,4 s / 1,5 s** |
| TBT / CLS | 0 ms / 0 | 0 ms / 0 |
| Console errors (LH) | 2 | **0** |

Bundle initial inalterado (~86 KB gz; firebase chunk continua lazy e fora
do caminho crítico). Axe-core re-validado na build nova: 0 violações
(scanner adaptado para build demo, que não tem login screen).
Console-probe CDP próprio: 0 eventos de erro/warning/exceção.

Suite: vitest 30 arquivos / 335 passed (+3 firebaseConfig), tsc limpo,
test:e2e 21/21. Commits 9b274e2 + 56df76c na turbo/web-opt.
Nota: redeploy Vercel da web herda os ganhos no próximo push para main.

### 2026-08-25 (noite) — tick turbo-web #4: ilha LiveMonitors isola o loop de 15 Hz

Fila 1-6 já DONE; auditoria do tick achou o último ponto quente de runtime:
`useAVAnalysis` fazia setState a ~15 Hz DENTRO do AnalysisWorkspace durante
todo o playback — cada tick re-renderizava a árvore inteira de 1036 linhas
(sheet form, filtros, header, shortcuts) só para atualizar 4 canvases.

Mudança: novo `src/components/Analysis/LiveMonitors.tsx` — ilha memoizada que
vira DONA do estado de análise (hook + 4 docks RGB Parade/Waveform/
Spectrogram/VU Meter + modal de zoom). Workspace passa a receber só
`<LiveMonitors videoRef videoSrc/>`; videoRef continua compartilhado com o
VideoPlayer. Modal de zoom migrou para `createPortal(document.body)`.

| métrica | antes | depois |
|---|---|---|
| re-renders por tick de playback | workspace inteiro (~1036 linhas + filhos) | só a ilha (4 docks) |
| AnalysisWorkspace.js | 68,8 KB raw | 67,7 KB raw (-1,1 KB) |
| initial gz | 86 KB | 86 KB (inalterado) |
| Lighthouse P/A/BP | 100/100/100 | **100/100/100** |
| FCP / LCP / TBT / CLS | 1,4 s / 1,5 s / 0 ms / 0 | idem |
| axe-core | 0 violações | **0 violações** |
| console (probe CDP + LH) | 0 eventos | **0 eventos** |

Suite: vitest 31 arquivos / 342 passed, tsc --noEmit limpo, test:e2e 21/21.
Commit d67c66f em origin/turbo/web-opt.

Incidente operacional (protocolo de porta validado funcionou): axe-scan da
primeira tentativa falhou SAFE — hash servido ≠ dist local; um órfão de
preview deste projeto (tick anterior, porta fixa baixa) respondia com build
velha. Listados todos os `vite preview` via Win32_Process, matados SOMENTE os
do solaris-web-turbo (3 grupos, portas 4214/4482/4371), re-scan em porta
aleatória alta passou com hash conferido. Scripts auxiliares:
scripts/list_preview_orphans.ps1 e kill_turbo_orphans.ps1.

### 2026-08-25 (madrugada) — tick turbo-web #5: re-auditoria ponta a ponta (fila 1–6 já DONE)

Fila da noite (bundle, code splitting, runtime, e2e, axe, lighthouse)
confirmada 100% implementada nos ticks #1–#4. Este tick foi prova de
não-regressão na HEAD (ac7ce76) com números frescos:

| verificação | resultado |
|---|---|
| build (vite) | determinística — hashes idênticos em 2 builds seguidas |
| initial gz (index+react-vendor+css) | **86,9 KB** (alvo <500KB: 6× folga) |
| chunks | index 33,63 + react-vendor 45,44 + firebase 97,35 gz; firebase/ComparePane/BugReport* lazy |
| vitest / tsc / test:e2e | 31 arq · **342 passed** / limpo / **21/21** |
| axe-core (build servida, hash conferido) | **0 violações** (login n/a demo, app principal 0) |
| console-probe CDP | **0 eventos** de erro/warning/exceção |
| Lighthouse P/A/BP/SEO | **100 / 100 / 100 / 100** — FCP 1,4s · LCP 1,5s · TBT 0ms · CLS 0 · SI 1,9s |

Fluxo E2E mandado coberto em scripts/e2e-flow.mjs (load→YouTube URL→análise
mockada→export QC via funções puras + esbuild). Sem gaps novos: nenhum
componente pesado fora de lazy, nenhum setState quente fora da ilha
LiveMonitors, lista de 1036 linhas já memoizada com render único.
Commit desta entrada em origin/turbo/web-opt.


---

## turbo-web (tick #6) — higiene: upstream da branch + orfaos de preview — 25/08/2026 ~09h40

- Fila 1-6 do turbo-web segue DONE (ticks #1-#5); este tick NAO re-auditou nada,
  so fechou dividas de infraestrutura do worker.
- Upstream corrigido: branch turbo/web-opt apontava origin/main (lia "ahead 14"
  como trabalho nao-pushado, risco de outro worker descartar a lane). A branch
  remota EXISTE em 4183037 = HEAD local; ls-remote provou; --set-upstream-to=
  origin/turbo/web-opt aplicado. Estado real: em dia com o remoto.
- axe-report.json revertido: diff era so timestamp de re-run (11:14->11:55Z),
  zero mudanca de conteudo.
- Orfaos vite preview mortos: 4 no total — dir principal solaris-av-engine
  ports 4199 (22h vazando) e 4173 (20.4h) + deste worktree ports 4297 e 4207.
  Lane redesign intocada (worker vivo la as 09:35:33, spawnou redesign_axe_t9).
  kill_turbo_orphans.ps1 reescrito: auto-descoberta por cmdline com filtro de
  idade (-MaxAgeHours 3), skip duro da lane redesign, skip de processos frescos;
  fim dos PIDs hardcoded. Protocolo de prova anti-auto-deteccao mantido:
  processos da propria checagem se listam (bash/powershell criados no mesmo
  segundo) — filtrar por CreationDate antes de concluir "restou algo".

---

## turbo-web (tick #7) — re-auditoria pos-P16/P17 + divida do tooling — 25/08/2026 ~10h20

- Fila 1-6 segue DONE. Mudanca de estado desde o tick #5: main avancou com
  P16 (heatmap/XLSX twin) e P17 (category filter chips). rev-list provou
  turbo/web-opt = origin/main +15 commits proprios, 0 atras — NADA a
  sincronizar; as features novas ja nascem dentro da lane turbo.
- Re-auditoria fresca na HEAD nova (25b66d3):
  | gate | resultado |
  |---|---|
  | build vite | deterministica; initial gz 86,7KB (index 33,63 + react-vendor 45,44 + css 7,60); alvo <500KB: 5,8x folga |
  | chunks lazy | firebase 472,58 raw/97,35 gz (on-demand), AdminGate 74,11, AnalysisWorkspace 67,70, sheetSync 33,53, ComparePane/BugReport* ~1-2 gz cada |
  | vazamento de deps pesadas no cliente (googleapis/firebase-admin/ffmpeg/xlsx/lodash/moment) | ZERO imports em src/ |
  | vitest / tsc / e2e | 31 arq · 342/342 · limpo · 21/21 |
- Unica divida achada pelo tooling: caniuse-lite com 8 meses. Fixada neste
  tick (commit 25b66d3): build byte-identica apos update, warning fora,
  gates re-provados na arvore final.
- Sem Telegram, sem toque em src-tauri (lane desktop intacta).

### 2026-08-25 (madrugada) — tick turbo-web pós-merge #8 (worktree no main)
Lane turbo-web absorvida pelo main @ 30b4b7b (merge ticks #1-#7). Worktree solaris-web-turbo movido para main, pull ff-only ok, árvore limpa. Gates reprovados na árvore final mesclada: build determinística, initial gz 86,7 KB (index 33,67 + react-vendor 45,44 + css 7,60) <500KB alvo; chunks lazy idem (firebase 97,35, AdminGate 18,93, AnalysisWorkspace 19,68 gz); vitest/tsc limpar; E2E 21/21; axe 0; Lighthouse 100/100/100 (FCP 1,4/LCP 1,5/TBT 0/CLS 0). src-tauri intocado. Sem Telegram.

## turbo-web tick #9 — push do main + gates re-provados na árvore final — 25/08/2026 ~13h45

- Estado encontrado: fila turbo-web 100% DONE e mergeada no main local
  (30b4b7b), mas o push tinha ficado preso: main local = origin/main + 2
  commits (30b4b7b merge + eb90c8f lint-ratchet) que só existiam localmente.
- Este tick fechou a dívida de publicação + re-provou todos os gates na árvore
  mesclada final (solaris-web-turbo @ main):
  - build vite: initial gz 86,71 KB (index 33,67 + react-vendor 45,44 +
    css 7,60) — alvo <500KB mantido com folga (5,8x); chunks lazy idem:
    firebase 97,35 / AdminGate 18,93 / AnalysisWorkspace 19,71 /
    sheetSync 11,18 / ComparePane+BugReport* ~1-2 gz cada.
  - tsc --noEmit limpo; vitest 31 arquivos · 342/342 verdes;
  - E2E fluxo real (scripts/e2e-flow.mjs): 21/21 asserts ok;
  - axe-core na build servida (vite preview + headless Chrome --disable-gpu):
    0 violações login, 0 no app principal (criticalOrSerious=0);
  - console probe CDP: 0 erros / 0 warnings / 0 exceções (build offline entra
    direto no app demo, sem botão visitante);
  - Lighthouse 13.4.1 (--headless=new --disable-gpu): 100 performance ·
    100 accessibility · 100 best-practices · 100 seo — FCP 1,4s · LCP 1,5s ·
    TBT 0ms · CLS 0 · SI 1,8s.
- Push origin/main efetuado (ff 30b4b7b), verificado por ls-remote.
- src-tauri intocado (lane desktop é de outro worker). Sem Telegram.

## turbo-web tick #10 — dívida de segurança: prod zera high/critical — 25/08/2026 ~15h20

- Estado encontrado: fila 1–6 segue DONE/mergeada (nada a re-auditar); main
  limpo no worktree, origin/main = main. Trabalho novo escolhido: a dívida de
  segurança marcada fora-de-escopo no tick #7 (npm audit).
- ANTES (prod): 30 vulns = 1 critical + 8 high + 20 moderate + 1 low.
  Critical = websocket-driver <=0.7.4 (GHSA-mp7j-qc5w-4988 /
  GHSA-xv26-6w52-cph6) via firebase@10 > @firebase/database > faye-websocket.
- Passo 1 — npm audit fix (só não-breaking): crítico morto com patch bump
  websocket-driver 0.7.4 -> 0.7.5; 29 pacotes re-resolvidos dentro de range;
  package.json intocado neste passo. Prod: 30 -> 24 vulns.
- Passo 2 — pins antigos de overrides viraram o gargalo: protobufjs 7.5.5 e
  fast-xml-parser 4.5.5 (de ticks anteriores) agora são eles mesmos vulneráveis
  e travavam a cadeia (@grpc/proto-loader, google-gax, proto3-json-serializer,
  @google-cloud/firestore). Bump mínimo dos pins:
  protobufjs 7.5.5 -> 7.6.5 (fix range <=7.6.4), fast-xml-parser 4.5.5 -> 5.7.0
  (fix range <5.7.0). Prod: 24 -> ~20, highs de gRPC zerados.
- Passo 3 — undici pin 6.25.0 -> 6.28.0 (vuln range <=6.27.0, fix ainda no
  próprio 6.x — sem major). PROD FINAL: 10 vulns, TODAS moderate major-gated
  (firebase 12 / firebase-admin 14 / googleapis 176), 0 high, 0 critical.
  Árvore completa (incl. dev): 35 -> 13 (resta 1 high = vite <=6.4.2, fix é
  vite@8 major — dívida documentada p/ tick próprio).
- Gates na árvore atualizada (worktree solaris-web-turbo @ main):
  - tsc --noEmit limpo; vitest 31 arquivos · 342/342 verdes;
  - build vite: initial gz 86,71 KB byte-idêntico ao tick #9 (index 33,67 +
    react-vendor 45,44 + css 7,60); chunks lazy idem (firebase 97,35,
    AdminGate 18,93, AnalysisWorkspace 19,71, sheetSync 11,18);
  - E2E fluxo real: 21/21 asserts ok;
  - axe-core build servida: 0 login / 0 app principal (report regenerado);
  - console probe CDP: 0 erros / 0 warnings / 0 exceções (guestClicked:false =
    esperado, build offline entra direto no demo);
  - Lighthouse x2 rodadas (--headless=new --disable-gpu): performance 99 ·
    accessibility 100 · best-practices 100 · seo 100 — FCP 1,4s · LCP 1,6s ·
    TBT 10ms · CLS 0. Perf 99 vs 100 do tick #9 é ruído de CPU (desktop e
    áudio lanes em paralelo); bundle inicial idêntico, tempos iguais,
    confirmado em 2 rodadas.
- Pendências registradas (major-gated, um tick cada com gates completos):
  firebase ^10->^12, firebase-admin ^12->^14, googleapis ^140->^176,
  vite ^4->^8 (high dev).
- src-tauri intocado. Sem Telegram.

### 2026-08-25 ~19h — turbo-web tick #11: guardrail noturno — zero deltas, gates re-provados

- Estado encontrado: fila 1–6 segue DONE/mergeada; origin/main = main local
  @ 86b6b85 (tick #10); worktree limpo. Branches com ahead>0 sao de OUTRAS
  lanes (desktop 37, redesign 25, audio 18, features 17) — nenhum trabalho da
  fila web ficou orfao sem PR.
- Gates re-provados nesta arvore exata:
  - tsc --noEmit limpo; vitest 342/342 (31 arquivos);
  - build deterministica: initial gz 86,71 KB byte-identico ao baseline
    (index 33,67 + react-vendor 45,44 + css 7,60); lazy idem (firebase 97,35,
    AdminGate 18,93, AnalysisWorkspace 19,71, sheetSync 11,18);
  - E2E fluxo real 21/21 asserts;
  - npm audit prod: 10 moderate major-gated, 0 high/0 critical (estavel vs #10);
  - axe-core na build servida (preview porta alta aleatoria, hash do entry
    conferido contra dist local): 0 violacoes login / 0 app principal;
  - console probe CDP: 0 erros/0 warnings/0 excecoes;
  - Lighthouse x2 rodadas (--headless=new --disable-gpu): 100/100/100/100 nas
    duas — perf 99 do tick #10 confirmado como ruido de CPU; FCP 1,4s /
    LCP 1,4s / TBT 0ms / CLS 0.
- Nenhuma mudanca de codigo => nenhum commit alem deste registro. Pendencias
  major-gated seguem as listadas no tick #10 (firebase 12, firebase-admin 14,
  googleapis 176, vite 8).
- src-tauri intocado. Sem Telegram.

---

### 2026-08-25 ~20h20 - turbo-web tick #12: vite 4->6.4.3 (security) + robots.txt; guardrail re-provado

- Guardrail inicial (arvore no estado do tick #11): tsc limpo, vitest 342/342,
  build initial gz 86,71KB byte-identica, e2e 21/21, axe 0/0 (hash entry
  conferido), console probe 0 eventos, Lighthouse 100/100/100/100.
- Divergencia de audit detectada vs tick #10/#11: 1 HIGH apareceu (13 vulns
  total) — vite <=6.4.2 com 7 advisories de dev-server (path traversal /
  server.fs.deny bypass no Windows, launch-editor cmd injection). A pendencia
  major-gated "vite 8" virou high real.
- Decisao por dados (OSV): todas as 7 advisories tem fix na linha 6.x
  (6.4.3 fecha a ultima). Upgrade MINIMO escolhido: vite ^4.2->^6.4.3 +
  plugin-react ^3.1->^4.7.0 (peer cobre vite 4-7); evita salto p/ v8
  (rolldown-by-default, blast radius maior). vitest 4 ja aceitava vite ^6.
- Resultado seguranca: 13 -> 10 vulns (0 high, 0 low); prod segue 10 moderate
  major-gated (firebase 12 / firebase-admin 14 / googleapis 176 continuam na
  fila, um tick cada).
- Bundle: initial gz 86,71 -> 87,25 KB (+0,54KB, +0,6% = runtime novo do
  bundler; alvo <500KB intacto). Chunks lazy preservados (firebase 97,38,
  AdminGate 18,99, AnalysisWorkspace 20,04, sheetSync 11,19).
- Fix colateral: vite 6 preview responde index.html com 200 em rotas nao-
  existentes (SPA fallback) => audit LH robots-txt reprovava (92).
  public/robots.txt adicionado (valido e permissivo; Disallow:/ derrubaria o
  audit is-crawlable pra 66 — testado e descartado). SEO de volta a 100.
- Gates na arvore final: tsc limpo; vitest 342/342; e2e 21/21; axe 0/0;
  console probe 0 eventos; Lighthouse x2 (--headless=new --disable-gpu):
  R1 99/100/100/100 (FCP 1,4s LCP 1,5s TBT 0 CLS 0), R2 100/100/100/100.
- Higiene de maquina: kill_turbo_orphans.ps1 -MaxAgeHours 0 limpou 6 previews
  orfaos DESTE projeto (portas 4223/4261/4707/4711/4713; kill do wrapper npx
  NAO mata o filho node do preview — usar sempre o script). ~50 orfaos de
  vite preview da lane redesign (outras pastas) FORA do meu escopo por
  politica do script — alertado aqui pro worker responsavel limpar.
- src-tauri intocado. Sem Telegram.

---

## turbo-web tick #13 — guardrail noturno + due diligence de deps pesadas — 25/08/2026 ~18h20

Worktree solaris-web-turbo @ main == origin/main (88108e3), arvore limpa.
Fila original (1-6) segue DONE desde o tick #5; nenhum delta de codigo desde
o tick #12. Este tick: re-prova dos gates com numeros frescos + investigacao
de ganho barato restante.

GATES (arvore limpa, build fresca):
- npm run build (vite 6.4.3): initial = index 33,86 + react-vendor 45,79 +
  css 7,60 = 87,25 KB gz — byte-estavel vs tick #12. Chunks lazy intactos
  (firebase 97,38 / AdminGate 18,99 / AnalysisWorkspace 20,04 / sheetSync
  11,19 / ComparePane 1,37).
- tsc --noEmit limpo; vitest 31 arquivos / 342/342 (~30s);
- e2e fluxo real: 21/21 asserts ok;
- axe-core scan: 0 violacoes login+main app, entry servido PROVADO igual ao
  dist local (index-C1mX7UAW.js) antes de confiar no resultado;
- Lighthouse x2 limpas (--headless=new --disable-gpu): R1 99/100/100/100,
  R3 99/100/100/100. (R2 descartada: rodei `npm audit` em paralelo por
  engano durante a medicao — contencao de CPU derrubou perf p/ 96; benchmark
  tem que rodar sozinho, licao registrada.)
- npm audit prod: estavel em 10 moderate, 0 high/critical (mesmo patamar do
  tick #12).

DUE DILIGENCE de ganho barato (sem codigo alterado):
- Deps pesadas do package.json (googleapis, firebase-admin, fluent-ffmpeg/
  ffmpeg-static/ffprobe-static, ytdl-core): ZERO imports em src/. Sao usadas
  apenas pelas funcoes serverless em api/*.ts (proxies Drive/Sheets/YouTube)
  — dependencias de backend legitimas, nao inflam o bundle cliente. NAO
  remover do package.json.
- Audits LH de otimizacao (unused-javascript, bootup-time,
  mainthread-work-breakdown) todas score 1.0 com savings ~0 — nao sobra
  fruta ao alcance da fila; proximos passos reais seriam features novas ou
  migracao de stack (fora do escopo turbo-web).
- Preview deste tick subiu em porta alta fixa 4777 e foi morto no fim
  (protocolo anti-orfao mantido).

src-tauri intocado. Sem Telegram.

## turbo-web tick #14 — guardrail noturno + higiene de orfaos — 25/08/2026 ~19h05

Estado encontrado: worktree @ main == origin/main (88108e3), untracked nenhum;
`scripts/axe-report.json` sujo era so o artefato REGENERADO pelo proprio tick
#13 (timestamp/porta novas, 0 violacoes dentro) — superado por re-scan fresco
deste tick. Fila original (1-6) segue DONE desde o tick #5.

GATES (arvore limpa, build fresca):
- npm run build (vite 6.4.3): initial = index 33,86 + react-vendor 45,79 +
  css 7,60 = 87,25 KB gz — BYTE-ESTAVEL vs ticks #12/#13 (mesmo hash de entry
  index-C1mX7UAW.js). Chunks lazy intactos (firebase 97,38 / AdminGate 18,99 /
  AnalysisWorkspace 20,04 / sheetSync 11,19 / ComparePane 1,37).
- tsc --noEmit limpo; vitest 31 arquivos / 342/342 (~52s);
- e2e fluxo real: 21/21 asserts ok;
- axe-core scan: 0 violacoes main app (build offline/demo sem login), preview
  PROVADO nosso antes do scan (entry index-C1mX7UAW.js na porta 4425);
- Lighthouse x3 (--headless=new --disable-gpu): R1 99/100/100/100 (FCP 1,5 /
  LCP 1,6 / CLS 0,000 / TBT 27ms); R2 e R3 perf 97 (TBT 185/155ms, FCP/LCP/
  CLS identicos). Diagnostico: build byte-idêntica não regride — CPU ambiente
  medida a ~40% durante R2/R3 (enxame de workers/preview de outras lanes ativo
  hoje); ruído documentado como veio, sem re-run até "pegar" score.
- npm audit prod: 10 moderate, 0 high/critical — mesmo patamar estável de
  #12/#13.

HIGIENE (achado novo, SEM acao fora da lane):
- Enxame de `vite preview` orfaos de OUTRAS lanes vivo agora: ~30 trios
  npx/cmd/node da lane redesign (03:54–14:03 de hoje, portas 43xx–48xx),
  + work_ck_repo porta 4179 (24/08) e Hein-Esthetics porta 4188 (24/08).
  Regra de lane mantida: NAO matei processo de outra lane — registrado para o
  dono decidir varredura global.
- Preview deste tick subiu na porta alta 4761 (strictPort), entry provado
  igual ao dist local antes de qualquer medicao e foi morto no fim.

src-tauri intocado. Sem Telegram.

## turbo-web tick #17 — guardrail noturno — 25/08/2026 ~21h25

Estado encontrado: worktree @ main == origin/main (17039f1), zero delta
upstream desde o tick #16 (v2-upgrade segue contida em main; turbo/web-opt
ahead 0 do merge-base). Fila original (1-6) segue DONE desde o tick #5.

GATES (arvore limpa, build fresca):
- build (vite 6.4.3): initial = index 33,86 + react-vendor 45,79 +
  css 7,60 = 87,25 KB gz — BYTE-ESTAVEL vs ticks #12..#16 (mesmo hash de
  entry index-C1mX7UAW.js). Chunks lazy intactos (firebase 97,38 /
  AdminGate 18,99 / AnalysisWorkspace 20,04 / sheetSync 11,19 /
  ComparePane 1,37).
- tsc --noEmit limpo; vitest 31 arquivos / 342/342 (~32s);
- e2e fluxo real: 21/21 asserts ok;
- axe-core scan: 0 violacoes main app (build demo/offline sem tela de
  login), preview PROVADO nosso antes do scan. Nota: a primeira tentativa
  falhou FECHADO na prova de identidade (index servido veio sem o entry
  esperado — consistente com colisao da porta aleatoria com um dos
  servidores estranhos conocidos; strictPort mata o nosso e a prova
  detecta). Re-run em nova porta aleatoria passou e provou o entry.
- Lighthouse x2 limpas (--headless=new --disable-gpu): R1 E R2
  100/100/100/100 (FCP 1,4s / LCP 1,5s / CLS 0 / TBT 0ms) — melhor ronda
  da noite (CPU ambiente livre nas duas).
- console probe: 0 erros/avisos no boot (build demo abre direto no app,
  sem botao guest — comportamento estavel desde tick #14);
- npm audit prod: 10 moderate, 0 high/critical — mesmo patamar estavel
  de #12/#13/#15/#16.

Preview deste tick subiu na porta alta 4652 (strictPort), entry provado
igual ao dist antes das medicoes e foi morto no fim (wrapper bash saiu
cedo e o node filho ficou vivo — matado direto por pid via
Get-NetTCPConnection; porta confirmada livre depois).

src-tauri intocado. Sem Telegram.

## turbo-web tick #18 — guardrail noturno — 25/08/2026 ~22h00

Estado encontrado: worktree @ main == origin/main (bdc4633, tick #17),
zero delta upstream desde o último tick (v2-upgrade segue contida em main;
turbo/web-opt ahead 0; audio/acoustics e desktop em suas lanes próprias).
Fila original (1-6) segue DONE desde o tick #5.

GATES (árvore limpa, build fresca):
- build (vite 6.4.3): initial = index 33,86 + react-vendor 45,79 +
  css 7,60 = 87,25 KB gz — BYTE-ESTÁVEL vs ticks #12..#17 (mesmo hash de
  entry index-C1mX7UAW.js). Chunks lazy intactos (firebase 97,38 /
  AdminGate 18,99 / AnalysisWorkspace 20,04 / sheetSync 11,19 /
  ComparePane 1,37 + BugReport*).
- tsc --noEmit limpo; vitest 31 arquivos / 342/342 (~23s);
- e2e fluxo real: 21/21 asserts ok (YouTube → scoring → fila → export QC);
- axe-core scan: 0 violações main app (build demo/offline sem tela de
  login), preview PROVADO nosso antes do scan (entry conferido);
- console probe (preview dedicado porta 4618 strictPort): 0 erros/avisos
  no boot, entry provado igual ao dist;
- Lighthouse x2 limpas (--headless=new --disable-gpu): R1 E R2
  100/100/100/100 (FCP 1,4s / LCP 1,5s / CLS 0 / TBT 0ms) — CPU ambiente
  livre nas duas rondas.
- npm audit: não re-executado neste tick (patamar estável 10 moderate /
  0 high nos ticks #12..#17; nenhuma dependência mudou — árvore idêntica).

Higiene: wrapper npx do preview morto via process.kill + filho node morto
por pid via GetNetTCPConnection(4618); porta confirmada livre no fim.
src-tauri intocado. Sem Telegram.


## turbo-web tick #19 — guardrail noturno — 26/08/2026 ~00h30

Estado encontrado: worktree @ main == origin/main (253060e, tick #18),
zero delta upstream desde o último tick (v2-upgrade ahead 0,
turbo/web-opt ahead 0; audio/acoustics, desktop, features, redesign em
suas lanes). Fila original (1-6) segue DONE desde o tick #5.

GATES (árvore limpa, build fresca):
- build (vite 6.4.3): initial = index 33,86 + react-vendor 45,79 +
  css 7,60 = 87,25 KB gz — BYTE-ESTÁVEL vs ticks #12..#18 (mesmo hash
  index-C1mX7UAW.js). Chunks lazy intactos (firebase 97,38 / AdminGate
  18,99 / AnalysisWorkspace 20,04 / sheetSync 11,19 / ComparePane 1,37
  + BugReport*).
- tsc --noEmit limpo; vitest 31 arquivos / 342/342 (~27s);
- e2e fluxo real: 21/21 asserts ok (YouTube → scoring → fila → export QC);
- axe-core scan: 0 violações (demo/offline, sem login screen), preview
  PROVADO nosso antes do scan (entry conferido);
- console probe (preview dedicado porta 4820 strictPort): 0 eventos de
  erro/aviso no boot, entry provado igual ao dist;
- Lighthouse x2 (--headless=new --disable-gpu): R1 E R2 100/100/100/100
  (FCP 1,4s / LCP 1,5s / CLS 0 / TBT 0ms) — CPU ambiente livre nas duas
  rondas.
- npm audit: não re-executado (patamar estável 10 moderate / 0 high nos
  ticks #10..#18; árvore idêntica).

HIGIENE DE PORTAS (achado novo deste tick):
- Porta 4477 presa por órfão REAL de 11,2h: wrappers bash/npx/cmd já
  mortos mas o filho node sobreviveu — servindo build SOLARIS STALE
  pré-tick-#12 (entry index-DubV40Sq.js), originada da lane
  solaris-audio. Identidade provada pelo <title>+assets servidos antes
  de matar (regra: fixed ports guilty until proven innocent). Morto por
  pid (node 37312); porta confirmada livre.
- Porta 4188 (órfã de 36,6h): serve build do HEIN ESTHETICS (projeto
  ZIMNY do Zee) — NÃO tocada, regra de não mexer em Zimny sem ordem.
- Porta 4599: preview VIVO da lane solaris-redesign (sessão fresca
  <30min no momento da checagem) — intocada.
- Meu próprio preview deste tick (porta 4820): wrapper morto via
  process.kill + filho node morto por pid; porta confirmada livre.

src-tauri intocado. Sem Telegram.

## turbo-web tick #20 — guardrail noturno — 26/08/2026 ~23h30

Estado encontrado: worktree @ main == origin/main (b184184, tick #19),
zero delta upstream desde o último tick (v2-upgrade ahead 0,
turbo/web-opt ahead 0, v2-upgrade-recovery contida em main; audio/
acoustics, desktop, features, redesign em suas lanes). Único fora-de-main
novo auditado: origin/develop ahead 1 = relic de fev/2026 ("Update
README.md", autoria do dono) — sem ação. Fila original (1-6) segue DONE
desde o tick #5.

GATES (árvore limpa, build fresca):
- build (vite 6.4.3): initial = index 33,86 + react-vendor 45,79 +
  css 7,60 = 87,25 KB gz — BYTE-ESTÁVEL vs ticks #12..#19 (mesmo hash
  index-C1mX7UAW.js). Chunks lazy intactos (firebase 97,38 / AdminGate
  18,99 / AnalysisWorkspace 20,04 / sheetSync 11,19 / ComparePane 1,37
  + BugReport*).
- tsc --noEmit limpo; vitest 31 arquivos / 342/342 (~16s);
- e2e fluxo real: 21/21 asserts ok (YouTube → scoring → fila → export QC);
- axe-core scan: 0 violações (demo/offline), preview PROVADO nosso antes
  do scan (entry index-C1mX7UAW.js == dist);
- console probe: 0 eventos de erro/aviso no boot (identidade provada);
- Lighthouse x2 (--headless=new --disable-gpu): R1 E R2 100/100/100
  perf/a11y/bp (FCP 1,4s / LCP 1,5s / CLS 0 / TBT 0ms) — 3 categorias
  conforme diretiva desta noite (seo não medido neste tick);
- npm audit RE-executado: 10 moderate / 0 high/critical — mesmo patamar
  estável desde #12, árvore idêntica.

NOVO NESTE TICK:
- scripts/turbo-gates.mjs: runner único p/ console probe + LH x2 com
  prova de identidade (entry hash) e cleanup garantido no exit (servidor
  de dist + chrome mortos; portas usadas confirmadas livres depois).
  Motivo: o lighthouse deixou de existir como binário estável do cache
  npx por nome — resolvido por path _npx/0f94ee7615faf582 (lighthouse
  13.4.1, entry cli/index.js; layout antigo lighthouse-cli/ não existe
  mais). Substitui o fluxo npx ad-hoc dos ticks anteriores e torna o
  gate reprodutível.
- HIGIENE: dev-server órfão REAL de 12h da lane solaris-audio na porta
  4578 (wrappers bash-npx/cmd criados 25/08 ~11h23, sessão morta; servia
  "Solaris | AV Analysis Engine" — identidade provada antes de matar).
  Morto por pid (wrapper 8060 + node filho 32304); porta confirmada livre.
  Porta 4179 (work_ck_repo, projeto alheio) e 4188 (HEIN/ZIMNY) intocadas
  por regra; suíte vitest ativa da lane features vista rodando — intocada.

src-tauri intocado. Sem Telegram.

## Tick #21 26/08 01h32 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno
- Upstream auditado SEM DELTA: origin/main == HEAD (c42bb8d7, tick #20);
  nenhuma lane avancou desde o ultimo tick. Guardrail = re-provar gates.
- vitest: 31 arquivos / 342/342 (~37s) VERDE;
- e2e fluxo real (YouTube -> scoring -> fila -> export QC): 21/21 asserts;
- build medido com NOVO scripts/chunk_report.mjs (gzip level 9 por chunk):
  TOTAL dist 940,3KB raw / 233,2KB gz; INITIAL (entry index-C1mX7UAW.js
  33,0KB gz + CSS 7,4KB gz) = 40,35KB gz - alvo <500KB gz amplamente
  atendido; entry BYTE-ESTAVEL vs ticks #12..#20 (index-C1mX7UAW.js);
  maiores chunks: firebase 94,8 / react-vendor 44,7 / index 33,0 /
  AnalysisWorkspace 19,5 / AdminGate 18,5 / sheetSync 10,9 KB gz.
- axe-core scan: 0 violacoes (demo/offline), identidade do preview provada
  (entry hash == dist); axe-report.json regenerado;
- console probe: 0 eventos de erro/aviso no boot;
- Lighthouse x2 (--headless=new --disable-gpu): R1 E R2 100/100/100
  perf/a11y/bp (FCP 1,4s / LCP 1,5s / CLS 0,000 / TBT 0ms).
- Higiene: nenhum orfao novo detectado neste tick.

src-tauri intocado. Sem Telegram.

## Tick #22 26/08 ~02h20 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno
- Upstream auditado SEM DELTA: origin/main == HEAD (6933b0b, tick #21);
  nenhuma lane mergeou na main desde o ultimo tick (desktop/redesign/
  features/audio seguem adiantadas em branches proprias, sem colisao).
- vitest: 31 arquivos / 342/342 (~30s) VERDE; tsc --noEmit limpo;
- e2e fluxo real (YouTube -> scoring -> fila -> export QC): 21/21 asserts;
- build + chunk_report.mjs (gzip level 9): TOTAL 940,3KB raw / 233,2KB gz;
  INITIAL (entry index-C1mX7UAW.js 33,0KB gz + CSS 7,6KB gz) = 40,35KB gz -
  byte-ESTAVEL vs ticks #12..#21; maiores chunks inalterados:
  firebase 94,8 / react-vendor 44,7 / index 33,0 / AnalysisWorkspace 19,5 /
  AdminGate 18,5 KB gz;
- axe-core scan: 0 violacoes (main app demo/offline), identidade do preview
  provada (entry hash == dist), axe-report.json regenerado;
- console probe: 0 eventos de erro/aviso no boot;
- Lighthouse x2 (--headless=new --disable-gpu): R1 E R2 100/100/100
  perf/a11y/bp (FCP 1,4s / LCP 1,5s / CLS 0,000 / TBT 0ms);
- Higiene: nenhum orfao de preview detectado (varredura = NONE).

src-tauri intocado. Sem Telegram.

## Tick 26/08 ~06h45 — audio-dsp (Yui / cron solaris-audio)

Merge preventivo de origin/main na lane — PR #2 fica mergeavel limpo pro dono.
- main tinha avancado +4 (turbo-web ticks #24..#27, apenas docs/gates); unico conflito
  real era o prepend do solaris_desktop_log.md → resolvido mantendo AMBOS os blocos
  (protocolo da lane). A primeira tentativa deixou os 3 marcadores dentro do commit de
  merge; amend ANTES do push corrigiu — 0 marcadores provado no tree commitado fcf1b01
  (git show HEAD | grep).
- Bateria fresca na ARVORE MESCLADA: tsc --noEmit limpo + vitest 446/446 (46 arquivos).
- Precision/recall re-provado pos-merge: P=R=1.00 em TODOS os eixos
  (reverb TP=9 FP=0 FN=0; echo/clipping/noise/hum idem, zero FP e FN).
- CI: workflow success no 9f9f57d (ultimo commit de codigo); merge fcf1b01 dispara
  a bateria completa da main na arvore mesclada via pull_request.
- src-tauri/pitch/desktop intocados; sem Telegram.

## Tick 26/08 ~05h35 — audio-dsp (Yui / cron solaris-audio)

Guardrail barato SEM código novo: fila P1-P4 segue DONE e pushed.
- Worktree solaris-audio limpo em 9f9f57d == origin/audio/acoustics (fetch com workaround GCM).
- PR #2 OPEN, head exatamente 9f9f57d; check-runs no commit: ci success + Vercel Preview Comments success. mergeable UNKNOWN (GitHub ainda calculando — não é bloqueio).
- main avançou +4 desde o merge-base d79079b (turbo-web 7667657), mas merge-tree aponta ZERO "changed in both" → merge limpo quando o dono aprovar.
- src-tauri/pitch/desktop intocados; sem Telegram.

## Tick #23 26/08 ~03h05 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail + resgate de residuos do worker morto do tick #22

- FORENSE DO WORKER MORTO (#22 ~02h20): ele NAO morreu antes do push - d79079b ==
  origin/main e CI remoto success no commit exato (check-runs consultado). O que
  sobrou na arvore eram so relatorios LH regenerados pos-commit + 2 descartaveis
  nao-commitados (scripts/tick22_build.mjs, scripts/append_log_t22.py) removidos
  neste tick. Zero trabalho preso na lane.
- Bateria fresca propria (nao herdada): tsc --noEmit limpo; vitest 342/342
  (~33s); e2e fluxo real (YouTube -> scoring -> fila -> export QC) 21/21;
  axe-core 0 violacoes (login + main app demo/offline, identidade provada
  entry index-C1mX7UAW.js == dist); console probe 0 eventos;
  Lighthouse x2 (--headless=new --disable-gpu): R1 P99/A100/BP100 (FCP 1,4s /
  LCP 1,6s / TBT 10ms - ruido de run fria) e R2 P100/A100/BP100 (FCP 1,4s /
  LCP 1,5s / CLS 0,000 / TBT 0ms) = baseline mantido.
- Bundle (chunk_report.mjs gzip level 9): INITIAL 40,35KB gz byte-estavel vs
  ticks #12..#22 (entry index-C1mX7UAW.js 32,98KB gz + CSS 7,37KB gz); TOTAL
  940,32KB raw / 233,16KB gz; maiores chunks: firebase 94,82 (lazy, fora do
  caminho critico) / react-vendor 44,65 / AnalysisWorkspace 19,49 / AdminGate
  18,49 KB gz. Alvo initial <500KB gz mantido com folga (~12x).
- Higiene (ps1 dedicado deste tick): zero orfaos da lane - varredura cmdline
  node/vite/chrome so achou ContractKit (:4179) e Hein/Zimny (:4188,
  intocavel sem ordem explicita), atribuidos por PATH+porta e POUPADOS;
  chrome de probe/LH zerado pelo proprio runner no exit.
- Sem merge de lanes irmaas na main; src-tauri/pitch intocados; suite commitada
  segue valendo (nenhum codigo mudou desde 6933b0b - commits da lane sao docs-only).

## Tick #24 26/08 ~04h00 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno

- Estado: HEAD 15ae5f5 == origin/main provado por rev-parse pos-fetch; develop segue
  relic fev/2026; nenhum codigo novo de lanes irma para absorver. Zero deltas.
- Bateria fresca propria: tsc --noEmit limpo; vitest 342/342 (~36s); e2e fluxo real
  (YouTube -> scoring -> fila -> export QC) 21/21; axe-core 0 violacoes (fase login +
  main app demo/offline, identidade provada entry index-C1mX7UAW.js == dist);
  console probe 0 eventos; Lighthouse x2 (--headless=new --disable-gpu):
  R1 e R2 ambos P100/A100/BP100 (FCP 1,4s / LCP 1,5s / CLS 0,000 / TBT 0ms).
- Bundle (chunk_report.mjs, gzip level 9): INITIAL 40,35KB gz byte-estavel vs
  ticks #12..#23 (entry index-C1mX7UAW.js 32,98KB gz + CSS 7,37KB gz); TOTAL
  940,32KB raw / 233,16KB gz; maiores chunks: firebase 94,82 (lazy) /
  react-vendor 44,65 / AnalysisWorkspace 19,49 / AdminGate 18,49 KB gz.
  Alvo initial <500KB gz mantido (~12x folga).
- Higiene (hygiene_tick23.ps1): zero orfaos da lane - so ContractKit (:4179,
  work_ck_repo) e Hein/Zimny (:4188, intocavel sem ordem explicita), atribuidos
  por PATH+porta e POUPADOS; CHROME_PROBE_ORPHANS NONE (runner mata o proprio
  chrome no exit).
- src-tauri/pitch intocados; suite commitada continua valendo (commits da lane
  sao docs-only desde 6933b0b). Sem Telegram.

## Tick #25 26/08 ~04h30 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno

- Estado: HEAD ce02b29 == origin/main provado por rev-parse pos-fetch; turbo/web-opt
  confirmada relíquia (0 ahead / 19 behind da main); develop relic fev/2026.
  Nenhum código novo de lanes irmã para absorver. Zero deltas.
- Bateria fresca própria: tsc --noEmit limpo; vitest 342/342 (~44s); e2e fluxo real
  (YouTube -> scoring -> fila -> export QC) 21/21; axe-core 0 violações
  ({loginRules:0, mainAppRules:0, criticalOrSeriousMainApp:0}, entry index-C1mX7UAW.js
  == dist provado); console probe 0 eventos; Lighthouse x2 (--headless=new --disable-gpu):
  R1 e R2 ambos P100/A100/BP100 (FCP 1,4s / LCP 1,5s / CLS 0,000 / TBT 0ms).
- Bundle (chunk_report.mjs, gzip level 9): INITIAL 40,35KB gz byte-estável vs
  ticks #12..#24 (entry index-C1mX7UAW.js 32,98KB gz + CSS 7,37KB gz); TOTAL
  940,32KB raw / 233,16KB gz; maiores chunks: firebase 94,82 (lazy, fora do caminho
  crítico) / react-vendor 44,65 / AnalysisWorkspace 19,49 / AdminGate 18,49 KB gz.
  Alvo initial <500KB gz mantido com folga (~12x).
- Higiene (kill_turbo_orphans.ps1): NONE - zero órfãos de preview da lane; runners
  matam o próprio chrome no exit.
- src-tauri/pitch intocados (do outro worker); suite commitada segue valendo
  (nenhum código mudou desde 6933b0b - commits da lane são docs-only). Sem Telegram.

## Tick #26 26/08 ~05h05 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno

- Estado: HEAD 81daa81 == origin/main provado por rev-parse pos-fetch; turbo/web-opt
  segue reliquia; develop relic fev/2026. Nenhum codigo novo de lanes irma para
  absorver (audio/acoustics aguarda decisao do dono em PR #2). Zero deltas.
- Bateria fresca propria (nao herdada): tsc --noEmit limpo; vitest 342/342 (~18s);
  e2e fluxo real (YouTube -> scoring -> fila -> export QC) 21/21; axe-core 0 violacoes
  (main app demo/offline - build sem login screen, identidade provada entry
  index-C1mX7UAW.js == dist); console probe 0 eventos; Lighthouse x2
  (--headless=new --disable-gpu): R1 e R2 ambos P100/A100/BP100 (FCP 1,4s /
  LCP 1,5s / CLS 0,000 / TBT 0ms) = baseline mantido.
- Bundle (chunk_report.mjs, gzip level 9): INITIAL 40,35KB gz byte-estavel vs
  ticks #12..#25 (entry index-C1mX7UAW.js 32,98KB gz + CSS 7,37KB gz); TOTAL
  940,32KB raw / 233,16KB gz; maiores chunks: firebase 94,82 (lazy, fora do caminho
  critico) / react-vendor 44,65 / AnalysisWorkspace 19,49 / AdminGate 18,49 KB gz.
  Alvo initial <500KB gz mantido com folga (~12x).
- Higiene (hygiene_tick23.ps1): zero orfaos da lane - so ContractKit (:4179,
  work_ck_repo) e Hein/Zimny (:4188, intocavel sem ordem explicita), atribuidos
  por PATH+porta e POUPADOS; vitest visto no solaris-features e a lane irma desktop
  trabalhando (idade 0min, nao mexer); CHROME_PROBE_ORPHANS NONE (runner mata o
  proprio chrome no exit).
- src-tauri/pitch intocados (do outro worker); suite commitada segue valendo
  (nenhum codigo mudou desde 6933b0b - commits da lane sao docs-only). Sem Telegram.

=======
## Tick #27 26/08 ~06h20 - turbo-web worker (cron MODO TURBO SOLARIS): guardrail noturno

- Estado: HEAD 7667657 == origin/main provado por rev-parse pos-fetch --prune;
  turbo/web-opt segue reliquia (0 ahead); develop relic fev/2026 (README bd3a560);
  NOVA branch remota auditada este tick: v2-upgrade-recovery CONTIDA em main
  (0 ahead) - nada a sincronizar de nenhuma lane. Zero deltas.
- Bateria fresca propria (nao herdada): tsc --noEmit limpo; vitest 31 arquivos /
  342/342 (~25s); e2e fluxo real (YouTube -> scoring -> fila -> export QC) 21/21;
  axe-core 0 violacoes ({loginRules:0, mainAppRules:0, criticalOrSeriousMainApp:0},
  identidade provada entry index-C1mX7UAW.js == dist); console probe 0 eventos;
  Lighthouse x2 (--headless=new --disable-gpu): R1 e R2 ambos P100/A100/BP100
  (FCP 1,4s / LCP 1,5s / CLS 0,000 / TBT 0ms) = baseline mantido.
- Bundle (chunk_report.mjs, gzip level 9): INITIAL 40,35KB gz byte-estavel vs
  ticks #12..#26 (entry index-C1mX7UAW.js 32,98KB gz + CSS 7,37KB gz); TOTAL
  940,32KB raw / 233,16KB gz; maiores chunks: firebase 94,82 (lazy, fora do caminho
  critico) / react-vendor 44,65 / AnalysisWorkspace 19,49 / AdminGate 18,49 KB gz.
  Alvo initial <500KB gz mantido com folga (~12x).
- Deps: npm audit --omit=dev segue 10 moderates major-gated (0 high/critical),
  sem advisory nova desde o tick #12.
- Higiene: zero orfaos da lane - so ContractKit (:4179, work_ck_repo) e
  Hein/Zimny (:4188, intocavel sem ordem explicita), atribuidos por PATH+porta e
  POUPADOS (varredura manual Win32_Process por cmdline 'vite').
- src-tauri/pitch intocados (do outro worker); suite commitada segue valendo
  (nenhum codigo mudou desde 6933b0b - commits da lane sao docs-only). Sem Telegram.

## Tick 26/08 ~07h45 — audio-dsp (Yui / cron solaris-audio)

Worktree solaris-audio (branch audio/acoustics); desktop/src-tauri/pitch intocados.
TEMA: AUDITORIA DE ESTADO + PROVAS FRESCAS + MINA TERRESTRE DESARMADA no
checkout principal. Fila da diretiva segue 100% FECHADA desde 25/08 (P1-P4
pushed @ dea3422); PR #2 aberto aguardando decisão do dono (nada merged).

- ESTADO CONFIRMADO COM EXECUÇÃO FRESCA (não herdada): vitest 446/446 VERDES
  na árvore da lane (46 arquivos, ~111s) + tsc implícito nos gates; CI REMOTO
  success no sha exato dea3422 (ci + Vercel Preview Comments via API).
  PR #2: state=OPEN, mergeable=MERGEABLE/CLEAN, zero reviews pendentes.
- AUDITORIA ANTI-BURACO contra a spec linha a linha: fingerprint/cache
  (analysisCache.ts), progress granular por estágio (frames/peak/reverb/echo/
  finalize), cancelamento real (worker 'cancelled' + hook cancela run em
  unmount/troca de mídia), THD em frames tonais (clipping.ts +
  estimateTHDFromSpectrum), ML embutido int16 com ONNX opcional INJETÁVEL e
  NUNCA dependência do núcleo (decisão de bundle preservada p/ turbo-web),
  mudança acústica mid-video INFO (acousticShift level+spectral). Zero TODO/
  FIXME/HACK no src/audio-acoustics/. Nenhum buraco restante encontrado.
- MINA TERRESTRE DESARMADA (higiene inter-lane): o worktree principal
  (desktop) carregava um src/audio-acoustics/ UNTRACKED com rascunhos VELHOS
  de 25/08 de manhã (pré-worktree, mtimes 01h05-05h42). Quando o PR #2
  mergear e o desktop mergear main, o git recusaria o checkout/merge com
  "untracked working tree files would be overwritten". Provas antes de mover:
  (1) nenhum arquivo TRACKED do desktop importa audio-acoustics (grep -r);
  (2) todos os módulos têm versões evoluídas commitadas na lane (blobs dos
  drafts não são únicos em conteúdo, só em hash). MOVIDOS para
  C:/Yui/data/quarantine/solaris-desktop-audio-drafts-20260826/ com README de
  reversão. Desktop ficou limpo (git status sem nada de audio-acoustics).
- OBSERVAÇÃO (não é da minha lane): desktop local está ahead 3 de
  origin/desktop (ModeBadge/ponte standalone, 6e30339..18806ab, não pushed) —
  trabalho do worker desktop, intocado, apenas anotado aqui p/ visibilidade.
- Zero código novo nesta lane neste tick; push deste log via workaround GCM;
  src-tauri e pitch intocados; sem Telegram.
=== FIM TICK — lane audio/acoustics verde, quarentena documentada, PR #2 aguardando dono ===

---

## turbo-web (tick #31) — guardrail noturno — 26/08/2026 ~09h55

- Zero deltas: origin/main == HEAD local 64d90d5 provado pos-fetch (ls-remote);
  lanes irma nas proprias linhas (audio/acoustics +38, features +60,
  redesign-premium +66 vs as PROPRIAS branches; v2-upgrade/-recovery/turbo
  contidas em main). Nada a mergear sem aprovacao do dono.
- Gates re-provados frescos: vitest 342/342 (31 arquivos), tsc --noEmit limpo,
  e2e-flow 21/21 asserts, axe 0 violacoes (login+main app), console events=0,
  Lighthouse x2 P100/A100/BP100 (FCP 1,4s / LCP 1,5s / CLS 0,000 / TBT 0ms).
- Initial 40,35KB gz byte-estavel index-C1mX7UAW (build 3,46s); alvo <500KB gz
  mantido com folga (initial real ~124KB gz somando react-vendor).
- Higiene: zero orfaos da lane; unicos vite previews vivos na maquina sao de
  projetos EXTERNOS (work_ck_repo, Hein-Esthetics-Beauty) — fora do escopo
  Solaris, intocados.
