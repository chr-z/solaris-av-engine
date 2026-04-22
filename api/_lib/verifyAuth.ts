// Verifies Firebase Auth ID tokens for Vercel serverless routes.
// Service account: prefer FIREBASE_SERVICE_ACCOUNT_KEY_JSON; the Sheets SA may be the same GCP project.

import type { NextApiRequest, NextApiResponse } from 'next';
import * as admin from 'firebase-admin';
import type { ServiceAccount } from 'firebase-admin/app';

function getAdmin(): void {
  if (admin.apps.length) return;
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON ?? process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  if (!keyJson) {
    throw new Error('Missing service account for Firebase Admin (FIREBASE_SERVICE_ACCOUNT_KEY_JSON or GOOGLE_SERVICE_ACCOUNT_KEY_JSON).');
  }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(keyJson) as ServiceAccount) });
}

export async function requireFirebaseIdToken(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  const idToken = header.slice(7);
  try {
    getAdmin();
    const { uid } = await admin.auth().verifyIdToken(idToken, true);
    return uid;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('Missing service account')) {
      res.status(500).json({ error: 'Server configuration error.' });
      return null;
    }
    res.status(401).json({ error: 'Invalid or expired session.' });
    return null;
  }
}
