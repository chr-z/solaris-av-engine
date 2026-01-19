// Vercel Serverless Function
// Endpoint: /api/youtube-proxy
// Description: Resolves and proxies YouTube streams for CORS-compatible playback.

import type { NextApiRequest, NextApiResponse } from 'next';
import ytdl from 'ytdl-core';
import { Readable } from 'stream';

// Metadata Cache
const cache: Record<string, { info: ytdl.videoInfo; ts: number }> = {};
const TTL = 60 * 1000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const { url } = req.query;
    const token = req.cookies.g_token;

    if (typeof url !== 'string' || !ytdl.validateURL(url)) {
        return res.status(400).json({ error: 'Invalid URL.' });
    }

    try {
        const cacheKey = url;
        let info = cache[cacheKey]?.ts > Date.now() - TTL ? cache[cacheKey].info : null;

        if (!info) {
            const options = token ? { headers: { 'Authorization': `Bearer ${token}` } } : {};
            info = await ytdl.getInfo(url, { requestOptions: options });
            cache[cacheKey] = { info, ts: Date.now() };
        }

        const format = ytdl.chooseFormat(info.formats, { 
            quality: 'highest', 
            filter: 'audioandvideo' 
        });

        if (!format.url) throw new Error("No playback stream available.");

        // Pipe external stream to response
        const upstreamRes = await fetch(format.url, { 
            headers: req.headers.range ? { Range: req.headers.range } : undefined 
        });

        if (!upstreamRes.ok) throw new Error(`Upstream Error: ${upstreamRes.statusText}`);

        // Forward Headers
        const forward = ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges'];
        forward.forEach(h => {
            if (upstreamRes.headers.has(h)) res.setHeader(h, upstreamRes.headers.get(h)!);
        });

        res.writeHead(upstreamRes.status);
        Readable.fromWeb(upstreamRes.body as any).pipe(res);

    } catch (err: any) {
        console.error("YouTube Proxy Error:", err.message);
        // Error handling tailored for common YouTube permission issues
        const status = err.message.includes('private') ? 403 : 500;
        return res.status(status).json({ error: "Stream unavailable." });
    }
}