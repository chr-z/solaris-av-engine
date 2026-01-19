// Vercel Serverless Function
// Endpoint: /api/set-auth-cookie
// Description: Elevates the client-side OAuth token to a Secure HttpOnly cookie for proxy middleware.

import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end();
    }

    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token payload missing.' });

    try {
        const isProd = process.env.VERCEL_ENV === 'production';
        
        // Security Flags:
        // HttpOnly: Inaccessible to JavaScript (XSS protection)
        // Secure: HTTPS only (Prod)
        // SameSite: Strict (CSRF protection)
        const cookie = [
            `g_token=${token}`,
            'HttpOnly',
            'Path=/',
            'SameSite=Strict',
            'Max-Age=86400',
            isProd ? 'Secure' : ''
        ].filter(Boolean).join('; ');

        res.setHeader('Set-Cookie', cookie);
        return res.status(200).json({ success: true });

    } catch (error) {
        console.error('Session Init Error:', error);
        return res.status(500).json({ error: 'Internal Server Error.' });
    }
}