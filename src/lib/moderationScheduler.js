const { listSchedules, markScheduleRun } = require('./scheduleStore');
const { getTimezone } = require('./timezoneStore');

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function localParts(timeZone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: values.weekday.toLowerCase().slice(0, 3),
    time: `${values.hour}:${values.minute}`,
    date: `${values.year}-${values.month}-${values.day}`,
  };
}

function scheduleMatches(schedule, parts) {
  if (schedule.time_local !== parts.time) return false;
  const days = String(schedule.days || 'daily').toLowerCase();
  if (days === 'daily') return true;
  if (days === 'weekdays') return !['sat', 'sun'].includes(parts.weekday);
  if (days === 'weekends') return ['sat', 'sun'].includes(parts.weekday);
  return days.split(',').map((day) => day.trim()).includes(parts.weekday);
}

async function runAccountSchedules(session) {
  if (!session.sock || session.connectionState !== 'connected') return;
  const timezone = await getTimezone(session.accountId);
  const parts = localParts(timezone);
  const schedules = await listSchedules(session.accountId);
  for (const schedule of schedules) {
    if (!scheduleMatches(schedule, parts)) continue;
    const runKey = `${parts.date} ${parts.time}`;
    if (schedule.last_run_key === runKey) continue;
    await markScheduleRun(schedule.id, runKey);
    try {
      await session.sock.groupSettingUpdate(
        schedule.group_jid,
        schedule.action === 'mute' ? 'announcement' : 'not_announcement'
      );
      await session.sock.sendMessage(schedule.group_jid, {
        text: schedule.action === 'mute'
          ? '🔇 *Scheduled group mute applied.* Only admins can send messages until the scheduled unmute.'
          : '🔊 *Scheduled group unmute applied.* Everyone can send messages again.',
      });
      console.log(`⏰ Applied scheduled ${schedule.action} for ${session.accountId}/${schedule.group_jid} (${timezone})`);
    } catch (error) {
      console.error(`❌ Scheduled ${schedule.action} failed for ${session.accountId}/${schedule.group_jid}:`, error.message);
    }
  }
}

function startModerationScheduler(sessions) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      for (const session of sessions.values()) {
        await runAccountSchedules(session);
      }
    } catch (error) {
      console.error('❌ Moderation scheduler error:', error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 30 * 1000);
  timer.unref?.();
  tick();
  return timer;
}

module.exports = { localParts, scheduleMatches, startModerationScheduler };
