/**
 * SOLARIS lightweight i18n — translation dictionaries.
 * Flat keys with dot notation. `pt` is typed as Record<TranslationKey, string>,
 * so the TypeScript compiler enforces exact key parity with `en`.
 */

export const en = {
  // Login screen
  'login.tagline': 'Audiovisual Analysis Platform',
  'login.signInGoogle': 'Sign in with Google',
  'login.connecting': 'Connecting...',
  'login.continueAsGuest': 'Continue as Guest (Demo Mode)',
  'login.authError': 'Authentication Error',

  // Header
  'header.backToList': 'Back to List',
  'header.loadMedia': 'Load Media',
  'header.changeLanguage': 'Switch language',
  'header.reportIssue': 'Report Issue',
  'header.systemReports': 'System Reports',
  'header.signOut': 'Sign Out',

  // Source selector
  'source.tab.local': 'Local File',
  'source.tab.youtube': 'YouTube',
  'source.tab.drive': 'Google Drive',
  'source.placeholder.youtube': 'Enter YouTube Video URL',
  'source.placeholder.drive': 'Enter Google Drive Link',
  'source.or': 'OR',
  'source.selectFromDrive': 'Select from Drive Folder',
  'source.load': 'Load',
  'source.selectLocalFile': 'Select Local File',
  'source.dragDropHint': 'Or drag and drop a video file here',

  // Loading states
  'loading.failed': 'Load Failed',
  'loading.retry': 'Retry',
  'loading.generic': 'Loading...',
  'loading.initializing': 'Initializing application...',
  'loading.step.workspace': 'Setting up workspace...',
  'loading.step.monitors': 'Powering on monitors...',
  'loading.step.vectorscopes': 'Calibrating vectorscopes...',
  'loading.step.audio': 'Tuning audio frequencies...',
  'loading.step.pixels': 'Checking pixel alignment...',
  'loading.step.coffee': 'Brewing analysis coffee...',

  // Monitors / workspace
  'dock.expandMonitor': 'Expand monitor {monitor}',
  'users.activeCount': '{count} active user(s)',
  'workspace.noVideo': 'No video loaded',

  // Content presets (S5.1)
  'preset.title': 'Content Presets',
  'preset.select': 'Choose a preset tuned for the content being reviewed',
  'preset.clean.name': 'Clean',
  'preset.clean.description': 'No overlays — raw signal review',
  'preset.framing.name': 'Framing',
  'preset.framing.description': 'Rule-of-thirds grid for framing checks',
  'preset.leveling.name': 'Leveling',
  'preset.leveling.description': 'Level crosshair to check horizon tilt',
  'preset.onsite.name': 'On-site Ceiling',
  'preset.onsite.description': 'On-site ceiling guide overlay',
  'preset.homeStudio.name': 'Home Studio Ceiling',
  'preset.homeStudio.description': 'Home studio ceiling guide overlay',
  'preset.custom': 'Custom',

  // Analyst shortcuts (S5.1)
  'header.shortcutHelp': 'Keyboard Shortcuts',
  'shortcuts.modalTitle': 'Keyboard Shortcuts',
  'shortcuts.playerGroup': 'Player',
  'shortcuts.workspaceGroup': 'Analysis Workspace',
  'shortcuts.playPause.description': 'Play / pause',
  'shortcuts.jumpBack.description': 'Jump back 10s',
  'shortcuts.jumpForward.description': 'Jump forward 30s',
  'shortcuts.seekStart.description': 'Seek to start',
  'shortcuts.fullscreen.description': 'Toggle fullscreen',
  'shortcuts.frameBack.description': 'Nudge back 0.5s (fine trim)',
  'shortcuts.frameForward.description': 'Nudge forward 0.5s (fine trim)',
  'shortcuts.volumeUp.description': 'Volume up 5%',
  'shortcuts.volumeDown.description': 'Volume down 5%',
  'shortcuts.mute.description': 'Mute / unmute',
  'shortcuts.markTime.description': 'Open time markers at current time',
  'shortcuts.saveAnalysis.description': 'Save analysis',

  // Auth errors
  'auth.loginFailed': 'Login failed.',
  'auth.popupClosed': 'Login popup closed.',

  // Accessibility
  'a11y.skipToContent': 'Skip to main content',
  'a11y.loadingStatus': 'Loading',

  // PWA / offline
  'pwa.offlineBadge': 'Offline — cached mode',
  'pwa.offlineBadgeTitle': 'You are offline. The app shell keeps working; media and cloud features need a connection.',
} as const;

export type TranslationKey = keyof typeof en;

export const pt: Record<TranslationKey, string> = {
  // Login screen
  'login.tagline': 'Plataforma de Análise Audiovisual',
  'login.signInGoogle': 'Entrar com Google',
  'login.connecting': 'Conectando...',
  'login.continueAsGuest': 'Continuar como Visitante (Modo Demo)',
  'login.authError': 'Erro de Autenticação',

  // Header
  'header.backToList': 'Voltar para a Lista',
  'header.loadMedia': 'Carregar Mídia',
  'header.changeLanguage': 'Mudar idioma',
  'header.reportIssue': 'Reportar Problema',
  'header.systemReports': 'Relatórios do Sistema',
  'header.signOut': 'Sair',

  // Source selector
  'source.tab.local': 'Arquivo Local',
  'source.tab.youtube': 'YouTube',
  'source.tab.drive': 'Google Drive',
  'source.placeholder.youtube': 'Insira a URL do vídeo do YouTube',
  'source.placeholder.drive': 'Insira o link do Google Drive',
  'source.or': 'OU',
  'source.selectFromDrive': 'Escolher da pasta do Drive',
  'source.load': 'Carregar',
  'source.selectLocalFile': 'Selecionar Arquivo Local',
  'source.dragDropHint': 'Ou arraste e solte um arquivo de vídeo aqui',

  // Loading states
  'loading.failed': 'Falha ao Carregar',
  'loading.retry': 'Tentar Novamente',
  'loading.generic': 'Carregando...',
  'loading.initializing': 'Inicializando aplicativo...',
  'loading.step.workspace': 'Preparando o workspace...',
  'loading.step.monitors': 'Ligando os monitores...',
  'loading.step.vectorscopes': 'Calibrando vetorescópios...',
  'loading.step.audio': 'Ajustando frequências de áudio...',
  'loading.step.pixels': 'Verificando alinhamento de pixels...',
  'loading.step.coffee': 'Preparando o café da análise...',

  // Monitors / workspace
  'dock.expandMonitor': 'Expandir monitor {monitor}',
  'users.activeCount': '{count} usuário(s) ativo(s)',
  'workspace.noVideo': 'Nenhum vídeo carregado',

  // Content presets (S5.1)
  'preset.title': 'Presets de Conteúdo',
  'preset.select': 'Escolha um preset ajustado para o conteúdo em análise',
  'preset.clean.name': 'Limpo',
  'preset.clean.description': 'Sem overlays — revisão do sinal puro',
  'preset.framing.name': 'Enquadramento',
  'preset.framing.description': 'Grade dos terços para conferir enquadramento',
  'preset.leveling.name': 'Nivelamento',
  'preset.leveling.description': 'Mira de nível para checar inclinação do horizonte',
  'preset.onsite.name': 'Teto Presencial',
  'preset.onsite.description': 'Overlay de guia de teto presencial',
  'preset.homeStudio.name': 'Teto Home Studio',
  'preset.homeStudio.description': 'Overlay de guia de teto home studio',
  'preset.custom': 'Personalizado',

  // Analyst shortcuts (S5.1)
  'header.shortcutHelp': 'Atalhos de Teclado',
  'shortcuts.modalTitle': 'Atalhos de Teclado',
  'shortcuts.playerGroup': 'Player',
  'shortcuts.workspaceGroup': 'Workspace de Análise',
  'shortcuts.playPause.description': 'Reproduzir / pausar',
  'shortcuts.jumpBack.description': 'Voltar 10s',
  'shortcuts.jumpForward.description': 'Avançar 30s',
  'shortcuts.seekStart.description': 'Voltar ao início',
  'shortcuts.fullscreen.description': 'Alternar tela cheia',
  'shortcuts.frameBack.description': 'Recuar 0,5s (ajuste fino)',
  'shortcuts.frameForward.description': 'Avançar 0,5s (ajuste fino)',
  'shortcuts.volumeUp.description': 'Aumentar volume 5%',
  'shortcuts.volumeDown.description': 'Diminuir volume 5%',
  'shortcuts.mute.description': 'Silenciar / reativar',
  'shortcuts.markTime.description': 'Abrir marcadores de tempo no ponto atual',
  'shortcuts.saveAnalysis.description': 'Salvar análise',

  // Auth errors
  'auth.loginFailed': 'Falha no login.',
  'auth.popupClosed': 'Janela de login fechada.',

  // Accessibility
  'a11y.skipToContent': 'Pular para o conteúdo principal',
  'a11y.loadingStatus': 'Carregando',

  // PWA / offline
  'pwa.offlineBadge': 'Offline — modo cacheado',
  'pwa.offlineBadgeTitle': 'Você está offline. O app continua funcionando; mídia e recursos na nuvem precisam de conexão.',
};

export const dictionaries = { en, pt } as const;
