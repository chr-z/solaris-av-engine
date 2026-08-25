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
