# Solaris — Log de Trabalho

## features

### 2026-08-24 23:22 — tick features-worker: F3 Gamificação Engine (núcleos puros)
- Branch `features/analista-feliz`. Novos módulos em `src/features/gamification/`:
  - `periods.ts`: chaves semana/mês/ano fuso-fixas America/São_Paulo (offset -180min, não depende do relógio do host); reset da semana na segunda 00h local; intervalos meio-abertos p/ agregação.
  - `xp.ts`: eventos de XP da spec B — base 100, +10/inconformidade válida (cap 100), streak diário +25, qualidade +150, estornos negativos (`rework_penalty`/`adjustment`); saldo = soma event-sourced; NUNCA velocidade pura.
  - `levels.ts`: escada Trainee→Assistente→Analista→Editor Sênior→Diretor de QC→Lenda do Estúdio (0/500/2k/6k/15k/40k XP) + fração p/ barra animada.
  - `achievements.ts`: catálogo C3 completo (9 conquistas) com predicados puros e diff de chaves novas p/ toast.
  - `podium.ts`: ranking semana/mês/ano; empate em XP desempata por MENOR retrabalho, depois alfabético (determinístico); rank denso com marcação de empate (1,1,3); separação por senioridade (C4); `frozenPodiumRows` gera linhas prontas pra `podium_history`.
- Testes: `src/__tests__/gamification.test.ts`, 34 asserts cobrindo bordas (reset dom 23:59:59 vs seg 00:00:00 no fuso SP, streak quebrado, caps, limiares exatos de nível, empates, janelas meio-abertas). Suíte completa 423/423 verde; tsc limpo; eslint limpo.
- WIP pré-existente no worktree (App/AnalysisWorkspace/translations — integração de UI do QoL) ficou INTACTO, fora deste commit.
