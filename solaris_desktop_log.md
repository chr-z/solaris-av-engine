# Solaris — Log de Trabalho

## features

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
