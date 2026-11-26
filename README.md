# Taper

A small phone app for cutting down on a bad habit. Pick what you're counting (cigs, doomscrolls, impulse buys), tap once each
time, and after a few days Taper sets a daily limit that steps down on a schedule. Watch the count against time.

Live at https://pantsonmyhead.com/taper/ (`bash tools/publish.sh` copies `docs/` into the pantsonmyhead.com
repository, `../recipe-app/docs/taper`, and pushes it).

It's a Home Screen web app. Open the site in Safari on the iPhone, tap Share, then Add to Home Screen. From
then on it opens full screen from its own icon and works with no signal.

## What it does

- **Welcome**: shown until a unit is picked: what Taper does, and What are you counting? Every label uses the
  unit after that (Log a cig, Cigs per day). Change it in Settings; About Taper there shows the welcome again.
  A log from before the unit existed gets the welcome once and keeps every entry.
- **Today**: the count so far, today's limit with a bar of what's left, time since the last one, a big
  Log a cigarette button with Undo, and Add one I missed for one logged late.
- **Over time**: 7 days, 30 days, 90 days or All. Daily average against the period before, the total, and days
  within the limit. A column chart of cigarettes per day with the 7-day average and the limit line, and a
  time of day chart that shows which hours carry the most. Tap or drag on a chart to read a day. Show the
  numbers opens the same values as a table. Past 120 days the per-day chart draws one column per week.
- **Plan**: after 3 full days of logs Taper makes one, once: start at the recent daily average and cut about a
  tenth of it every 7 days (at least 1), so it reaches 0 in about ten weeks. Before then, Set my own plan opens
  the form. By hand: start at a number a day and cut by 1 to 5 every 3 to 14 days, from a start date. The starting number
  fills in from the recent daily average. The summary names today's limit, the next drop and the day it
  reaches 0.
- **History**: every day with its times. Tap a time to remove it.
- **Settings**: when your day ends (midnight to 5 am, so a 1 am cigarette can count toward the day before),
  Save a backup, Restore a backup, and Export CSV. Today shows a backup reminder after 3 days of logs with no
  backup, then 14 days after the last one.

## Where the data lives

Only on the phone, in the browser storage for this site, under the key `taper`. Nothing is sent anywhere and
there's no account. A Home Screen web app keeps its storage, but deleting the app from the Home Screen or
clearing Safari's website data erases the log, so save a backup now and then (it goes through the share
sheet, so Save to Files works). Restore adds the backup's entries to what's there and takes its plan.

## Files

- `docs/` is the whole app and is what gets published: `index.html`, `style.css`, `app.js`, the service
  worker `sw.js` that keeps it working offline, `manifest.webmanifest` and `icons/`.
- `tests/index.html` drives the app in a phone-sized frame. `tests/seed.html?f=month` fills the storage with
  a made-up month and opens the app (also `fresh`, `week` and `year`; add `&range=7` to pick a range).
- `tools/run_tests.py` and `tools/shot.py` run the tests and take screenshots in headless Chrome.
  `tools/make_icons.py` draws the icon.

```
python3 -I -B tools/run_tests.py . tests/index.html
python3 -I -B tools/shot.py . "tests/seed.html?f=month" /tmp/taper.png 390 2300
python3 -I -B tools/shot.py . "tests/seed.html?f=month" /tmp/taper-dark.png 390 2300 dark
python3 -B tools/make_icons.py
```

The service worker serves the saved copy first and fetches the new one in the background, so a change to the
site shows up the second time the app opens.

Chart colours are slots 1 to 3 of the data-viz reference palette (blue columns, orange limit, aqua average),
checked against both page colours with its validator in all-pairs mode.
