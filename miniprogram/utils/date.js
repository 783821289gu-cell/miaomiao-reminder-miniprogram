const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function pad(num) {
  return String(num).padStart(2, "0");
}

function cloneDate(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toDateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromDateString(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function getTodayString(now) {
  return toDateString(cloneDate(now || new Date()));
}

function addDays(date, days) {
  const next = cloneDate(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getMonthDays(year, month) {
  return new Date(year, month, 0).getDate();
}

function formatDisplayDate(value) {
  const date = typeof value === "string" ? fromDateString(value) : value;
  if (!date) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`;
}

function formatShortDate(value) {
  const date = typeof value === "string" ? fromDateString(value) : value;
  if (!date) return "";
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function diffDays(targetDate, now) {
  const target = typeof targetDate === "string" ? fromDateString(targetDate) : targetDate;
  if (!target) return 0;
  const today = cloneDate(now || new Date());
  return Math.round((cloneDate(target).getTime() - today.getTime()) / 86400000);
}

function getCountdownInfo(targetDate, now) {
  const days = diffDays(targetDate, now);
  if (days > 0) {
    const statusText = days === 1 ? "明天" : (days === 2 ? "后天" : "未来");
    return { days, absDays: days, status: "future", statusText, prefix: "还有", showDayCount: true, centerText: "" };
  }
  if (days === 0) {
    return { days, absDays: 0, status: "today", statusText: "今天", prefix: "", showDayCount: false, centerText: "就是今天" };
  }
  return { days, absDays: Math.abs(days), status: "past", statusText: "已过", prefix: "已过", showDayCount: true, centerText: "" };
}

function buildYearRange(now) {
  const year = (now || new Date()).getFullYear();
  const years = [];
  for (let item = year - 3; item <= year + 12; item += 1) {
    years.push(item);
  }
  return years;
}

module.exports = {
  WEEKDAYS,
  pad,
  cloneDate,
  toDateString,
  fromDateString,
  getTodayString,
  addDays,
  getMonthDays,
  formatDisplayDate,
  formatShortDate,
  diffDays,
  getCountdownInfo,
  buildYearRange,
};
