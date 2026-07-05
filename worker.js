// ─────────────────────────────────────────────────────────────
// Cloudflare Worker Proxy untuk Kamus Konstruksi (Gemini)
// ─────────────────────────────────────────────────────────────
//
// Fungsi: proxy dari browser HP ke Google Gemini API supaya
//         API key tidak bocor di HP teman-temanmu.
//
// Deploy: lihat README-DEPLOY.md
//
// Env vars yang harus di-set di Cloudflare (Settings → Variables):
//   GEMINI_API_KEY   — API key kamu (AIza...). MUST be encrypted.
//                      Ambil gratis di https://aistudio.google.com/apikey
//   SHARED_TOKEN     — token bebas buatan sendiri (opsional tapi disarankan).
//                      Kalau di-set, request harus bawa
//                      header "Authorization: Bearer <SHARED_TOKEN>".
//                      Ini mencegah orang random pakai kuota-mu.
//   ALLOWED_ORIGIN   — origin frontend kamu, misal
//                      "https://kamus.pages.dev". Kosong = terima semua.
// ─────────────────────────────────────────────────────────────

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const ALLOWED_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
]);
const MAX_TOKENS_CAP = 2000;

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, cors);
    }

    // Optional shared-token gate
    if (env.SHARED_TOKEN) {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.replace(/^Bearer\s+/i, '').trim();
      if (token !== env.SHARED_TOKEN) {
        return json({ error: 'unauthorized' }, 401, cors);
      }
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: 'server_misconfigured', hint: 'GEMINI_API_KEY not set' }, 500, cors);
    }

    // Parse & sanitize payload
    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: 'bad_json' }, 400, cors);
    }

    // Model whitelist (defence: prevent abuse of expensive models via proxy)
    const reqModel = String(payload.model || DEFAULT_MODEL);
    const model = ALLOWED_MODELS.has(reqModel) ? reqModel : DEFAULT_MODEL;

    const contents = Array.isArray(payload.contents) ? payload.contents : null;
    if (!contents || !contents.length) {
      return json({ error: 'missing_contents' }, 400, cors);
    }

    const genCfg = payload.generationConfig || {};
    const safeCfg = {
      temperature: clampNum(genCfg.temperature, 0, 2, 0.3),
      maxOutputTokens: clampNum(genCfg.maxOutputTokens, 1, MAX_TOKENS_CAP, 1000),
      responseMimeType: genCfg.responseMimeType === 'application/json' ? 'application/json' : undefined,
    };

    // Forward to Gemini
    const upstreamUrl = GEMINI_BASE + model + ':generateContent';
    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify({ contents, generationConfig: safeCfg }),
      });
    } catch (e) {
      return json({ error: 'upstream_fetch_failed', detail: String(e) }, 502, cors);
    }

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...cors,
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      },
    });
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function clampNum(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}
