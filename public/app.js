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
  const isViewer = state.user?.role === 'viewer';
  const link = (href, label, key) =>
    `<a class="nav-link ${active === key ? 'active' : ''}" href="${href}">${label}</a>`;
  return `
    <div class="layout">
      <nav class="sidebar">
        <div class="brand">AI <span>Review</span> Hub</div>
        ${link('#/', 'Dashboard', 'dashboard')}
        ${isViewer ? '' : link('#/new', 'New Review', 'new')}
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

/**
 * Searchable combobox: a text input with a server-filtered dropdown.
 * loadOptions(search) must return [{ value, label, data? }].
 */
function createCombobox(root, { placeholder, emptyText, loadOptions, onSelect }) {
  root.classList.add('combobox');
  root.innerHTML = `
    <input type="text" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder || '')}" />
    <div class="combo-list" style="display:none"></div>`;
  const input = root.querySelector('input');
  const list = root.querySelector('.combo-list');

  let selected = null;
  let options = [];
  let debounceTimer = null;
  let reqId = 0;
  let activeIdx = -1;

  const isOpen = () => list.style.display !== 'none';
  const open = () => { list.style.display = ''; };
  const close = () => { list.style.display = 'none'; activeIdx = -1; };

  function renderList() {
    activeIdx = -1;
    if (!options.length) {
      list.innerHTML = `<div class="combo-empty">${esc(emptyText || 'No matches')}</div>`;
      return;
    }
    list.innerHTML = options
      .slice(0, 200)
      .map((o, i) => `<div class="combo-item" data-i="${i}">${esc(o.label)}</div>`)
      .join('');
  }

  async function fetchOptions(query) {
    const id = ++reqId;
    list.innerHTML = '<div class="combo-empty">Loading…</div>';
    open();
    try {
      const result = await loadOptions(query);
      if (id !== reqId) return;
      options = result;
      renderList();
    } catch (err) {
      if (id !== reqId) return;
      options = [];
      list.innerHTML = `<div class="combo-empty error-msg" style="margin:0">${esc(err.message)}</div>`;
    }
  }

  function choose(option) {
    selected = option;
    input.value = option.label;
    close();
    onSelect?.(option);
  }

  input.addEventListener('focus', () => {
    // Show the unfiltered list when re-opening on an existing selection
    const q = input.value.trim();
    fetchOptions(selected && q === selected.label ? '' : q);
  });

  input.addEventListener('input', () => {
    if (selected) {
      selected = null;
      onSelect?.(null);
    }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchOptions(input.value.trim()), 250);
  });

  input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('.combo-item');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!isOpen() || !items.length) return;
      e.preventDefault();
      activeIdx =
        e.key === 'ArrowDown'
          ? Math.min(activeIdx + 1, items.length - 1)
          : Math.max(activeIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (isOpen() && activeIdx >= 0 && options[activeIdx]) {
        e.preventDefault();
        choose(options[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });

  // Delay so a mousedown on a list item wins over blur
  input.addEventListener('blur', () => setTimeout(close, 150));

  list.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.combo-item');
    if (!item) return;
    e.preventDefault();
    choose(options[parseInt(item.dataset.i, 10)]);
  });

  return {
    getSelected: () => selected,
    setSelected(option) {
      selected = option;
      input.value = option ? option.label : '';
      close();
    },
    setDisabled(disabled) {
      input.disabled = disabled;
      root.classList.toggle('disabled', disabled);
      if (disabled) close();
    },
    reset() {
      selected = null;
      options = [];
      input.value = '';
      close();
    }
  };
}

async function renderNewReview() {
  const app = document.getElementById('app');

  app.innerHTML = layout(
    'new',
    `<h1>New Review</h1>
     <div class="panel">
       <label>Repository</label>
       <div id="repo-combo"></div>

       <div class="mode-toggle">
         <button type="button" id="mode-branches" class="active">Branch comparison</button>
         <button type="button" id="mode-pr">Pull / Merge Request</button>
       </div>

       <div id="branches-form">
         <label>Base branch</label>
         <div id="base-combo"></div>
         <label>Feature branch</label>
         <div id="feature-combo"></div>
       </div>

       <div id="pr-form" style="display:none">
         <label>Pull / Merge Request</label>
         <div id="pr-combo"></div>
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
  let repo = null;
  const launchBtn = document.getElementById('launch-btn');
  const errEl = document.getElementById('new-error');

  // Defined below; hoisted wrapper so combobox callbacks can use it safely
  function hideConfirmIfShown() {
    const box = document.getElementById('confirm-box');
    if (box && box.style.display !== 'none') hideConfirm();
  }

  const searchSuffix = (search) => (search ? `?search=${encodeURIComponent(search)}` : '');

  const branchLoader = async (search) => {
    if (!repo) return [];
    const branches = await api(
      `/repositories/${encodeURIComponent(repo.value)}/branches${searchSuffix(search)}`
    );
    return branches.map((b) => ({ value: b.name, label: b.name }));
  };

  const repoCombo = createCombobox(document.getElementById('repo-combo'), {
    placeholder: 'Type to search repositories…',
    emptyText: 'No repositories found',
    loadOptions: async (search) => {
      const repos = await api(`/repositories${searchSuffix(search)}`);
      return repos.map((r) => ({ value: r.id, label: r.name, data: r }));
    },
    onSelect: (option) => {
      hideConfirmIfShown();
      errEl.textContent = '';
      repo = option;
      [baseCombo, featCombo, prCombo].forEach((c) => {
        c.reset();
        c.setDisabled(!option);
      });
      launchBtn.disabled = !option;
      if (option?.data?.defaultBranch) {
        baseCombo.setSelected({ value: option.data.defaultBranch, label: option.data.defaultBranch });
      }
    }
  });

  const baseCombo = createCombobox(document.getElementById('base-combo'), {
    placeholder: 'Type to search branches…',
    emptyText: 'No branches found',
    loadOptions: branchLoader,
    onSelect: hideConfirmIfShown
  });

  const featCombo = createCombobox(document.getElementById('feature-combo'), {
    placeholder: 'Type to search branches…',
    emptyText: 'No branches found',
    loadOptions: branchLoader,
    onSelect: hideConfirmIfShown
  });

  const prCombo = createCombobox(document.getElementById('pr-combo'), {
    placeholder: 'Type to search by number, title or branch…',
    emptyText: 'No open PRs / MRs found',
    loadOptions: async (search) => {
      if (!repo) return [];
      const prs = await api(
        `/repositories/${encodeURIComponent(repo.value)}/pull-requests${searchSuffix(search)}`
      );
      return prs.map((p) => ({
        value: p.number,
        label: `#${p.number} — ${p.title} (${p.sourceBranch} → ${p.targetBranch})`,
        data: p
      }));
    },
    onSelect: hideConfirmIfShown
  });

  [baseCombo, featCombo, prCombo].forEach((c) => c.setDisabled(true));

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

  const confirmBox = document.getElementById('confirm-box');
  const confirmText = document.getElementById('confirm-text');
  let pendingBody = null;

  function hideConfirm() {
    pendingBody = null;
    confirmBox.style.display = 'none';
    launchBtn.disabled = !repo;
  }

  // Step 1: validate the selection and show the merge warning
  launchBtn.addEventListener('click', () => {
    errEl.textContent = '';
    if (!repo) {
      errEl.textContent = 'Select a repository';
      return;
    }
    const body = {
      repositoryId: repo.value,
      repositoryName: repo.data.name,
      mode
    };

    let base;
    let feature;
    if (mode === 'branches') {
      const b = baseCombo.getSelected();
      const f = featCombo.getSelected();
      if (!b || !f) {
        errEl.textContent = 'Select both base and feature branches';
        return;
      }
      base = b.value;
      feature = f.value;
      body.baseBranch = base;
      body.featureBranch = feature;
    } else {
      const p = prCombo.getSelected();
      if (!p) {
        errEl.textContent = 'No PR/MR selected';
        return;
      }
      body.prNumber = p.value;
      base = p.data.targetBranch;
      feature = p.data.sourceBranch;
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

/**
 * Content lines of a unified diff with metadata (---/+++/@@) stripped.
 * Shared by the Review Details rendering and "Copy review".
 */
function diffContentLines(diff) {
  return String(diff)
    .split('\n')
    .filter(
      (line) => !line.startsWith('--- ') && !line.startsWith('+++ ') && !line.startsWith('@@')
    );
}

/** Plain-text representation of a single finding, used by "Copy review". */
function findingToPlainText(f, suggestion) {
  const parts = [`─── ${findingLocation(f) || 'general'} ───`, ''];
  const text = findingText(f);
  if (text) parts.push(text, '');
  if (suggestion) {
    parts.push('Suggested change:', diffContentLines(suggestion.diff).join('\n'), '');
  } else {
    if (f.existing_code) parts.push('Existing code:', f.existing_code, '');
    if (f.suggestion_code) parts.push('Suggestion code:', f.suggestion_code, '');
  }
  return parts.join('\n').trimEnd();
}

function buildReviewText(findings, diffByFinding) {
  return findings.map((f, i) => findingToPlainText(f, diffByFinding?.get(i))).join('\n\n');
}

/** Plain text for diffs recovered from raw (non-JSON) OCR output. */
function buildSuggestionsText(suggestions) {
  return suggestions
    .map((s) => {
      const parts = [`─── ${s.location || 'general'} ───`, ''];
      if (s.text) parts.push(s.text, '');
      parts.push('Suggested change:', diffContentLines(s.diff).join('\n'));
      return parts.join('\n').trimEnd();
    })
    .join('\n\n');
}

/** Git-style rendering of a unified diff; metadata lines are stripped. */
function renderDiffHtml(diff) {
  const lines = diffContentLines(diff)
    .map((line) => {
      let cls = '';
      if (line.startsWith('+')) cls = 'add';
      else if (line.startsWith('-')) cls = 'del';
      return `<span class="diff-line ${cls}">${esc(line) || ' '}</span>`;
    });
  return `<pre class="code diff">${lines.join('')}</pre>`;
}

function renderFindings(findings, diffByFinding) {
  return findings
    .map((f, i) => {
      const loc = findingLocation(f);
      const text = findingText(f) || JSON.stringify(f, null, 2);
      const suggestion = diffByFinding?.get(i);
      const codeHtml = suggestion
        ? `<div class="code-label">Suggested change:</div>${renderDiffHtml(suggestion.diff)}`
        : `${f.existing_code ? `<div class="code-label">Existing code:</div><pre class="code">${esc(f.existing_code)}</pre>` : ''}
           ${f.suggestion_code ? `<div class="code-label">Suggestion code:</div><pre class="code suggestion">${esc(f.suggestion_code)}</pre>` : ''}`;
      return `<div class="finding">
        ${loc ? `<div class="loc">─── ${esc(loc)} ───</div>` : ''}
        <div class="body">${esc(text)}</div>
        ${codeHtml}
      </div>`;
    })
    .join('');
}

/** Suggestion cards for diffs recovered from raw (non-JSON) OCR output. */
function renderTextSuggestions(suggestions) {
  return suggestions
    .map(
      (s) => `<div class="finding">
        ${s.location ? `<div class="loc">─── ${esc(s.location)} ───</div>` : ''}
        ${s.text ? `<div class="body">${esc(s.text)}</div>` : ''}
        <div class="code-label">Suggested change:</div>
        ${renderDiffHtml(s.diff)}
      </div>`
    )
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
    const canCancel =
      isActive &&
      state.user.role !== 'viewer' &&
      (state.user.role === 'admin' || job.user_id === state.user.id);
    const result = job.result;
    const parsed = result?.ocr_output_json;
    const findings = extractFindings(parsed);

    const diffByFinding = new Map();
    const textSuggestions = [];
    if (Array.isArray(result?.suggestions_json)) {
      for (const s of result.suggestions_json) {
        if (s.findingIndex != null) diffByFinding.set(s.findingIndex, s);
        else textSuggestions.push(s);
      }
    }

    const findingsHtml = findings
      ? renderFindings(findings, diffByFinding)
      : textSuggestions.length
        ? renderTextSuggestions(textSuggestions)
        : null;
    const copyText = findings
      ? buildReviewText(findings, diffByFinding)
      : textSuggestions.length
        ? buildSuggestionsText(textSuggestions)
        : (result?.raw_stdout || '').trim();

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
                       <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>viewer</option>
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
               <option value="viewer">viewer</option>
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
  else if (hash === '#/new') {
    if (state.user.role === 'viewer') navigate('#/');
    else await renderNewReview();
  } else if (hash === '#/admin') await renderAdmin();
  else if (reviewMatch) await renderReviewDetails(reviewMatch[1]);
  else navigate('#/');
}

window.addEventListener('hashchange', render);
render();
