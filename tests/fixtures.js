/* Made-up logs for the tests and screenshots. Seeded, so every run draws the same days. */
(function () {
  "use strict";

  function rng(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // how likely each hour of the day is: mornings, after lunch and evenings
  const WEIGHTS = [0, 0, 0, 0, 0, 0, 1, 4, 5, 3, 2, 2, 4, 3, 2, 4, 3, 3, 4, 4, 5, 4, 2, 1];
  const TOTAL = WEIGHTS.reduce((a, b) => a + b, 0);

  function pickHour(r) {
    let x = r() * TOTAL;
    for (let h = 0; h < 24; h++) {
      x -= WEIGHTS[h];
      if (x < 0) return h;
    }
    return 20;
  }

  const pad = n => String(n).padStart(2, "0");
  const keyOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

  function build(days, from, to, plan, seed) {
    const r = rng(seed);
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const entries = [];
    for (let ago = days - 1; ago >= 0; ago--) {
      const day = new Date(today);
      day.setDate(day.getDate() - ago);
      const share = 1 - ago / Math.max(1, days - 1);
      const target = Math.max(0, Math.round(from + (to - from) * share + (r() - 0.5) * 4));
      for (let i = 0; i < target; i++) {
        const t = new Date(day);
        t.setHours(pickHour(r), Math.floor(r() * 60), Math.floor(r() * 60), 0);
        if (t.getTime() <= now) entries.push(t.getTime());
      }
    }
    let p = null;
    if (plan) {
      const d = new Date(today);
      d.setDate(d.getDate() - plan.daysAgo);
      p = { start: plan.start, step: plan.step, every: plan.every, from: keyOf(d) };
    }
    return { v: 1, unit: "cigs", entries: entries.sort((a, b) => a - b), plan: p, dayStart: 0, range: 30 };
  }

  window.TaperFixtures = {
    fresh: () => ({ v: 1, entries: [], plan: null, dayStart: 0, range: 30 }),
    week: () => build(5, 15, 13, null, 3),
    month: () => build(40, 20, 12, { start: 16, step: 1, every: 7, daysAgo: 21 }, 7),
    year: () => Object.assign(build(200, 22, 6, { start: 20, step: 1, every: 10, daysAgo: 150 }, 11), { range: 0 })
  };
})();
