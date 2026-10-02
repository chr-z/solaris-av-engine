/** Environment bindings available to the Solaris Pages Functions. */
export interface ServerEnv {
  /** Firebase project id used to validate ID-token `aud`/`iss`. */
  FIREBASE_PROJECT_ID?: string;
  /** Web API key, only used for the optional `accounts:lookup` revocation check. */
  FIREBASE_API_KEY?: string;
  /** Service account JSON (Sheets read + optional revocation). */
  GOOGLE_SERVICE_ACCOUNT_KEY_JSON?: string;
  FIREBASE_SERVICE_ACCOUNT_KEY_JSON?: string;
  /** Master spreadsheet id (Sheets handlers). */
  SPREADSHEET_ID?: string;
  /** Google OAuth scopes override, space-separated (advanced). */
  SOLARIS_GOOGLE_SCOPES?: string;
  /**
   * Innertube player API key for the YouTube proxy (SOLA-142).
   *
   * Server-only. Never use a `VITE_` prefixed variable here: a bare
   * `import.meta.env` reference serialises the whole env object into the
   * client bundle (SOLA-120) and would leak this key to every visitor.
   * The committed key is revoked; operators must set this binding and
   * rotate the value in Cloud Console (SOLA-104 operator action).
   */
  YOUTUBE_INNERTUBE_API_KEY?: string;
}

export function serviceAccountJson(env: ServerEnv): string | undefined {
  return env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON ?? env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON;
}
