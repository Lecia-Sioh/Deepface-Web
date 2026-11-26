const me = DF.auth.guard('admin');
DF.renderNav('admin');

const $ = id => document.getElementById(id);
let persons = [];   // registered people, loaded from the server
async function loadPersons() {
  try { persons = await DF.api.persons(); }
  catch (e) { persons = []; DF.toast(e.message, 'danger', 6000); }
  renderAll();
}
const log = (msg) => DF.store.addLog({ type: 'admin', msg: `${me.username}: ${msg}` });

/* ---------- tabs ---------- */
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  $('tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('on', p.id === 't-' + b.dataset.t));
  renderAll();
});

/* ---------- stats + overview ---------- */
function renderStats() {
  const p = persons, logs = DF.store.logs();
  const bl = p.filter(x => x.status === 'Blacklisted').length;
  const vec = p.reduce((s, x) => s + x.vectors, 0);
  const dayAgo = Date.now() - 86400000;
  const alerts24 = logs.filter(l => l.type === 'alert' && l.ts > dayAgo).length;
  const stats = [
    { k: 'Registered', v: p.length, s: 'persons on watchlist' },
    { k: 'Blacklisted', v: bl, s: `${p.length - bl} authorised`, c: 'var(--red)' },
    { k: 'Embeddings', v: vec, s: 'vectors stored', c: 'var(--green)' },
    { k: 'Alerts · 24h', v: alerts24, s: 'blacklist detections', c: 'var(--amber)' },
  ];
  $('stats').innerHTML = stats.map(s => `<div class="stat" style="${s.c ? '--c:' + s.c : ''}"><div class="k">${s.k}</div><div class="v">${s.v}</div><div class="s">${s.s}</div></div>`).join('');

  const max = Math.max(1, p.length);
  $('breakdown').innerHTML = [['Authorised', p.length - bl, 'var(--green)'], ['Blacklisted', bl, 'var(--red)']]
    .map(([k, v, c]) => `<div class="bar-row" style="--c:${c}"><span>${k}</span><div class="b"><i style="width:${(v / max) * 100}%"></i></div><span>${v}</span></div>`).join('');

  const maxV = Math.max(1, ...p.map(x => x.vectors));
  $('vecChart').innerHTML = p.length ? [...p].sort((a, b) => b.vectors - a.vectors).slice(0, 8)
    .map(x => `<div class="bar-row" style="--c:${x.status === 'Blacklisted' ? 'var(--red)' : 'var(--accent)'}"><span>${DF.esc(x.name)}</span><div class="b"><i style="width:${(x.vectors / maxV) * 100}%"></i></div><span>${x.vectors}</span></div>`).join('')
    : '<div class="muted">No data</div>';

  const alerts = logs.filter(l => l.type === 'alert').slice(0, 12);
  $('recentAlerts').innerHTML = alerts.length ? alerts.map(logRow).join('') : '<div class="empty" style="display:block">No alerts yet — run the Inference page</div>';
}

function logRow(l) {
  return `<div class="t-${l.type}"><time>${DF.fmtDate(l.ts)}</time><span>${l.type.toUpperCase()}</span><span>${DF.esc(l.msg)}</span></div>`;
}

/* ---------- watchlist ---------- */
function renderWatchlist() {
  const p = persons;
  $('wlRows').innerHTML = p.length ? p.map(x => `
    <tr>
      <td><div class="person-cell">${DF.avatar(x)}${DF.esc(x.name)}</div></td>
      <td class="mono">${DF.esc(x.idNumber) || '<span class="muted">—</span>'}</td>
      <td>${DF.statusTag(x.status)}</td>
      <td class="mono">${x.photoCount}</td>
      <td class="mono">${x.vectors}</td>
      <td><div class="row">
        <button class="btn btn-ghost btn-sm" data-flip="${x.id}">${x.status === 'Blacklisted' ? '→ Authorise' : '→ Blacklist'}</button>
        <button class="btn btn-danger btn-sm" data-del="${x.id}">Remove</button>
      </div></td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">No persons registered</td></tr>';
}
$('wlRows').addEventListener('click', async e => {
  const flip = e.target.dataset.flip, del = e.target.dataset.del;
  if (flip) {
    const p = persons.find(x => x.id === flip);
    const status = p.status === 'Blacklisted' ? 'Authorised' : 'Blacklisted';
    const fd = new FormData(); fd.append('status', status);
    try { await DF.api.post('/persons/' + encodeURIComponent(p.name) + '/status', fd); }
    catch (err) { return DF.toast('Server error: ' + err.message, 'danger'); }
    log(`set ${p.name} → ${status}`);
    DF.toast(`${p.name} is now ${status}`, status === 'Blacklisted' ? 'danger' : 'success');
    await loadPersons();
  }
  if (del) {
    const p = persons.find(x => x.id === del);
    if (!await DF.confirmBox({ title: `Remove ${p.name}?`, body: `All ${p.vectors} vectors will be deleted.`, confirmText: 'Remove', danger: true })) return;
    try { await DF.api.del('/persons/' + encodeURIComponent(p.name)); }
    catch (err) { return DF.toast('Server error: ' + err.message, 'danger'); }
    log(`removed ${p.name}`);
    DF.toast(`${p.name} removed`, 'success'); await loadPersons();
  }
});

/* ---------- accounts ---------- */
let newRole = 'user';
$('aRole').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  newRole = b.dataset.v; $('aRole').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
});
function renderAccounts() {
  const a = DF.store.accounts();
  $('accRows').innerHTML = a.map(x => `
    <tr>
      <td><b>${DF.esc(x.username)}</b> ${x.username === me.username ? '<span class="muted">(you)</span>' : ''}</td>
      <td><span class="tag ${x.role === 'admin' ? 'tag-role' : 'tag-unk'}">${x.role}</span></td>
      <td style="text-align:right">${x.username === me.username ? '' : `<button class="btn btn-danger btn-sm" data-u="${DF.esc(x.username)}">Delete</button>`}</td>
    </tr>`).join('');
}
$('accRows').addEventListener('click', async e => {
  const u = e.target.dataset.u; if (!u) return;
  if (!await DF.confirmBox({ title: `Delete account "${u}"?`, body: 'They will no longer be able to log in.', confirmText: 'Delete', danger: true })) return;
  DF.store.saveAccounts(DF.store.accounts().filter(x => x.username !== u));
  log(`deleted account ${u}`); DF.toast(`Account ${u} deleted`, 'success'); renderAll();
});
$('accForm').onsubmit = e => {
  e.preventDefault();
  const username = $('aUser').value.trim(), password = $('aPass').value;
  const a = DF.store.accounts();
  if (a.some(x => x.username.toLowerCase() === username.toLowerCase())) return DF.toast('Username already exists', 'danger');
  a.push({ username, password, role: newRole, created: Date.now() });
  DF.store.saveAccounts(a); log(`created ${newRole} account ${username}`);
  DF.toast(`Created ${newRole} "${username}"`, 'success');
  e.target.reset(); renderAll();
};

/* ---------- logs ---------- */
function renderLogs() {
  const f = $('logFilter').value;
  const l = DF.store.logs().filter(x => !f || x.type === f);
  $('logList').innerHTML = l.length ? l.map(logRow).join('') : '<div class="empty" style="display:block">No events</div>';
}
$('logFilter').onchange = renderLogs;
$('clearLogs').onclick = async () => {
  if (!await DF.confirmBox({ title: 'Clear activity log?', body: 'All events will be removed.', confirmText: 'Clear', danger: true })) return;
  DF.store.clearLogs(); renderAll();
};

/* ---------- settings ---------- */
function loadSettings() {
  const s = DF.store.settings();
  $('sFs').value = s.frameSkip; $('fsVal').textContent = s.frameSkip;
  DF.api.info().then(i => {
    $('srvInfo').innerHTML = [['Model', i.model], ['Detector', i.detector], ['Distance metric', i.metric], ['Match threshold', i.threshold], ['People loaded', i.people]]
      .map(([k, v]) => `<tr><td class="muted">${k}</td><td class="mono"><b>${DF.esc(v)}</b></td></tr>`).join('');
  }).catch(e => { $('srvInfo').innerHTML = `<tr><td class="empty">${DF.esc(e.message)}</td></tr>`; });
}
$('sFs').oninput = e => $('fsVal').textContent = e.target.value;
$('setForm').onsubmit = e => {
  e.preventDefault();
  DF.store.saveSettings({ ...DF.store.settings(), frameSkip: +$('sFs').value }); log('updated video frame skip');
  DF.toast('Saved', 'success');
};

$('retrainBtn').onclick = async () => {
  const btn = $('retrainBtn'), prog = $('rtProg');
  btn.disabled = true; btn.textContent = '⏳ Retraining…'; prog.classList.remove('hidden');
  prog.firstElementChild.style.width = '50%';
  try {
    await DF.api.post('/retrain');
    prog.firstElementChild.style.width = '100%';
    await loadPersons(); loadSettings();
    log(`retrained all ${persons.length} persons`);
    DF.toast(`✅ Retrained ${persons.length} persons`, 'success');
  } catch (e) { DF.toast('Retrain failed: ' + e.message, 'danger'); }
  btn.disabled = false; btn.textContent = 'Retrain all faces';
  setTimeout(() => prog.classList.add('hidden'), 800);
};

function renderAll() { renderStats(); renderWatchlist(); renderAccounts(); renderLogs(); }
loadSettings();
renderAll();
loadPersons();
