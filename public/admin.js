const state = { status: null, users: [], plans: [], lessons: [], books: [], bookPlans: [], bookSessions: [], jobs: [], backups: [], businessTasks: [] };
const $ = (s) => document.querySelector(s);
const esc = (v = '') => String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function error(e) { $('#error').textContent = e.message || String(e); $('#error').classList.remove('hidden'); }
function badge(status) { const cls = /approved|completed|connected|ok/.test(status) ? 'good' : /failed|rejected|error/.test(status) ? 'bad' : 'warn'; return `<span class="badge ${cls}">${esc(status)}</span>`; }
function fmt(date) { return date ? new Date(date).toLocaleString() : '—'; }

async function checkSession() {
  try { await refresh(); $('#login').classList.add('hidden'); $('#admin-workspace').classList.remove('hidden'); }
  catch { $('#login').classList.remove('hidden'); }
}
$('#login-form').onsubmit = async (event) => {
  event.preventDefault();
  try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ token: new FormData(event.target).get('token') }) }); await refresh(); $('#login').classList.add('hidden'); $('#admin-workspace').classList.remove('hidden'); }
  catch (e) { error(e); }
};

async function refresh() {
  [state.status, state.users, state.plans, state.lessons, state.books, state.bookPlans, state.bookSessions, state.jobs, state.backups, state.businessTasks] = await Promise.all([
    api('/api/admin/status'), api('/api/admin/users'), api('/api/admin/plans'), api('/api/admin/lessons'), api('/api/admin/books'), api('/api/admin/book-plans'), api('/api/admin/book-sessions'), api('/api/admin/jobs'), api('/api/admin/backups'), api('/api/admin/business-tasks')
  ]);
  renderAll();
}

function renderAll() { renderOverview(); renderUsers(); renderPlans(); renderLessons(); renderBooksAdmin(); renderChannels(); renderOperations(); }

function renderOverview() {
  const completed = state.lessons.filter((lesson) => lesson.status === 'completed').length;
  const reviewHeld = state.lessons.filter((lesson) => ['needs_review', 'needs_changes'].includes(lesson.reviewStatus)).length
    + state.bookSessions.filter((session) => ['needs_review', 'needs_changes'].includes(session.reviewStatus)).length;
  const scheduler = state.status.scheduler || {};
  const internal = state.status.internalJobs || {};
  $('#tab-overview').innerHTML = `<div class="notice"><strong>Administration is for monitoring and exceptional overrides.</strong><br>Normal learners review held content and control delivery from their own private dashboard.</div>
  <div class="grid three">
    <div class="card"><div class="metric">${state.users.length}</div><div class="metric-label">Learners</div></div>
    <div class="card"><div class="metric">${completed}</div><div class="metric-label">Completed topic lessons</div></div>
    <div class="card"><div class="metric">${reviewHeld}</div><div class="metric-label">Learner review holds</div></div>
  </div><div class="grid three">
    <div class="card"><div class="metric">${state.books.length}</div><div class="metric-label">Books</div></div>
    <div class="card"><div class="metric">${state.bookSessions.filter((session) => session.status === 'completed').length}</div><div class="metric-label">Completed book sessions</div></div>
    <div class="card"><div class="metric">${internal.failed || 0}</div><div class="metric-label">Failed internal jobs</div></div>
  </div><div class="card"><h2>System status</h2><div class="actions">
    <span class="badge">Version ${esc(state.status.version || '—')}</span>
    ${badge(state.status.whatsapp)}
    <span class="badge">Telegram: ${state.status.telegram ? 'enabled' : 'disabled'}</span>
    <span class="badge">AI: ${esc(state.status.aiProvider)}</span>
    <span class="badge">GPT tasks ready: ${state.status.pendingBusinessTasks || 0}</span>
    <span class="badge">Internal jobs pending: ${internal.pending || 0}</span>
    <span class="badge ${scheduler.lastError ? 'bad' : scheduler.enabled ? 'good' : 'warn'}">Scheduler: ${scheduler.enabled ? scheduler.lastError ? 'error' : 'enabled' : 'disabled'}</span>
  </div><p class="muted">Last scheduler tick: ${fmt(scheduler.lastTickAt)}${scheduler.lastError ? ` · ${esc(scheduler.lastError)}` : ''}</p>${state.status.businessActions ? `<p class="muted">GPT Action schema: <a href="${esc(state.status.actionSchemaUrl)}" target="_blank" rel="noopener noreferrer">${esc(state.status.actionSchemaUrl)}</a></p>${state.status.customGptUrl ? `<p><a href="${esc(state.status.customGptUrl)}" target="_blank" rel="noopener noreferrer"><button>Open Knowledge Pilot GPT</button></a></p>` : ''}` : ''}</div>`;
}

function renderUsers() {
  $('#tab-users').innerHTML = `<div class="card"><h2>Create learner</h2><form id="create-user" class="form-grid"><label>Name<input name="name" required></label><label>Email (optional)<input name="email" type="email"></label><label>Language<select name="language"><option value="ar">Arabic</option><option value="en">English</option><option value="nl">Dutch</option></select></label><label>Timezone<input name="timezone" value="Europe/Brussels"></label><div class="full"><button>Create private profile</button></div></form></div>
  <div class="card"><h2>Learners</h2>${state.users.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Profile</th><th>Channels</th><th>Actions</th></tr></thead><tbody>${state.users.map((u) => `<tr><td><strong>${esc(u.name)}</strong><br><small>${esc(u.id)}</small></td><td><a href="${esc(u.accessUrl)}" target="_blank">Private link</a><br><small>${u.onboardingComplete ? 'Onboarded' : 'Not onboarded'}</small></td><td>Telegram: ${u.telegramChatId ? 'linked' : '—'}<br>WhatsApp: ${u.whatsappJid ? 'linked' : '—'}</td><td><button class="secondary generate-plan" data-id="${u.id}">Generate plan</button><button class="ghost copy-link" data-link="${esc(u.accessUrl)}">Copy link</button><button class="danger delete-user" data-id="${u.id}">Delete learner</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No learners yet.</p>'}</div>`;
  $('#create-user').onsubmit = async (event) => { event.preventDefault(); const f = new FormData(event.target); try { const result = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) }); await navigator.clipboard?.writeText(result.accessUrl); await refresh(); alert(`User created. Private link:\n${result.accessUrl}`); } catch (e) { error(e); } };
  document.querySelectorAll('.generate-plan').forEach((b) => b.onclick = async () => { b.disabled = true; try { const result = await api(`/api/admin/users/${b.dataset.id}/plan`, { method: 'POST', body: '{}' }); if (result.queued) alert('Queued for verified processing in the ChatGPT Business custom GPT.'); await refresh(); } catch (e) { error(e); } finally { b.disabled = false; } });
  document.querySelectorAll('.copy-link').forEach((b) => b.onclick = () => navigator.clipboard?.writeText(b.dataset.link));
  document.querySelectorAll('.delete-user').forEach((button) => button.onclick = async () => {
    const user = state.users.find((candidate) => candidate.id === button.dataset.id);
    if (!user) return;
    const confirmation = prompt(`Permanently delete ${user.name} and every lesson, book, task, message, upload, and progress record owned by this learner?\n\nType the learner name exactly to continue:`, '');
    if (confirmation === null) return;
    if (confirmation !== user.name) return alert('The learner name did not match. Nothing was deleted.');
    if (!confirm('This deletion is permanent in the live system. Protected backups expire through normal rotation. Continue?')) return;
    button.disabled = true;
    try {
      const result = await api(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE', body: JSON.stringify({ confirmation }) });
      await refresh();
      alert(`${result.user.name} was deleted. ${result.totalRecords} database record(s) and ${result.deletedFiles} private file location(s) were removed.`);
    } catch (e) {
      error(e);
    } finally {
      button.disabled = false;
    }
  });
}

function renderPlans() {
  $('#tab-plans').innerHTML = `<div class="card"><h2>Weekly plans</h2>${state.plans.length ? `<div class="list">${state.plans.map((p) => {
    const user = state.users.find((u) => u.id === p.userId);
    return `<div class="list-item"><div class="actions">${badge(p.status)}<span class="badge">${esc(p.weekStart)}</span></div><h3>${esc(p.primarySubject)} — ${esc(user?.name || p.userId)}</h3><p>${esc(p.rationale)}</p>${p.proposals.map((x) => `<div style="padding:.65rem 0;border-top:1px solid var(--line)"><strong>${x.order}. ${esc(x.title)}</strong><br><small>${esc(x.question)}</small><div class="actions" style="margin-top:6px"><button class="secondary generate-lesson" data-plan="${p.id}" data-proposal="${x.id}">${state.status.aiProvider === 'chatgpt_business' ? 'Queue Business lesson' : 'Generate lesson'}</button></div></div>`).join('')}</div>`;
  }).join('')}</div>` : '<p class="muted">No plans yet.</p>'}</div>`;
  document.querySelectorAll('.generate-lesson').forEach((b) => b.onclick = () => sourceDialog(b.dataset.plan, b.dataset.proposal));
}

async function sourceDialog(planId, proposalId) {
  if (state.status.aiProvider === 'chatgpt_business') {
    try {
      const result = await api(`/api/admin/plans/${planId}/generate/${proposalId}`, { method: 'POST', body: '{}' });
      if (result.queued) alert('Lesson queued. Open the Knowledge Pilot custom GPT and ask it to process pending tasks.');
      await refresh();
    } catch (e) { error(e); }
    return;
  }
  const d = $('#dialog'); d.classList.remove('hidden');
  d.innerHTML = `<div class="card"><h2>Generate researched lesson</h2><p class="muted">Optional: add trusted source URLs, one per line. SearXNG results are also used when configured.</p><form id="source-form"><label>Source URLs<textarea name="urls"></textarea></label><div class="actions" style="margin-top:12px"><button>Generate</button><button type="button" class="ghost" id="close">Cancel</button></div></form><div id="generation-status"></div></div>`;
  $('#close').onclick = () => d.classList.add('hidden');
  $('#source-form').onsubmit = async (event) => { event.preventDefault(); const btn = event.target.querySelector('button'); btn.disabled = true; $('#generation-status').innerHTML = '<p class="notice">Generating and checking the lesson…</p>'; try { const urls = String(new FormData(event.target).get('urls') || '').split(/\s+/).filter(Boolean); await api(`/api/admin/plans/${planId}/generate/${proposalId}`, { method: 'POST', body: JSON.stringify({ sourceUrls: urls }) }); d.classList.add('hidden'); await refresh(); } catch (e) { $('#generation-status').innerHTML = `<p class="notice error">${esc(e.message)}</p>`; } finally { btn.disabled = false; } };
}

function renderLessons() {
  $('#tab-lessons').innerHTML = `<div class="card"><div class="section-heading"><div><h2>Lessons</h2><p class="muted">Learners normally resolve review holds themselves. Use these controls only as an exceptional override.</p></div><span class="badge">${state.lessons.length}</span></div>${state.lessons.length ? `<div class="list">${state.lessons.map((lesson) => {
    const user = state.users.find((candidate) => candidate.id === lesson.userId);
    const held = ['needs_review', 'needs_changes'].includes(lesson.reviewStatus);
    return `<div class="list-item"><div class="actions">${badge(lesson.status)}${badge(lesson.reviewStatus)}<span class="badge">Quality ${lesson.quality?.score ?? '—'}</span></div><h3>${esc(lesson.title)}</h3><p>${esc(user?.name || lesson.userId)} · ${esc(lesson.topic)} · ${lesson.estimatedMinutes} min</p>${lesson.quality?.issues?.length ? `<div class="notice warn"><strong>Blocking review findings</strong><br>${lesson.quality.issues.map(esc).join('<br>')}</div>` : ''}${lesson.quality?.warnings?.length ? `<div class="notice"><strong>Non-blocking warnings</strong><br>${lesson.quality.warnings.map(esc).join('<br>')}</div>` : ''}<div class="actions" style="margin-top:10px"><button class="secondary preview" data-id="${lesson.id}">Preview</button>${held ? `<button class="approve" data-id="${lesson.id}">Override: approve & schedule</button>` : lesson.status === 'approved' ? `<button class="schedule" data-id="${lesson.id}">Schedule now</button>` : ''}${!['delivered', 'completed', 'skipped'].includes(lesson.status) ? `<button class="danger reject" data-id="${lesson.id}">Reject</button>` : ''}</div></div>`;
  }).join('')}</div>` : '<p class="muted">No lessons generated.</p>'}</div>`;
  document.querySelectorAll('.approve').forEach((button) => button.onclick = async () => { await api(`/api/admin/lessons/${button.dataset.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'approve', note: 'Exceptional administrator override' }) }); await refresh(); });
  document.querySelectorAll('.reject').forEach((button) => button.onclick = async () => { await api(`/api/admin/lessons/${button.dataset.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'reject', note: 'Rejected by administrator override' }) }); await refresh(); });
  document.querySelectorAll('.schedule').forEach((button) => button.onclick = async () => { await api(`/api/admin/lessons/${button.dataset.id}/schedule`, { method: 'POST', body: JSON.stringify({ runAt: new Date().toISOString() }) }); await refresh(); });
  document.querySelectorAll('.preview').forEach((button) => button.onclick = () => previewLesson(state.lessons.find((lesson) => lesson.id === button.dataset.id)));
}

function previewLesson(l) {
  const d = $('#dialog'); d.classList.remove('hidden'); const c = l.content || {};
  d.innerHTML = `<div class="card"><div class="actions">${badge(l.status)}<button class="ghost" id="close">Close</button></div><h2>${esc(l.title)}</h2><p><strong>${esc(l.question)}</strong></p><p>${esc(c.hook)}</p><h3>Core</h3><p>${esc(c.coreExplanation)}</p><h3>Three ideas</h3><ol>${(c.keyIdeas || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol><h3>Sources</h3><ol>${(l.sources || []).map((s) => `<li><a href="${esc(s.url)}" target="_blank">${esc(s.title)}</a></li>`).join('')}</ol></div>`;
  $('#close').onclick = () => d.classList.add('hidden');
}


function renderBooksAdmin() {
  const bookCards = state.books.length ? state.books.map((book) => {
    const user = state.users.find((item) => item.id === book.userId);
    const plan = state.bookPlans.find((item) => item.id === book.activePlanId || item.bookId === book.id);
    const sessions = state.bookSessions.filter((item) => item.bookId === book.id).sort((a, b) => a.sessionNumber - b.sessionNumber);
    const generated = new Set(sessions.map((item) => item.sessionNumber));
    const missing = (plan?.sessions || []).filter((item) => item.isCore !== false && !generated.has(item.number));
    return `<div class="list-item"><div class="lesson-meta"><div class="actions">${badge(book.status)}<span class="badge">Sources: ${esc(book.sourceQuality || 'pending')}</span><span class="badge">${book.progressPercent || 0}%</span></div><small>${esc(user?.name || book.userId)}</small></div><h3>${esc(book.title)}</h3><p>${esc(book.author || '')}${book.edition ? ` · ${esc(book.edition)}` : ''}</p>${book.sourceLimitations?.length ? `<div class="notice warn">${book.sourceLimitations.map(esc).join(' · ')}</div>` : ''}${book.analysisIntegrationError ? `<div class="notice warn"><strong>Submission needs correction</strong><br>${esc(book.analysisIntegrationError.message || book.analysisIntegrationError.code || 'Result contract error')}${book.analysisIntegrationError.details?.length ? `<br><small>${book.analysisIntegrationError.details.map(esc).join(' · ')}</small>` : ''}</div>` : ''}<div class="actions"><button class="secondary analyze-book" data-id="${book.id}">Re-analyze</button>${missing.length ? `<button class="ghost generate-book-session" data-book="${book.id}" data-number="${missing[0].number}">Queue session ${missing[0].number}</button>` : ''}</div>${plan ? `<details><summary>Plan: ${plan.sessions.length} sessions · ${plan.sessionsPerWeek}/week</summary><ol>${plan.sessions.map((item) => `<li>${item.number}. ${esc(item.title)}</li>`).join('')}</ol></details>` : ''}</div>`;
  }).join('') : '<p class="muted">No books added.</p>';

  const sessionCards = state.bookSessions.length ? state.bookSessions.map((session) => {
    const book = state.books.find((item) => item.id === session.bookId);
    return `<div class="list-item"><div class="actions">${badge(session.status)}${badge(session.reviewStatus)}<span class="badge">Quality ${session.quality?.score ?? '—'}</span></div><h3>${esc(book?.title || session.bookId)} — ${esc(session.title)}</h3><p>Session ${session.sessionNumber} · ${session.estimatedMinutes} min</p>${session.quality?.issues?.length ? `<div class="notice warn"><strong>Blocking review findings</strong><br>${session.quality.issues.map(esc).join('<br>')}</div>` : ''}${session.quality?.warnings?.length ? `<div class="notice"><strong>Non-blocking warnings</strong><br>${session.quality.warnings.map(esc).join('<br>')}</div>` : ''}<div class="actions"><button class="secondary preview-book-session" data-id="${session.id}">Preview</button>${['needs_review', 'needs_changes'].includes(session.reviewStatus) ? `<button class="approve-book-session" data-id="${session.id}">Override: approve & schedule</button>` : session.status === 'approved' ? `<button class="schedule-book-session" data-id="${session.id}">Schedule now</button>` : ''}${!['delivered', 'completed', 'skipped'].includes(session.status) ? `<button class="danger reject-book-session" data-id="${session.id}">Reject</button>` : ''}</div></div>`;
  }).join('') : '<p class="muted">No book sessions generated.</p>';

  $('#tab-books').innerHTML = `<div class="card"><div class="section-heading"><div><div class="kicker">Separate learning track</div><h2>Books</h2></div><span class="badge">${state.books.length}</span></div><div class="list">${bookCards}</div></div><div class="card"><div class="section-heading"><h2>Book sessions</h2><span class="badge">${state.bookSessions.length}</span></div><div class="list">${sessionCards}</div></div>`;
  document.querySelectorAll('.analyze-book').forEach((button) => button.onclick = async () => { await api(`/api/admin/books/${button.dataset.id}/analyze`, { method: 'POST', body: '{}' }); await refresh(); alert('Book analysis queued for the Business GPT.'); });
  document.querySelectorAll('.generate-book-session').forEach((button) => button.onclick = async () => { await api(`/api/admin/books/${button.dataset.book}/generate/${button.dataset.number}`, { method: 'POST', body: '{}' }); await refresh(); alert('Book session queued for the Business GPT.'); });
  document.querySelectorAll('.approve-book-session').forEach((button) => button.onclick = async () => { await api(`/api/admin/book-sessions/${button.dataset.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'approve', note: 'Exceptional administrator override' }) }); await refresh(); });
  document.querySelectorAll('.reject-book-session').forEach((button) => button.onclick = async () => { await api(`/api/admin/book-sessions/${button.dataset.id}/review`, { method: 'POST', body: JSON.stringify({ decision: 'reject', note: 'Rejected by administrator override' }) }); await refresh(); });
  document.querySelectorAll('.schedule-book-session').forEach((button) => button.onclick = async () => { await api(`/api/admin/book-sessions/${button.dataset.id}/schedule`, { method: 'POST', body: JSON.stringify({ runAt: new Date().toISOString() }) }); await refresh(); });
  document.querySelectorAll('.preview-book-session').forEach((button) => button.onclick = () => previewBookSession(state.bookSessions.find((item) => item.id === button.dataset.id)));
}

function previewBookSession(session) {
  const dialog = $('#dialog');
  const book = state.books.find((item) => item.id === session.bookId);
  const content = session.content || {};
  dialog.classList.remove('hidden');
  dialog.innerHTML = `<div class="card"><div class="actions">${badge(session.status)}${badge(session.reviewStatus)}<button class="ghost" id="close">Close</button></div><div class="kicker">${esc(book?.title || 'Book')} · Session ${session.sessionNumber}</div><h2>${esc(session.title)}</h2><h3>Summary</h3><p>${esc(content.summary || '')}</p><h3>Critical assessment</h3><p>${esc(content.criticalAssessment || '')}</p><h3>Three ideas</h3><ol>${(content.keyIdeas || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ol><h3>Sources</h3><ol>${(session.sources || []).filter((source) => source.url).map((source) => `<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a></li>`).join('')}</ol></div>`;
  $('#close').onclick = () => dialog.classList.add('hidden');
}

function renderChannels() {
  $('#tab-channels').innerHTML = `<div class="grid two"><div class="card"><h2>Telegram</h2><p>Status: ${state.status.telegram ? badge('enabled') : badge('disabled')}</p><p class="muted">The webhook is configured automatically when APP_BASE_URL uses HTTPS.</p></div><div class="card"><h2>WhatsApp Web</h2><p>Status: ${badge(state.status.whatsapp)}</p><form id="wa-pair"><label>Dedicated WhatsApp number<input name="phoneNumber" placeholder="32470123456" required></label><button style="margin-top:12px">Request pairing code</button></form><div id="pair-code"></div><p class="notice warn" style="margin-top:14px">This free connection is unofficial. Use a dedicated opted-in number and keep message volume low.</p></div></div>`;
  $('#wa-pair').onsubmit = async (event) => { event.preventDefault(); try { const result = await api('/api/admin/whatsapp/pair', { method: 'POST', body: JSON.stringify({ phoneNumber: new FormData(event.target).get('phoneNumber') }) }); $('#pair-code').innerHTML = `<p>Enter this code in WhatsApp linked devices:</p><pre class="code">${esc(result.pairingCode)}</pre>`; } catch (e) { error(e); } };
}

function renderOperations() {
  const pendingInternal = state.jobs.filter((job) => job.status === 'pending').length;
  const failedInternal = state.jobs.filter((job) => job.status === 'failed').length;
  $('#tab-operations').innerHTML = `<div class="grid two"><div class="card"><div class="section-heading"><div><h2>Verified-processing queue</h2><p class="muted">Tasks shown here require the configured Knowledge Pilot custom GPT. They are separate from local scheduler jobs.</p></div><span class="badge">${state.businessTasks.length}</span></div>${state.businessTasks.length ? `<div class="list">${state.businessTasks.slice(0,50).map((task) => `<div class="list-item"><div class="actions">${badge(task.status)}<span class="badge">${esc(task.type)}</span></div><strong>${esc(task.id)}</strong><br><small>${fmt(task.createdAt)} · priority ${task.priority}${task.claimedAt ? ` · claimed ${fmt(task.claimedAt)}` : ''}${task.submissionRejectCount ? ` · ${task.submissionRejectCount} rejected submission(s)` : ''}</small>${task.lastSubmissionError ? `<div class="notice warn" style="margin-top:8px">${esc(task.lastSubmissionError.message || task.error || 'Submission rejected')}${task.lastSubmissionError.details?.length ? `<br><small>${task.lastSubmissionError.details.map(esc).join(' · ')}</small>` : ''}</div>` : task.error ? `<div class="notice warn" style="margin-top:8px">${esc(task.error)}</div>` : ''}</div>`).join('')}</div>` : '<p class="muted">No verified-processing tasks yet.</p>'}${state.status.customGptUrl ? `<a class="button-link" href="${esc(state.status.customGptUrl)}" target="_blank" rel="noopener noreferrer">Open processing GPT</a>` : ''}</div>
  <div class="card"><h2>Backups</h2><button id="backup-now">Create backup</button><div class="list" style="margin-top:12px">${state.backups.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,10).map((backup) => `<div class="list-item"><strong>${esc(backup.name)}</strong><br><small>${fmt(backup.createdAt)} · ${Math.round(backup.size/1024)} KB</small></div>`).join('')}</div></div>
  <div class="card"><div class="section-heading"><div><h2>Local scheduler jobs</h2><p class="muted">Pending ${pendingInternal} · Failed ${failedInternal}. Future generation jobs are expected and are not the same as GPT tasks ready to process.</p></div></div><div class="list">${state.jobs.slice(0,40).map((job) => `<div class="list-item"><div class="actions">${badge(job.status)}<span class="badge">${esc(job.type)}</span></div><small>Run: ${fmt(job.runAt)} · attempts ${job.attempts || 0}${job.lastError ? ` · ${esc(job.lastError)}` : ''}</small></div>`).join('')}</div></div></div>`;
  $('#backup-now').onclick = async () => { await api('/api/admin/backups', { method: 'POST', body: '{}' }); await refresh(); };
}

function switchTab(name) { document.querySelectorAll('.nav-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name)); document.querySelectorAll('.section').forEach((s) => s.classList.toggle('active', s.id === `tab-${name}`)); }
document.querySelectorAll('.nav-tabs button').forEach((b) => b.onclick = () => switchTab(b.dataset.tab));
checkSession();
