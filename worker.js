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
//   GET    /tocfl           → list TOCFL vocabulary (ADMIN only)
//   POST   /tocfl/sync      → sync TOCFL from GitHub CSV (ADMIN only)
//   POST   /tocfl/upload    → bulk upload TOCFL from JSON payload (ADMIN only)
//   PATCH  /tocfl/:id       → edit single TOCFL entry Indonesian (ADMIN only)
//   GET    /tocfl/stats     → TOCFL stats per level (ADMIN only)
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
// gemini-2.5-flash-lite has 4x more daily quota (1000 vs 250) and no
// "thinking token" overhead that inflates cost + can truncate JSON.
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const ALLOWED_MODELS = new Set([
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash-lite',
]);
const MAX_TOKENS_CAP = 2000;
const KV_KEY = 'entries:v1';
const MAX_ENTRIES = 20000;
const MAX_FIELD_LEN = 500;

// TOCFL source: official CSV from ivankra/tocfl (mirrors tocfl.edu.tw data)
const TOCFL_CSV_URL = 'https://raw.githubusercontent.com/ivankra/tocfl/master/tocfl-202307.csv';
const TOCFL_KV_KEY = 'tocfl:v2';
const MAX_TOCFL = 10000;

const TOCFL_LEVEL_MAP = {
  'L0': 'A1', 'L1': 'A2', 'L2': 'B1',
  'L3': 'B2', 'L4': 'C1', 'L5': 'C2',
  'L6': 'B1課', 'L7': 'B2課'
};

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

      // TOCFL routes
      if (path === '/tocfl' && method === 'GET') return await handleTocflList(request, env, cors, mode);
      if (path === '/tocfl/sync' && method === 'POST') return await handleTocflSync(request, env, cors, mode);
      if (path === '/tocfl/upload' && method === 'POST') return await handleTocflUpload(request, env, cors, mode);
      if (path === '/tocfl/stats' && method === 'GET') return await handleTocflStats(env, cors, mode);

      const tocflIdMatch = path.match(/^\/tocfl\/([\w-]+)$/);
      if (tocflIdMatch && method === 'PATCH') return await handleTocflEdit(request, env, cors, mode, tocflIdMatch[1]);

      if (path === '/' && method === 'GET') {
        return json({
          app: 'kamus-konstruksi-worker',
          version: 3,
          endpoints: [
            '/ai', '/entries', '/entries/:id', '/entries/bulk',
            '/tocfl', '/tocfl/sync', '/tocfl/upload', '/tocfl/stats', '/tocfl/:id'
          ],
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

const CATS = new Set(['Alat', 'Alat Berat', 'Material', 'Struktur', 'Keselamatan', 'Proses', 'Ukuran', 'Umum', 'B1課', 'B2課']);
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

// ─── TOCFL ───────────────────────────────────────────────────
async function readTocfl(env) {
  if (!env.KAMUS) throw new Error('KV_NOT_BOUND');
  const raw = await env.KAMUS.get(TOCFL_KV_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function writeTocfl(env, entries) {
  await env.KAMUS.put(TOCFL_KV_KEY, JSON.stringify(entries));
}

// GET /tocfl?level=A1&q=xxx&offset=0&limit=200
async function handleTocflList(request, env, cors, mode) {
  if (mode !== 'admin') return json({ error: 'admin_only' }, 403, cors);
  const url = new URL(request.url);
  const level = url.searchParams.get('level') || '';
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '500', 10) || 500, 1000);

  const all = await readTocfl(env);
  
  let filtered = all;
  if (level && level !== 'Semua') {
    filtered = filtered.filter(e => e.level === level);
  }
  if (q) {
    filtered = filtered.filter(e =>
      e.hanzi.toLowerCase().includes(q) ||
      e.pinyin.toLowerCase().includes(q) ||
      (e.indonesia || '').toLowerCase().includes(q)
    );
  }
  
  const page = filtered.slice(offset, offset + limit);
  
  // Count stats per level
  const stats = {};
  for (const e of all) {
    if (!stats[e.level]) stats[e.level] = { total: 0, translated: 0 };
    stats[e.level].total++;
    if (e.indonesia) stats[e.level].translated++;
  }
  
  return json({
    entries: page,
    total: filtered.length,
    allTotal: all.length,
    offset,
    limit,
    stats,
    lastSync: (await env.KAMUS.get('tocfl:lastSync')) || null
  }, 200, cors);
}

// POST /tocfl/sync — pull from ivankra/tocfl GitHub CSV (official TOCFL 2023 data)
async function handleTocflSync(request, env, cors, mode) {
  if (mode !== 'admin') return json({ error: 'admin_only' }, 403, cors);

  try {
    const res = await fetch(TOCFL_CSV_URL, {
      headers: { 'User-Agent': 'Kamus-Konstruksi-Worker/3.0' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from CSV source`);
    const csvText = await res.text();

    // Parse CSV manually
    const lines = csvText.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('ID,'));
    const incomingMap = new Map();

    for (const line of lines) {
      try {
        // Parse CSV row (simple - handle quoted fields)
        const cols = parseCSVLine(line);
        if (cols.length < 4) continue;

        const [rowId, traditional, , pinyin, pos] = cols;
        if (!rowId || !traditional) continue;

        // Get level from ID prefix like L0, L1, etc.
        const lvlMatch = rowId.match(/^(L\d+)-/);
        if (!lvlMatch) continue;
        const level = TOCFL_LEVEL_MAP[lvlMatch[1]] || 'B1';

        // Clean hanzi: remove parenthetical optional parts, take first variant
        let hanzi = traditional.replace(/\([^)]+\)/g, '').split('/')[0].trim();
        if (!hanzi) continue;

        // Clean pinyin: take first variant
        const cleanPinyin = (pinyin || '').split('/')[0].trim();

        const key = `${hanzi}|${level}`;
        if (!incomingMap.has(key)) {
          incomingMap.set(key, {
            id: `t-${rowId}`,
            hanzi,
            pinyin: cleanPinyin,
            indonesia: '',
            level,
            pos: (pos || '').trim(),
            source: 'TOCFL-202307',
          });
        }
      } catch (e) {
        // Skip malformed lines
      }
    }

    // Merge with existing (preserve Indonesian translations)
    const existing = await readTocfl(env);
    const existingMap = new Map(existing.map(e => [`${e.hanzi}|${e.level}`, e]));

    let added = 0, updated = 0;
    const finalEntries = [];

    for (const [key, inItem] of incomingMap.entries()) {
      const ex = existingMap.get(key);
      if (ex) {
        // Preserve existing Indonesian translation, update pinyin/pos if changed
        const changed = ex.pinyin !== inItem.pinyin || ex.level !== inItem.level;
        finalEntries.push({
          ...ex,
          pinyin: inItem.pinyin || ex.pinyin,
          level: inItem.level,
          pos: inItem.pos || ex.pos,
          source: inItem.source,
          updatedAt: changed ? Date.now() : ex.updatedAt,
        });
        if (changed) updated++;
      } else {
        finalEntries.push({ ...inItem, createdAt: Date.now() });
        added++;
      }
    }

    // Keep custom entries not from CSV
    for (const ex of existing) {
      const key = `${ex.hanzi}|${ex.level}`;
      if (!incomingMap.has(key) && ex.source !== 'TOCFL-202307') {
        finalEntries.push(ex);
      }
    }

    const trimmed = finalEntries.slice(0, MAX_TOCFL);
    await writeTocfl(env, trimmed);
    await env.KAMUS.put('tocfl:lastSync', String(Date.now()));

    // Compute stats
    const stats = {};
    for (const e of trimmed) {
      if (!stats[e.level]) stats[e.level] = { total: 0, translated: 0 };
      stats[e.level].total++;
      if (e.indonesia) stats[e.level].translated++;
    }

    return json({ added, updated, total: trimmed.length, stats, lastSync: Date.now() }, 200, cors);
  } catch (err) {
    return json({ error: 'sync_failed', detail: String(err) }, 500, cors);
  }
}

// POST /tocfl/upload — bulk upload pre-parsed TOCFL JSON (faster than sync)
async function handleTocflUpload(request, env, cors, mode) {
  if (mode !== 'admin') return json({ error: 'admin_only' }, 403, cors);

  const payload = await request.json().catch(() => null);
  const incoming = Array.isArray(payload?.entries) ? payload.entries : null;
  if (!incoming) return json({ error: 'missing_entries' }, 400, cors);

  const existing = await readTocfl(env);
  const existingMap = new Map(existing.map(e => [`${e.hanzi}|${e.level}`, e]));

  let added = 0, updated = 0;
  const finalEntries = [...existing];

  for (const raw of incoming) {
    if (!raw.hanzi || !raw.level) continue;
    const key = `${raw.hanzi}|${raw.level}`;
    const ex = existingMap.get(key);
    if (ex) {
      // Merge: only update if Indonesian translation provided or pinyin changed
      const idx = finalEntries.findIndex(e => e === ex);
      if (idx >= 0) {
        const changed = (raw.indonesia && raw.indonesia !== ex.indonesia) ||
                        (raw.pinyin && raw.pinyin !== ex.pinyin);
        if (changed) {
          finalEntries[idx] = {
            ...ex,
            pinyin: raw.pinyin || ex.pinyin,
            indonesia: raw.indonesia || ex.indonesia,
            contoh: raw.contoh || ex.contoh,
            pos: raw.pos || ex.pos,
            updatedAt: Date.now(),
          };
          updated++;
        }
      }
    } else {
      const entry = {
        id: raw.id || `t-${makeId()}`,
        hanzi: String(raw.hanzi).trim().slice(0, 50),
        pinyin: String(raw.pinyin || '').trim().slice(0, 100),
        indonesia: String(raw.indonesia || '').trim().slice(0, 200),
        contoh: String(raw.contoh || '').trim().slice(0, 500),
        level: raw.level,
        pos: String(raw.pos || '').trim().slice(0, 20),
        source: raw.source || 'upload',
        createdAt: Date.now(),
      };
      finalEntries.push(entry);
      existingMap.set(key, entry);
      added++;
    }
  }

  const trimmed = finalEntries.slice(0, MAX_TOCFL);
  await writeTocfl(env, trimmed);
  await env.KAMUS.put('tocfl:lastSync', String(Date.now()));

  const stats = {};
  for (const e of trimmed) {
    if (!stats[e.level]) stats[e.level] = { total: 0, translated: 0 };
    stats[e.level].total++;
    if (e.indonesia) stats[e.level].translated++;
  }

  return json({ added, updated, total: trimmed.length, stats }, 200, cors);
}

// PATCH /tocfl/:id — edit a TOCFL entry's Indonesian translation (admin only)
async function handleTocflEdit(request, env, cors, mode, id) {
  if (mode !== 'admin') return json({ error: 'admin_only' }, 403, cors);
  const patch = await request.json().catch(() => null);
  if (!patch) return json({ error: 'bad_json' }, 400, cors);

  const entries = await readTocfl(env);
  const idx = entries.findIndex(e => e.id === id);
  if (idx === -1) return json({ error: 'not_found' }, 404, cors);

  entries[idx] = {
    ...entries[idx],
    indonesia: patch.indonesia !== undefined ? String(patch.indonesia).trim().slice(0, 200) : entries[idx].indonesia,
    contoh: patch.contoh !== undefined ? String(patch.contoh).trim().slice(0, 500) : entries[idx].contoh,
    pinyin: patch.pinyin !== undefined ? String(patch.pinyin).trim().slice(0, 100) : entries[idx].pinyin,
    updatedAt: Date.now(),
  };
  await writeTocfl(env, entries);
  return json({ entry: entries[idx] }, 200, cors);
}

// GET /tocfl/stats
async function handleTocflStats(env, cors, mode) {
  if (mode !== 'admin') return json({ error: 'admin_only' }, 403, cors);
  const entries = await readTocfl(env);

  const stats = {};
  for (const e of entries) {
    if (!stats[e.level]) stats[e.level] = { total: 0, translated: 0 };
    stats[e.level].total++;
    if (e.indonesia) stats[e.level].translated++;
  }

  const lastSync = await env.KAMUS.get('tocfl:lastSync');
  return json({ stats, total: entries.length, lastSync }, 200, cors);
}

// ─── CSV Parser ──────────────────────────────────────────────
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
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
