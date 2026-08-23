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
};

export const dictionaries = { en, pt } as const;
