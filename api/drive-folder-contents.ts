// Vercel Serverless Function
// Endpoint: /api/drive-folder-contents
// Description: Recursively scans a target Drive folder for audiovisual assets.

import { google, drive_v3 } from 'googleapis';
import type { NextApiRequest, NextApiResponse } from 'next';

function getUserDriveClient(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.drive({ version: 'v3', auth });
}

async function recursiveScan(drive: drive_v3.Drive, folderId: string, depth = 0): Promise<drive_v3.Schema$File[]> {
    if (depth > 5) return []; // Safety limit

    let assets: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined;

    do {
        const res = await drive.files.list({
            q: `'${folderId}' in parents and trashed = false`,
            fields: 'nextPageToken, files(id, name, mimeType)',
            pageSize: 100,
            pageToken,
            supportsAllDrives: true,
            includeItemsFromAllDrives: true
        });

        const files = res.data.files || [];
        pageToken = res.data.nextPageToken || undefined;

        const subOperations = files.map(async (file) => {
            if (file.mimeType === 'application/vnd.google-apps.folder') {
                return recursiveScan(drive, file.id!, depth + 1);
            } else if (file.mimeType?.startsWith('video/') || file.mimeType?.startsWith('audio/')) {
                return [file];
            }
            return [];
        });

        const results = await Promise.all(subOperations);
        assets = assets.concat(...results.flat());

    } while (pageToken);

    return assets;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Access Token.' });

    const { folderId } = req.query;
    if (typeof folderId !== 'string') return res.status(400).json({ error: 'Invalid Folder ID.' });

    try {
        const drive = getUserDriveClient(authHeader.split(' ')[1]);
        const files = await recursiveScan(drive, folderId);
        return res.status(200).json(files);
    } catch (err: any) {
        console.error("Folder Scan Error:", err.message);
        return res.status(500).json({ error: "Failed to scan directory." });
    }
}