/* ============================================
   RAVEN OS v5.0 — FEATURES.JS
   File Reader & URL Scraper (via AllOrigins Proxy)
   ============================================ */

'use strict';

// ── AllOrigins proxy untuk bypass CORS ──
const ALLORIGINS_URL = 'https://api.allorigins.win/get?url=';

// ───────────────────────────────────────────
// FILE READER MODULE
// ───────────────────────────────────────────

const FileModule = {

  _currentFile: null,
  _currentContent: null,
  _currentIsImage: false,

  /** Reset state file */
  clear() {
    this._currentFile = null;
    this._currentContent = null;
    this._currentIsImage = false;
  },

  /** Return true jika ada file aktif */
  hasFile() { return this._currentContent !== null; },

  /** Return true jika file aktif adalah image */
  isImage() { return this._currentIsImage; },

  /** Return nama file aktif */
  getFileName() { return this._currentFile ? this._currentFile.name : null; },

  /** Return konten file aktif (base64 jika image, string jika teks) */
  getContent() { return this._currentContent; },

  /**
   * Baca file dari input element
   * @param {File} file
   * @returns {Promise<{ok, content, isImage, fileName, mimeType, reason?}>}
   */
  readFile(file) {
    return new Promise((resolve) => {
      // Validasi via SecurityEngine
      const validation = window.SecurityEngine.validateFile(file);
      if (!validation.valid) {
        resolve({ ok: false, reason: validation.reason });
        return;
      }

      const isImage = file.type.startsWith('image/');
      const reader  = new FileReader();

      reader.onerror = () => resolve({ ok: false, reason: 'Gagal membaca file.' });

      if (isImage) {
        reader.onload = (e) => {
          this._currentFile     = file;
          this._currentContent  = e.target.result; // base64 data URL
          this._currentIsImage  = true;
          resolve({
            ok: true,
            content: e.target.result,
            isImage: true,
            fileName: file.name,
            mimeType: file.type,
          });
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = (e) => {
          const text = e.target.result;
          this._currentFile     = file;
          this._currentContent  = text;
          this._currentIsImage  = false;
          resolve({
            ok: true,
            content: text,
            isImage: false,
            fileName: file.name,
            mimeType: file.type || 'text/plain',
          });
        };
        reader.readAsText(file, 'UTF-8');
      }
    });
  },

  /**
   * Format konten file untuk dimasukkan ke prompt AI
   * @param {string} userMessage - pesan user
   * @returns {string} prompt yang sudah include file context
   */
  buildPromptWithFile(userMessage) {
    if (!this.hasFile()) return userMessage;

    if (this.isImage()) {
      // Image akan dikirim sebagai inline_data, bukan teks
      return userMessage;
    }

    const content = this.getContent();
    const name    = this.getFileName();
    const ext     = name.split('.').pop().toLowerCase();

    // Truncate jika terlalu panjang (max 6000 char dari file)
    const truncated = content.length > 6000
      ? content.slice(0, 6000) + '\n\n[... konten dipotong karena terlalu panjang ...]'
      : content;

    return `User mengirimkan file: **${name}**

\`\`\`${ext}
${truncated}
\`\`\`

Pesan user: ${userMessage}`;
  },

  /**
   * Build parts array untuk Gemini API (support inline image)
   * @param {string} promptText
   * @returns {Array} parts array
   */
  buildGeminiParts(promptText) {
    const parts = [];

    if (this.hasFile() && this.isImage()) {
      // Ambil raw base64 (tanpa prefix data:mime;base64,)
      const dataUrl = this.getContent();
      const mimeMatch = dataUrl.match(/^data:([^;]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      const base64 = dataUrl.split(',')[1];

      parts.push({
        inline_data: { mime_type: mimeType, data: base64 }
      });
      parts.push({ text: promptText || 'Apa yang ada di gambar ini?' });
    } else {
      parts.push({ text: promptText });
    }

    return parts;
  },
};

// ───────────────────────────────────────────
// URL SCRAPER MODULE
// ───────────────────────────────────────────

const URLModule = {

  _isActive: false,

  isActive() { return this._isActive; },
  setActive(val) { this._isActive = !!val; },
  toggle() { this._isActive = !this._isActive; return this._isActive; },

  /**
   * Ekstrak URL dari teks user jika ada
   * Return URL pertama yang ditemukan, atau null
   */
  extractURL(text) {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
    const matches = text.match(urlRegex);
    return matches ? matches[0] : null;
  },

  /**
   * Fetch konten dari URL via AllOrigins proxy
   * @param {string} url
   * @returns {Promise<{ok, content, title?, reason?}>}
   */
  async fetchURL(url) {
    // Validasi URL
    const validation = window.SecurityEngine.validateURL(url);
    if (!validation.valid) {
      return { ok: false, reason: validation.reason };
    }

    try {
      const proxyUrl = ALLORIGINS_URL + encodeURIComponent(url);
      const response = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(15000), // 15 detik timeout
      });

      if (!response.ok) {
        return { ok: false, reason: `Server proxy mengembalikan error: ${response.status}` };
      }

      const data = await response.json();

      if (!data || !data.contents) {
        return { ok: false, reason: 'Konten URL tidak bisa diambil. Mungkin situs memblokir akses.' };
      }

      // Parse HTML untuk ambil teks bersih
      const parsed = this._parseHTML(data.contents);

      return {
        ok: true,
        content: parsed.text,
        title: parsed.title,
        url: url,
      };

    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        return { ok: false, reason: 'Timeout: URL tidak merespons dalam 15 detik.' };
      }
      return { ok: false, reason: `Gagal fetch URL: ${err.message}` };
    }
  },

  /**
   * Parse HTML string → { text, title }
   * Menggunakan DOMParser untuk ekstrak teks bersih
   */
  _parseHTML(html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Ambil title
      const title = doc.title || '';

      // Hapus elemen yang tidak relevan
      const toRemove = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'iframe', 'noscript'];
      toRemove.forEach(tag => {
        doc.querySelectorAll(tag).forEach(el => el.remove());
      });

      // Ambil teks dari body
      let text = doc.body ? doc.body.innerText || doc.body.textContent : '';

      // Bersihkan whitespace berlebihan
      text = text.replace(/\n{3,}/g, '\n\n').replace(/\s{3,}/g, ' ').trim();

      // Truncate jika terlalu panjang
      if (text.length > 6000) {
        text = text.slice(0, 6000) + '\n\n[... konten dipotong ...]';
      }

      return { text, title };
    } catch {
      // Fallback: strip semua HTML tags manual
      const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
      return { text, title: '' };
    }
  },

  /**
   * Build prompt yang include konten URL
   */
  buildPromptWithURL(userMessage, urlContent, urlTitle, url) {
    return `User meminta informasi dari URL: ${url}
Judul halaman: ${urlTitle || 'Tidak ada judul'}

Konten halaman:
---
${urlContent}
---

Pertanyaan user: ${userMessage}

Berikan jawaban berdasarkan konten halaman tersebut.`;
  },
};

// ───────────────────────────────────────────
// HISTORY MODULE (per-user localStorage)
// ───────────────────────────────────────────

const HistoryModule = {

  _key: null,
  _messages: [],

  /** Init dengan username dari session */
  init(username) {
    this._key = `${window.HISTORY_KEY}_${username}`;
    this._load();
  },

  _load() {
    try {
      const raw = localStorage.getItem(this._key);
      this._messages = raw ? JSON.parse(raw) : [];
    } catch {
      this._messages = [];
    }
  },

  _save() {
    try {
      // Simpan max 100 messages terakhir
      if (this._messages.length > 100) {
        this._messages = this._messages.slice(-100);
      }
      localStorage.setItem(this._key, JSON.stringify(this._messages));
    } catch (e) {
      console.warn('[RAVEN] Gagal simpan history:', e.message);
    }
  },

  /** Tambah message ke history */
  add(role, content, meta = {}) {
    this._messages.push({
      role,
      content,
      timestamp: Date.now(),
      ...meta,
    });
    this._save();
  },

  /** Return semua messages */
  getAll() { return [...this._messages]; },

  /** Return messages dalam format Gemini API */
  getForAPI() {
    return this._messages
      .filter(m => m.role === 'user' || m.role === 'model')
      .slice(-20) // max 20 turn terakhir untuk context window
      .map(m => ({ role: m.role, parts: [{ text: m.content }] }));
  },

  /** Hapus semua history */
  clear() {
    this._messages = [];
    this._save();
  },

  /** Return jumlah messages */
  count() { return this._messages.length; },
};

// Export global
window.FileModule    = FileModule;
window.URLModule     = URLModule;
window.HistoryModule = HistoryModule;
                
