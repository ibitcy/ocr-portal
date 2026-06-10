'use strict';

/* ===== API helpers ===== */

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options
  });
  if (res.status === 401 && location.hash !== '#/login') {
    state.user = null;
    navigate('#/login');
    throw new Error('Not authenticated');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const state = { user: null, pollTimer: null };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleString() : '—';
}

function badge(status) {
  return `<span class="badge ${esc(status)}">${esc(status)}</span>`;
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

/* ===== Layout ===== */

function layout(active, content) {
  const isAdmin = state.user?.role === 'admin';
  const link = (href, label, key) =>
    `<a class="nav-link ${active === key ? 'active' : ''}" href="${href}">${label}</a>`;
  return `
    <div class="layout">
      <nav class="sidebar">
        <div class="brand">AI <span>Review</span> Hub</div>
        ${link('#/', 'Dashboard', 'dashboard')}
        ${link('#/new', 'New Review', 'new')}
        ${isAdmin ? link('#/admin', 'Administration', 'admin') : ''}
        <div class="spacer"></div>
        <div class="user-box">
          ${esc(state.user?.email || '')}<br/>
          <span class="muted">role: ${esc(state.user?.role || '')}</span>
          <button class="secondary" id="logout-btn">Sign out</button>
        </div>
      </nav>
      <main class="content">${content}</main>
    </div>`;
}

function bindLogout() {
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' });
    state.user = null;
    navigate('#/login');
  });
}

/* ===== Pages ===== */

function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="login-wrap">
      <div class="login-box panel">
        <h1>AI <span>Review</span> Hub</h1>
        <form id="login-form">
          <label>Email</label>
          <input type="email" id="email" autocomplete="username" required />
          <label>Password</label>
          <input type="password" id="password" autocomplete="current-password" required />
          <button type="submit">Sign in</button>
          <div class="error-msg" id="login-error"></div>
        </form>
      </div>
    </div>`;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    try {
      state.user = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('email').value,
          password: document.getElementById('password').value
        })
      });
      navigate('#/');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

async function renderDashboard() {
  const app = document.getElementById('app');
  app.innerHTML = layout('dashboard', '<h1>Dashboard</h1><div class="muted">Loading…</div>');
  bindLogout();

  const jobs = await api('/reviews');
  const count = (s) => jobs.filter((j) => j.status === s).length;

  const rows = jobs
    .slice(0, 30)
    .map(
      (j) => `
      <tr class="clickable" data-id="${j.id}">
        <td>#${j.id}</td>
        <td>${esc(j.repository_name)}</td>
        <td>${
          j.mode === 'pr'
            ? `PR #${j.pr_number}`
            : `${esc(j.base_branch)} → ${esc(j.feature_branch)}`
        }</td>
        <td>${badge(j.status)}</td>
        <td>${esc(j.user_email)}</td>
        <td>${fmtDate(j.created_at)}</td>
        <td>${j.duration_seconds != null ? j.duration_seconds + 's' : '—'}</td>
      </tr>`
    )
    .join('');

  app.innerHTML = layout(
    'dashboard',
    `<h1>Dashboard</h1>
     <div class="stats">
       <div class="stat"><div class="num">${jobs.length}</div><div class="label">Total</div></div>
       <div class="stat"><div class="num">${count('running') + count('pending')}</div><div class="label">Active</div></div>
       <div class="stat"><div class="num">${count('completed')}</div><div class="label">Completed</div></div>
       <div class="stat"><div class="num">${count('failed')}</div><div class="label">Failed</div></div>
     </div>
     <div class="panel">
       <h2 style="margin-top:0">Recent reviews</h2>
       ${
         jobs.length
           ? `<table>
                <thead><tr><th>ID</th><th>Repository</th><th>Diff</th><th>Status</th><th>User</th><th>Created</th><th>Duration</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>`
           : '<div class="empty">No reviews yet. Create your first one!</div>'
       }
     </div>`
  );
  bindLogout();
  app.querySelectorAll('tr.clickable').forEach((tr) =>
    tr.addEventListener('click', () => navigate(`#/review/${tr.dataset.id}`))
  );
}

async function renderNewReview() {
  const app = document.getElementById('app');
  app.innerHTML = layout('new', '<h1>New Review</h1><div class="muted">Loading repositories…</div>');
  bindLogout();

  let repos;
  try {
    repos = await api('/repositories');
  } catch (err) {
    app.innerHTML = layout(
      'new',
      `<h1>New Review</h1><div class="panel error-msg">Failed to load repositories: ${esc(err.message)}</div>`
    );
    bindLogout();
    return;
  }

  app.innerHTML = layout(
    'new',
    `<h1>New Review</h1>
     <div class="panel">
       <label>Repository</label>
       <select id="repo">
         <option value="">— select repository —</option>
         ${repos
           .map(
             (r) =>
               `<option value="${esc(r.id)}" data-name="${esc(r.name)}" data-default="${esc(r.defaultBranch || '')}">${esc(r.name)}</option>`
           )
           .join('')}
       </select>

       <div class="mode-toggle">
         <button type="button" id="mode-branches" class="active">Branch comparison</button>
         <button type="button" id="mode-pr">Pull / Merge Request</button>
       </div>

       <div id="branches-form">
         <label>Base branch</label>
         <select id="base-branch" disabled><option>— select repository first —</option></select>
         <label>Feature branch</label>
         <select id="feature-branch" disabled><option>— select repository first —</option></select>
       </div>

       <div id="pr-form" style="display:none">
         <label>Pull / Merge Request</label>
         <select id="pr-select" disabled><option>— select repository first —</option></select>
       </div>

       <div class="btn-row">
         <button id="launch-btn" disabled>Launch review</button>
       </div>

       <div id="confirm-box" class="confirm-box" style="display:none">
         <div class="confirm-title">Before you launch</div>
         <p id="confirm-text"></p>
         <p>If the base branch is not merged in, the diff will include unrelated
            changes and the review results will be unreliable.</p>
         <div class="btn-row">
           <button id="confirm-launch-btn">I confirm — launch review</button>
           <button class="secondary" id="cancel-launch-btn">Cancel</button>
         </div>
       </div>

       <div class="error-msg" id="new-error"></div>
     </div>`
  );
  bindLogout();

  let mode = 'branches';
  // Defined below; hoisted wrapper so setMode can use it safely
  function hideConfirmIfShown() {
    const box = document.getElementById('confirm-box');
    if (box && box.style.display !== 'none') hideConfirm();
  }
  const repoSel = document.getElementById('repo');
  const baseSel = document.getElementById('base-branch');
  const featSel = document.getElementById('feature-branch');
  const prSel = document.getElementById('pr-select');
  const launchBtn = document.getElementById('launch-btn');
  const errEl = document.getElementById('new-error');

  function setMode(m) {
    mode = m;
    hideConfirmIfShown();
    document.getElementById('mode-branches').classList.toggle('active', m === 'branches');
    document.getElementById('mode-pr').classList.toggle('active', m === 'pr');
    document.getElementById('branches-form').style.display = m === 'branches' ? '' : 'none';
    document.getElementById('pr-form').style.display = m === 'pr' ? '' : 'none';
  }
  document.getElementById('mode-branches').addEventListener('click', () => setMode('branches'));
  document.getElementById('mode-pr').addEventListener('click', () => setMode('pr'));

  [baseSel, featSel, prSel].forEach((sel) =>
    sel.addEventListener('change', hideConfirmIfShown)
  );

  repoSel.addEventListener('change', async () => {
    errEl.textContent = '';
    hideConfirmIfShown();
    const repoId = repoSel.value;
    if (!repoId) return;
    launchBtn.disabled = true;
    baseSel.disabled = featSel.disabled = prSel.disabled = true;
    baseSel.innerHTML = featSel.innerHTML = prSel.innerHTML = '<option>Loading…</option>';

    try {
      const [branches, prs] = await Promise.all([
        api(`/repositories/${encodeURIComponent(repoId)}/branches`),
        api(`/repositories/${encodeURIComponent(repoId)}/pull-requests`)
      ]);

      const defaultBranch = repoSel.selectedOptions[0]?.dataset.default;
      const opts = branches
        .map((b) => `<option value="${esc(b.name)}">${esc(b.name)}</option>`)
        .join('');
      baseSel.innerHTML = opts;
      featSel.innerHTML = opts;
      if (defaultBranch) baseSel.value = defaultBranch;

      prSel.innerHTML = prs.length
        ? prs
            .map(
              (p) =>
                `<option value="${p.number}" data-source="${esc(p.sourceBranch)}" data-target="${esc(p.targetBranch)}">#${p.number} — ${esc(p.title)} (${esc(p.sourceBranch)} → ${esc(p.targetBranch)})</option>`
            )
            .join('')
        : '<option value="">No open PRs / MRs</option>';

      baseSel.disabled = featSel.disabled = prSel.disabled = false;
      launchBtn.disabled = false;
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  const confirmBox = document.getElementById('confirm-box');
  const confirmText = document.getElementById('confirm-text');
  let pendingBody = null;

  function hideConfirm() {
    pendingBody = null;
    confirmBox.style.display = 'none';
    launchBtn.disabled = false;
  }

  // Step 1: validate the selection and show the merge warning
  launchBtn.addEventListener('click', () => {
    errEl.textContent = '';
    const opt = repoSel.selectedOptions[0];
    const body = {
      repositoryId: repoSel.value,
      repositoryName: opt.dataset.name,
      mode
    };

    let base;
    let feature;
    if (mode === 'branches') {
      base = baseSel.value;
      feature = featSel.value;
      body.baseBranch = base;
      body.featureBranch = feature;
    } else {
      if (!prSel.value) {
        errEl.textContent = 'No PR/MR selected';
        return;
      }
      body.prNumber = parseInt(prSel.value, 10);
      const prOpt = prSel.selectedOptions[0];
      base = prOpt.dataset.target;
      feature = prOpt.dataset.source;
    }

    pendingBody = body;
    confirmText.innerHTML =
      `Reviews must be launched only when the base branch ` +
      `<strong>${esc(base)}</strong> is already merged into the feature branch ` +
      `<strong>${esc(feature)}</strong>.`;
    confirmBox.style.display = '';
    launchBtn.disabled = true;
    confirmBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.getElementById('cancel-launch-btn').addEventListener('click', hideConfirm);

  // Step 2: launch only after explicit confirmation
  document.getElementById('confirm-launch-btn').addEventListener('click', async () => {
    if (!pendingBody) return;
    errEl.textContent = '';
    const body = { ...pendingBody, baseMergedConfirmed: true };
    try {
      const job = await api('/reviews', { method: 'POST', body: JSON.stringify(body) });
      navigate(`#/review/${job.id}`);
    } catch (err) {
      errEl.textContent = err.message;
      hideConfirm();
    }
  });
}

function extractFindings(parsed) {
  if (!parsed) return null;
  const list = Array.isArray(parsed)
    ? parsed
    : parsed.comments || parsed.issues || parsed.results;
  return Array.isArray(list) && list.length > 0 ? list : null;
}

function findingLocation(f) {
  const file = f.path || f.file || f.filename || '';
  if (!file) return '';
  const start = f.start_line ?? f.line ?? f.lineNumber;
  const end = f.end_line;
  let loc = file;
  if (start != null) {
    loc += `:${start}`;
    if (end != null && end !== start) loc += `-${end}`;
  }
  return loc;
}

function findingText(f) {
  return f.content || f.comment || f.message || f.body || f.description || '';
}

/** Plain-text representation of a single finding, used by "Copy review". */
function findingToPlainText(f) {
  const parts = [`─── ${findingLocation(f) || 'general'} ───`, ''];
  const text = findingText(f);
  if (text) parts.push(text, '');
  if (f.existing_code) parts.push('Existing code:', f.existing_code, '');
  if (f.suggestion_code) parts.push('Suggestion code:', f.suggestion_code, '');
  return parts.join('\n').trimEnd();
}

function buildReviewText(findings) {
  return findings.map(findingToPlainText).join('\n\n');
}

function renderFindings(findings) {
  return findings
    .map((f) => {
      const loc = findingLocation(f);
      const text = findingText(f) || JSON.stringify(f, null, 2);
      return `<div class="finding">
        ${loc ? `<div class="loc">─── ${esc(loc)} ───</div>` : ''}
        <div class="body">${esc(text)}</div>
        ${f.existing_code ? `<div class="code-label">Existing code:</div><pre class="code">${esc(f.existing_code)}</pre>` : ''}
        ${f.suggestion_code ? `<div class="code-label">Suggestion code:</div><pre class="code suggestion">${esc(f.suggestion_code)}</pre>` : ''}
      </div>`;
    })
    .join('');
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

async function renderReviewDetails(id) {
  const app = document.getElementById('app');

  async function load() {
    let job;
    try {
      job = await api(`/reviews/${id}`);
    } catch (err) {
      app.innerHTML = layout('dashboard', `<h1>Review #${esc(id)}</h1><div class="panel error-msg">${esc(err.message)}</div>`);
      bindLogout();
      return;
    }

    const isActive = ['pending', 'running'].includes(job.status);
    const canCancel = isActive && (state.user.role === 'admin' || job.user_id === state.user.id);
    const result = job.result;
    const parsed = result?.ocr_output_json;
    const findings = extractFindings(parsed);
    const findingsHtml = findings ? renderFindings(findings) : null;
    const copyText = findings ? buildReviewText(findings) : (result?.raw_stdout || '').trim();

    app.innerHTML = layout(
      'dashboard',
      `<h1>${isActive ? '<span class="spinner"></span>' : ''}Review #${job.id} ${badge(job.status)}</h1>
       <div class="panel">
         <div class="meta-grid">
           <div class="k">Repository</div><div>${esc(job.repository_name)}</div>
           <div class="k">Mode</div><div>${job.mode === 'pr' ? `PR/MR #${job.pr_number}${job.pr_title ? ` — ${esc(job.pr_title)}` : ''}` : 'Branch comparison'}</div>
           <div class="k">Base branch</div><div>${esc(job.base_branch)}</div>
           <div class="k">Feature branch</div><div>${esc(job.feature_branch)}</div>
           <div class="k">Requested by</div><div>${esc(job.user_email)}</div>
           <div class="k">Created</div><div>${fmtDate(job.created_at)}</div>
           <div class="k">Started</div><div>${fmtDate(job.started_at)}</div>
           <div class="k">Finished</div><div>${fmtDate(job.finished_at)}</div>
           <div class="k">Duration</div><div>${job.duration_seconds != null ? job.duration_seconds + 's' : '—'}</div>
           ${job.error ? `<div class="k">Error</div><div class="error-msg" style="margin:0">${esc(job.error)}</div>` : ''}
         </div>
         ${canCancel ? `<div class="btn-row"><button class="danger" id="cancel-btn">Cancel review</button></div>` : ''}
       </div>

       ${
         result
           ? `<div class="result-head">
                <h2>Result ${result.exit_code != null ? `<span class="muted">(exit code ${result.exit_code})</span>` : ''}</h2>
                ${copyText ? '<button class="secondary" id="copy-review-btn">Copy review</button>' : ''}
              </div>
              ${result.summary ? `<div class="panel">${esc(result.summary)}</div>` : ''}
              ${
                findingsHtml
                  ? `<div>${findingsHtml}</div>`
                  : result.raw_stdout
                    ? `<pre class="logs">${esc(result.raw_stdout.slice(0, 50000))}</pre>`
                    : '<div class="panel muted">No output captured.</div>'
              }`
           : ''
       }

       <h2>Execution logs</h2>
       <pre class="logs" id="job-logs">${esc(job.logs || 'No logs yet.')}</pre>`
    );
    bindLogout();

    const copyBtn = document.getElementById('copy-review-btn');
    copyBtn?.addEventListener('click', async () => {
      const ok = await copyToClipboard(copyText);
      copyBtn.textContent = ok ? 'Copied!' : 'Copy failed';
      setTimeout(() => { copyBtn.textContent = 'Copy review'; }, 1500);
    });

    document.getElementById('cancel-btn')?.addEventListener('click', async () => {
      try {
        await api(`/reviews/${id}/cancel`, { method: 'POST' });
        load();
      } catch (err) {
        alert(err.message);
      }
    });

    if (isActive) {
      state.pollTimer = setTimeout(load, 2500);
    }
  }

  await load();
}

async function renderAdmin() {
  const app = document.getElementById('app');
  app.innerHTML = layout('admin', '<h1>Administration</h1><div class="muted">Loading…</div>');
  bindLogout();

  try {
    const [users, repos, settings] = await Promise.all([
      api('/admin/users'),
      api('/admin/repositories'),
      api('/admin/settings')
    ]);

    app.innerHTML = layout(
      'admin',
      `<h1>Administration</h1>

       <div class="panel">
         <h2 style="margin-top:0">Provider settings <span class="muted">(read-only, configured via environment)</span></h2>
         <div class="meta-grid">
           <div class="k">Git provider</div><div>${esc(settings.gitProvider)}</div>
           <div class="k">Git host</div><div>${esc(settings.gitHost)}</div>
           <div class="k">Git token</div><div>${settings.gitTokenConfigured ? 'configured' : '<span class="error-msg">not configured</span>'}</div>
           <div class="k">LLM URL</div><div>${esc(settings.llmUrl || '—')}</div>
           <div class="k">LLM model</div><div>${esc(settings.llmModel || '—')}</div>
           <div class="k">LLM token</div><div>${settings.llmTokenConfigured ? 'configured' : '<span class="error-msg">not configured</span>'}</div>
         </div>
       </div>

       <div class="panel">
         <h2 style="margin-top:0">Users</h2>
         <table>
           <thead><tr><th>ID</th><th>Email</th><th>Role</th><th>Created</th><th></th></tr></thead>
           <tbody>
             ${users
               .map((u) => {
                 const self = u.id === state.user.id;
                 return `<tr>
                   <td>${u.id}</td>
                   <td>${esc(u.email)}${self ? ' <span class="muted">(you)</span>' : ''}</td>
                   <td>
                     <select class="role-select" data-id="${u.id}" ${self ? 'disabled title="You cannot change your own role"' : ''} style="width:auto">
                       <option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option>
                       <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
                     </select>
                   </td>
                   <td>${fmtDate(u.created_at)}</td>
                   <td style="text-align:right; white-space:nowrap">
                     <button class="secondary reset-pw-btn" data-id="${u.id}" data-email="${esc(u.email)}">Reset password</button>
                     ${self ? '' : `<button class="danger delete-user-btn" data-id="${u.id}" data-email="${esc(u.email)}">Delete</button>`}
                   </td>
                 </tr>`;
               })
               .join('')}
           </tbody>
         </table>

         <h2>Add user</h2>
         <form id="add-user-form" class="add-user-form">
           <div>
             <label>Email</label>
             <input type="email" id="new-user-email" required />
           </div>
           <div>
             <label>Password <span class="muted">(min 8 chars)</span></label>
             <input type="password" id="new-user-password" minlength="8" autocomplete="new-password" required />
           </div>
           <div>
             <label>Role</label>
             <select id="new-user-role">
               <option value="user" selected>user</option>
               <option value="admin">admin</option>
             </select>
           </div>
           <div>
             <button type="submit">Add user</button>
           </div>
         </form>
         <div class="error-msg" id="admin-users-error"></div>
       </div>

       <div class="panel">
         <h2 style="margin-top:0">Known repositories</h2>
         ${
           repos.length
             ? `<table>
                  <thead><tr><th>ID</th><th>Name</th><th>Provider</th><th>First used</th></tr></thead>
                  <tbody>
                    ${repos.map((r) => `<tr><td>${r.id}</td><td>${esc(r.name)}</td><td>${esc(r.provider)}</td><td>${fmtDate(r.created_at)}</td></tr>`).join('')}
                  </tbody>
                </table>`
             : '<div class="empty">No repositories used yet.</div>'
         }
       </div>`
    );
    bindLogout();

    const errEl = document.getElementById('admin-users-error');
    const showError = (msg) => { errEl.textContent = msg || ''; };

    document.getElementById('add-user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      try {
        await api('/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            email: document.getElementById('new-user-email').value,
            password: document.getElementById('new-user-password').value,
            role: document.getElementById('new-user-role').value
          })
        });
        render();
      } catch (err) {
        showError(err.message);
      }
    });

    app.querySelectorAll('.role-select').forEach((sel) =>
      sel.addEventListener('change', async () => {
        showError('');
        try {
          await api(`/admin/users/${sel.dataset.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ role: sel.value })
          });
        } catch (err) {
          showError(err.message);
          render();
        }
      })
    );

    app.querySelectorAll('.reset-pw-btn').forEach((btn) =>
      btn.addEventListener('click', async () => {
        showError('');
        const password = prompt(`New password for ${btn.dataset.email} (min 8 chars):`);
        if (!password) return;
        try {
          await api(`/admin/users/${btn.dataset.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ password })
          });
        } catch (err) {
          showError(err.message);
        }
      })
    );

    app.querySelectorAll('.delete-user-btn').forEach((btn) =>
      btn.addEventListener('click', async () => {
        showError('');
        if (!confirm(`Delete user ${btn.dataset.email}?`)) return;
        try {
          await api(`/admin/users/${btn.dataset.id}`, { method: 'DELETE' });
          render();
        } catch (err) {
          showError(err.message);
        }
      })
    );
  } catch (err) {
    app.innerHTML = layout('admin', `<h1>Administration</h1><div class="panel error-msg">${esc(err.message)}</div>`);
    bindLogout();
  }
}

/* ===== Router ===== */

async function render() {
  clearTimeout(state.pollTimer);

  if (!state.user) {
    try {
      state.user = await api('/auth/me');
    } catch {
      // not logged in
    }
  }

  const hash = location.hash || '#/';

  if (!state.user) {
    renderLogin();
    return;
  }
  if (hash === '#/login') {
    navigate('#/');
    return;
  }

  const reviewMatch = hash.match(/^#\/review\/(\d+)$/);
  if (hash === '#/') await renderDashboard();
  else if (hash === '#/new') await renderNewReview();
  else if (hash === '#/admin') await renderAdmin();
  else if (reviewMatch) await renderReviewDetails(reviewMatch[1]);
  else navigate('#/');
}

window.addEventListener('hashchange', render);
render();
