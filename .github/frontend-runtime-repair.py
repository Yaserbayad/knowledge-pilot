from pathlib import Path
import re

app_path = Path('public/app.js')
admin_path = Path('public/admin.js')
css_path = Path('public/styles.css')
app = app_path.read_text()
admin = admin_path.read_text()
css = css_path.read_text()


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label} anchor count was {count}, expected 1')
    return text.replace(old, new, 1)


def replace_pattern(text, pattern, replacement, label):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label} replacement count was {count}, expected 1')
    return updated


app_helper_anchor = "function clearError() { $('#error').classList.add('hidden'); }\n\nfunction showToast(message) {"
app_helper = """function clearError() { $('#error').classList.add('hidden'); }

function openDialogSurface(html, { labelId = 'dialog-title', initialFocus = '[autofocus], #close-dialog, button, a[href], input, textarea, select' } = {}) {
  const dialog = $('#dialog');
  const previous = document.activeElement;
  dialog.innerHTML = html;
  dialog.setAttribute('aria-labelledby', labelId);
  dialog.classList.remove('hidden');
  const close = () => {
    dialog.classList.add('hidden');
    dialog.innerHTML = '';
    dialog.removeAttribute('aria-labelledby');
    dialog.onclick = null;
    dialog.onkeydown = null;
    previous?.focus?.();
  };
  dialog.onclick = (event) => { if (event.target === dialog) close(); };
  dialog.onkeydown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
        .filter((item) => !item.disabled && !item.hidden && item.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  dialog.querySelector(initialFocus)?.focus();
  return { dialog, close };
}

function clampProgress(value) { return Math.max(0, Math.min(100, Number(value) || 0)); }
function applyDynamicStyles(root = document) {
  root.querySelectorAll('[data-progress-inline]').forEach((item) => { item.style.inlineSize = `${clampProgress(item.dataset.progressInline)}%`; });
  root.querySelectorAll('[data-progress-width]').forEach((item) => { item.style.width = `${clampProgress(item.dataset.progressWidth)}%`; });
}
const dynamicStyleObserver = new MutationObserver(() => applyDynamicStyles());
dynamicStyleObserver.observe(document.documentElement, { childList: true, subtree: true });

function showToast(message) {"""
app = replace_once(app, app_helper_anchor, app_helper, 'learner dialog helper')

app = replace_pattern(
    app,
    r"function openScheduleDialog\(kind, id, currentAt = ''\) \{.*?\n\}\n\nfunction bindReviewActions",
    """function openScheduleDialog(kind, id, currentAt = '') {
  const endpoint = kind === 'book' ? '/api/book-sessions' : '/api/lessons';
  const suggested = currentAt ? new Date(currentAt) : new Date(Date.now() + 5 * 60_000);
  const localValue = new Date(suggested.getTime() - suggested.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const { close } = openDialogSurface(`<div class="card"><div class="dialog-heading"><h2 id="dialog-title">Choose delivery time</h2><button type="button" class="icon-button ghost" id="close-dialog" aria-label="Close">×</button></div><form id="schedule-form"><label>Delivery date and time<input type="datetime-local" name="runAt" value="${esc(localValue)}" required></label><div class="actions dialog-actions"><button>Save schedule</button><button type="button" class="ghost" id="deliver-immediately">Deliver now</button></div></form></div>`, { initialFocus: 'input[name="runAt"]' });
  $('#close-dialog').onclick = close;
  $('#schedule-form').onsubmit = async (event) => {
    event.preventDefault();
    const value = new FormData(event.target).get('runAt');
    const runAt = new Date(String(value));
    if (Number.isNaN(runAt.getTime())) return showError(new Error('Choose a valid delivery time.'));
    await api(`${endpoint}/${id}/schedule`, { method: 'POST', body: JSON.stringify({ runAt: runAt.toISOString() }) });
    close(); await refreshData(); showToast('Delivery schedule updated.');
  };
  $('#deliver-immediately').onclick = async () => {
    await api(`${endpoint}/${id}/schedule`, { method: 'POST', body: JSON.stringify({ runAt: new Date().toISOString() }) });
    close(); await refreshData(); showToast('Queued for immediate delivery.');
  };
}

function bindReviewActions""",
    'schedule dialog',
)

app = replace_pattern(
    app,
    r"function openAccessibleSheet\(title, body, bind = \(\) => \{\}\) \{.*?\n\}\n\nfunction openOutlineSheet",
    """function openAccessibleSheet(title, body, bind = () => {}) {
  const { dialog, close } = openDialogSurface(`<div class="card lesson-sheet" role="document"><div class="dialog-heading"><h2 id="dialog-title">${esc(title)}</h2><button type="button" class="icon-button ghost" id="close-dialog" aria-label="Close">×</button></div>${body}</div>`);
  $('#close-dialog').onclick = close;
  bind(dialog, close);
}

function openOutlineSheet""",
    'accessible sheet',
)

app = replace_pattern(
    app,
    r"function openQuestionDialog\(lesson, starter = ''\) \{.*?\n\}\n\nfunction renderPlan",
    """function openQuestionDialog(lesson, starter = '') {
  const { close } = openDialogSurface(`<div class="card"><div class="dialog-heading"><h2 id="dialog-title">${esc(uiText(lesson, 'discussTitle'))}</h2><button type="button" class="icon-button ghost" id="close-dialog" aria-label="Close">×</button></div><form id="question-form"><label>${esc(uiText(lesson, 'questionLabel'))}<textarea name="question" dir="auto" required autofocus>${esc(starter)}</textarea></label><p class="muted">${esc(uiText(lesson, 'aiProcessing'))}</p><div class="actions dialog-actions"><button>${esc(uiText(lesson, 'ask'))}</button><button type="button" class="ghost" id="cancel-dialog">${esc(uiText(lesson, 'cancel'))}</button></div></form><div id="question-answer"></div></div>`, { initialFocus: 'textarea[name="question"]' });
  $('#close-dialog').onclick = close;
  $('#cancel-dialog').onclick = close;
  $('#question-form').onsubmit = async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    try {
      const result = await api(`/api/lessons/${lesson.id}/follow-up`, { method: 'POST', body: JSON.stringify({ question: new FormData(event.target).get('question') }) });
      $('#question-answer').innerHTML = `<div class="notice dialog-result" dir="auto">${esc(result.answer)}</div>`;
    } catch (error) {
      $('#question-answer').innerHTML = `<div class="notice error dialog-result">${esc(error.message)}</div>`;
    } finally { button.disabled = false; }
  };
}

function renderPlan""",
    'learner question dialog',
)

app = replace_pattern(
    app,
    r"  if \(\$\('#ask-book-question'\)\) \$\('#ask-book-question'\)\.onclick = \(\) => \{.*?\n  \};\n  if \(\$\('#book-feedback-form'\)\)",
    """  if ($('#ask-book-question')) $('#ask-book-question').onclick = () => {
    const { close } = openDialogSurface(`<div class="card"><div class="dialog-heading"><h2 id="dialog-title">Ask about this book session</h2><button type="button" class="icon-button ghost" id="close-dialog" aria-label="Close">×</button></div><form id="book-question-form"><label>Question<textarea name="question" dir="auto" required autofocus></textarea></label><div class="actions dialog-actions"><button>Ask</button></div></form><div id="book-question-answer"></div></div>`, { initialFocus: 'textarea[name="question"]' });
    $('#close-dialog').onclick = close;
    $('#book-question-form').onsubmit = async (event) => { event.preventDefault(); const result = await api(`/api/book-sessions/${session.id}/follow-up`, { method: 'POST', body: JSON.stringify({ question: new FormData(event.target).get('question') }) }); $('#book-question-answer').innerHTML = `<div class="notice dialog-result" dir="auto">${esc(result.answer)}</div>`; };
  };
  if ($('#book-feedback-form'))""",
    'book question dialog',
)

for old, new, expected in [
    ('<span style="inline-size:${Number(lesson.resumePercent)}%"></span>', '<span data-progress-inline="${Number(lesson.resumePercent)}"></span>', 1),
    ('<span style="inline-size:${progress}%"></span>', '<span data-progress-inline="${progress}"></span>', 1),
    ('<div class="progress-fill" style="width:${Number(book.progressPercent || 0)}%"></div>', '<div class="progress-fill" data-progress-width="${Number(book.progressPercent || 0)}"></div>', 3),
]:
    count = app.count(old)
    if count != expected:
        raise SystemExit(f'learner progress style count was {count}, expected {expected}')
    app = app.replace(old, new)

if re.search(r'\sstyle\s*=\s*["\']', app, flags=re.I):
    raise SystemExit('learner asset still emits inline style attributes')

admin_helper_anchor = "function fmt(date) { return date ? new Date(date).toLocaleString() : '—'; }\n\nasync function checkSession() {"
admin_helper = """function fmt(date) { return date ? new Date(date).toLocaleString() : '—'; }

function openDialogSurface(html, { labelId = 'dialog-title', initialFocus = '[autofocus], #close, button, a[href], input, textarea, select' } = {}) {
  const dialog = $('#dialog');
  const previous = document.activeElement;
  dialog.innerHTML = html;
  dialog.setAttribute('aria-labelledby', labelId);
  dialog.classList.remove('hidden');
  const close = () => {
    dialog.classList.add('hidden');
    dialog.innerHTML = '';
    dialog.removeAttribute('aria-labelledby');
    dialog.onclick = null;
    dialog.onkeydown = null;
    previous?.focus?.();
  };
  dialog.onclick = (event) => { if (event.target === dialog) close(); };
  dialog.onkeydown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])')]
        .filter((item) => !item.disabled && !item.hidden && item.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) { event.preventDefault(); return; }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  dialog.querySelector(initialFocus)?.focus();
  return { dialog, close };
}

async function checkSession() {"""
admin = replace_once(admin, admin_helper_anchor, admin_helper, 'admin dialog helper')

admin = replace_pattern(
    admin,
    r"async function sourceDialog\(planId, proposalId\) \{.*?\n\}\n\nfunction renderLessons",
    """async function sourceDialog(planId, proposalId) {
  if (state.status.aiProvider === 'chatgpt_business') {
    try {
      const result = await api(`/api/admin/plans/${planId}/generate/${proposalId}`, { method: 'POST', body: '{}' });
      if (result.queued) alert('Lesson queued. Open the Knowledge Pilot custom GPT and ask it to process pending tasks.');
      await refresh();
    } catch (e) { error(e); }
    return;
  }
  const { close } = openDialogSurface(`<div class="card"><h2 id="dialog-title">Generate researched lesson</h2><p class="muted">Optional: add trusted source URLs, one per line. SearXNG results are also used when configured.</p><form id="source-form"><label>Source URLs<textarea name="urls"></textarea></label><div class="actions admin-dialog-actions"><button>Generate</button><button type="button" class="ghost" id="close" aria-label="Close">Cancel</button></div></form><div id="generation-status"></div></div>`, { initialFocus: 'textarea[name="urls"]' });
  $('#close').onclick = close;
  $('#source-form').onsubmit = async (event) => { event.preventDefault(); const btn = event.target.querySelector('button'); btn.disabled = true; $('#generation-status').innerHTML = '<p class="notice">Generating and checking the lesson…</p>'; try { const urls = String(new FormData(event.target).get('urls') || '').split(/\\s+/).filter(Boolean); await api(`/api/admin/plans/${planId}/generate/${proposalId}`, { method: 'POST', body: JSON.stringify({ sourceUrls: urls }) }); close(); await refresh(); } catch (e) { $('#generation-status').innerHTML = `<p class="notice error">${esc(e.message)}</p>`; } finally { btn.disabled = false; } };
}

function renderLessons""",
    'admin source dialog',
)

admin = replace_pattern(
    admin,
    r"function previewLesson\(l\) \{.*?\n\}\n\n\nfunction renderBooksAdmin",
    """function previewLesson(l) {
  const c = l.content || {};
  const { close } = openDialogSurface(`<div class="card"><div class="actions">${badge(l.status)}<button class="ghost" id="close" aria-label="Close">Close</button></div><h2 id="dialog-title">${esc(l.title)}</h2><p><strong>${esc(l.question)}</strong></p><p>${esc(c.hook)}</p><h3>Core</h3><p>${esc(c.coreExplanation)}</p><h3>Three ideas</h3><ol>${(c.keyIdeas || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol><h3>Sources</h3><ol>${(l.sources || []).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></li>`).join('')}</ol></div>`);
  $('#close').onclick = close;
}


function renderBooksAdmin""",
    'admin lesson preview',
)

admin = replace_pattern(
    admin,
    r"function previewBookSession\(session\) \{.*?\n\}\n\nfunction renderChannels",
    """function previewBookSession(session) {
  const book = state.books.find((item) => item.id === session.bookId);
  const content = session.content || {};
  const { close } = openDialogSurface(`<div class="card"><div class="actions">${badge(session.status)}${badge(session.reviewStatus)}<button class="ghost" id="close" aria-label="Close">Close</button></div><div class="kicker">${esc(book?.title || 'Book')} · Session ${session.sessionNumber}</div><h2 id="dialog-title">${esc(session.title)}</h2><h3>Summary</h3><p>${esc(content.summary || '')}</p><h3>Critical assessment</h3><p>${esc(content.criticalAssessment || '')}</p><h3>Three ideas</h3><ol>${(content.keyIdeas || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ol><h3>Sources</h3><ol>${(session.sources || []).filter((source) => source.url).map((source) => `<li><a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a></li>`).join('')}</ol></div>`);
  $('#close').onclick = close;
}

function renderChannels""",
    'admin book preview',
)

for old, new, expected in [
    ('<div style="padding:.65rem 0;border-top:1px solid var(--line)">', '<div class="admin-proposal-row">', 1),
    ('<div class="actions" style="margin-top:6px">', '<div class="actions admin-row-actions">', 1),
    ('<div class="actions" style="margin-top:10px">', '<div class="actions admin-item-actions">', 1),
    ('<button style="margin-top:12px">Request pairing code</button>', '<button class="admin-form-submit">Request pairing code</button>', 1),
    ('<p class="notice warn" style="margin-top:14px">', '<p class="notice warn admin-spaced-notice">', 1),
    ('<div class="notice warn" style="margin-top:8px">', '<div class="notice warn admin-compact-notice">', 2),
    ('<div class="list" style="margin-top:12px">', '<div class="list admin-spaced-list">', 1),
]:
    count = admin.count(old)
    if count != expected:
        raise SystemExit(f'admin style anchor count was {count}, expected {expected}: {old}')
    admin = admin.replace(old, new)

if re.search(r'\sstyle\s*=\s*["\']', admin, flags=re.I):
    raise SystemExit('admin asset still emits inline style attributes')

css_anchor = ".dialog-actions, .dialog-result { margin-block-start: 14px; }\n"
css_replacement = """.dialog-actions, .dialog-result { margin-block-start: 14px; }
.admin-proposal-row { padding: .65rem 0; border-block-start: 1px solid var(--line); }
.admin-row-actions { margin-block-start: 6px; }
.admin-dialog-actions, .admin-spaced-list, .admin-form-submit { margin-block-start: 12px; }
.admin-item-actions { margin-block-start: 10px; }
.admin-spaced-notice { margin-block-start: 14px; }
.admin-compact-notice { margin-block-start: 8px; }
"""
css = replace_once(css, css_anchor, css_replacement, 'admin CSP-safe spacing classes')

app_path.write_text(app)
admin_path.write_text(admin)
css_path.write_text(css)
