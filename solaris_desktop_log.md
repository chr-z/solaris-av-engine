# Solaris — Log de Trabalho

## features

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
