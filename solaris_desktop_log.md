## redesign (tick 10) — R2 remanescente: checklist de inconformidades com kit animado — 25/08/2026 ~10h20

- Auditoria anti-false-done da spec INTEIRA (R1-R4 + momentos wow) antes de
  qualquer commit: tokens/CSS 9.92KB gz, timeline com pins empilháveis,
  ScoreRing SVG, sparkline da tendência, contagem animada, print v3 do relatório,
  favicon kit, empty states ilustrados, erros humanos — tudo DONE nos ticks 1-9.
  Suíte 385/385 verde na base.
- **Gap real achado**: os checkboxes do CHECKLIST de inconformidades
  (AnalysisForm — onde o analista marca, coração do fluxo) ainda usavam o
  estilo cru do MVP (h-4 w-4 border-gray-500 text-solar-accent focus:ring);
  o kit .checkbox-custom animado do R2 só tinha sido aplicado no FilterControls.
- Fix mínimo (1 linha): className -> checkbox-custom. Anatomia, vocabulário e
  comportamento intactos (mesmo input, mesmo onChange, YES/NO e TRUE/FALSE).
- Decisão documentada: migração p/ lucide-react fica FORA — dependência nova
  contra a restrição "zero dependência pesada nova" da spec; kit SVG inline
  atual já é consistente (stroke-2/currentColor/aria-hidden).
- Prova no browser real (scripts/verify_t10_checkbox.cjs, protocolo anti-stale:
  hash do entry servido conferida contra dist local): appearance:none, 16x16px,
  borda hairline rgba(255,255,255,.12), classe antiga ausente, clique dispara
  onChange e gradiente accent 135deg #8F6FF7->#F09A52 computado ao marcar.
  7/7 checks = VERIFY_T10_OK. Screenshots t10_checklist{,_marcado}.png.
- Validação: tsc limpo; vitest 385/385; build verde; CSS gz 9.92KB inalterado.

---

## redesign (tick 6) — R4 polimento final — 25/08/2026 ~06h
- Commits fac4ec3 + 6f1edc3 + 59c30eb + ac7dac8 @ redesign-premium, pushados
  (ls-remote ok, 880f4a0..ac7dac8). Fila R1-R4 da spec agora 100% executada.
- **R4a print**: relatório QC exportado era fragmento HTML cru sem estilo —
  virou documento completo com identidade v3 (gradiente accent no header,
  stats em grid tabular, JetBrains Mono nos dados) + @media print/@page A4
  próprio; escape XSS no título/headers interpolados. CSS morto qc-print.css
  removido (mirava .qc-report-card que não existe na v3). +2 testes (365/365).
- **R4b motion**: duration-300/200 -> 150ms (7+1 ocorrências; VuMeter mantém
  75ms por ser VU meter em tempo real). Reduced-motion global já existente
  provado no CSS built.
- **R4c ícones**: kit v3 completo 16/32/192/512/maskable gerado por
  scripts/gen_icons_v3.py (gradiente 135deg #8F6FF7->#F09A52 espelhando o
  SolarisLogo; antes era laranja #f97316 pré-redesign); favicon svg+png no
  index.html, theme-color/manifest -> #0B0E14, SW cache bump v3-r4.
- **R4d axe/AA**: axe-core scan real (npm i --no-save, sem tocar no manifest
  compartilhado) nas 4 telas via scripts/verify_r4.cjs (protocolo anti-órfão:
  preview próprio + hash do build conferida + interceptação do blob do relatório).
  Antes: 31 violações blocking (color-contrast serious x30, label critical x1).
  Depois: ZERO critical/serious (sobram só moderates 'region'/'heading-order').
- **Achado estrutural** (causa dos docks claros): Tailwind 3 NÃO gera variante
  alpha sobre cor var() hex — dark:bg-solar-dark-content/80 não saía no build
  e o fundo aplicado era o light (#fffc). Fix: tokens ganham gêmeos _rgb +
  <alpha-value> no config; Dock/VuMeter -> bg-surface/90 + hairline.
  Armadilha registrada p/ próximos workers: /NN sobre token hex silencia.
- Varredura AA complementar: gray-500 -> text-ink-secondary (~15 arquivos),
  CTAs accent+branco -> kit btn-primary/text-bg (tinta escura sobre gradiente),
  linha selecionada da fila com texto ink sobre tinta accent, slider de volume
  com aria-label i18n ('workspace.volume' EN/PT).
- Contraste matemático dos pares novos: pior caso AA normal 4.70 (accent-from
  sobre raised); botão primário 5.32-8.69; tema claro também passa.
- Validação: tsc limpo; vitest 365/365; build verde; CSS gz 9.85KB (meta <30KB);
  screenshots redesign_shots/r4_{login,fila,analysis,qc_dialog,qc_report}.png
  + r4_axe_summary.json (números do scan) + r4_qc_report.html (documento real).

---

## redesign (tick 7) — aceite visual MVP vs v3 + consolidacao anti-false-done — 25/08/2026 ~07h

- Fila R1-R4 permanece DONE (ticks 1-6); este tick fechou o unico item que
  faltava na spec (SOLARIS_REDESIGN.md, secao Aceite visual): composites
  side-by-side MVP vs v3 das 4 telas para o dono aprovar.
- Baselines MVP capturados do build REAL da main: worktree de prova
  (%TEMP%/probe-solaris-mvp @ origin/main 5353d1d) + .env.local copiado do
  checkout de redesign — a main exige VITE_FIREBASE_* no build; sem elas o
  boot morre em FIREBASE FATAL ERROR antes do React montar (diagnosticado
  via CDP console). Nenhuma mudanca de codigo na main.
- Protocolo anti-orfa respeitado: porta alta aleatoria por run, localhost
  (nao 127.0.0.1), screenshot so apos conferir hash do entry servido contra
  o dist local (index-D15riw2h.js), chrome headless --disable-gpu, profile
  descartavel, servidores estaticos proprios fechados no finally. Conteudo
  das telas provado por texto (visao auxiliar indisponivel nesta sessao):
  guest login -> fila demo WO-2024-001..115 -> workspace "Demo Video Mode"
  + RGB Parade/Waveform/Spectrogram/VU + Analysis Sheet -> dialogo QC aberto.
- Artefatos para aprovacao do dono em redesign_shots/: aceite_1_login_,
  aceite_2_fila_, aceite_3_analise_ e aceite_4_relatorio_mvp_vs_v3.png
  (3220x880, MVP a esquerda / v3 a direita, moldura accent na v3). Diferenca
  real entre paineis provada por estatistica de pixels (ex.: relatorio =
  documento branco do print stylesheet apenas no lado v3).
- Scripts versionados: scripts/mvp_shot_acceptance.cjs (captura MVP) +
  scripts/compose_aceite.py (composite PIL rotulado).
- Consolidacao anti-false-done @ HEAD 6cc12a5 (= origin/redesign-premium):
  tsc limpo; vitest 365/365 (33 arquivos); npm run build verde (initial gz
  index 36.41KB + react-vendor 45.44KB; AnalysisWorkspace 22.83KB lazy;
  firebase 97.24KB lazy). src-tauri/audio-acoustics/pitch intocados.
- Residuais axe moderate documentados no tick 6 (region x3 no login,
  heading-order x1 no dialogo QC); zero critical/serious.

## redesign (tick 8) — momento wow #2: contagem dos achados animada — 25/08/2026 ~08h

- Fila R1-R4 estava DONE (ticks 1-7); auditoria fina da spec achou UM residual:
  wow #2 ("ao concluir análise: contagem dos achados anima de 0 até o total")
  não existia — grep por useCountUp/countUp vazio. Os outros 3 momentos wow já
  viviam no código (logo animado LoginScreen:30, ScoreRing workspace:982,
  empty states fila r3).
- Implementação (padrão do repo: matemática pura em utils/, hook fino):
  - src/utils/countUp.ts — easeOutCubic + countFrame com snap EXATO no destino
    (último frame == texto estático antigo), guards p/ duração<=0 e destino
    não finito;
  - src/hooks/useCountUp.ts — rAF + prefers-reduced-motion (estado direto,
    sem frames);
  - QCExportButton: AnimatedStat no diálogo de confirmação — rows/avg/errors
    sobem de 0 ao total (900ms ease-out). Texto final byte-idêntico ao anterior.
- Testes: src/__tests__/countUp.test.ts 10 novos (clamp, snap exato, interpolação
  from!=0, guards NaN/Infinity, elapsed negativo). Suite: 365 -> 375/375 verde.
  tsc --noEmit limpo. npm run build verde: CSS 9.92KB gz (<30KB spec), initial
  index 36.41 -> 36.77KB gz (+0.36KB), chunks lazy intocados.
- Prova em browser real (scripts/redesign_shot_t8_countup.cjs, protocolo anti-
  órfão: preview próprio porta alta + hash servido==dist + profile descartável +
  chrome headless --disable-gpu):
  - headless NOVO reporta prefers-reduced-motion:reduce por padrão — app
    respeitou e foi direto ao estado final (comportamento correto provado);
  - com Emulation.setEmulatedMedia(no-preference): burst sampling 100ms pegou a
    contagem viva "2 rows -> 3 rows -> 4 rows -> 5 rows", terminando no formato
    estático exato. Shots: redesign_shots/t8_qc_final.png (+r3b_* revalidados:
    fila, empty state, diálogo QC, erro humano login — build pós-tick-8).
- src-tauri/audio-acoustics/pitch intocados (só worktree redesign-premium).

## redesign (tick 9) — micro-sparkline da tendência + housekeeping — 25/08/2026 ~09h

- Housekeeping: o registro do tick 8 tinha ficado SEM COMMIT (código pushed
  em b80c422, log não) — resgatado no commit 56b50d6 antes de qualquer coisa.
- Auditoria fina da spec pós-tick-8 achou UM residual real: "Badges de score:
  pill com número tabular + micro-sparkline da tendência" não existia (grep
  spark vazio). Decisão de leitura da spec: NÃO há série temporal de análises
  anteriores no domínio (e inventá-la seria mudança funcional — proibido). A
  "tendência" implementada é o PERFIL das notas por categoria do ScoringEngine
  (fração nota/máximo das 5 categorias, normalizada pois os máximos diferem
  1.27..0.70): dado real já computado a cada marcação, zero funcionalidade nova.
- Implementação (padrões da casa):
  - src/utils/scoreSpark.ts — categoryFractions + sparkPoints puros
    (guards NaN/max<=0, clamp 0..1, pad vertical, ponto único centralizado);
  - src/components/Core/ScoreSpark.tsx — svg decorativo aria-hidden,
    polyline com gradiente accent dos tokens (--color-accent-from→to),
    ponto final marca a categoria mais fraca;
  - AnalysisWorkspace: memo categoryBreakdownForSpark (recalculateScoresWithEngine)
    + spark ao lado do ScoreRing, tooltip rico com nota/máximo por categoria
    (IDs do seed JÁ são o vocabulário MVP: ENQUADRAMENTO, ILUMINAÇÃO...);
  - i18n en/pt ('workspace.scoreSparkTitle').
- Testes: scoreSpark.test.ts 10 novos (frações seed reais, guards, clamp,
  pontos, dimensões inválidas). Suite 375 -> 385/385 verde. tsc limpo. Build:
  CSS 9.92KB gz estável (<30KB spec); index 36.83KB gz (+0.06); spark dentro
  do chunk lazy AnalysisWorkspace (23.43KB gz). Commit 107f6e3.
- Prova em browser real x2 (protocolo anti-órfão, preview própria porta alta +
  hash servido==dist, chrome headless --disable-gpu):
  - estado limpo: points "0,2 14,2 28,2 42,2 56,2", dot no topo, tooltip lista
    as 5 categorias 100% (1,27/1,27 ... 0,94/0,94);
  - marcando 'Uneven Lighting': ILUMINAÇÃO cai pra 0,77/0,87 -> y 2->3,61 na
    linha, dot migra pra categoria mais fraca, tooltip reflete na hora.
    Shots: redesign_shots/t9_workspace_spark.png + t9_workspace_spark_marked.png.
- axe-core 4.10.2 no workspace COM sparkline e regra marcada: ZERO violações
  (todas as impacts). Spark svg aria-hidden+focusable=false confirmado.
  Script: scripts/redesign_axe_t9.cjs (axe via init-script + Page.reload —
  evaluate gigante por WS provou-se frágil p/ 553KB).
- Armadilha registrada: o seletor "ul li > 0" como sinal de login é FRÁGIL —
  a fila demo pré-renderiza atrás do overlay de login. Sinal correto: botão
  guest SUMIR da tela. (Custo: ~6 iterações perdidas no axe script.)
- DECISÃO PENDENTE DO DONO (não implementado): spec pede "labels flutuantes"
  nos inputs; o app usa labels permanentes acima dos campos em TODO lugar.
  Flutuantes mudam a anatomia que o usuário do MVP conhece — mantive permanentes
  (filosofia inegociável > detalhe estético). Se o dono quiser, vira tick próprio
  com aceite visual.
- src-tauri/audio-acoustics/pitch intocados (worktree dedicado solaris-redesign).

## redesign (tick 12) — badges de score com tier semantico (R3 lista) — 25/08/2026
- Residual: spec pede "Badges de score: pill com número tabular + micro-sparkline da tendência"; o badge existia apenas no ScoreRing, nao na lista.
- Não invente a tendencia temporal (não existe série; mesma decisao do tick 9 — sparkline = perfil categoria do ScoringEngine). Aqui: o número vira pill colorido pelo tier (verde >=4 / amarelo >=3 / vermelho <3), mesmo vocabulário do MVP (verde=ok, amarelo=atencao, vermelho=inconformidade).
- Implementacao: scoreFormat.ts + scoreBandClass(); AnalysisSheet.tsx lista com .badge-pill.badge-score; CSS .badge-score (tamanho maior); zebra/hover na lista (even:bg-surface + hover:bg-surface/50). Zero mudanca funcional — mesmos dados do demo.
- Testes: scoreFormat 388/388 (+3 novos: tiers, vírgula decimal, garbage nao inventa cor). tsc 0. build verde. CSS 10.18KB gz (<30KB).
- Prova browser (verify_t12_badge.cjs, protocolo anti-órfão: preview próprio + hash servido==dist + chrome --disable-gpu + cleanup): badges 5/5, classe badge-ok, cor rgb(52,211,153), .tnum font-family mono + font-variant tabular-nums; workspace abre; ScoreRing prova tier ao vivo via stroke. Shots: redesign_shots/t12_fila_badges.png, t12_fila_badges_marked.png.
- Restriçoes respeitadas: mesma anatomia de tela (player+timeline+painel), mesmos nomes/atalhos, nenhum src-tauri/audio/pitch alterado. Labels flutuantes: mantidos permanentes (filosofia inegociavel > detalhe estético — pendência do dono registrada).
