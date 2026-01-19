// Vercel Serverless Function
// Endpoint: /api/get-sheets-data
// Description: Fetches, transforms, and caches analysis data from the master Google Sheet.

import { google } from 'googleapis';
import type { NextApiRequest, NextApiResponse } from 'next';

// --- SERVER-SIDE CACHE ---
// Reduces latency and API quota usage for frequent dashboard refreshes.
let cache: { [key: string]: { data: any; timestamp: number } } = {};
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;

// Regex to extract clean URLs from Google Sheet =HYPERLINK("url", "label") formulas
const HYPERLINK_REGEX = /=HYPERLINK\("([^"]+)"/i;

async function getSheetsClient() {
    if (!SERVICE_ACCOUNT_KEY) {
        throw new Error("Missing Server-Side Credentials (GOOGLE_SERVICE_ACCOUNT_KEY_JSON).");
    }

    const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(SERVICE_ACCOUNT_KEY),
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 1. Configuration Validation
  if (!SPREADSHEET_ID) {
      return res.status(500).json({ error: "System Configuration Error: Spreadsheet ID missing." });
  }

  const { force } = req.query;
  const cacheKey = 'master_dataset_v1'; 

  // 2. Cache Strategy
  if (force !== 'true' && cache[cacheKey] && Date.now() - cache[cacheKey].timestamp < CACHE_TTL) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cache[cacheKey].data);
  }

  try {
    // 3. Upstream Fetch
    const sheets = await getSheetsClient();
    
    // Assumes a clean, English schema: 'Analysis!A1:Z'
    // Fetching formatted values for display and formulas for link extraction
    const [headerResponse, dataResponse] = await Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: 'ANALYSIS!A1:Z1' }),
        sheets.spreadsheets.values.batchGet({
            spreadsheetId: SPREADSHEET_ID,
            ranges: ['ANALYSIS!A2:Z1000'], // Main data block
            valueRenderOption: 'FORMULA', // Needed to parse HYPERLINK()
        })
    ]);

    const headers = headerResponse.data.values?.[0]?.map(h => String(h).toUpperCase().trim()) || [];
    
    if (headers.length === 0) throw new Error("Spreadsheet headers could not be retrieved.");

    // Retrieve data blocks (assuming the batchGet returned the requested range)
    const rawData = dataResponse.data.valueRanges?.[0].values || [];

    // 4. Data Transformation (ETL)
    const processedRows = rawData.map((row, index) => {
        // Map raw row array to structured CellData based on index
        const rowObject = row.map((cell: any) => {
            const cellValue = String(cell);
            const linkMatch = cellValue.match(HYPERLINK_REGEX);
            
            return {
                value: linkMatch ? "Link" : cellValue, // Simplify display for linked cells
                link: linkMatch ? linkMatch[1] : undefined
            };
        });

        return {
            rowIndex: index + 2, // 1-based index + header offset
            row: rowObject
        };
    });

    const payload = { headers, rows: processedRows };

    // 5. Update Cache
    cache[cacheKey] = { data: payload, timestamp: Date.now() };

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', `public, s-maxage=${CACHE_TTL / 1000}, stale-while-revalidate`);
    
    return res.status(200).json(payload);

  } catch (err: any) {
    console.error("Sheet API Error:", err.message);
    return res.status(500).json({ error: "Failed to sync with Data Layer." });
  }
}