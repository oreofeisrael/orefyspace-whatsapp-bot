const { isGroup } = require('../lib/groupUtils');
const { createSchedule, listSchedules, deleteSchedule } = require('../lib/scheduleStore');
const { getTimezone } = require('../lib/timezoneStore');

const DAY_NAMES = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

function parseTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseDays(value) {
  const days = String(value || 'daily').toLowerCase();
  if (['daily', 'weekdays', 'weekends'].includes(days)) return days;
  const parsed = days.split(',').map((day) => day.trim()).filter(Boolean);
  if (!parsed.length || parsed.some((day) => !DAY_NAMES.has(day))) return null;
  return [...new Set(parsed)].join(',');
}

function usage(prefix) {
  return `Usage:\n${prefix}schedule mute 23:00 daily\n${prefix}schedule unmute 06:00 weekdays\n${prefix}schedules\n${prefix}cancelschedule <id>`;
}

const schedulePlugin = {
  command: 'schedule',
  description: 'Create or list recurring group mute schedules',
  execute: async ({ sock, from, args, accountId, text }) => {
    if (!isGroup(from)) {
      await sock.sendMessage(from, { text: '❌ Scheduling group mute/unmute is only available inside a group.' });
      return;
    }
    const action = String(args[0] || '').toLowerCase();
    if (!['mute', 'unmute'].includes(action)) {
      await sock.sendMessage(from, { text: usage(text.trim().split(/\s+/)[0]) });
      return;
    }
    const time = parseTime(args[1]);
    const days = parseDays(args[2]);
    if (!time || !days) {
      await sock.sendMessage(from, { text: usage(text.trim().split(/\s+/)[0]) });
      return;
    }
    const schedule = await createSchedule(accountId, from, action, time, days);
    const timezone = await getTimezone(accountId);
    await sock.sendMessage(from, {
      text: `✅ Schedule #${schedule.id} created.\n\nAction: *${action}*\nTime: *${time}*\nRepeats: *${days}*\nTimezone: *${timezone}*`,
    });
  },
};

const listPlugin = {
  command: ['schedules', 'schedulelist'],
  description: 'List recurring group mute schedules',
  execute: async ({ sock, from, accountId }) => {
    if (!isGroup(from)) {
      await sock.sendMessage(from, { text: '❌ Schedules are managed inside a group.' });
      return;
    }
    const schedules = await listSchedules(accountId, from);
    const timezone = await getTimezone(accountId);
    if (!schedules.length) {
      await sock.sendMessage(from, { text: `📅 No recurring schedules for this group.\nTimezone: ${timezone}` });
      return;
    }
    const lines = schedules.map((schedule) =>
      `#${schedule.id} — ${schedule.action} at ${schedule.time_local} (${schedule.days})`
    );
    await sock.sendMessage(from, {
      text: `📅 *Recurring schedules*\nTimezone: *${timezone}*\n\n${lines.join('\n')}\n\nCancel with \.cancelschedule <id>`,
    });
  },
};

const cancelPlugin = {
  command: ['cancelschedule', 'unschedule'],
  description: 'Cancel a recurring group mute schedule',
  execute: async ({ sock, from, args, accountId }) => {
    if (!isGroup(from)) {
      await sock.sendMessage(from, { text: '❌ Schedules are managed inside a group.' });
      return;
    }
    const id = Number.parseInt(args[0], 10);
    if (!Number.isInteger(id)) {
      await sock.sendMessage(from, { text: 'Usage: `.cancelschedule <id>`' });
      return;
    }
    const deleted = await deleteSchedule(accountId, id, from);
    await sock.sendMessage(from, {
      text: deleted ? `✅ Schedule #${id} cancelled.` : `❌ Schedule #${id} was not found in this group.`,
    });
  },
};

module.exports = [schedulePlugin, listPlugin, cancelPlugin];
