const dateUtils = require("./date");

const EXAMPLE_HINT = "试试：明天交作业";
const EXAMPLE_TEXT = "例如：明天交作业 / 下周五团队会议 / 8月1日朋友生日";

const CN_NUM = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const WEEK_MAP = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 0,
};

const UNSUPPORTED_PATTERN = /删除|删掉|取消|改成|改到|修改|更改|调整|查一下|查询|看看|还有什么|有哪些|列表|清空/;
const WEAK_TEXT_PATTERN = /^(哈+|呵+|嘿+|喂+|嗯+|啊+|测试|test|随便|不知道)$/i;
const FILLER_PATTERN = /帮我记一下|帮我记一条|帮我记|记一下|记一条|提醒我一下|提醒我|我想|我要|新增|添加|创建|安排一个|安排/g;

function toHalfWidth(text) {
  return String(text || "").replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248));
}

function parseChineseNumber(value) {
  if (value === undefined || value === null) return NaN;
  const text = toHalfWidth(value).trim();
  if (!text) return NaN;
  if (/^\d+$/.test(text)) return Number(text);
  if (text === "半") return 30;
  if (text === "十") return 10;
  const tenIndex = text.indexOf("十");
  if (tenIndex >= 0) {
    const left = text.slice(0, tenIndex);
    const right = text.slice(tenIndex + 1);
    const tens = left ? CN_NUM[left] || 0 : 1;
    const ones = right ? CN_NUM[right] || 0 : 0;
    return tens * 10 + ones;
  }
  let result = 0;
  for (let index = 0; index < text.length; index += 1) {
    const num = CN_NUM[text[index]];
    if (num === undefined) return NaN;
    result = result * 10 + num;
  }
  return result;
}

function normalizeText(text) {
  return toHalfWidth(text)
    .replace(/\s+/g, "")
    .replace(/：/g, ":")
    .replace(/．/g, ".")
    .replace(/[，。；、,;]/g, "，");
}

function validDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return dateUtils.toDateString(date);
}

function normalizeFutureDate(year, month, day, now) {
  const current = now || new Date();
  let targetYear = year || current.getFullYear();
  let date = validDate(targetYear, month, day);
  if (!date) return null;
  if (!year && dateUtils.diffDays(date, current) < 0) {
    targetYear += 1;
    date = validDate(targetYear, month, day);
  }
  return date;
}

function getWeekStartMonday(date) {
  const day = date.getDay();
  const offset = -((day + 6) % 7);
  return dateUtils.addDays(date, offset);
}

function weekDayOffset(weekDay) {
  return weekDay === 0 ? 6 : weekDay - 1;
}

function resolveRelativeDate(text, now) {
  const source = normalizeText(text);
  const base = dateUtils.cloneDate(now || new Date());
  const relativeRules = [
    { pattern: /大后天/, offset: 3 },
    { pattern: /后天/, offset: 2 },
    { pattern: /明天/, offset: 1 },
    { pattern: /今天/, offset: 0 },
  ];

  for (let index = 0; index < relativeRules.length; index += 1) {
    const rule = relativeRules[index];
    const match = source.match(rule.pattern);
    if (match) {
      return {
        date: dateUtils.toDateString(dateUtils.addDays(base, rule.offset)),
        matchedText: match[0],
      };
    }
  }

  let match = source.match(/下(?:个)?(?:周|星期|礼拜)([一二三四五六日天1-7])/);
  if (match) {
    const weekDay = WEEK_MAP[match[1]];
    const monday = getWeekStartMonday(base);
    return {
      date: dateUtils.toDateString(dateUtils.addDays(monday, 7 + weekDayOffset(weekDay))),
      matchedText: match[0],
    };
  }

  match = source.match(/(?:本周|这周|本星期|这星期|本礼拜|这礼拜)([一二三四五六日天1-7])/);
  if (match) {
    const weekDay = WEEK_MAP[match[1]];
    const monday = getWeekStartMonday(base);
    return {
      date: dateUtils.toDateString(dateUtils.addDays(monday, weekDayOffset(weekDay))),
      matchedText: match[0],
    };
  }

  match = source.match(/(?:周|星期|礼拜)([一二三四五六日天1-7])/);
  if (match) {
    const weekDay = WEEK_MAP[match[1]];
    let offset = weekDay - base.getDay();
    if (offset < 0) offset += 7;
    return {
      date: dateUtils.toDateString(dateUtils.addDays(base, offset)),
      matchedText: match[0],
    };
  }

  match = source.match(/下个?月([零一二两三四五六七八九十\d]{1,3})(?:日|号)?/);
  if (match) {
    const day = parseChineseNumber(match[1]);
    const year = base.getMonth() === 11 ? base.getFullYear() + 1 : base.getFullYear();
    const month = base.getMonth() === 11 ? 1 : base.getMonth() + 2;
    return {
      date: validDate(year, month, day),
      matchedText: match[0],
    };
  }

  match = source.match(/(\d{4})(?:年|[-/])([零一二两三四五六七八九十\d]{1,3})(?:月|[-/])([零一二两三四五六七八九十\d]{1,3})(?:日|号)?/);
  if (match) {
    return {
      date: validDate(Number(match[1]), parseChineseNumber(match[2]), parseChineseNumber(match[3])),
      matchedText: match[0],
    };
  }

  match = source.match(/([零一二两三四五六七八九十\d]{1,3})月([零一二两三四五六七八九十\d]{1,3})(?:日|号)?/);
  if (match) {
    return {
      date: normalizeFutureDate(null, parseChineseNumber(match[1]), parseChineseNumber(match[2]), base),
      matchedText: match[0],
    };
  }

  match = source.match(/(^|[^\d])(\d{1,2})[/-](\d{1,2})(?:$|[^\d])/);
  if (match) {
    return {
      date: normalizeFutureDate(null, Number(match[2]), Number(match[3]), base),
      matchedText: match[0].replace(/^[^\d]/, "").replace(/[^\d]$/, ""),
    };
  }

  return { date: "", matchedText: "" };
}

function applyPeriod(hour, period) {
  if ((period === "下午" || period === "晚上" || period === "夜里") && hour < 12) return hour + 12;
  if (period === "中午" && hour > 0 && hour < 11) return hour + 12;
  return hour;
}

function formatTime(hour, minute, matchedText) {
  if (hour > 23 || minute > 59 || hour < 0 || minute < 0) {
    return { time: "", matchedText };
  }
  return {
    time: `${dateUtils.pad(hour)}:${dateUtils.pad(minute)}`,
    matchedText,
  };
}

function extractTime(text) {
  const source = normalizeText(text);
  let match = source.match(/(凌晨|早上|上午|中午|下午|晚上|夜里)?([01]?\d|2[0-3]):([0-5]?\d)(?:$|[^\d])/);
  if (match) {
    const hour = applyPeriod(Number(match[2]), match[1] || "");
    return formatTime(hour, Number(match[3]), `${match[1] || ""}${match[2]}:${match[3]}`);
  }

  match = source.match(/(凌晨|早上|上午|中午|下午|晚上|夜里)?([01]?\d|2[0-3])\.([0-5]?\d)(?:$|[^\d])/);
  if (match) {
    const hour = applyPeriod(Number(match[2]), match[1] || "");
    return formatTime(hour, Number(match[3]), `${match[1] || ""}${match[2]}.${match[3]}`);
  }

  match = source.match(/(凌晨|早上|上午|中午|下午|晚上|夜里|早)?([零一二两三四五六七八九十\d]{1,3})(?:点|时)(半|([零一二两三四五六七八九十\d]{1,3})(?:分)?)?/);
  if (!match) return { time: "", matchedText: "" };
  let hour = parseChineseNumber(match[2]);
  let minute = 0;
  if (match[3] === "半") {
    minute = 30;
  } else if (match[4]) {
    minute = parseChineseNumber(match[4]);
  }
  if (Number.isNaN(hour) || Number.isNaN(minute)) return { time: "", matchedText: match[0] };
  hour = applyPeriod(hour, match[1] === "早" ? "早上" : (match[1] || ""));
  return formatTime(hour, minute, match[0]);
}

function inferCategory(text) {
  const source = normalizeText(text);
  if (/会议|面试|考试|作业|材料|项目|团队|上课|培训|汇报|答辩/.test(source)) return "work";
  if (/爸爸|妈妈|父母|孩子|老婆|老公|家人|家庭|朋友|生日|纪念日/.test(source)) return "family";
  return "life";
}

function cleanTitle(text, dateText, timeText) {
  let title = normalizeText(text)
    .replace(FILLER_PATTERN, "")
    .replace(dateText || "", "")
    .replace(timeText || "", "")
    .replace(/^(去|到|在|于|要|需要|做一下|办一下)/, "")
    .replace(/[，。；、,;：:]/g, "");
  if (title.length > 24) title = title.slice(0, 24);
  return title;
}

function invalidResult(rawText, reason, message, idPrefix) {
  return {
    id: `${idPrefix || "candidate"}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    rawText: String(rawText || ""),
    ok: false,
    canSave: false,
    selected: false,
    title: "",
    targetDate: "",
    targetTime: "",
    location: "",
    action: "",
    categoryId: "life",
    repeat: "none",
    reminderOffsets: [],
    missingFields: [reason],
    reason,
    message,
    example: EXAMPLE_TEXT,
  };
}

function parseCreateEventText(rawText, now, idPrefix) {
  const source = String(rawText || "").trim();
  const normalized = normalizeText(source);
  if (!normalized) {
    return invalidResult(source, "empty", EXAMPLE_HINT, idPrefix);
  }
  if (UNSUPPORTED_PATTERN.test(normalized)) {
    return invalidResult(source, "unsupported", "当前只支持新增事项，不能通过导入修改或删除", idPrefix);
  }
  if (WEAK_TEXT_PATTERN.test(normalized) || normalized.length < 3) {
    return invalidResult(source, "meaningless", EXAMPLE_HINT, idPrefix);
  }

  const dateResult = resolveRelativeDate(source, now);
  const timeResult = extractTime(source);
  const title = cleanTitle(source, dateResult.matchedText, timeResult.matchedText);

  if (!dateResult.date) {
    return invalidResult(source, "date", "需要带上日期，例如：明天交作业", idPrefix);
  }
  if (!title || title.length < 2 || WEAK_TEXT_PATTERN.test(title)) {
    return invalidResult(source, "title", "需要写清事项，例如：明天交作业", idPrefix);
  }

  return {
    id: `${idPrefix || "candidate"}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    rawText: source,
    ok: true,
    canSave: true,
    selected: true,
    title,
    targetDate: dateResult.date,
    targetTime: timeResult.time || "",
    location: "",
    action: title,
    categoryId: inferCategory(source),
    repeat: "none",
    reminderOffsets: timeResult.time ? ["1d", "2h"] : [],
    missingFields: [],
    reason: "",
    message: "",
    example: EXAMPLE_TEXT,
  };
}

function parseVoiceEvent(rawText, now) {
  return parseCreateEventText(rawText, now, "candidate");
}

function splitImportLines(rawText) {
  return String(rawText || "")
    .split(/\n|[；;]/)
    .map((line) => line.replace(/^\s*\d+[.、\s]+/, "").trim())
    .filter(Boolean);
}

function parseImportedText(rawText, now) {
  return splitImportLines(rawText).map((line, index) => {
    const candidate = parseCreateEventText(line, now, `import_${index}`);
    return Object.assign({}, candidate, {
      id: `import_${Date.now()}_${index}`,
      sourceType: "text_import",
    });
  });
}

module.exports = {
  EXAMPLE_HINT,
  EXAMPLE_TEXT,
  parseChineseNumber,
  resolveRelativeDate,
  extractTime,
  parseCreateEventText,
  parseVoiceEvent,
  parseImportedText,
};
