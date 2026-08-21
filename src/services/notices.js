import { nowIso, uid } from '../utils.js';

export function queueSystemNotice(state, {
  userId,
  kind = 'system',
  title,
  message,
  actionUrl = '',
  actionLabel = '',
  dedupeKey = '',
  metadata = {}
}) {
  if (!userId || !title || !message) return null;
  const key = String(dedupeKey || `${kind}:${userId}:${title}:${message}`).slice(0, 500);
  const existing = Object.values(state.jobs || {}).find((job) => job.type === 'send_system_notice' && job.payload?.dedupeKey === key && !['failed', 'cancelled'].includes(job.status));
  if (existing) return existing;
  const job = {
    id: uid('job'),
    type: 'send_system_notice',
    userId,
    payload: {
      kind: String(kind).slice(0, 80),
      title: String(title).slice(0, 300),
      message: String(message).slice(0, 4000),
      actionUrl: String(actionUrl || '').slice(0, 2000),
      actionLabel: String(actionLabel || '').slice(0, 120),
      dedupeKey: key,
      metadata
    },
    runAt: nowIso(),
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.jobs ||= {};
  state.jobs[job.id] = job;
  return job;
}

export function taskTypeLabel(type) {
  return ({
    weekly_plan: 'weekly plan',
    lesson: 'lesson',
    follow_up: 'follow-up answer',
    reinforcement_evaluation: 'recall evaluation',
    book_analysis: 'book analysis',
    book_session: 'book session',
    book_finale: 'book synthesis',
    book_follow_up: 'book follow-up answer',
    book_reinforcement_evaluation: 'book recall evaluation'
  })[type] || String(type || 'task').replaceAll('_', ' ');
}
