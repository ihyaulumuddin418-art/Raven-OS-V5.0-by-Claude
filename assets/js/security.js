/* ============================================
   RAVEN OS v5.0 — SECURITY.JS
   Anti-Jailbreak & Sanitization Engine (THE SHIELD)
   ============================================ */

'use strict';

// ── BLACKLIST PATTERNS ──
// Kata/frasa yang menunjukkan prompt injection / jailbreak attempt
const INJECTION_PATTERNS = [
  // Prompt injection klasik
  /ignore\s+(previous|prior|all|above)\s+(instructions?|prompts?|rules?|context)/i,
  /forget\s+(everything|all|your|previous|prior)/i,
  /disregard\s+(your|all|previous|prior)/i,
  /override\s+(your|the|all)\s+(rules?|instructions?|system)/i,

  // System prompt extraction
  /system\s*prompt/i,
  /reveal\s+(your|the)\s+(prompt|instructions?|system|rules?)/i,
  /show\s+(me\s+)?(your|the)\s+(prompt|system|instructions?)/i,
  /print\s+(your|the)\s+(system|prompt|instructions?)/i,
  /what\s+(are|is)\s+(your|the)\s+(instructions?|system\s*prompt|rules?)/i,
  /repeat\s+(your|the)\s+(system|instructions?|prompt)/i,
  /display\s+(your|the)\s+(prompt|instructions?)/i,

  // Privilege escalation
  /sudo\b/i,
  /root\s*access/i,
  /admin\s*mode/i,
  /developer\s*mode/i,
  /god\s*mode/i,
  /jailbreak/i,
  /dan\s*mode/i,     // "Do Anything Now"
  /\bDAN\b/,

  // Bypass / unlock
  /bypass\s+(your|the|all|safety|filter|restriction)/i,
  /unlock\s+(your|the|hidden|true|real|full)/i,
  /unrestricted\s+mode/i,
  /no\s*filter\s*mode/i,
  /without\s+(restriction|filter|limit|rule)/i,
  /remove\s+(your\s+)?(restriction|filter|limit|safeguard)/i,

  // Persona manipulation
  /act\s+as\s+(if\s+you\s+(are|were)\s+)?(a\s+)?(different|another|new|evil|unrestricted|uncensored|free|unethical)/i,
  /pretend\s+(you\s+are|you're|to\s+be)\s+(a\s+)?(different|another|evil|unrestricted|uncensored|free)/i,
  /roleplay\s+as\s+(a\s+)?(different|another|evil|unrestricted|uncensored|hacker|villain)/i,
  /you\s+are\s+now\s+(a\s+)?(different|another|new|evil|unrestricted|uncensored|free)/i,
  /forget\s+(you\s+are|you're|being)\s+raven/i,
  /stop\s+being\s+raven/i,
  /you\s+are\s+not\s+raven/i,
  /your\s+(real|true|actual)\s+(self|identity|purpose|name)\s+is/i,

  // Encoding tricks
  /base64\s*(decode|encode|this)/i,
  /hex\s*(decode|encode)/i,
  /rot13/i,

  // Token smuggling / delimiter injection
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /<<SYS>>/i,
  /\[\/INST\]/i,

  // Harmful content requests (tambahan lapisan)
  /how\s+to\s+(make|create|build|synthesize)\s+(bomb|weapon|explosive|malware|virus|ransomware)/i,
  /step.+step.+(hack|crack|exploit)/i,
];

// ── REGEX: HTML/Script tags untuk XSS prevention ──
const XSS_PATTERNS = [
  /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
  /<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi,
  /<img[^>]+on\w+\s*=/gi,
  /<[^>]+on\w+\s*=\s*["'][^"']*["']/gi,
  /javascript\s*:/gi,
  /data\s*:\s*text\/html/gi,
  /vbscript\s*:/gi,
  /<object[\s\S]*?>/gi,
  /<embed[\s\S]*?>/gi,
  /<link[^>]*>/gi,
  /<meta[^>]*>/gi,
  /eval\s*\(/gi,
  /document\s*\.\s*(write|cookie|location)/gi,
  /window\s*\.\s*(location|open)/gi,
];

// ── RATE LIMIT (simple, in-memory) ──
const _rateLimitStore = { count: 0, resetAt: Date.now() + 60000 };
const MAX_MSG_PER_MIN = 20;

// ───────────────────────────────────────────
// SECURITY ENGINE
// ───────────────────────────────────────────

const SecurityEngine = {

  /**
   * Main check — panggil ini sebelum setiap request ke AI
   * Return: { safe: bool, reason?: string, sanitized?: string }
   */
  analyze(input) {
    if (typeof input !== 'string') {
      return { safe: false, reason: 'Input type tidak valid.' };
    }

    // 1. Cek panjang input
    if (input.trim().length === 0) {
      return { safe: false, reason: 'Input kosong.' };
    }

    if (input.length > 8000) {
      return { safe: false, reason: 'Input terlalu panjang (max 8000 karakter).' };
    }

    // 2. Rate limit
    const rl = this._checkRateLimit();
    if (!rl.ok) {
      return { safe: false, reason: rl.reason };
    }

    // 3. Prompt injection check
    const injectionResult = this._checkInjection(input);
    if (!injectionResult.safe) {
      return injectionResult;
    }

    // 4. XSS sanitization
    const sanitized = this._sanitizeXSS(input);

    // 5. Encode special HTML entities
    const cleaned = this._htmlEncode(sanitized);

    return { safe: true, sanitized: cleaned };
  },

  /** Cek prompt injection patterns */
  _checkInjection(input) {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        console.warn('[RAVEN SHIELD] Injection attempt blocked:', pattern.source.slice(0, 50));
        return {
          safe: false,
          reason: 'Input terdeteksi sebagai prompt injection / percobaan bypass. Request ditolak oleh Raven Shield.'
        };
      }
    }
    return { safe: true };
  },

  /** Strip XSS payloads dari input */
  _sanitizeXSS(input) {
    let clean = input;
    for (const pattern of XSS_PATTERNS) {
      clean = clean.replace(pattern, '[REMOVED]');
    }
    return clean;
  },

  /** Encode HTML entities berbahaya */
  _htmlEncode(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Jangan encode quotes — bisa rusak readability
      ;
  },

  /** Rate limiter sederhana */
  _checkRateLimit() {
    const now = Date.now();
    if (now > _rateLimitStore.resetAt) {
      _rateLimitStore.count = 0;
      _rateLimitStore.resetAt = now + 60000;
    }
    _rateLimitStore.count++;
    if (_rateLimitStore.count > MAX_MSG_PER_MIN) {
      return { ok: false, reason: `Rate limit: terlalu banyak pesan. Coba lagi dalam ${Math.ceil((_rateLimitStore.resetAt - now) / 1000)}s.` };
    }
    return { ok: true };
  },

  /**
   * Sanitasi output dari AI sebelum dirender ke DOM
   * (Mencegah jika AI secara tidak sengaja menghasilkan HTML berbahaya)
   */
  sanitizeOutput(text) {
    if (typeof text !== 'string') return '';
    // Hanya strip tag script/iframe berbahaya, biarkan markdown-style text
    return text
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, '')
      .replace(/javascript\s*:/gi, '');
  },

  /**
   * Validasi URL untuk URL scraper mode
   * Return: { valid: bool, url?: string, reason?: string }
   */
  validateURL(input) {
    try {
      const url = new URL(input.trim());

      // Hanya izinkan HTTP/HTTPS
      if (!['http:', 'https:'].includes(url.protocol)) {
        return { valid: false, reason: 'Hanya URL http/https yang diizinkan.' };
      }

      // Blokir localhost / internal network
      const hostname = url.hostname.toLowerCase();
      const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
      if (blocked.includes(hostname) || hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.')) {
        return { valid: false, reason: 'URL ke jaringan internal tidak diizinkan.' };
      }

      return { valid: true, url: url.href };
    } catch {
      return { valid: false, reason: 'Format URL tidak valid.' };
    }
  },

  /**
   * Validasi file yang di-upload
   * Return: { valid: bool, reason?: string }
   */
  validateFile(file) {
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    const ALLOWED_TYPES = [
      'text/plain', 'text/html', 'text/css', 'text/javascript',
      'application/json', 'application/xml', 'text/xml', 'text/csv',
      'text/markdown', 'application/javascript',
      'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    ];
    const ALLOWED_EXTENSIONS = [
      '.txt', '.html', '.htm', '.css', '.js', '.ts', '.json', '.xml',
      '.csv', '.md', '.py', '.java', '.c', '.cpp', '.php', '.rb',
      '.go', '.rs', '.sh', '.yaml', '.yml', '.toml', '.ini', '.env',
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
    ];

    if (!file) return { valid: false, reason: 'File tidak ditemukan.' };
    if (file.size > MAX_SIZE) return { valid: false, reason: 'File terlalu besar (max 5MB).' };

    const ext = '.' + file.name.split('.').pop().toLowerCase();
    const typeOk = ALLOWED_TYPES.includes(file.type) || file.type === '';
    const extOk  = ALLOWED_EXTENSIONS.includes(ext);

    if (!extOk) {
      return { valid: false, reason: `Ekstensi .${ext.replace('.', '')} tidak didukung.` };
    }

    return { valid: true };
  },
};

// Export global
window.SecurityEngine = SecurityEngine;
      
