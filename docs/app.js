/* Taper: log each time you do the thing you're cutting down on, get a daily limit that steps down, and watch the trend.
   Everything lives in this browser's local storage under one key; nothing is sent anywhere. */
(function () {
  "use strict";

  const KEY = "taper";
  const DAY_MS = 864e5;
  const RANGES = [7, 30, 90, 0];               // 0 means everything logged
  const STEP_CHOICES = [1, 2, 3, 4, 5];
  const EVERY_CHOICES = [3, 4, 5, 7, 10, 14];
  const DAY_START_CHOICES = [0, 1, 2, 3, 4, 5];
  const DOUBLE_TAP_MS = 1500;                  // a second tap this soon after a log is ignored
  const TOAST_MS = 8000;
  const HISTORY_PAGE = 14;
  const WEEKLY_AFTER = 120;                    // ranges longer than this many days draw one column per week
  const AUTO_PLAN_DAYS = 3;                    // full days logged before Taper makes a plan
  const AUTO_PLAN_EVERY = 7;                   // the plan it makes cuts once a week...
  const AUTO_PLAN_WEEKS = 10;                  // ...by about a tenth of the start, so it reaches 0 in about ten weeks
  const BACKUP_FIRST_AFTER = 3;                // days of logs before the first backup reminder
  const BACKUP_EVERY = 14;                     // days between backup reminders after that
  const UNIT_MAX = 24;

  let state = load();
  let renderedDay = null;
  let historyShown = HISTORY_PAGE;
  let pendingRemoval = null;                   // timestamp waiting for Remove or Keep
  let editingPlan = false;
  let welcomeOpen = false;                     // About Taper in Settings shows the welcome again
  let lastLogAt = 0;
  let toastTimer = null;
  let toastEntry = null;
  let tooltips = [];                           // { host, hide } for the charts on screen

  const $ = sel => document.querySelector(sel);

  // ---------- storage ----------

  function blank() {
    return { v: 1, unit: null, entries: [], plan: null, autoPlanned: false, dayStart: 0, range: 30, backedUp: 0 };
  }

  function validPlan(p) {
    return !!p && typeof p === "object" &&
      Number.isInteger(p.start) && p.start >= 1 && p.start <= 99 &&
      Number.isInteger(p.step) && p.step >= 1 && p.step <= 99 &&
      Number.isInteger(p.every) && p.every >= 1 && p.every <= 60 &&
      typeof p.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.from);
  }

  function tidy(raw) {
    const s = blank();
    if (!raw || typeof raw !== "object") return s;
    if (Array.isArray(raw.entries)) {
      const times = raw.entries.filter(n => typeof n === "number" && Number.isFinite(n)).map(Math.round);
      s.entries = Array.from(new Set(times)).sort((a, b) => a - b);
    }
    if (validPlan(raw.plan)) {
      s.plan = { start: raw.plan.start, step: raw.plan.step, every: raw.plan.every, from: raw.plan.from };
      if (raw.plan.auto === true) s.plan.auto = true;
    }
    s.unit = cleanUnit(raw.unit);
    s.autoPlanned = raw.autoPlanned === true || !!s.plan;
    if (Number.isFinite(raw.backedUp) && raw.backedUp > 0) s.backedUp = raw.backedUp;
    if (DAY_START_CHOICES.includes(raw.dayStart)) s.dayStart = raw.dayStart;
    if (RANGES.includes(raw.range)) s.range = raw.range;
    return s;
  }

  function cleanUnit(u) {
    if (typeof u !== "string") return null;
    u = u.replace(/\s+/g, " ").trim().toLowerCase().slice(0, UNIT_MAX).trim();
    return u || null;
  }

  function load() {
    try { return tidy(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return blank(); }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      toast("This phone wouldn't save that. Save a backup from Settings.", null);
    }
  }

  // ---------- days ----------
  // A day is named by its local date, YYYY-MM-DD. With a later day start, one logged at 1 am belongs to the day before.

  const pad = n => String(n).padStart(2, "0");
  const keyOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

  function dayKey(ms) {
    const d = new Date(ms);
    if (d.getHours() < state.dayStart) d.setDate(d.getDate() - 1);
    return keyOf(d);
  }

  function dateOf(key) {
    const p = key.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2], 12);
  }

  function addDays(key, n) {
    const d = dateOf(key);
    d.setDate(d.getDate() + n);
    return keyOf(d);
  }

  function daysBetween(a, b) {
    return Math.round((dateOf(b) - dateOf(a)) / DAY_MS);
  }

  function countsByDay() {
    const m = new Map();
    for (const t of state.entries) {
      const k = dayKey(t);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }

  // The first day being tracked: the day of the first log, or the plan's first day if that came earlier.
  function firstDay(today) {
    let first = state.entries.length ? dayKey(state.entries[0]) : null;
    const p = state.plan;
    if (p && p.from <= today && (!first || p.from < first)) first = p.from;
    if (first && first > today) first = today;
    return first;
  }

  // ---------- plan ----------

  function limitOn(key, plan) {
    plan = plan === undefined ? state.plan : plan;
    if (!plan || key < plan.from) return null;
    const steps = Math.floor(daysBetween(plan.from, key) / plan.every);
    return Math.max(0, plan.start - steps * plan.step);
  }

  function nextDrop(key, plan) {
    const now = limitOn(key, plan);
    if (now === null) return { key: plan.from, limit: plan.start };
    if (now === 0) return null;
    const steps = Math.floor(daysBetween(plan.from, key) / plan.every) + 1;
    return { key: addDays(plan.from, steps * plan.every), limit: Math.max(0, plan.start - steps * plan.step) };
  }

  function zeroDay(plan) {
    return addDays(plan.from, Math.ceil(plan.start / plan.step) * plan.every);
  }

  // ---------- words ----------

  const fmt = opts => new Intl.DateTimeFormat(undefined, opts);
  const F = {
    long: fmt({ weekday: "long", month: "long", day: "numeric" }),
    short: fmt({ weekday: "short", month: "short", day: "numeric" }),
    monthDay: fmt({ month: "short", day: "numeric" }),
    weekday: fmt({ weekday: "short" }),
    time: fmt({ hour: "numeric", minute: "2-digit" }),
    hour: fmt({ hour: "numeric" })
  };

  const longDay = key => F.long.format(dateOf(key));
  const shortDay = key => F.short.format(dateOf(key));
  const hourName = h => F.hour.format(new Date(2000, 0, 1, h % 24));
  const one = v => (Math.round(v * 10) / 10).toFixed(1);
  const plural = (n, word, words) => n + " " + (n === 1 ? word : words);
  const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1);

  // The unit is kept as typed, plural ("cigs"); one of them drops the plural ending ("cig").
  function single(unit) {
    const words = unit.split(" ");
    let last = words.pop();
    if (/(ss|us|is)$/.test(last)) { /* glass, bus, this: already single */ }
    else if (/(ches|shes|sses|xes|zes)$/.test(last)) last = last.slice(0, -2);
    else if (/[^aeiou]ies$/.test(last)) last = last.slice(0, -3) + "y";
    else if (/s$/.test(last)) last = last.slice(0, -1);
    return words.concat(last).join(" ");
  }
  const unitWord = n => (n === 1 ? single(state.unit) : state.unit);
  const article = w => (/^[aeiou]/i.test(w) ? "an " : "a ");

  function since(ms) {
    const min = Math.floor(ms / 60000);
    if (min < 60) return plural(min, "min", "min");
    const h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return h + " hr" + (m ? " " + m + " min" : "");
    const d = Math.floor(h / 24), hh = h % 24;
    return plural(d, "day", "days") + (hh ? " " + hh + " hr" : "");
  }

  // ---------- today ----------

  function renderToday(now, counts) {
    const today = dayKey(now);
    const count = counts.get(today) || 0;
    const limit = limitOn(today);
    $("#today-date").textContent = longDay(today);
    $("#count").textContent = count;
    $("#count-note").textContent = limit === null ? unitWord(count) + " today" : "of " + limit + " today";
    const each = single(state.unit);
    $("#log-label").textContent = "Log " + article(each) + each;
    renderMeter(count, limit);
    renderSince(now);
    renderNudge(now);
  }

  // Reminds once there's a few days of log and no recent backup, since the log lives only on this phone.
  function renderNudge(now) {
    const box = $("#backup-nudge");
    const first = state.entries[0];
    let due = false, text = "";
    if (first !== undefined) {
      if (!state.backedUp) {
        due = now - first > BACKUP_FIRST_AFTER * DAY_MS;
        text = "Your log lives only on this phone. Save a backup to Files so it survives a lost phone or a cleared browser.";
      } else {
        due = now - state.backedUp > BACKUP_EVERY * DAY_MS && state.entries[state.entries.length - 1] > state.backedUp;
        text = "Your last backup was " + plural(Math.floor((now - state.backedUp) / DAY_MS), "day", "days") + " ago.";
      }
    }
    box.hidden = !due;
    if (due) $("#backup-nudge-text").textContent = text;
  }

  function renderSince(now) {
    const last = state.entries[state.entries.length - 1];
    let text = "Tap the button each time.";
    if (last !== undefined) text = now - last < 60000 ? "Last one just now" : "Last one " + since(now - last) + " ago";
    $("#since").textContent = text;
  }

  function renderMeter(count, limit) {
    const meter = $("#meter"), note = $("#meter-note");
    meter.textContent = "";
    meter.hidden = limit === null || (limit === 0 && count === 0);
    note.hidden = limit === null;
    if (limit === null) return;
    for (let i = 0; i < Math.max(limit, count); i++) {
      const seg = document.createElement("span");
      seg.className = i < Math.min(count, limit) ? "used" : i < limit ? "left" : "over";
      meter.appendChild(seg);
    }
    if (count < limit) note.textContent = (limit - count) + " left under today's limit";
    else if (count === limit) note.textContent = limit === 0 ? "Your limit is 0 today." : "That's today's limit.";
    else note.textContent = (count - limit) + " over today's limit";
  }

  // ---------- logging ----------

  function insertEntry(t) {
    let i = state.entries.length;
    while (i > 0 && state.entries[i - 1] > t) i--;
    if (state.entries[i - 1] === t) return false;
    state.entries.splice(i, 0, t);
    save();
    render();
    return true;
  }

  function removeEntry(t) {
    const i = state.entries.indexOf(t);
    if (i < 0) return;
    state.entries.splice(i, 1);
    if (pendingRemoval === t) pendingRemoval = null;
    save();
    render();
  }

  function logNow() {
    const t = Date.now();
    if (t - lastLogAt < DOUBLE_TAP_MS) return;
    lastLogAt = t;
    insertEntry(t);
    toast("Logged at " + F.time.format(t), t);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }

  function localInputValue(ms) {
    const d = new Date(ms);
    return keyOf(d) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function toggleMissed(open) {
    const form = $("#missed"), btn = $("#missed-toggle");
    form.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    $("#missed-error").hidden = true;
    if (open) {
      const now = Date.now();
      $("#missed-at").value = localInputValue(now - 30 * 60000);
      $("#missed-at").max = localInputValue(now);
    }
  }

  function addMissed(ev) {
    ev.preventDefault();
    const err = $("#missed-error");
    const value = $("#missed-at").value;
    const t = value ? new Date(value).getTime() : NaN;
    err.hidden = true;
    if (!Number.isFinite(t)) {
      err.textContent = "Pick a date and time.";
      err.hidden = false;
      return;
    }
    if (t > Date.now()) {
      err.textContent = "That time hasn't happened yet.";
      err.hidden = false;
      return;
    }
    if (!insertEntry(t)) {
      err.textContent = "There's already one at that exact time.";
      err.hidden = false;
      return;
    }
    toggleMissed(false);
    toast("Added one at " + F.time.format(t) + " on " + shortDay(dayKey(t)), t);
  }

  function toast(text, entry) {
    $("#toast-text").textContent = text;
    toastEntry = entry;
    $("#toast-undo").hidden = entry == null;
    $("#toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, TOAST_MS);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    $("#toast").hidden = true;
    toastEntry = null;
  }

  function undo() {
    if (toastEntry != null) removeEntry(toastEntry);
    lastLogAt = 0;
    hideToast();
  }

  // ---------- over time ----------

  function trailingAvg(key, first, counts) {
    let sum = 0, n = 0;
    for (let j = 0; j < 7; j++) {
      const k = addDays(key, -j);
      if (k < first) break;
      sum += counts.get(k) || 0;
      n++;
    }
    return sum / n;
  }

  // The days in the chosen range. A range never reaches back before the first tracked day, so a day before
  // tracking began is never drawn as a day with none. Today is still going, so it gets no 7-day average.
  function buildRange(now, counts) {
    const today = dayKey(now);
    const first = firstDay(today);
    if (!first) return null;
    const wanted = state.range ? addDays(today, 1 - state.range) : first;
    const start = wanted < first ? first : wanted;
    const days = [];
    for (let k = start; k <= today; k = addDays(k, 1)) {
      days.push({ key: k, count: counts.get(k) || 0, limit: limitOn(k), avg: k === today ? null : trailingAvg(k, first, counts) });
    }
    return { today, first, start, clipped: start !== wanted, days };
  }

  function byWeek(days, today) {
    const weeks = [];
    let cur = null;
    for (const d of days) {
      const wk = addDays(d.key, -((dateOf(d.key).getDay() + 6) % 7));
      if (!cur || cur.key !== wk) weeks.push(cur = { key: wk, days: [] });
      cur.days.push(d);
    }
    return weeks.map(w => {
      const done = w.days.filter(d => d.key !== today);
      const use = done.length ? done : w.days;
      const limits = w.days.map(d => d.limit).filter(v => v !== null);
      return { key: w.key, value: mean(use.map(d => d.count)), limit: limits.length ? mean(limits) : null };
    });
  }

  function renderTrends(now, counts) {
    tooltips = [];
    const r = buildRange(now, counts);
    $("#trends-empty").hidden = !!r;
    $("#trends-body").hidden = !r;
    if (!r) return;

    for (const b of document.querySelectorAll(".range button")) {
      b.setAttribute("aria-checked", String(Number(b.dataset.range) === state.range));
    }
    renderStats(r, counts);
    if (r.days.length > WEEKLY_AFTER) renderWeekChart(r);
    else renderDayChart(r);
    renderHourChart(r);
  }

  function stat(box, label, value, sub, subClass) {
    const div = document.createElement("div");
    div.className = "stat";
    const l = document.createElement("p");
    l.className = "stat-label";
    l.textContent = label;
    const v = document.createElement("p");
    v.className = "stat-value" + (value === null ? " empty" : "");
    v.textContent = value === null ? "None yet" : value;
    div.append(l, v);
    if (sub) {
      const s = document.createElement("p");
      s.className = "stat-sub" + (subClass ? " " + subClass : "");
      s.textContent = sub;
      div.appendChild(s);
    }
    box.appendChild(div);
  }

  function renderStats(r, counts) {
    const box = $("#stats");
    box.textContent = "";
    const done = r.days.filter(d => d.key !== r.today);

    // daily average over finished days, against the same number of days just before
    if (done.length) {
      const avg = mean(done.map(d => d.count));
      let sub = null, cls = null;
      if (state.range && !r.clipped) {
        const prevEnd = addDays(r.start, -1);
        const prevStart = addDays(r.start, -state.range);
        if (prevEnd >= r.first) {
          const prev = [];
          for (let k = prevStart < r.first ? r.first : prevStart; k <= prevEnd; k = addDays(k, 1)) prev.push(counts.get(k) || 0);
          const delta = Math.round((avg - mean(prev)) * 10) / 10;
          const span = "the previous " + state.range + " days";
          if (delta < 0) { sub = "Down " + one(-delta) + " from " + span; cls = "good"; }
          else if (delta > 0) sub = "Up " + one(delta) + " from " + span;
          else sub = "Same as " + span;
        }
      }
      stat(box, "Daily average", one(avg), sub, cls);
    } else {
      stat(box, "Daily average", null, "after your first full day");
    }

    const total = r.days.reduce((a, d) => a + d.count, 0);
    stat(box, "Total", total.toLocaleString(),r.clipped || !state.range ? "since " + F.monthDay.format(dateOf(r.start)) : "in " + state.range + " days");

    const planned = done.filter(d => d.limit !== null);
    if (planned.length) {
      const within = planned.filter(d => d.count <= d.limit).length;
      stat(box, "Within limit", String(within), "of " + plural(planned.length, "day", "days"));
    } else if (done.length) {
      const low = done.reduce((a, d) => (d.count < a.count ? d : a), done[0]);
      stat(box, "Lowest day", String(low.count), shortDay(low.key));
    } else {
      stat(box, "Lowest day", null, "after your first full day");
    }
  }

  function legend(items) {
    const ul = $("#day-legend");
    ul.textContent = "";
    ul.hidden = items.length < 2;
    for (const it of items) {
      const li = document.createElement("li");
      const k = document.createElement("span");
      k.className = "key key-" + it.key;
      li.append(k, document.createTextNode(it.label));
      ul.appendChild(li);
    }
  }

  function table(id, head, rows) {
    const t = $(id);
    t.textContent = "";
    const tr = t.createTHead().insertRow();
    for (const h of head) {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = h;
      tr.appendChild(th);
    }
    const body = t.createTBody();
    for (const row of rows) {
      const r = body.insertRow();
      for (const cell of row) r.insertCell().textContent = cell;
    }
  }

  function renderDayChart(r) {
    const n = r.days.length;
    const hasLimit = r.days.some(d => d.limit !== null);
    const hasAvg = r.days.some(d => d.avg !== null);
    $("#day-title").textContent = cap(state.unit) + " per day";
    const items = [{ key: "bar", label: cap(state.unit) }];
    if (hasAvg) items.push({ key: "avg", label: "7-day average" });
    if (hasLimit) items.push({ key: "limit", label: "Daily limit" });
    legend(items);

    const points = r.days.map(d => ({
      value: d.count,
      limit: d.limit,
      avg: d.avg,
      title: d.key === r.today ? "Today, " + F.monthDay.format(dateOf(d.key)) : shortDay(d.key),
      tick: n <= 7 ? F.weekday.format(dateOf(d.key)) : F.monthDay.format(dateOf(d.key))
    }));
    columnChart($("#day-chart"), {
      points,
      integer: true,
      tickWidth: n <= 7 ? 34 : 50,
      tickFromEnd: true,
      endLabel: hasAvg,
      label: cap(state.unit) + " per day from " + longDay(r.start) + " to today. Show the numbers below the chart for every value.",
      rows: p => {
        const rows = [{ key: "bar", value: String(p.value), label: unitWord(p.value) }];
        if (p.avg !== null) rows.push({ key: "avg", value: one(p.avg), label: "7-day average" });
        if (p.limit !== null) rows.push({ key: "limit", value: String(p.limit), label: "limit" });
        return rows;
      }
    });

    const head = ["Day", cap(state.unit), "7-day avg"];
    if (hasLimit) head.push("Limit");
    table("#day-table", head, r.days.slice().reverse().map(d => {
      const row = [shortDay(d.key), String(d.count), d.avg === null ? "" : one(d.avg)];
      if (hasLimit) row.push(d.limit === null ? "" : String(d.limit));
      return row;
    }));
  }

  function renderWeekChart(r) {
    const weeks = byWeek(r.days, r.today);
    const hasLimit = weeks.some(w => w.limit !== null);
    $("#day-title").textContent = "Average per day, by week";
    legend(hasLimit ? [{ key: "bar", label: "Average per day" }, { key: "limit", label: "Average limit" }] : []);
    const points = weeks.map(w => ({
      value: w.value,
      limit: w.limit,
      avg: null,
      title: "Week of " + F.monthDay.format(dateOf(w.key)),
      tick: F.monthDay.format(dateOf(w.key))
    }));
    columnChart($("#day-chart"), {
      points,
      integer: false,
      tickWidth: 50,
      tickFromEnd: true,
      endLabel: false,
      label: "Average " + state.unit + " per day for each week since " + longDay(r.start) + ". Show the numbers below the chart for every value.",
      rows: p => {
        const rows = [{ key: "bar", value: one(p.value), label: "a day on average" }];
        if (p.limit !== null) rows.push({ key: "limit", value: one(p.limit), label: "average limit" });
        return rows;
      }
    });
    const head = ["Week of", "Per day"];
    if (hasLimit) head.push("Limit");
    table("#day-table", head, weeks.slice().reverse().map(w => {
      const row = [F.monthDay.format(dateOf(w.key)), one(w.value)];
      if (hasLimit) row.push(w.limit === null ? "" : one(w.limit));
      return row;
    }));
  }

  function renderHourChart(r) {
    const hours = new Array(24).fill(0);
    for (const t of state.entries) {
      const k = dayKey(t);
      if (k >= r.start && k <= r.today) hours[new Date(t).getHours()]++;
    }
    const n = r.days.length;
    const points = [];
    for (let i = 0; i < 24; i++) {
      const h = (state.dayStart + i) % 24;
      points.push({
        value: hours[h] / n,
        count: hours[h],
        limit: null,
        avg: null,
        title: hourName(h) + " to " + hourName(h + 1),
        tick: hourName(h)
      });
    }
    columnChart($("#hour-chart"), {
      points,
      integer: false,
      tickEvery: 6,
      endLabel: false,
      label: "Average " + state.unit + " per day in each hour of the day. Show the numbers below the chart for every value.",
      rows: p => [
        { key: "bar", value: one(p.value), label: "a day on average" },
        { key: null, value: String(p.count), label: "in " + plural(n, "day", "days") }
      ]
    });
    table("#hour-table", ["Hour", "Per day", "In all"], points.map(p => [p.title, one(p.value), String(p.count)]));
  }

  // ---------- one column chart, drawn as SVG ----------
  // points: { value, limit, avg, title, tick }. Columns for value, a step line for limit, a line for avg.

  const SVG_NS = "http://www.w3.org/2000/svg";

  function svgEl(name, attrs, parent) {
    const n = document.createElementNS(SVG_NS, name);
    for (const a in attrs) n.setAttribute(a, attrs[a]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function niceScale(max, integer) {
    const steps = (integer ? [] : [0.1, 0.2, 0.25, 0.5]).concat([1, 2, 5, 10, 20, 25, 50, 100]);
    const m = max > 0 ? max : 1;
    const step = steps.find(s => m / s <= 4) || 100;
    return { step, top: Math.ceil(m / step - 1e-9) * step };
  }

  function barPath(x, top, w, h) {
    const r = Math.min(4, w / 2, h);
    const b = top + h;
    return "M" + x + "," + b + "V" + (top + r) +
      "A" + r + "," + r + " 0 0 1 " + (x + r) + "," + top +
      "H" + (x + w - r) +
      "A" + r + "," + r + " 0 0 1 " + (x + w) + "," + (top + r) +
      "V" + b + "Z";
  }

  function columnChart(host, o) {
    host.textContent = "";
    const W = Math.max(280, Math.round(host.clientWidth || 340));
    const PH = 170, TOP = 10, BOTTOM = 26, LEFT = 30, RIGHT = o.endLabel ? 34 : 10;
    const H = TOP + PH + BOTTOM;
    const plotW = W - LEFT - RIGHT;
    const n = o.points.length;
    const band = plotW / n;
    const cx = i => LEFT + band * (i + 0.5);

    let max = 0;
    for (const p of o.points) max = Math.max(max, p.value, p.limit || 0, p.avg || 0);
    const sc = niceScale(max, o.integer);
    const y = v => TOP + PH - (v / sc.top) * PH;

    const svg = svgEl("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": o.label, tabindex: "0" }, host);

    for (let i = 0; i * sc.step <= sc.top + 1e-9; i++) {
      const v = i * sc.step;
      const yy = Math.round(y(v)) + 0.5;
      if (i > 0) svgEl("line", { x1: LEFT, x2: W - RIGHT, y1: yy, y2: yy, class: "grid" }, svg);
      svgEl("text", { x: LEFT - 8, y: yy + 4, "text-anchor": "end" }, svg).textContent = String(Number(v.toFixed(2)));
    }

    const barW = Math.min(24, Math.max(1, band - 2));
    const bars = o.points.map((p, i) => {
      if (!(p.value > 0)) return null;
      const h = (p.value / sc.top) * PH;
      return svgEl("path", { d: barPath(LEFT + band * i + (band - barW) / 2, TOP + PH - h, barW, h), class: "bar" }, svg);
    });

    const base = Math.round(y(0)) + 0.5;
    svgEl("line", { x1: LEFT, x2: W - RIGHT, y1: base, y2: base, class: "baseline" }, svg);

    // daily limit: a step line across each day's column slot
    let d = "", prev = null;
    o.points.forEach((p, i) => {
      if (p.limit === null) { prev = null; return; }
      const yy = y(p.limit);
      if (prev === null) d += "M" + (LEFT + band * i) + "," + yy;
      else if (prev !== p.limit) d += "V" + yy;
      d += "H" + (LEFT + band * (i + 1));
      prev = p.limit;
    });
    if (d) svgEl("path", { d, class: "limit-line" }, svg);

    // 7-day average: a line through column centres, its last value labelled at the end
    let a = "", lastAvg = -1;
    o.points.forEach((p, i) => {
      if (p.avg === null) return;
      a += (lastAvg === i - 1 && a ? "L" : "M") + cx(i) + "," + y(p.avg);
      lastAvg = i;
    });
    if (a) {
      svgEl("path", { d: a, class: "avg-line" }, svg);
      const p = o.points[lastAvg];
      svgEl("circle", { cx: cx(lastAvg), cy: y(p.avg), r: 4, class: "avg-dot" }, svg);
      if (o.endLabel) {
        svgEl("text", { x: cx(lastAvg) + 8, y: y(p.avg) + 4, class: "end-label" }, svg).textContent = one(p.avg);
      }
    }

    // x labels, counted back from the newest so the latest day always carries one
    const every = o.tickEvery || Math.max(1, Math.ceil((n * o.tickWidth) / plotW));
    o.points.forEach((p, i) => {
      const idx = o.tickFromEnd ? n - 1 - i : i;
      if (idx % every || !p.tick) return;
      const w = p.tick.length * 6.2;
      let x = cx(i), anchor = "middle";
      if (x + w / 2 > W) { x = W - 1; anchor = "end"; }
      else if (x - w / 2 < 0) { x = 1; anchor = "start"; }
      svgEl("text", { x, y: H - 8, "text-anchor": anchor }, svg).textContent = p.tick;
    });

    // hover and touch: a crosshair that snaps to the nearest column, and one tooltip with every value there
    const cross = svgEl("line", { x1: 0, x2: 0, y1: TOP, y2: TOP + PH, class: "cross", visibility: "hidden" }, svg);
    const hit = svgEl("rect", { x: LEFT, y: 0, width: plotW, height: H, class: "hit" }, svg);
    const tip = document.createElement("div");
    tip.className = "tip";
    tip.hidden = true;
    host.appendChild(tip);
    let at = -1;

    function show(i) {
      i = Math.max(0, Math.min(n - 1, i));
      at = i;
      cross.setAttribute("x1", cx(i));
      cross.setAttribute("x2", cx(i));
      cross.setAttribute("visibility", "visible");
      bars.forEach((b, j) => b && b.classList.toggle("on", j === i));
      tip.textContent = "";
      const title = document.createElement("p");
      title.className = "tip-title";
      title.textContent = o.points[i].title;
      tip.appendChild(title);
      for (const row of o.rows(o.points[i])) {
        const line = document.createElement("p");
        line.className = "tip-row";
        if (row.key) {
          const k = document.createElement("span");
          k.className = "key key-" + row.key;
          line.appendChild(k);
        }
        const v = document.createElement("strong");
        v.textContent = row.value;
        line.append(v, document.createTextNode(" " + row.label));
        tip.appendChild(line);
      }
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(W - tw, cx(i) - tw / 2)) + "px";
    }

    function hide() {
      at = -1;
      cross.setAttribute("visibility", "hidden");
      bars.forEach(b => b && b.classList.remove("on"));
      tip.hidden = true;
    }

    const indexAt = ev => Math.floor((ev.clientX - svg.getBoundingClientRect().left - LEFT) / band);
    hit.addEventListener("pointerdown", ev => show(indexAt(ev)));
    hit.addEventListener("pointermove", ev => { if (ev.pointerType === "mouse" || ev.buttons) show(indexAt(ev)); });
    hit.addEventListener("pointerleave", ev => { if (ev.pointerType === "mouse") hide(); });
    svg.addEventListener("focus", () => { if (svg.matches(":focus-visible") && at < 0) show(n - 1); });
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", ev => {
      if (ev.key === "ArrowLeft") show(at < 0 ? n - 1 : at - 1);
      else if (ev.key === "ArrowRight") show(at < 0 ? n - 1 : at + 1);
      else if (ev.key === "Escape") hide();
      else return;
      ev.preventDefault();
    });
    tooltips.push({ host, hide, show });
  }

  // ---------- plan ----------

  // The average of the last week of full days (today isn't over yet), or null before the first full day.
  function recentAverage(now, counts) {
    const today = dayKey(now), first = firstDay(today);
    if (!first || first === today) return null;
    const days = [];
    for (let k = addDays(today, -1); k >= first && days.length < 7; k = addDays(k, -1)) days.push(counts.get(k) || 0);
    return mean(days);
  }

  function suggestedStart(now, counts) {
    const avg = recentAverage(now, counts);
    return avg === null ? 10 : Math.min(99, Math.max(1, Math.round(avg)));
  }

  const fullDays = now => {
    const today = dayKey(now), first = firstDay(today);
    return first ? daysBetween(first, today) : 0;
  };

  // After a few full days of logs, and only once, Taper makes a plan: start at the recent average and cut about a
  // tenth of it each week. Ending or changing the plan is up to the person from then on.
  function makePlanFrom(avg, today) {
    const start = Math.min(99, Math.max(1, Math.round(avg)));
    return { start, step: Math.max(1, Math.round(start / AUTO_PLAN_WEEKS)), every: AUTO_PLAN_EVERY, from: today, auto: true };
  }

  function autoPlan(now, counts) {
    if (state.plan || state.autoPlanned || !state.unit || fullDays(now) < AUTO_PLAN_DAYS) return false;
    state.plan = makePlanFrom(recentAverage(now, counts), dayKey(now));
    state.autoPlanned = true;
    save();
    toast("Taper made your plan. See Plan below.", null);
    return true;
  }

  function readPlanForm() {
    const p = {
      start: Number($("#plan-start").value),
      step: Number($("#plan-step").value),
      every: Number($("#plan-every").value),
      from: $("#plan-from").value
    };
    return validPlan(p) ? p : null;
  }

  function fillPlanForm(now, counts) {
    const p = state.plan;
    $("#plan-start").value = p ? p.start : suggestedStart(now, counts);
    $("#plan-step").value = p ? p.step : 1;
    $("#plan-every").value = p ? p.every : 7;
    $("#plan-from").value = p ? p.from : dayKey(now);
    previewPlan();
  }

  function previewPlan() {
    const p = readPlanForm();
    $("#plan-preview").textContent = p ? "That reaches 0 on " + longDay(zeroDay(p)) + "." : "";
  }

  function renderPlan(now, counts) {
    const today = dayKey(now), p = state.plan, form = $("#plan-form");
    const waiting = !p && !state.autoPlanned && !editingPlan;
    const showForm = !waiting && (!p || editingPlan);
    $("#plan-edit-label").textContent = p ? "Change plan" : "Set my own plan";
    $("#plan-end").hidden = !p;
    if (showForm && form.hidden) fillPlanForm(now, counts);
    form.hidden = !showForm;
    $("#plan-actions").hidden = showForm;
    $("#plan-cancel").hidden = !p && state.autoPlanned;

    const summary = $("#plan-summary");
    if (waiting) {
      const left = AUTO_PLAN_DAYS - fullDays(now);
      summary.hidden = false;
      summary.textContent = state.entries.length
        ? "Log as usual for " + plural(left, "more day", "more days") + ". Then Taper makes a plan from how often you do it."
        : "Log as usual for a few days. Then Taper makes a plan from how often you do it.";
      return;
    }
    if (showForm) {
      summary.textContent = p ? "" : state.entries.length
        ? "Set a daily limit that steps down on a schedule. The starting number is your recent daily average."
        : "Set a daily limit that steps down on a schedule. Log a few normal days first and the starting number fills in from your average.";
      summary.hidden = !summary.textContent;
      return;
    }
    summary.hidden = false;
    const lines = [];
    const lim = limitOn(today);
    const rule = p.step + " every " + plural(p.every, "day", "days");
    if (lim === null) {
      lines.push("Your plan starts " + longDay(p.from) + " at " + p.start + " a day and cuts " + rule + ".");
    } else if (lim === 0) {
      lines.push("Your limit is 0 now.");
    } else {
      lines.push("Today's limit is " + lim + ".");
      const next = nextDrop(today, p);
      if (next) lines.push("It drops to " + next.limit + " on " + longDay(next.key) + ".");
    }
    if (lim !== 0) lines.push("You'll reach 0 on " + longDay(zeroDay(p)) + ".");
    if (lim !== null && lim !== 0) lines.push("The plan cuts " + rule + ".");
    if (p.auto) lines.push("Taper set it from your first days of logs. Change it any time.");
    summary.textContent = lines.join(" ");
  }

  function savePlan(ev) {
    ev.preventDefault();
    const p = readPlanForm();
    if (!p) {
      $("#plan-preview").textContent = "Fill in every box with a whole number.";
      return;
    }
    state.plan = p;
    state.autoPlanned = true;
    editingPlan = false;
    save();
    render();
  }

  function endPlan() {
    if (!window.confirm("End this plan? Your log stays.")) return;
    state.plan = null;
    state.autoPlanned = true;
    editingPlan = false;
    $("#plan-form").hidden = true;
    save();
    render();
  }

  // ---------- history ----------

  function renderHistory(now) {
    const list = $("#history-list");
    list.textContent = "";
    const today = dayKey(now), first = firstDay(today);
    $("#history-empty").hidden = !!state.entries.length;
    $("#history-help").hidden = !state.entries.length;
    if (!first) { $("#history-more").hidden = true; return; }

    const byDay = new Map();
    for (const t of state.entries) {
      const k = dayKey(t);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(t);
    }

    let k = today, shown = 0;
    while (k >= first && shown < historyShown) {
      list.appendChild(dayRow(k, byDay.get(k) || []));
      k = addDays(k, -1);
      shown++;
    }
    $("#history-more").hidden = k < first;
  }

  function dayRow(key, times) {
    const li = document.createElement("li");
    li.className = "day";
    const head = document.createElement("div");
    head.className = "day-head";
    const name = document.createElement("span");
    name.textContent = shortDay(key);
    const count = document.createElement("span");
    count.textContent = times.length;
    const lim = limitOn(key);
    if (lim !== null) {
      const of = document.createElement("span");
      of.className = "of";
      of.textContent = " of " + lim;
      count.appendChild(of);
    }
    head.append(name, count);
    li.appendChild(head);

    const wrap = document.createElement("div");
    wrap.className = "times";
    if (!times.length) {
      const none = document.createElement("span");
      none.className = "none";
      none.textContent = "None";
      wrap.appendChild(none);
    }
    for (const t of times) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "time" + (pendingRemoval === t ? " picked" : "");
      b.textContent = F.time.format(t);
      b.setAttribute("aria-label", "Remove the one at " + F.time.format(t));
      b.addEventListener("click", () => { pendingRemoval = pendingRemoval === t ? null : t; render(); });
      wrap.appendChild(b);
    }
    li.appendChild(wrap);

    if (pendingRemoval !== null && times.includes(pendingRemoval)) {
      const t = pendingRemoval;
      const c = document.createElement("div");
      c.className = "confirm";
      const q = document.createElement("span");
      q.textContent = "Remove the one at " + F.time.format(t) + "?";
      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = "danger";
      yes.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg>Remove';
      yes.addEventListener("click", () => removeEntry(t));
      const no = document.createElement("button");
      no.type = "button";
      no.className = "link";
      no.textContent = "Keep";
      no.addEventListener("click", () => { pendingRemoval = null; render(); });
      c.append(q, yes, no);
      li.appendChild(c);
    }
    return li;
  }

  // ---------- settings and backups ----------

  function renderSettings() {
    $("#day-start").value = String(state.dayStart);
    if (document.activeElement !== $("#unit-setting")) $("#unit-setting").value = state.unit || "";
  }

  function backupFile() {
    const body = JSON.stringify(Object.assign({ app: "taper", saved: new Date().toISOString() }, state), null, 2);
    return new File([body], "taper-backup-" + keyOf(new Date()) + ".json", { type: "application/json" });
  }

  function csvFile() {
    const rows = ["time,local_time,day"];
    for (const t of state.entries) {
      const d = new Date(t);
      rows.push(d.toISOString() + "," + keyOf(d) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + "," + dayKey(t));
    }
    return new File([rows.join("\n") + "\n"], "taper-log-" + keyOf(new Date()) + ".csv", { type: "text/csv" });
  }

  // On a phone the share sheet is the dependable way to save a file (Save to Files, AirDrop, Mail).
  // Resolves true once the file was handed over, false if the person closed the share sheet.
  async function handOver(file) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return true;
      } catch (e) {
        if (e && e.name === "AbortError") return false;
      }
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  }

  async function saveBackup() {
    if (!(await handOver(backupFile()))) return;
    state.backedUp = Date.now();
    save();
    renderNudge(state.backedUp);
  }

  // ---------- welcome ----------

  function standalone() {
    return navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  function pickUnit(ev) {
    ev.preventDefault();
    const input = $("#unit");
    state.unit = cleanUnit(input.value) || cleanUnit(input.placeholder);
    welcomeOpen = false;
    save();
    render();
    window.scrollTo(0, 0);
  }

  async function restore(file) {
    let incoming;
    try {
      const raw = JSON.parse(await file.text());
      if (!raw || !Array.isArray(raw.entries)) throw new Error("not a backup");
      incoming = tidy(raw);
    } catch (e) {
      toast("That file isn't a Taper backup.", null);
      return;
    }
    const have = new Set(state.entries);
    const fresh = incoming.entries.filter(t => !have.has(t));
    const planNote = incoming.plan ? " and use the backup's plan" : "";
    if (!window.confirm("Add " + plural(fresh.length, "entry", "entries") + " from this backup" + planNote + "?")) return;
    state.entries = state.entries.concat(fresh).sort((a, b) => a - b);
    if (incoming.plan) state.plan = incoming.plan;
    if (incoming.unit) state.unit = incoming.unit;
    state.autoPlanned = state.autoPlanned || incoming.autoPlanned;
    state.dayStart = incoming.dayStart;
    save();
    render();
    toast("Restored " + plural(fresh.length, "entry", "entries") + ".", null);
  }

  // ---------- wiring ----------

  function fillSelect(sel, values, label) {
    for (const v of values) {
      const o = document.createElement("option");
      o.value = String(v);
      o.textContent = label(v);
      sel.appendChild(o);
    }
  }

  function render() {
    const now = Date.now();
    const welcome = !state.unit || welcomeOpen;
    document.documentElement.classList.toggle("first-run", welcome);
    if (welcome) {
      if (state.unit && !$("#unit").value) $("#unit").value = state.unit;
      $("#unit-submit-label").textContent = state.entries.length ? "Back to my log" : "Start logging";
      renderedDay = dayKey(now);
      return;
    }
    const counts = countsByDay();
    autoPlan(now, counts);
    renderToday(now, counts);
    renderTrends(now, counts);
    renderPlan(now, counts);
    renderHistory(now);
    renderSettings();
    renderedDay = dayKey(now);
  }

  function start() {
    fillSelect($("#plan-step"), STEP_CHOICES, String);
    fillSelect($("#plan-every"), EVERY_CHOICES, v => plural(v, "day", "days"));
    fillSelect($("#day-start"), DAY_START_CHOICES, v => (v === 0 ? "Midnight" : hourName(v)));

    $("#unit-form").addEventListener("submit", pickUnit);
    $("#about").addEventListener("click", () => { welcomeOpen = true; $("#unit").value = ""; render(); window.scrollTo(0, 0); });
    for (const b of document.querySelectorAll("#welcome .picks button")) {
      b.addEventListener("click", () => { $("#unit").value = b.textContent; });
    }
    $("#install-hint").hidden = standalone();
    $("#unit-setting").addEventListener("change", ev => {
      const u = cleanUnit(ev.target.value);
      if (u) state.unit = u;
      save();
      render();
    });

    $("#log").addEventListener("click", logNow);
    $("#toast-undo").addEventListener("click", undo);
    $("#missed-toggle").addEventListener("click", () => toggleMissed($("#missed").hidden));
    $("#missed").addEventListener("submit", addMissed);

    for (const b of document.querySelectorAll(".range button")) {
      b.addEventListener("click", () => {
        state.range = Number(b.dataset.range);
        save();
        renderTrends(Date.now(), countsByDay());
      });
    }

    $("#plan-form").addEventListener("submit", savePlan);
    $("#plan-form").addEventListener("input", previewPlan);
    $("#plan-edit").addEventListener("click", () => { editingPlan = true; $("#plan-form").hidden = true; render(); });
    $("#plan-cancel").addEventListener("click", () => { editingPlan = false; render(); });
    $("#plan-end").addEventListener("click", endPlan);

    $("#history-more").addEventListener("click", () => { historyShown += HISTORY_PAGE; render(); });

    $("#day-start").addEventListener("change", ev => {
      state.dayStart = Number(ev.target.value);
      save();
      render();
    });
    $("#backup-save").addEventListener("click", saveBackup);
    $("#backup-nudge-save").addEventListener("click", saveBackup);
    $("#export-csv").addEventListener("click", () => handOver(csvFile()));
    $("#backup-restore").addEventListener("click", () => $("#backup-file").click());
    $("#backup-file").addEventListener("change", ev => {
      const f = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      if (f) restore(f);
    });

    // a tap anywhere outside a chart closes its tooltip
    document.addEventListener("pointerdown", ev => {
      for (const t of tooltips) if (!t.host.contains(ev.target)) t.hide();
    });

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => renderTrends(Date.now(), countsByDay()), 150);
    });

    // keep "last one" current, and redraw everything when the day turns over
    setInterval(() => {
      const now = Date.now();
      if (dayKey(now) !== renderedDay) render();
      else if (!document.documentElement.classList.contains("first-run")) renderSince(now);
    }, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
    window.addEventListener("storage", ev => { if (ev.key === KEY) { state = load(); render(); } });

    render();

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  }

  // for the tests in tests/index.html
  window.Taper = {
    get state() { return state; },
    dayKey, addDays, daysBetween, limitOn, nextDrop, zeroDay, niceScale, since, tidy, buildRange, byWeek, backupFile, csvFile,
    single, makePlanFrom,
    tooltips: () => tooltips,
    render
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
