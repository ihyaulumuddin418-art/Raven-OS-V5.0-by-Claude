/* ============================================
   RAVEN OS v5.0 — AUTH.JS
   Login Logic & Page Protection (Security Guard)
   ============================================ */

'use strict';

// ── STATIC USER DATABASE (simulasi) ──
// Ganti / tambah user di sini
const RAVEN_USERS = [
  { username: 'din',    password: 'raven2025', displayName: 'Din' },
  { username: 'admin',  password: 'admin123',  displayName: 'Admin' },
  { username: 'guest',  password: 'guest',     displayName: 'Guest' },
];

// ── SESSION KEYS ──
const SESSION_KEY   = 'raven_session';
const HISTORY_KEY   = 'raven_history';
const ATTEMPT_KEY   = 'raven_attempts';
const LOCKOUT_KEY   = 'raven_lockout';

// ── LOCKOUT CONFIG ──
const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 30 * 1000; // 30 detik

// ───────────────────────────────────────────
// AUTH UTILITIES
// ───────────────────────────────────────────

const Auth = {

  /** Cek apakah user sedang login */
  isLoggedIn() {
    const session = sessionStorage.getItem(SESSION_KEY);
    if (!session) return false;
    try {
      const s = JSON.parse(session);
      // Token harus ada dan belum expire (24 jam)
      return s.token && s.username && (Date.now() - s.issuedAt < 86400000);
    } catch {
      return false;
    }
  },

  /** Ambil data session saat ini */
  getSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); }
    catch { return null; }
  },

  /** Buat token sederhana (bukan kriptografi, hanya untuk simulasi) */
  _generateToken(username) {
    const raw = username + Date.now() + Math.random();
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash) + raw.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36) + Date.now().toString(36);
  },

  /** Login — return { ok, message, displayName? } */
  login(username, password) {
    username = (username || '').trim().toLowerCase();
    password = (password || '').trim();

    // Cek lockout
    const lockout = this._getLockout();
    if (lockout) {
      const remaining = Math.ceil((lockout - Date.now()) / 1000);
      return { ok: false, message: `Too many attempts. Wait ${remaining}s.` };
    }

    // Validasi input dasar
    if (!username || !password) {
      return { ok: false, message: 'Username dan password wajib diisi.' };
    }

    // Sanitasi input (no injection)
    if (/[<>"'&;]/.test(username) || /[<>"'&;]/.test(password)) {
      return { ok: false, message: 'Input mengandung karakter tidak valid.' };
    }

    // Cari user
    const user = RAVEN_USERS.find(
      u => u.username === username && u.password === password
    );

    if (!user) {
      this._recordFailedAttempt();
      const attempts = this._getAttempts();
      const remaining = MAX_ATTEMPTS - attempts;
      return {
        ok: false,
        message: remaining > 0
          ? `Kredensial salah. ${remaining} percobaan tersisa.`
          : 'Terlalu banyak percobaan. Akun terkunci sementara.'
      };
    }

    // Sukses — buat sesi
    this._clearAttempts();
    const session = {
      username: user.username,
      displayName: user.displayName,
      token: this._generateToken(user.username),
      issuedAt: Date.now(),
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));

    return { ok: true, displayName: user.displayName };
  },

  /** Logout — hapus sesi */
  logout() {
    sessionStorage.removeItem(SESSION_KEY);
    // History tetap tersimpan agar bisa di-restore saat login lagi
  },

  /** Hard logout — hapus semua data user */
  hardLogout() {
    const session = this.getSession();
    if (session) {
      localStorage.removeItem(`${HISTORY_KEY}_${session.username}`);
    }
    sessionStorage.removeItem(SESSION_KEY);
  },

  // ── LOCKOUT HELPERS ──

  _getAttempts() {
    return parseInt(localStorage.getItem(ATTEMPT_KEY) || '0', 10);
  },

  _recordFailedAttempt() {
    let attempts = this._getAttempts() + 1;
    localStorage.setItem(ATTEMPT_KEY, attempts);
    if (attempts >= MAX_ATTEMPTS) {
      localStorage.setItem(LOCKOUT_KEY, Date.now() + LOCKOUT_MS);
    }
  },

  _getLockout() {
    const lockout = parseInt(localStorage.getItem(LOCKOUT_KEY) || '0', 10);
    if (lockout && Date.now() < lockout) return lockout;
    if (lockout) {
      localStorage.removeItem(LOCKOUT_KEY);
      this._clearAttempts();
    }
    return null;
  },

  _clearAttempts() {
    localStorage.removeItem(ATTEMPT_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
  },
};

// ───────────────────────────────────────────
// PAGE GUARDS
// ───────────────────────────────────────────

/** Panggil di index.html — redirect ke login jika belum auth */
function guardDashboard() {
  if (!Auth.isLoggedIn()) {
    window.location.replace('login.html');
  }
}

/** Panggil di login.html — redirect ke dashboard jika sudah auth */
function guardLogin() {
  if (Auth.isLoggedIn()) {
    window.location.replace('index.html');
  }
}

// ───────────────────────────────────────────
// LOGIN PAGE CONTROLLER
// ───────────────────────────────────────────

function initLoginPage() {
  guardLogin();

  const form       = document.getElementById('login-form');
  const usernameEl = document.getElementById('username');
  const passwordEl = document.getElementById('password');
  const errorEl    = document.getElementById('login-error');
  const btnEl      = document.getElementById('login-btn');
  const btnText    = document.getElementById('btn-text');

  if (!form) return;

  // Cek lockout saat halaman dibuka
  const lockout = Auth._getLockout();
  if (lockout) {
    showError(`Terkunci. Coba lagi dalam ${Math.ceil((lockout - Date.now()) / 1000)} detik.`);
    btnEl.disabled = true;
    const interval = setInterval(() => {
      const remaining = Auth._getLockout();
      if (!remaining) {
        clearInterval(interval);
        btnEl.disabled = false;
        hideError();
      } else {
        showError(`Terkunci. Coba lagi dalam ${Math.ceil((remaining - Date.now()) / 1000)} detik.`);
      }
    }, 1000);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleLogin();
  });

  // Enter key support
  [usernameEl, passwordEl].forEach(el => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); handleLogin(); }
    });
  });

  function handleLogin() {
    if (btnEl.disabled) return;

    const username = usernameEl.value;
    const password = passwordEl.value;

    // Loading state
    btnEl.disabled = true;
    btnText.textContent = 'Authenticating...';

    // Simulasi network delay
    setTimeout(() => {
      const result = Auth.login(username, password);

      if (result.ok) {
        btnText.textContent = '✓ Access Granted';
        btnEl.style.background = 'linear-gradient(135deg, #059669, #047857)';
        setTimeout(() => {
          window.location.replace('index.html');
        }, 600);
      } else {
        showError(result.message);
        btnEl.disabled = false;
        btnText.textContent = 'Enter Raven OS';
        passwordEl.value = '';
        passwordEl.focus();

        // Re-enable saat lockout berakhir
        const lock = Auth._getLockout();
        if (lock) {
          const interval = setInterval(() => {
            if (!Auth._getLockout()) {
              clearInterval(interval);
              btnEl.disabled = false;
              hideError();
            }
          }, 1000);
        }
      }
    }, 500);
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.add('show');
  }

  function hideError() {
    errorEl.classList.remove('show');
  }
}

// ───────────────────────────────────────────
// LOGOUT HANDLER (dipanggil dari index.html)
// ───────────────────────────────────────────

function handleLogout(hard = false) {
  if (hard) Auth.hardLogout();
  else Auth.logout();
  window.location.replace('login.html');
}

// Auto-export ke global scope
window.Auth         = Auth;
window.guardDashboard = guardDashboard;
window.guardLogin     = guardLogin;
window.initLoginPage  = initLoginPage;
window.handleLogout   = handleLogout;
window.SESSION_KEY    = SESSION_KEY;
window.HISTORY_KEY    = HISTORY_KEY;
      
