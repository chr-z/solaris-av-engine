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
}

export function serviceAccountJson(env: ServerEnv): string | undefined {
  return env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON ?? env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON;
}
