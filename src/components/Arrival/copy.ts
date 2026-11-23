/**
 * Tour copy — EN + PT-BR.
 *
 * The tour owns its own strings instead of the app dictionary: it is a
 * narrative, not UI chrome, and it is written for someone who has never
 * opened a broadcast monitor in their life. Locale still comes from the
 * shared i18n context, so switching language here switches the whole app.
 */

export type TourLocale = 'en' | 'pt';

export interface TourStep {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  facts: string[];
  /** Segment of the demo tape this chapter runs, in seconds. */
  seek: [number, number];
  /** Which monitor gets the focus (others dim). */
  focus: 'all' | 'luma' | 'color' | 'audio' | 'motion' | 'paper';
  /** Status flag burned over the picture. */
  flag?: string;
}

export interface TourCopy {
  skip: string;
  skipHint: string;
  next: string;
  back: string;
  replay: string;
  scrollHint: string;
  stepWord: string;
  tapeLabel: string;
  live: string;
  audioIdle: string;
  runTape: string;
  monitorLabels: {
    waveform: string;
    parade: string;
    vector: string;
    spectrum: string;
    level: string;
  };
  monitors: {
    waveformNote: string;
    paradeNote: string;
    vectorNote: string;
    spectrumNote: string;
  };
  keys: { scrub: string; mark: string; save: string };
  paper: {
    title: string;
    meta: string;
    rows: { tc: string; what: string; verdict: string }[];
    signed: string;
  };
  cta: {
    title: string;
    body: string;
    google: string;
    demo: string;
    note: string;
  };
  stats: { value: string; label: string }[];
  steps: TourStep[];
}

const en: TourCopy = {
  skip: 'Skip tour',
  skipHint: 'Go straight to sign in',
  next: 'Next',
  back: 'Back',
  replay: 'Replay tour',
  scrollHint: 'Scroll',
  stepWord: 'of',
  tapeLabel: 'TAPE 01 · 960×540 · 25p',
  live: 'RUN',
  audioIdle: 'audio idle — click to arm',
  runTape: 'Run the tape',
  monitorLabels: {
    waveform: 'Waveform · luma',
    parade: 'RGB parade',
    vector: 'Vectorscope',
    spectrum: 'Spectrogram',
    level: 'Level · dBFS',
  },
  monitors: {
    waveformNote: 'brightness of every pixel',
    paradeNote: 'R · G · B, one column each',
    vectorNote: 'hue and strength',
    spectrumNote: 'frequency over time',
  },
  keys: { scrub: 'scrub', mark: 'mark', save: 'save' },
  paper: {
    title: 'QC report · QCR-001',
    meta: 'Tape 01 · 00:00:40 · 25p · analyst C. Eliel',
    rows: [
      { tc: '00:00:16:12', what: 'Dead air, 2.4 s', verdict: 'FAIL' },
      { tc: '00:00:20:04', what: 'Black frame, 18 frames', verdict: 'FAIL' },
      { tc: '00:00:24:18', what: 'Audio clipping', verdict: 'FAIL' },
      { tc: '00:00:34:02', what: 'Hum at 60 Hz', verdict: 'WARN' },
    ],
    signed: 'Exported · prints to PDF',
  },
  cta: {
    title: 'That is the whole engine.',
    body: 'Sign in with Google to load a real file from your Drive, or walk through the app with a demo queue and no account at all.',
    google: 'Continue with Google',
    demo: 'Use the demo queue',
    note: 'No install. Nothing is uploaded to check a file — the analysis runs in your tab.',
  },
  stats: [
    { value: '5', label: 'monitors' },
    { value: '5', label: 'presets' },
    { value: '2', label: 'languages' },
    { value: '129', label: 'tests green' },
  ],
  steps: [
    {
      id: 'tape',
      eyebrow: '01 — The problem',
      title: 'A two-hour file is mostly fine. The damage sits in four places.',
      body:
        'Someone still has to watch all of it. Solaris reads the signal instead: every frame, every audio sample, then it hands back the seconds that need a person. Silence where there should be sound. Black where there should be picture. Audio pushed past the ceiling. A channel that dropped. You watch the ten seconds that matter.',
      facts: ['2 hours → 4 timestamps', 'No upload to check', 'Runs in a tab'],
      seek: [4, 10],
      focus: 'all',
      flag: 'SIGNAL',
    },
    {
      id: 'luma',
      eyebrow: '02 — Luma',
      title: 'The waveform is the brightness of every pixel, stacked into columns.',
      body:
        'The bottom of the grid is black and the top is white. Broadcast wants both ends kept inside the marked limits. A drop to the floor is a hole in the picture; a band riding too high is a face with no detail left. This tape goes quiet at 00:16 and fully black at 00:20, and you can see both coming.',
      facts: ['0 = black · 100 = white', 'Dead air at 00:16', 'Black frame at 00:20'],
      seek: [16, 20],
      focus: 'luma',
      flag: 'DEAD AIR',
    },
    {
      id: 'color',
      eyebrow: '03 — Chroma',
      title: 'Three columns for colour. One dial for what the colour does.',
      body:
        'Red, green and blue each get a column of their own. When blue rides higher than the other two, the whole frame turns cold. The round scope plots every pixel by hue and strength: skin should land near the line at eleven o’clock, and a dot outside the circle is colour that no longer exists after encoding.',
      facts: ['Blue cast at 00:24', 'Skin line at 11 o’clock', 'Out of gamut'],
      seek: [24, 29],
      focus: 'color',
      flag: 'BLUE CAST',
    },
    {
      id: 'audio',
      eyebrow: '04 — Sound',
      title: 'Sound, drawn as time against frequency.',
      body:
        'A hum is a straight line at 60 hertz. Hiss is a grey wash along the top. Dead air is an empty column. Beside it the meter reads the loudest moment and the average, so you know whether the mix was already touching the ceiling before anyone opened the file.',
      facts: ['0–20 kHz', 'Hum at 60 Hz', 'Clipping at 00:24'],
      seek: [34, 40],
      focus: 'audio',
      flag: '60 Hz HUM',
    },
    {
      id: 'desk',
      eyebrow: '05 — The desk',
      title: 'Built for hands on the keyboard.',
      body:
        'J, K and L scrub like a deck. The arrow keys step one frame at a time. T drops a marker on the exact second you are looking at, and Ctrl+S saves the sheet. Presets rearrange the entire monitor wall for the content in front of you — clean, framing, levelling, ceiling.',
      facts: ['J K L — scrub', 'T — mark', 'Ctrl+S — save'],
      seek: [4, 10],
      focus: 'motion',
      flag: 'READY',
    },
    {
      id: 'paper',
      eyebrow: '06 — The output',
      title: 'Every mark becomes a report you can attach to the delivery.',
      body:
        'Timecode, what was wrong, how bad, who signed it. Export one self-contained page that opens in any browser and prints to PDF. It is the artefact a client asks for when they ask what, exactly, was checked.',
      facts: ['QC report · HTML', 'Prints to PDF', 'Signed by the analyst'],
      seek: [29, 34],
      focus: 'paper',
      flag: 'QCR-001',
    },
    {
      id: 'start',
      eyebrow: '07 — Start',
      title: 'Open a tab. Drop the file. Nothing to install.',
      body:
        'No plugins, no workstation build, no graphics-driver lottery. Install it once as an app and it keeps working when the studio connection does not. It is free to use; nine dollars a month adds side-by-side comparison of two files.',
      facts: ['PWA · offline shell', 'EN / PT-BR', 'Free · $9 pro'],
      seek: [10, 16],
      focus: 'all',
      flag: 'READY',
    },
  ],
};

const pt: TourCopy = {
  skip: 'Pular tour',
  skipHint: 'Ir direto para o login',
  next: 'Continuar',
  back: 'Voltar',
  replay: 'Rever o tour',
  scrollHint: 'Role',
  stepWord: 'de',
  tapeLabel: 'FITA 01 · 960×540 · 25p',
  live: 'RODANDO',
  audioIdle: 'áudio parado — clique para armar',
  runTape: 'Rodar a fita',
  monitorLabels: {
    waveform: 'Waveform · luma',
    parade: 'Parade RGB',
    vector: 'Vectorscópio',
    spectrum: 'Espectrograma',
    level: 'Nível · dBFS',
  },
  monitors: {
    waveformNote: 'brilho de cada pixel',
    paradeNote: 'R · G · B, uma coluna cada',
    vectorNote: 'matiz e intensidade',
    spectrumNote: 'frequência ao longo do tempo',
  },
  keys: { scrub: 'rebobinar', mark: 'marcar', save: 'salvar' },
  paper: {
    title: 'Relatório QC · QCR-001',
    meta: 'Fita 01 · 00:00:40 · 25p · analista C. Eliel',
    rows: [
      { tc: '00:00:16:12', what: 'Silêncio, 2,4 s', verdict: 'FAIL' },
      { tc: '00:00:20:04', what: 'Quadro preto, 18 quadros', verdict: 'FAIL' },
      { tc: '00:00:24:18', what: 'Clipping de áudio', verdict: 'FAIL' },
      { tc: '00:00:34:02', what: 'Zumbido em 60 Hz', verdict: 'WARN' },
    ],
    signed: 'Exportado · imprime em PDF',
  },
  cta: {
    title: 'O motor é isso.',
    body: 'Entre com o Google para abrir um arquivo do seu Drive, ou percorra o app com uma fila de demonstração, sem conta nenhuma.',
    google: 'Continuar com Google',
    demo: 'Usar a fila de demonstração',
    note: 'Nada para instalar. Para conferir um arquivo, nada é enviado: a análise roda na sua aba.',
  },
  stats: [
    { value: '5', label: 'monitores' },
    { value: '5', label: 'presets' },
    { value: '2', label: 'idiomas' },
    { value: '129', label: 'testes verdes' },
  ],
  steps: [
    {
      id: 'tape',
      eyebrow: '01 — O problema',
      title: 'Um arquivo de duas horas é quase todo bom. O defeito mora em quatro lugares.',
      body:
        'Alguém ainda precisa assistir tudo. O Solaris lê o sinal no lugar dessa pessoa: quadro por quadro, amostra por amostra, e devolve os segundos que precisam de gente. Silêncio onde deveria ter som. Preto onde deveria ter imagem. Áudio estourado. Canal que caiu. Você assiste os dez segundos que importam.',
      facts: ['2 horas → 4 timecodes', 'Sem upload para conferir', 'Roda numa aba'],
      seek: [4, 10],
      focus: 'all',
      flag: 'SINAL',
    },
    {
      id: 'luma',
      eyebrow: '02 — Luma',
      title: 'O waveform é o brilho de cada pixel, empilhado em colunas.',
      body:
        'Embaixo da grade é preto, em cima é branco, e broadcast quer as duas pontas dentro dos limites marcados. Queda até o chão é buraco na imagem; faixa alta demais é rosto sem detalhe. Esta fita fica muda em 00:16 e totalmente preta em 00:20 — e dá para ver as duas chegando.',
      facts: ['0 = preto · 100 = branco', 'Silêncio em 00:16', 'Preto em 00:20'],
      seek: [16, 20],
      focus: 'luma',
      flag: 'SILÊNCIO',
    },
    {
      id: 'color',
      eyebrow: '03 — Cor',
      title: 'Três colunas para a cor. Um disco para o que a cor faz.',
      body:
        'Vermelho, verde e azul ganham uma coluna cada. Quando o azul sobe acima dos outros dois, o quadro inteiro fica frio. O disco marca cada pixel por matiz e intensidade: pele deve cair perto da linha das onze horas, e ponto fora do círculo é cor que deixa de existir depois da codificação.',
      facts: ['Desvio azul em 00:24', 'Linha de pele às 11h', 'Fora de gamut'],
      seek: [24, 29],
      focus: 'color',
      flag: 'DESVIO AZUL',
    },
    {
      id: 'audio',
      eyebrow: '04 — Som',
      title: 'Som desenhado como tempo contra frequência.',
      body:
        'Um zumbido é uma linha reta em 60 hertz. Chiado é uma mancha cinza no topo. Silêncio é coluna vazia. Ao lado, o medidor mostra o momento mais alto e a média — para você saber se a mixagem já batia no teto antes de qualquer pessoa abrir o arquivo.',
      facts: ['0–20 kHz', 'Zumbido em 60 Hz', 'Clipping em 00:24'],
      seek: [34, 40],
      focus: 'audio',
      flag: 'ZUMBIDO 60 Hz',
    },
    {
      id: 'desk',
      eyebrow: '05 — A mesa',
      title: 'Feito para as mãos no teclado.',
      body:
        'J, K e L rebobinam como num deck. As setas andam um quadro por vez. T crava um marcador no segundo exato que você está vendo, e Ctrl+S salva a ficha. Presets reorganizam a parede inteira de monitores para o conteúdo na sua frente — limpo, enquadramento, níveis, teto.',
      facts: ['J K L — rebobinar', 'T — marcar', 'Ctrl+S — salvar'],
      seek: [4, 10],
      focus: 'motion',
      flag: 'PRONTO',
    },
    {
      id: 'paper',
      eyebrow: '06 — A saída',
      title: 'Cada marca vira um relatório que você anexa na entrega.',
      body:
        'Timecode, o que estava errado, o quanto, e quem assinou. Exporta uma página única que abre em qualquer navegador e imprime em PDF. É o documento que o cliente pede quando pergunta o que, exatamente, foi conferido.',
      facts: ['Relatório QC · HTML', 'Imprime em PDF', 'Assinado pelo analista'],
      seek: [29, 34],
      focus: 'paper',
      flag: 'QCR-001',
    },
    {
      id: 'start',
      eyebrow: '07 — Começar',
      title: 'Abre uma aba. Joga o arquivo. Nada para instalar.',
      body:
        'Sem plugin, sem montar estação, sem loteria de driver de vídeo. Instala uma vez como app e continua funcionando quando a conexão do estúdio não funciona. É de graça para usar; nove dólares por mês adicionam a comparação lado a lado de dois arquivos.',
      facts: ['PWA · casca offline', 'EN / PT-BR', 'Grátis · US$9 pro'],
      seek: [10, 16],
      focus: 'all',
      flag: 'PRONTO',
    },
  ],
};

export const tourCopy: Record<TourLocale, TourCopy> = { en, pt };
