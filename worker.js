// ─────────────────────────────────────────────────────────────
// Cloudflare Worker — Kamus Konstruksi
// AI Proxy (Gemini) + Shared Data (KV) + Auth
// ─────────────────────────────────────────────────────────────
//
// ROUTES:
//   POST   /ai              → proxy Gemini (needs team or admin token)
//   GET    /entries         → list all shared entries (any auth)
//   POST   /entries         → add entry (any auth)
//   PATCH  /entries/:id     → edit entry (ADMIN only)
//   DELETE /entries/:id     → delete entry (ADMIN only)
//   POST   /entries/bulk    → bulk import (ADMIN only, for migration)
//
// ENV VARS (Settings → Variables and Secrets):
//   GEMINI_API_KEY   — Google Gemini key (Encrypted). Free from aistudio.google.com/apikey
//   TEAM_TOKEN       — dishare ke tim (Encrypted). Bebas, bikin random panjang.
//   ADMIN_TOKEN      — hanya Mukti (Encrypted). Bebas, beda dari TEAM_TOKEN.
//   ALLOWED_ORIGIN   — origin frontend (Plaintext), misal "https://muktihadi5641-cpu.github.io"
//                      Kosong = "*" (buat testing saja).
//
// KV BINDING:
//   Variable name: KAMUS
//   Namespace: buat via dashboard → Workers KV → Create namespace "kamus-data"
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
const KV_KEY = 'entries:v1';
const MAX_ENTRIES = 5000;
const MAX_FIELD_LEN = 500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname.replace(/\/+$/, '') || '/';

    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Auth level
    const auth = request.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    let mode = 'none';
    if (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN) mode = 'admin';
    else if (env.TEAM_TOKEN && token === env.TEAM_TOKEN) mode = 'team';

    // Routes
    try {
      if (path === '/ai' && method === 'POST') return await handleAI(request, env, cors, mode);
      if (path === '/entries' && method === 'GET') return await handleList(env, cors, mode);
      if (path === '/entries' && method === 'POST') return await handleAdd(request, env, cors, mode);
      if (path === '/entries/bulk' && method === 'POST') return await handleBulk(request, env, cors, mode);

      const idMatch = path.match(/^\/entries\/([\w-]+)$/);
      if (idMatch && method === 'PATCH') return await handleEdit(request, env, cors, mode, idMatch[1]);
      if (idMatch && method === 'DELETE') return await handleDelete(env, cors, mode, idMatch[1]);

      if (path === '/' && method === 'GET') {
        return json({
          app: 'kamus-konstruksi-worker',
          version: 2,
          endpoints: ['/ai', '/entries', '/entries/:id', '/entries/bulk'],
        }, 200, cors);
      }
      return json({ error: 'not_found', path }, 404, cors);
    } catch (e) {
      return json({ error: 'internal', detail: String(e).slice(0, 200) }, 500, cors);
    }
  },
};

// ─── AI ──────────────────────────────────────────────────────
async function handleAI(request, env, cors, mode) {
  if (mode === 'none') return json({ error: 'unauthorized' }, 401, cors);
  if (!env.GEMINI_API_KEY) return json({ error: 'server_misconfigured', hint: 'GEMINI_API_KEY not set' }, 500, cors);

  let payload;
  try { payload = await request.json(); }
  catch { return json({ error: 'bad_json' }, 400, cors); }

  const reqModel = String(payload.model || DEFAULT_MODEL);
  const model = ALLOWED_MODELS.has(reqModel) ? reqModel : DEFAULT_MODEL;
  const contents = Array.isArray(payload.contents) ? payload.contents : null;
  if (!contents || !contents.length) return json({ error: 'missing_contents' }, 400, cors);

  const cfg = payload.generationConfig || {};
  const safeCfg = {
    temperature: clampNum(cfg.temperature, 0, 2, 0.3),
    maxOutputTokens: clampNum(cfg.maxOutputTokens, 1, MAX_TOKENS_CAP, 1000),
    responseMimeType: cfg.responseMimeType === 'application/json' ? 'application/json' : undefined,
  };

  const upstream = await fetch(GEMINI_BASE + model + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents, generationConfig: safeCfg }),
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
  });
}

// ─── Data ────────────────────────────────────────────────────
async function readEntries(env) {
  if (!env.KAMUS) throw new Error('KV_NOT_BOUND');
  const raw = await env.KAMUS.get(KV_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
async function writeEntries(env, entries) {
  await env.KAMUS.put(KV_KEY, JSON.stringify(entries));
}

async function handleList(env, cors, mode) {
  if (mode === 'none') return json({ error: 'unauthorized' }, 401, cors);
  const entries = await readEntries(env);
  return json({ entries, mode, count: entries.length }, 200, cors);
}

const CATS = new Set(['Alat', 'Alat Berat', 'Material', 'Struktur', 'Keselamatan', 'Proses', 'Ukuran', 'Umum']);
function sanitizeEntry(raw, author) {
  const s = (v) => String(v || '').trim().slice(0, MAX_FIELD_LEN);
  const kat = s(raw.kategori);
  return {
    hanzi: s(raw.hanzi),
    pinyin: s(raw.pinyin),
    indonesia: s(raw.indonesia),
    kategori: CATS.has(kat) ? kat : 'Umum',
    contoh: s(raw.contoh),
    createdBy: s(author).slice(0, 30) || 'anon',
    createdAt: Date.now(),
  };
}

function makeId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

async function handleAdd(request, env, cors, mode) {
  if (mode === 'none') return json({ error: 'unauthorized' }, 401, cors);
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ error: 'bad_json' }, 400, cors);

  const entry = { id: makeId(), ...sanitizeEntry(payload, payload.author) };
  if (!entry.hanzi || !entry.indonesia) return json({ error: 'missing_fields' }, 400, cors);

  const entries = await readEntries(env);
  if (entries.length >= MAX_ENTRIES) return json({ error: 'quota_exceeded' }, 409, cors);
  if (entries.find(e => e.hanzi === entry.hanzi && e.indonesia === entry.indonesia)) {
    return json({ error: 'duplicate' }, 409, cors);
  }
  entries.unshift(entry);
  await writeEntries(env, entries);
  return json({ entry }, 201, cors);
}

async function handleEdit(request, env, cors, mode, id) {
  if (mode !== 'admin') return json({ error: 'admin_only' }, 403, cors);
  const patch = await request.json().catch(() => null);
  if (!patch) return json({ error: 'bad_json' }, 400, cors);

  const entries = await readEntries(env);
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return json({ error: 'not_found' }, 404, cors);

  const s = (v, fallback) => v !== undefined ? String(v).trim().slice(0, MAX_FIELD_LEN) : fallback;
  const kat = patch.kategori !== undefined ? String(patch.kategori).trim() : entries[idx].kategori;
  entries[idx] = {
    ...entries[idx],
    hanzi: s(patch.hanzi, entries[idx].hanzi),
    pinyin: s(patch.pinyin, entries[idx].pinyin),
    indonesia: s(patch.indonesia, entries[idx].indonesia),
    kategori: CATS.has(kat) ? kat : entries[idx].kategori,
    contoh: s(patch.contoh, entries[idx].contoh),
    updatedAt: Date.now(),
  };
  await writeEntries(env, entries);
  return json({ entry: entries[idx] }, 200, cors);
}

async function handleDelete(env, cors, mode, id) {
  if (mode !== 'admin') return json({ error: 'admin_only' }, 403, cors);
  const entries = await readEntries(env);
  const filtered = entries.filter(e => e.id !== id);
  if (filtered.length === entries.length) return json({ error: 'not_found' }, 404, cors);
  await writeEntries(env, filtered);
  return json({ ok: true }, 200, cors);
}

async function handleBulk(request, env, cors, mode) {
  if (mode !== 'admin') return json({ error: 'admin_only' }, 403, cors);
  const payload = await request.json().catch(() => null);
  const incoming = Array.isArray(payload?.entries) ? payload.entries : null;
  if (!incoming) return json({ error: 'missing_entries' }, 400, cors);

  const entries = await readEntries(env);
  const seen = new Set(entries.map(e => e.hanzi + '|' + e.indonesia));
  const added = [];
  for (const raw of incoming) {
    const s = sanitizeEntry(raw, raw.createdBy || payload.author);
    if (!s.hanzi || !s.indonesia) continue;
    const key = s.hanzi + '|' + s.indonesia;
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({ id: makeId(), ...s });
  }
  if (!added.length) return json({ added: 0, message: 'no_new_entries' }, 200, cors);
  const next = [...added, ...entries].slice(0, MAX_ENTRIES);
  await writeEntries(env, next);
  return json({ added: added.length, count: next.length }, 200, cors);
}

// ─── Helpers ─────────────────────────────────────────────────
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
