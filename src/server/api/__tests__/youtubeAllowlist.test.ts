import { describe, it, expect, vi } from 'vitest';
import {
  parseYouTubeVideoId,
  isPrivateOrReservedHost,
  isAllowedStreamHost,
  resolveYouTubeStream,
  safeStreamFetch,
} from '../youtube';

describe('parseYouTubeVideoId — input allowlist (SSRF guard)', () => {
  it('rejects loopback, link-local, metadata and non-YouTube hosts', () => {
    // The two production reproduction URLs from SOLA-35 / threat model P1-4.
    expect(parseYouTubeVideoId('http://127.0.0.1:22/')).toBeNull();
    expect(parseYouTubeVideoId('http://169.254.169.254/')).toBeNull();
    expect(parseYouTubeVideoId('http://localhost/youtube')).toBeNull();
    expect(parseYouTubeVideoId('http://[::1]/')).toBeNull();
    expect(parseYouTubeVideoId('http://2130706433/')).toBeNull(); // decimal 127.0.0.1
    expect(parseYouTubeVideoId('file:///etc/passwd')).toBeNull();
    expect(parseYouTubeVideoId('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeVideoId('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeVideoId('javascript:alert(1)')).toBeNull();
    expect(parseYouTubeVideoId('not a url')).toBeNull();
  });

  it('accepts genuine YouTube watch, short, embed and shorts URLs', () => {
    expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeVideoId('https://m.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD')).toBe(
      'dQw4w9WgXcQ',
    );
  });
});

describe('isPrivateOrReservedHost', () => {
  it('flags loopback, RFC1918, link-local, CGNAT and metadata names', () => {
    for (const host of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      'localhost',
      'foo.localhost',
      'svc.internal',
      'metadata.google.internal',
    ]) {
      expect(isPrivateOrReservedHost(host), host).toBe(true);
    }
  });

  it('does not flag public hosts', () => {
    for (const host of ['r1.googlevideo.com', '8.8.8.8', '172.32.0.1', 'example.com']) {
      expect(isPrivateOrReservedHost(host), host).toBe(false);
    }
  });
});

describe('isAllowedStreamHost', () => {
  it('allows only googlevideo.com origins', () => {
    expect(isAllowedStreamHost('r1---sn-abc.googlevideo.com')).toBe(true);
    expect(isAllowedStreamHost('googlevideo.com')).toBe(true);
    expect(isAllowedStreamHost('googlevideo.com.evil.example')).toBe(false);
    expect(isAllowedStreamHost('evil.example')).toBe(false);
    expect(isAllowedStreamHost('youtube.com')).toBe(false);
  });
});

describe('safeStreamFetch — re-check after each hop', () => {
  it('rejects a redirect into a private address on the next hop', async () => {
    const doFetch = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
    );
    await expect(
      safeStreamFetch('https://r1.googlevideo.com/videoplayback', {}, { fetch: doFetch }),
    ).rejects.toThrow('private_host');
  });

  it('rejects a redirect to a non-allowlisted host', async () => {
    const doFetch = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }),
    );
    await expect(
      safeStreamFetch('https://r1.googlevideo.com/videoplayback', {}, { fetch: doFetch }),
    ).rejects.toThrow('host_not_allowed');
  });

  it('rejects a non-allowlisted initial host before fetching', async () => {
    const doFetch = vi.fn(async () => new Response('x', { status: 200 }));
    await expect(safeStreamFetch('https://evil.example/x', {}, { fetch: doFetch })).rejects.toThrow(
      'host_not_allowed',
    );
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('follows an allowed redirect and returns the final response', async () => {
    const doFetch = vi.fn(async (url: string) =>
      url.includes('redirector')
        ? new Response(null, { status: 302, headers: { location: 'https://r2.googlevideo.com/v' } })
        : new Response('media', { status: 206 }),
    );
    const res = await safeStreamFetch('https://r1.googlevideo.com/redirector', {}, { fetch: doFetch as unknown as typeof fetch });
    expect(res.status).toBe(206);
    expect(doFetch).toHaveBeenCalledTimes(2);
  });
});

describe('resolveYouTubeStream', () => {
  it('returns null when YouTube exposes no directly usable format', async () => {
    const doFetch = vi.fn(
      async () => new Response(JSON.stringify({ streamingData: { formats: [] } }), { status: 200 }),
    );
    expect(await resolveYouTubeStream('dQw4w9WgXcQ', { fetch: doFetch })).toBeNull();
  });

  it('rejects a malformed video id without fetching', async () => {
    const doFetch = vi.fn();
    expect(await resolveYouTubeStream('../etc/passwd', { fetch: doFetch })).toBeNull();
    expect(doFetch).not.toHaveBeenCalled();
  });
});
