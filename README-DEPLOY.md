# Kamus Konstruksi — Deploy Guide

Kamus Mandarin Taiwan ↔ Indonesia untuk tim magang konstruksi.
Single-file HTML frontend + Cloudflare Worker backend + KV storage.
100% gratis, tanpa kartu kredit.

---

## 🎯 Arsitektur

```
   [HP Mukti]    ── admin token ──┐
   [HP Teman A]  ── team token  ──┤
   [HP Teman B]  ── team token  ──┼──► Cloudflare Worker  ──► KV (kamus bersama)
                                  │                          └► Gemini API (auto pinyin+arti)
   (Frontend di GitHub Pages)     │
```

**Peran:**
- **Frontend** (`index.html`) → GitHub Pages, HTTPS auto
- **Backend** (`worker.js`) → Cloudflare Worker, gratis 100k req/hari
- **Storage** → Cloudflare KV, gratis 100k reads + 1000 writes/hari
- **AI** → Google Gemini free tier (1500 req/hari)

**Auth model:**
- **`TEAM_TOKEN`** → dishare ke tim. Boleh: baca semua, tambah kata, pakai AI.
- **`ADMIN_TOKEN`** → hanya Mukti. Semua kemampuan team + edit + hapus + bulk import.

---

## 🚀 Setup (15 menit, 1× saja)

### 1. Ambil API key Gemini (gratis, no kartu kredit)

1. **https://aistudio.google.com/apikey** → login Google → **Create API key**
2. Copy: `AIzaSy...` (~40 char). Simpan aman.

Limit gratis: 1500 req/hari — jauuh dari kebutuhan (5 orang × 10 kata = 50/hari).

### 2. Buat akun Cloudflare

- **https://dash.cloudflare.com/sign-up** → daftar (gratis, no kartu kredit).

### 3. Buat KV Namespace

1. Dashboard → sidebar **Storage & Databases** → **KV** → **Create a namespace**
2. Nama: `kamus-data` → **Add**
3. Catat: nanti dipakai di step 4.

### 4. Deploy Worker

1. Sidebar → **Workers & Pages** → **Create** → **Create Worker**
2. Nama: `kamus-proxy` → **Deploy**
3. **Edit Code** → hapus template → paste isi `worker.js` → **Deploy**
4. **Settings** → **Variables and Secrets** → **Add**:

   | Nama | Value | Type |
   |---|---|---|
   | `GEMINI_API_KEY` | `AIzaSy...` (step 1) | **Secret** 🔒 |
   | `TEAM_TOKEN` | bebas, misal `team-kmz-2026-xyz` (random, panjang) | **Secret** 🔒 |
   | `ADMIN_TOKEN` | bebas, **beda** dari TEAM, misal `admin-mukti-abc` | **Secret** 🔒 |
   | `ALLOWED_ORIGIN` | `*` (dulu, nanti diganti di step 5) | Plaintext |

5. **Settings** → **Bindings** → **Add** → **KV Namespace**:
   - **Variable name**: `KAMUS` (persis, huruf kapital semua!)
   - **KV namespace**: pilih `kamus-data` (dari step 3)
   - **Save**

6. **Deploy** lagi supaya bindings aktif.
7. Catat Worker URL: `https://kamus-proxy.<username>.workers.dev`

> ⚠️ Wajib **Secret** untuk 3 token pertama. Plaintext = bocor di log.

### 5. Deploy Frontend

Frontend sudah live di GitHub Pages: `https://muktihadi5641-cpu.github.io/kamus-konstruksi/`

Kalau nanti kamu update `index.html`:
```bash
cd "c:\Claude\Project\Kamus Konstruksi"
git add index.html
git commit -m "update: <apa yang berubah>"
git push
```
Otomatis re-deploy dalam ~30 detik.

### 6. Tighten CORS

Balik ke Worker (step 4):
- **Settings → Variables** → ubah `ALLOWED_ORIGIN` dari `*` ke `https://muktihadi5641-cpu.github.io`
- **Deploy**

### 7. Setup App di HP Kamu (Mukti sebagai Admin)

1. Buka `https://muktihadi5641-cpu.github.io/kamus-konstruksi/` di HP
2. Tap ⚙️ (kanan atas) → isi:
   - **Worker URL**: URL dari step 4 (misal `https://kamus-proxy.username.workers.dev`)
   - **Token**: `ADMIN_TOKEN` (yang admin!)
   - **Nama Kamu**: `Mukti`
   - **Gemini API Key**: **KOSONGKAN** (key sudah di server)
3. Tutup drawer (tap area gelap kiri)
4. Kalau kamu punya kata di lokal, app tanya "Upload ke server?" → **Yes**
5. Header muncul badge `admin · sync` warna oranye ✅

### 8. Share ke Teman

WhatsApp:
```
Kamus Konstruksi tim kita:
👉 https://muktihadi5641-cpu.github.io/kamus-konstruksi/

Setup 30 detik:
1. Buka link, tap ⚙️ kanan atas
2. Worker URL: https://kamus-proxy.<username>.workers.dev
3. Token: team-kmz-2026-xyz
4. Nama: <nama kamu>
5. Simpan.

Chrome menu > "Add to Home Screen" biar kayak app.

Kamus otomatis sync — apa yang kamu tambah, semua orang lihat.
```

⚠️ **Jangan share `ADMIN_TOKEN`** — cuma buat kamu.

---

## 💰 Total Biaya

| Item | Free tier | Estimasi butuh |
|---|---|---|
| Gemini API | 1500 req/hari | ~50/hari |
| Cloudflare Worker | 100rb req/hari | ~500/hari |
| Cloudflare KV reads | 100rb/hari | ~500/hari |
| Cloudflare KV writes | 1000/hari | ~50/hari |
| GitHub Pages bandwidth | unlimited | — |
| **Total per bulan** | **Rp 0** | selamanya |

---

## 🛠 Operasi Sehari-hari

**Menambah kata (semua orang):**
1. Buka app → ketik hanzi → **Cari & Tambah**
2. Cek draft (pinyin + arti dari AI) → koreksi kalau perlu → **Simpan**
3. Semua HP tim otomatis dapat kata baru dalam <1 menit (sync tiap 60s, atau langsung saat buka app)

**Edit / hapus kata (Mukti only):**
- Tap ikon pensil/tempat sampah di kartu → confirm

**Update kode aplikasi (Mukti only):**
```bash
cd "c:\Claude\Project\Kamus Konstruksi"
# edit index.html
git add index.html && git commit -m "..." && git push
```

**Ganti API key Gemini (misal quota kena):**
- Cloudflare → Worker → Settings → Variables → edit `GEMINI_API_KEY` → Deploy
- Teman tidak perlu ubah apapun.

**Rotate TEAM_TOKEN (kalau bocor):**
- Cloudflare → Worker → Settings → Variables → edit `TEAM_TOKEN` → Deploy
- Broadcast token baru ke teman WA.

**Backup kamus:**
- Setiap minggu: buka app (admin) → ⚙️ → **⬇ Backup JSON** → simpan ke Drive/WA.

---

## 🔧 Troubleshooting

| Gejala | Fix |
|---|---|
| Badge merah `offline` | Cek Worker URL benar, cek internet, cek `ALLOWED_ORIGIN` di worker match domain frontend |
| "HTTP 401 unauthorized" | Token yang kamu isi ≠ `TEAM_TOKEN`/`ADMIN_TOKEN` di worker. Cek typo. |
| "HTTP 403 admin_only" waktu edit/hapus | Kamu login pakai `TEAM_TOKEN`. Perlu `ADMIN_TOKEN`. |
| "HTTP 500 KV_NOT_BOUND" | KV binding di worker belum diset. Ulangi step 5, pastikan variable name = `KAMUS` (huruf kapital). |
| "HTTP 500 server_misconfigured" | `GEMINI_API_KEY` belum di-set atau salah. |
| "HTTP 429 RESOURCE_EXHAUSTED" | Quota Gemini harian kena. Tunggu reset atau bikin key baru. |
| Kata muncul di HP-ku tapi ga di HP teman | Suruh teman refresh app / tunggu 60 detik / buka drawer setting tutup lagi (paksa re-sync) |
| Kata teman ga muncul di HP-ku | Cek badge sync: hijau = OK, offline = worker down. |

---

## 📁 Struktur

```
Kamus Konstruksi/
├── index.html          ← frontend (di GitHub Pages)
├── worker.js           ← backend (di Cloudflare Worker)
└── README-DEPLOY.md    ← file ini
```

---

## 🔒 Catatan Keamanan

- `GEMINI_API_KEY` **hanya** di env var Worker (encrypted). Tidak muncul di HP siapapun.
- `ADMIN_TOKEN` **hanya** di HP Mukti (LocalStorage).
- `TEAM_TOKEN` di HP semua tim (LocalStorage). Kalau HP teman dipinjam, token bisa dilihat via DevTools — anggap bocor. Fix: rotate.
- Data kamus di Cloudflare KV — Cloudflare bisa akses secara teknis, tapi tidak akan (Terms of Service). Sensitif? Enkripsi client-side sebelum kirim. Buat kamus istilah konstruksi = tidak perlu.
- Kalau semua HP hilang + KV wiped: data hilang. **Backup JSON rutin.**
