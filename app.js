/* ============================================================
   DeepFace Watchlist — shared core
   Storage, auth, nav, API bridge, toasts, modals
   ============================================================ */

const DF = (() => {
  const KEYS = {
    accounts: 'df_accounts',
    settings: 'df_settings',
    logs: 'df_logs',
    session: 'df_session',
  };

  // Only user preferences live here. Model, detector, metric and threshold come from the server.
  const DEFAULT_SETTINGS = { frameSkip: 3 };

  /* ---------- helpers ---------- */
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast('Storage full — try fewer / smaller photos', 'danger'); return false; }
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = (sec % 60).toFixed(2).padStart(5, '0');
    return `${String(m).padStart(2, '0')}:${s}`;
  }
  function fmtDate(ts) {
    return new Date(ts).toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // Remove data left over from the old demo version (fake people, built-in demo accounts)
  localStorage.removeItem('df_persons');
  localStorage.removeItem('df_samples_removed');
  const accs = read(KEYS.accounts, []);
  const clean = accs.filter(a => !((a.username === 'admin' && a.password === 'admin123') || (a.username === 'user' && a.password === 'user123')));
  if (clean.length !== accs.length) write(KEYS.accounts, clean);

  /* ---------- data stores ---------- */
  const store = {
    accounts: () => read(KEYS.accounts, []),
    saveAccounts: a => write(KEYS.accounts, a),
    settings: () => ({ ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }),
    saveSettings: s => write(KEYS.settings, s),
    logs: () => read(KEYS.logs, []),
    addLog(entry) {
      const logs = read(KEYS.logs, []);
      logs.unshift({ ts: Date.now(), ...entry });
      write(KEYS.logs, logs.slice(0, 300));
    },
    clearLogs: () => write(KEYS.logs, []),
  };

  /* ---------- auth ---------- */
  const auth = {
    current: () => { try { return JSON.parse(sessionStorage.getItem(KEYS.session)); } catch { return null; } },
    needsSetup: () => store.accounts().length === 0,
    /** First run: create the first admin account (only allowed while there are no accounts). */
    setup(username, password) {
      if (!auth.needsSetup()) return { ok: false, msg: 'An account already exists' };
      username = username.trim();
      if (!username) return { ok: false, msg: 'Enter a username' };
      if (password.length < 6) return { ok: false, msg: 'Password must be at least 6 characters' };
      store.saveAccounts([{ username, password, role: 'admin', created: Date.now() }]);
      store.addLog({ type: 'admin', msg: `first admin account created: ${username}` });
      return auth.login(username, password, 'admin');
    },
    login(username, password, role) {
      const acc = store.accounts().find(a => a.username.toLowerCase() === username.trim().toLowerCase() && a.password === password);
      if (!acc) return { ok: false, msg: 'Wrong username or password' };
      if (role === 'admin' && acc.role !== 'admin') return { ok: false, msg: 'This account has no admin access' };
      const session = { username: acc.username, role: acc.role, at: Date.now() };
      sessionStorage.setItem(KEYS.session, JSON.stringify(session));
      store.addLog({ type: 'auth', msg: `${acc.username} logged in (${acc.role})` });
      return { ok: true, session };
    },
    logout() {
      const s = auth.current();
      if (s) store.addLog({ type: 'auth', msg: `${s.username} logged out` });
      sessionStorage.removeItem(KEYS.session);
      location.href = 'index.html';
    },
    /** Redirect to login if not allowed. level: 'user' | 'admin' */
    guard(level) {
      const s = auth.current();
      const ok = s && (level === 'user' || s.role === 'admin');
      if (!ok) {
        const next = encodeURIComponent(location.pathname.split('/').pop());
        location.replace(`index.html?next=${next}${level === 'admin' ? '&need=admin' : ''}`);
        throw new Error('redirecting');
      }
      return s;
    },
  };

  /* ---------- API (your Python server) ----------
     window.DF_API_BASE is set by server.py through /js/config.js, so the site
     talks to whichever server served it. There is no simulated fallback: if the
     page isn't opened from server.py, the API calls fail with a clear message.
  ---------------------------------------------------------- */
  const OFFLINE_MSG = 'Server not running — start it with "python server.py" and open http://localhost:8000';
  async function call(method, path, body) {
    if (!api.live()) throw new Error(OFFLINE_MSG);
    let r;
    try { r = await fetch(api.base() + path, { method, body }); }
    catch { throw new Error(OFFLINE_MSG); }
    if (!r.ok) {
      let detail = `${r.status} ${r.statusText}`;
      try { detail = (await r.json()).detail || detail; } catch {}
      throw new Error(detail);
    }
    return r.json().catch(() => ({}));
  }
  const api = {
    base: () => (window.DF_API_BASE || '').replace(/\/$/, ''),
    live: () => !!window.DF_API_BASE,
    get: path => call('GET', path),
    post: (path, formData) => call('POST', path, formData || new FormData()),
    del: path => call('DELETE', path),
    /** Server settings: { model, detector, metric, threshold, people } */
    info: () => call('GET', '/api/health'),
    /** Registered people, straight from the server's watchlist. */
    async persons() {
      const list = await call('GET', '/persons');
      return list.map(p => ({
        id: p.name, name: p.name, idNumber: p.id_number || '', status: p.status,
        photos: (p.photos || []).map(u => api.base() + u),
        photoCount: (p.photos || []).length, vectors: p.vectors,
      }));
    },
  };

  /* ---------- UI: nav ---------- */
  function renderNav(active) {
    const s = auth.current();
    const links = [
      { href: 'inference.html',  key: 'inference',  label: 'Inference',   icon: '📹', show: true },
      { href: 'register.html',   key: 'register',   label: 'Register',    icon: '👤', show: !!s },
      { href: 'deregister.html', key: 'deregister', label: 'De-register', icon: '🗑️', show: !!s },
      { href: 'admin.html',      key: 'admin',      label: 'Admin',       icon: '⚙️', show: s?.role === 'admin' },
    ];
    const el = document.getElementById('nav');
    if (!el) return;
    el.innerHTML = `
      <a class="brand" href="${s ? 'register.html' : 'index.html'}">
        <span class="brand-mark">🛡️</span>
        <span class="brand-text">DEEPFACE<b>WATCHLIST</b></span>
      </a>
      <button class="nav-burger" aria-label="Menu" onclick="document.body.classList.toggle('nav-open')">☰</button>
      <div class="nav-links">
        ${links.filter(l => l.show).map(l =>
          `<a href="${l.href}" class="${l.key === active ? 'active' : ''}"><span>${l.icon}</span>${l.label}</a>`).join('')}
      </div>
      <div class="nav-user">
        <span class="mode-pill ${api.live() ? 'live' : ''}" title="${api.live() ? 'Connected to ' + esc(api.base()) : esc(OFFLINE_MSG)}">
          ${api.live() ? '● SERVER' : '● SERVER OFFLINE'}
        </span>
        ${s
          ? `<span class="who"><b>${esc(s.username)}</b><small>${s.role}</small></span>
             <button class="btn btn-ghost btn-sm" onclick="DF.auth.logout()">Log out</button>`
          : `<a class="btn btn-primary btn-sm" href="index.html">Log in</a>`}
      </div>`;
  }

  /* ---------- UI: toast ---------- */
  function toast(msg, kind = 'info', ms = 3200) {
    let wrap = document.getElementById('toasts');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toasts'; document.body.appendChild(wrap); }
    const t = document.createElement('div');
    t.className = `toast toast-${kind}`;
    t.innerHTML = esc(msg);
    wrap.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
  }

  /* ---------- UI: confirm modal (no browser dialogs) ---------- */
  function confirmBox({ title, body, confirmText = 'Confirm', danger = false }) {
    return new Promise(resolve => {
      const m = document.createElement('div');
      m.className = 'modal-back';
      m.innerHTML = `
        <div class="modal ${danger ? 'modal-danger' : ''}">
          <h3>${esc(title)}</h3>
          <p>${body}</p>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-v="0">Cancel</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-v="1">${esc(confirmText)}</button>
          </div>
        </div>`;
      m.addEventListener('click', e => {
        const v = e.target.dataset?.v;
        if (v !== undefined || e.target === m) { m.remove(); resolve(v === '1'); }
      });
      document.body.appendChild(m);
    });
  }

  /* ---------- image helpers ---------- */
  function fileToThumb(file, max = 160) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = img.width * sc; c.height = img.height * sc;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        res(c.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  function canvasThumb(source, max = 160) {
    const w = source.videoWidth || source.width, h = source.videoHeight || source.height;
    const sc = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = w * sc; c.height = h * sc;
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
  }

  function avatar(p) {
    if (p.photos?.length) return `<img class="avatar" src="${p.photos[0]}" alt="">`;
    return `<span class="avatar avatar-init ${p.status === 'Blacklisted' ? 'bl' : ''}">${esc(p.name.slice(0, 2).toUpperCase())}</span>`;
  }
  function statusTag(status) {
    const cls = status === 'Blacklisted' ? 'tag-bl' : status === 'Authorised' ? 'tag-ok' : 'tag-unk';
    const dot = status === 'Blacklisted' ? '🔴' : status === 'Authorised' ? '🟢' : '⚪';
    return `<span class="tag ${cls}">${dot} ${esc(status)}</span>`;
  }

  return { store, auth, api, renderNav, toast, confirmBox, fileToThumb, canvasThumb, avatar, statusTag, esc, uid, fmtTime, fmtDate };
})();
