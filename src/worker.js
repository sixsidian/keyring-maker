// Keyring preview pictures for the shop basket.
// POST /preview?<design settings>  stores the PNG the shop's Keyring Maker drew for that design.
// GET  /preview?<design settings>  returns it, so the basket can show it from the design link alone.
// Everything else is served from the static site.

const KEYS = ['t', 'f', 'h', 'g', 's', 'b', 'l', 'w', 'lp', 'd', 'c1', 'c2', 'k', 'pc'];
const MAX_BYTES = 500 * 1024;
const KEEP_SECONDS = 400 * 24 * 60 * 60;

async function designKey(url) {
  const q = url.searchParams;
  const canon = KEYS.map(k => k + '=' + (q.get(k) || '')).join('&');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon));
  return 'p:' + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function isPng(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length > 8 && sig.every((v, i) => bytes[i] === v);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/preview') return env.ASSETS.fetch(request);
    if (!url.searchParams.get('t')) return new Response('Missing design', { status: 400 });
    const key = await designKey(url);

    if (request.method === 'GET' || request.method === 'HEAD') {
      const png = await env.PREVIEWS.get(key, 'arrayBuffer');
      if (!png) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      return new Response(request.method === 'HEAD' ? null : png, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (request.method === 'POST') {
      // Only the Keyring Maker page on this site may store previews
      const origin = request.headers.get('Origin');
      if (origin !== url.origin) return new Response('Forbidden', { status: 403 });
      const len = Number(request.headers.get('Content-Length') || 0);
      if (len > MAX_BYTES) return new Response('Too large', { status: 413 });
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > MAX_BYTES || !isPng(bytes)) return new Response('Bad image', { status: 400 });
      await env.PREVIEWS.put(key, bytes, { expirationTtl: KEEP_SECONDS });
      return new Response(null, { status: 204 });
    }

    return new Response('Method not allowed', { status: 405 });
  }
};
