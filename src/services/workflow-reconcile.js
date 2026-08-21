import { nowIso } from '../utils.js';
import { queueSystemNotice, taskTypeLabel } from './notices.js';

function activeJob(jobs, type, field, id) {
  return jobs.some((job) => job.type === type && job.payload?.[field] === id && ['pending', 'running'].includes(job.status));
}

function usableRunAt(value, fallback) {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

export async function reconcileWorkflow({ store, learning, books = null, config, logger = console }) {
  const snapshot = store.snapshot();
  const jobs = Object.values(snapshot.jobs || {});
  const delayMinutes = Math.max(0, Number(config.businessActions?.autoScheduleDelayMinutes ?? 2));
  const automaticRunAt = () => new Date(Date.now() + delayMinutes * 60_000).toISOString();
  const repaired = { lessonsScheduled: 0, bookSessionsScheduled: 0, noticesQueued: 0, errors: [] };

  for (const lesson of Object.values(snapshot.lessons || {})) {
    const user = snapshot.users?.[lesson.userId];
    if (!user || lesson.reviewStatus !== 'approved') continue;
    const missingDeliveryJob = !activeJob(jobs, 'deliver_lesson', 'lessonId', lesson.id);
    const shouldAutoSchedule = lesson.status === 'approved' && user.automation?.autoScheduleApproved !== false;
    const shouldRepairSchedule = lesson.status === 'scheduled' && missingDeliveryJob;
    if (!shouldAutoSchedule && !shouldRepairSchedule) continue;
    try {
      await learning.scheduleLesson(lesson.id, shouldRepairSchedule ? usableRunAt(lesson.scheduledAt, automaticRunAt()) : automaticRunAt());
      repaired.lessonsScheduled += 1;
    } catch (error) {
      repaired.errors.push({ kind: 'lesson', id: lesson.id, error: error.message });
    }
  }

  if (books) {
    for (const session of Object.values(snapshot.bookSessions || {})) {
      const user = snapshot.users?.[session.userId];
      if (!user || session.reviewStatus !== 'approved') continue;
      const missingDeliveryJob = !activeJob(jobs, 'deliver_book_session', 'sessionId', session.id);
      const shouldAutoSchedule = session.status === 'approved' && user.automation?.autoScheduleApproved !== false;
      const shouldRepairSchedule = session.status === 'scheduled' && missingDeliveryJob;
      if (!shouldAutoSchedule && !shouldRepairSchedule) continue;
      try {
        await books.scheduleSession(session.id, shouldRepairSchedule ? usableRunAt(session.scheduledAt, automaticRunAt()) : automaticRunAt());
        repaired.bookSessionsScheduled += 1;
      } catch (error) {
        repaired.errors.push({ kind: 'book_session', id: session.id, error: error.message });
      }
    }
  }

  const before = Object.keys(store.snapshot().jobs || {}).length;
  await store.transaction((state) => {
    for (const lesson of Object.values(state.lessons || {})) {
      const user = state.users?.[lesson.userId];
      if (!user || user.automation?.notifyActionRequired === false || !['needs_review', 'needs_changes'].includes(lesson.reviewStatus)) continue;
      if (['delivered', 'completed', 'skipped', 'rejected'].includes(lesson.status)) continue;
      queueSystemNotice(state, {
        userId: user.id,
        kind: 'lesson_review_required',
        title: 'Lesson needs your review',
        message: `“${lesson.title || 'A lesson'}” is ready but requires your decision before delivery.`,
        actionUrl: `${learning.accessUrl(user)}#lesson=${lesson.id}`,
        actionLabel: 'Review lesson',
        dedupeKey: `lesson-review:${lesson.id}:r${Number(lesson.revisionNumber || 0)}`,
        metadata: { lessonId: lesson.id, issues: lesson.quality?.issues || [] }
      });
    }

    for (const session of Object.values(state.bookSessions || {})) {
      const user = state.users?.[session.userId];
      if (!user || user.automation?.notifyActionRequired === false || !['needs_review', 'needs_changes'].includes(session.reviewStatus)) continue;
      if (['delivered', 'completed', 'skipped', 'rejected'].includes(session.status)) continue;
      const book = state.books?.[session.bookId];
      queueSystemNotice(state, {
        userId: user.id,
        kind: 'book_session_review_required',
        title: 'Book session needs your review',
        message: `“${book?.title || 'Book'} — Session ${session.sessionNumber || ''}” is ready but requires your decision before delivery.`,
        actionUrl: `${learning.accessUrl(user)}#book-session=${session.id}`,
        actionLabel: 'Review session',
        dedupeKey: `book-session-review:${session.id}:r${Number(session.revisionNumber || 0)}`,
        metadata: { sessionId: session.id, bookId: session.bookId, issues: session.quality?.issues || [] }
      });
    }

    for (const plan of Object.values(state.plans || {})) {
      const user = state.users?.[plan.userId];
      if (!user || user.automation?.notifyActionRequired === false || plan.status !== 'draft') continue;
      queueSystemNotice(state, {
        userId: user.id,
        kind: 'weekly_plan_approval_required',
        title: 'Weekly plan ready',
        message: 'Your weekly learning plan is ready for review. Approve or adjust it to continue.',
        actionUrl: `${learning.accessUrl(user)}#plan`,
        actionLabel: 'Review weekly plan',
        dedupeKey: `weekly-plan-review:${plan.id}`,
        metadata: { planId: plan.id }
      });
    }

    for (const book of Object.values(state.books || {})) {
      const user = state.users?.[book.userId];
      if (!user || user.automation?.notifyActionRequired === false) continue;
      if (book.status === 'awaiting_plan_approval') {
        queueSystemNotice(state, {
          userId: user.id,
          kind: 'book_plan_approval_required',
          title: 'Book plan ready',
          message: `The reading plan for “${book.title || 'your book'}” is ready for review.`,
          actionUrl: `${learning.accessUrl(user)}#book=${book.id}`,
          actionLabel: 'Review book plan',
          dedupeKey: `book-plan-review:${book.activePlanId || book.id}`,
          metadata: { bookId: book.id, planId: book.activePlanId || null }
        });
      } else if (book.status === 'source_required') {
        queueSystemNotice(state, {
          userId: user.id,
          kind: 'book_source_required',
          title: 'Book source needed',
          message: `Knowledge Pilot needs an owned copy or a better source before it can build a reliable plan for “${book.title || 'your book'}”.`,
          actionUrl: `${learning.accessUrl(user)}#book=${book.id}`,
          actionLabel: 'Open book',
          dedupeKey: `book-source-required:${book.id}`,
          metadata: { bookId: book.id }
        });
      }
    }

    for (const task of Object.values(state.businessTasks || {})) {
      const user = state.users?.[task.userId];
      if (!user || user.automation?.notifyActionRequired === false || !['pending', 'claimed'].includes(task.status)) continue;
      queueSystemNotice(state, {
        userId: user.id,
        kind: 'processing_required',
        title: 'Verified processing is waiting',
        message: `A ${taskTypeLabel(task.type)} is queued and waiting for the Knowledge Pilot custom GPT to process it.`,
        actionUrl: config.businessActions?.customGptUrl || learning.accessUrl(user),
        actionLabel: config.businessActions?.customGptUrl ? 'Open Knowledge Pilot GPT' : 'Open dashboard',
        dedupeKey: `business-task-pending:${task.id}`,
        metadata: { taskId: task.id, taskType: task.type }
      });
    }

    for (const job of Object.values(state.jobs || {})) {
      const user = state.users?.[job.userId];
      if (!user || user.automation?.notifyActionRequired === false || job.status !== 'failed' || job.type === 'send_system_notice') continue;
      queueSystemNotice(state, {
        userId: user.id,
        kind: 'system_job_failed',
        title: 'Knowledge Pilot needs attention',
        message: `A ${String(job.type || 'system').replaceAll('_', ' ')} task failed. Open the dashboard to review it.`,
        actionUrl: learning.accessUrl(user),
        actionLabel: 'Open dashboard',
        dedupeKey: `system-job-failed:${job.id}`,
        metadata: { jobId: job.id, jobType: job.type, error: job.lastError || '' }
      });
    }
  });
  repaired.noticesQueued = Math.max(0, Object.keys(store.snapshot().jobs || {}).length - before);

  if (repaired.errors.length) logger.warn({ errors: repaired.errors }, 'Workflow reconciliation completed with recoverable errors');
  else logger.info(repaired, 'Workflow reconciliation completed');
  return { ...repaired, completedAt: nowIso() };
}
