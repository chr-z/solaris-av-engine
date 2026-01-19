// Vercel Serverless Function
// Endpoint: /api/sheet-row
// Description: Handles granular read/write operations for specific spreadsheet rows using User OAuth context.

import { google } from 'googleapis';
import type { NextApiRequest, NextApiResponse } from 'next';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;

const HYPERLINK_REGEX = /=HYPERLINK\("([^"]+)"/i;

// Service Account Client (Read-Only / System Operations)
async function getSystemClient() {
    if (!SERVICE_ACCOUNT_KEY) throw new Error("Missing Service Account Credentials.");
    const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(SERVICE_ACCOUNT_KEY),
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

// User Client (Write Operations - Requires OAuth Token)
function getUserClient(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.sheets({ version: 'v4', auth });
}

// --- GET: Fetch Single Row Detail ---
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
    const rowIndex = parseInt(req.query.rowIndex as string, 10);
    if (isNaN(rowIndex) || rowIndex < 2) return res.status(400).json({ error: 'Invalid row index.' });

    try {
        const sheets = await getSystemClient();
        const range = `ANALYSIS!A${rowIndex}:Z${rowIndex}`; // Updated to English Sheet Name
        
        // Parallel fetch for formatting and formulas
        const [formulaRes, fmtRes] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range, valueRenderOption: 'FORMULA' }),
            sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range, valueRenderOption: 'FORMATTED_VALUE' })
        ]);

        const formulas = formulaRes.data.values?.[0] || [];
        const values = fmtRes.data.values?.[0] || [];

        const combined = values.map((val: string, i: number) => {
            const formula = formulas[i] || '';
            const match = typeof formula === 'string' ? formula.match(HYPERLINK_REGEX) : null;
            return { value: val || '', link: match ? match[1] : undefined };
        });

        return res.status(200).json(combined);
    } catch (err: any) {
        console.error("Row Fetch Error:", err.message);
        return res.status(500).json({ error: "Failed to retrieve row details." });
    }
}

// --- POST: Update Single Row ---
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing Authorization Token.' });
    
    const { rowIndex, rowData } = req.body;
    if (!rowIndex || !Array.isArray(rowData)) return res.status(400).json({ error: 'Invalid payload schema.' });

    try {
        const sheets = getUserClient(authHeader.split(' ')[1]);
        const range = `ANALYSIS!A${rowIndex}:Z${rowIndex}`;
        
        // Transform data back into Sheet primitives or Formulas
        const values = [rowData.map((cell: { value: string; link?: string }) => {
            if (cell?.link && cell?.value) {
                // Sanitize double quotes for formula injection
                const label = cell.value.replace(/"/g, '""');
                return `=HYPERLINK("${cell.link}"; "${label}")`;
            }
            return cell?.value || "";
        })];

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range,
            valueInputOption: 'USER_ENTERED', // Required to parse the injected formulas
            requestBody: { values },
        });

        return res.status(200).json({ success: true });
    } catch (err: any) {
        console.error("Row Update Error:", err.message);
        const status = err.code === 401 || err.code === 403 ? 401 : 500;
        return res.status(status).json({ error: "Failed to persist changes." });
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (!SPREADSHEET_ID) return res.status(500).json({ error: "Server Configuration Error." });
    
    switch (req.method) {
        case 'GET': return handleGet(req, res);
        case 'POST': return handlePost(req, res);
        default: res.setHeader('Allow', ['GET', 'POST']); return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}