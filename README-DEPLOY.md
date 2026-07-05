# Kamus Konstruksi — Panduan Setup & Deploy

Kamus Mandarin Taiwan ↔ Indonesia untuk pekerja magang konstruksi.
Single-file HTML, mobile-first, offline-first (LocalStorage).
**AI pakai Google Gemini free tier — 100% gratis, tanpa kartu kredit.**

---

## 🎯 Dua Mode Pakai

### Mode A — Pribadi (paling cepat, no deploy)

Kamu sendiri (atau tim kecil) yang pakai. Setiap orang punya API key gratis masing-masing.

```
   HP Kamu ──► index.html (buka lokal / di-share) ──► Gemini API
                                                     ↑ key di HP kamu
```

Setup: cukup **1 langkah**. Skip ke [🚀 Mode A: Setup 3 Menit](#-mode-a-setup-3-menit).

### Mode B — Share ke Teman (deploy Cloudflare)

Kamu deploy sekali, share URL, semua teman tinggal buka & pakai — tidak perlu bikin API key sendiri.

```
   HP Teman ──► kamus.pages.dev  ──► your-proxy.workers.dev ──► Gemini API
                (Cloudflare Pages)   (Cloudflare Worker)         ↑ key hanya di Worker
```

Setup: **5 langkah**, ~15 menit, semua gratis. Skip ke [🌐 Mode B: Deploy Share](#-mode-b-deploy-share-15-menit).

---

## 🚀 Mode A: Setup 3 Menit

### 1. Ambil API Key Gemini (GRATIS, no kartu kredit)

1. Buka **https://aistudio.google.com/apikey**
2. Login pakai akun Google kamu (Gmail apapun)
3. Klik **Create API Key** → pilih **Create API key in new project** (atau existing)
4. Copy key yang muncul: `AIzaSy...` (~40 karakter)

Limit gratis:
- **15 request/menit** — cukup, kamu tidak akan cari 15 kata dalam 1 menit
- **1500 request/hari** — cukup buat berbulan-bulan pakai
- **1 juta token/menit** — di luar batas normal

### 2. Buka Aplikasi

Ada 2 cara:

**Opsi 2a — Lokal:**
Double-click `index.html` (atau buka di browser HP setelah copy file).
✅ Kekurangan: susah share, harus copy file.
✅ Kelebihan: 100% offline setelah first load font.

**Opsi 2b — Static hosting gratis (recommended):**
Drag-drop `index.html` ke salah satu ini:
- **Netlify Drop**: https://app.netlify.com/drop (paling mudah)
- **Cloudflare Pages**: https://pages.cloudflare.com/ → Upload assets
- **GitHub Pages**: perlu account & repo

Semua kasih HTTPS + URL public gratis.

### 3. Isi Key di Settings

1. Buka app → tap ⚙️ kanan atas
2. **Endpoint**: kosongkan (default sudah Gemini)
3. **API Key**: paste `AIzaSy...`
4. Tutup drawer (tap area gelap kiri)
5. Ketik `鋼筋` → **Cari & Tambah** → tunggu draft muncul ✅

Selesai. Kalau share ke teman via URL: mereka juga perlu bikin API key sendiri.

---

## 🌐 Mode B: Deploy Share (15 Menit)

Semua teman pakai 1 API key (kamu), mereka cukup buka URL — no setup.

### 1. Ambil API Key Gemini

Sama seperti Mode A step 1.

### 2. Daftar Cloudflare (gratis)

https://dash.cloudflare.com/sign-up → daftar (gratis, tidak perlu kartu kredit).

### 3. Deploy Worker (proxy)

1. Sidebar **Workers & Pages** → **Create** → **Create Worker**
2. Kasih nama, misal `kamus-proxy` → **Deploy**
3. Setelah deploy, klik **Edit Code** → hapus template, **paste isi `worker.js`** → **Deploy**
4. Klik tab **Settings** → **Variables and Secrets** → **Add** untuk 3 variable:

   | Nama | Value | Type |
   |---|---|---|
   | `GEMINI_API_KEY` | `AIzaSy...` (dari step 1) | **Secret (Encrypted)** ⚠️ |
   | `SHARED_TOKEN` | bebas, misal `kamus-abcxyz-2026` (bikin random & panjang) | **Secret (Encrypted)** ⚠️ |
   | `ALLOWED_ORIGIN` | `*` (nanti diganti setelah step 4) | Plaintext |

5. Catat URL worker: `https://kamus-proxy.<username>.workers.dev`

> ⚠️ **Wajib "Encrypted"** untuk `GEMINI_API_KEY` & `SHARED_TOKEN`. Plaintext = bocor di log.

### 4. Deploy Frontend (index.html)

1. Sidebar → **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. Kasih nama project, misal `kamus`
3. Drag file `index.html` → **Deploy site**
4. Catat URL: `https://kamus.pages.dev` (atau `https://kamus-abc.pages.dev`)

Kembali ke Worker:
- **Settings → Variables** → ganti `ALLOWED_ORIGIN` dari `*` ke URL Pages di atas
- **Save and deploy**

### 5. Setup App di HP Kamu

1. Buka URL Pages di HP → tap ⚙️
2. **Endpoint**: URL worker kamu (contoh `https://kamus-proxy.username.workers.dev`)
3. **API Key**: `SHARED_TOKEN` yang kamu buat di step 3 (**bukan** `AIzaSy...`!)
4. Tutup drawer → coba cari `鋼筋` ✅

### 6. Share ke Teman

WhatsApp:
```
Kamus Konstruksi Mandarin ↔ Indo:
👉 https://kamus.pages.dev

Setup 30 detik:
1. Buka link, tap ⚙️ kanan atas
2. Endpoint: https://kamus-proxy.<username>.workers.dev
3. API Key: kamus-abcxyz-2026
4. Simpan.

Di HP: menu Chrome → "Add to Home Screen" biar kayak app.
```

Sebar `SHARED_TOKEN` hanya ke teman terpercaya. Kalau ada yang abuse (misal dijual), ganti token → yang abuse langsung terputus.

---

## 💰 Biaya Total

| Item | Biaya |
|---|---|
| Gemini API (free tier) | **Rp 0** (limit 1500 req/hari sudah lebih dari cukup) |
| Cloudflare Pages | **Rp 0** (bandwidth unlimited) |
| Cloudflare Workers | **Rp 0** (100rb request/hari gratis) |
| Domain | **Rp 0** (pakai `.pages.dev` bawaan) |
| **Total** | **Rp 0 / bulan, selamanya** |

Kalau nanti limit Gemini kena (kamu cari 1500+ kata sehari — tidak mungkin buat kamus 😄), tinggal bikin project Google baru & dapat 1500 lagi.

---

## 🛠 Update App

- **Ubah `index.html`** → drag ulang ke Cloudflare Pages, otomatis re-deploy dalam 30 detik. Teman langsung dapat versi baru saat refresh.
- **Ubah `worker.js`** → edit code di Cloudflare dashboard, deploy.
- **Ganti API key Gemini** (misal quota harian kena) → cukup ganti env var `GEMINI_API_KEY` di worker. Teman tidak perlu ubah apa-apa.
- **Rotate SHARED_TOKEN** kalau bocor → ganti di worker → broadcast token baru ke teman.

---

## 🔧 Troubleshooting

| Gejala | Fix |
|---|---|
| "API key belum diisi" waktu cari | Buka ⚙️, isi API Key, tutup drawer. |
| "HTTP 400 API_KEY_INVALID" | Key `AIzaSy...` salah/expired. Bikin baru di aistudio.google.com/apikey. |
| "HTTP 401 unauthorized" (Mode B) | Token yang kamu isi di app ≠ `SHARED_TOKEN` di worker. |
| "HTTP 429 RESOURCE_EXHAUSTED" | Quota harian Gemini kena (mustahil kecuali abuse). Tunggu reset jam 15:00 WIB atau bikin project baru. |
| "HTTP 500 server_misconfigured" | `GEMINI_API_KEY` belum di-set di worker. |
| CORS error di console | `ALLOWED_ORIGIN` di worker tidak match URL Pages. Pakai `*` dulu buat test. |
| AI response bukan JSON valid | Sudah dihandle — app tampilkan draft manual buat diisi tangan. Coba lagi biasanya sukses. |
| Data hilang setelah clear browser | Selalu backup rutin: ⚙️ → **⬇ Backup JSON** — simpan di WhatsApp/Drive. |

---

## 📁 Struktur File

```
Kamus Konstruksi/
├── index.html         ← app (yang di-deploy ke Pages / dibuka lokal)
├── worker.js          ← proxy Gemini (hanya untuk Mode B)
└── README-DEPLOY.md   ← file ini
```

---

## 🔒 Catatan Keamanan

- **Mode A**: API key `AIzaSy...` ada di LocalStorage HP kamu. Kalau HP dipinjam, orang lain bisa lihat via DevTools. Jangan share URL app + HP yang sama.
- **Mode B**: API key `AIzaSy...` **HANYA** ada di env var Worker (encrypted). Tidak pernah muncul di HP siapapun. `SHARED_TOKEN` mencegah orang random pakai kuota kamu.
- Data kamus 100% di HP masing-masing user (LocalStorage). Server tidak menyimpan apa-apa.
- Kalau HP hilang, data hilang. **Backup rutin ke JSON/CSV.**
