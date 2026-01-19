// Vercel Serverless Function
// Endpoint: /api/drive-proxy
// Description: Secure streaming proxy for Google Drive assets. Handles Byte-Range requests for video seeking.

import { google } from 'googleapis';
import type { NextApiRequest, NextApiResponse } from 'next';
import { Readable } from 'stream';

function getUserDriveClient(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.drive({ version: 'v3', auth });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const accessToken = req.cookies.g_token;
    if (!accessToken) return res.status(401).json({ error: 'Session expired. Please refresh the page.' });

    const { fileId } = req.query;
    if (!fileId || typeof fileId !== 'string') return res.status(400).json({ error: 'Missing File ID.' });

    try {
        const drive = getUserDriveClient(accessToken);

        // 1. Metadata Pre-flight (HEAD)
        // Critical for player initialization (duration/mime-type)
        if (req.method === 'HEAD') {
            const metadata = await drive.files.get({
                fileId,
                fields: 'size, mimeType',
                supportsAllDrives: true,
            });

            res.setHeader('Content-Type', metadata.data.mimeType || 'video/mp4');
            res.setHeader('Content-Length', metadata.data.size || 0);
            res.setHeader('Accept-Ranges', 'bytes');
            return res.status(200).end();
        }

        // 2. Content Streaming (GET)
        if (req.method === 'GET') {
            const headers: any = {};
            if (req.headers.range) headers['Range'] = req.headers.range;

            const response = await drive.files.get(
                { fileId, alt: 'media', supportsAllDrives: true },
                { headers, responseType: 'stream' }
            );
            
            // Forward status (200 OK or 206 Partial Content)
            const status = req.headers.range ? 206 : 200;
            
            const responseHeaders: Record<string, string | number | string[]> = {
                'Accept-Ranges': 'bytes',
            };

            // Proxy essential headers
            if (response.headers['content-type']) responseHeaders['Content-Type'] = response.headers['content-type'];
            if (response.headers['content-length']) responseHeaders['Content-Length'] = response.headers['content-length'];
            if (response.headers['content-range']) responseHeaders['Content-Range'] = response.headers['content-range'];
            
            res.writeHead(status, responseHeaders);
            (response.data as Readable).pipe(res);
            return;
        }

        res.setHeader('Allow', ['GET', 'HEAD']);
        return res.status(405).end();

    } catch (err: any) {
        console.error("Drive Proxy Error:", err.message);
        if (err.code === 401 || err.code === 403) return res.status(401).json({ error: "Unauthorized access to Drive file." });
        if (err.code === 404) return res.status(404).json({ error: "File not found." });
        return res.status(500).json({ error: "Stream initialization failed." });
    }
}