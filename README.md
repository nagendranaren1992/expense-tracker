# Spends — Expense Tracker (v1: Daily & Weekly)

A cross-platform (web + Android + iOS) expense tracker built with Expo / React
Native. It reads your bank & credit-card **transaction alert emails**, parses
them into structured transactions, categorizes them (Food, E-commerce, Fuel,
etc.), and shows **daily** and **weekly** spend with charts.

This is v1. Monthly / quarterly / half-yearly / annual reports come next — the
data model and aggregation layer are already built to extend to those.

---

## Run it

The app runs immediately on **sample data**, so you can see the whole UI before
connecting any email.

```bash
# 1. Install dependencies
npm install

# 2. Start
npx expo start
#   press w  -> web
#   press a  -> Android (emulator or Expo Go)
#   press i  -> iOS (simulator or Expo Go)
```

> **Version note:** dependencies target **Expo SDK 54** (matches current Expo Go).

---

## How it works

```
Bank alert email ──► emailParser.js ──► { amount, merchant, account, category, date, type }
                                              │
                          categories.js ◄─────┘ (keyword → sector)
                                              │
                            storage.js ◄──────┘ (AsyncStorage, dedupe by id)
                                              │
                          aggregate.js ◄──────┘ (today / last 7 days / by category / by day)
                                              │
                              App.js  ◄────────┘ (dashboard + charts)
```

Key files:

| File | Role |
|------|------|
| `src/services/emailParser.js` | Regex engine that turns a raw email into a transaction. Handles HDFC / ICICI / SBI / Axis / Kotak-style alerts. **Add a bank = add a pattern.** |
| `src/services/categories.js` | Merchant → category rules (Zomato→Food, Amazon→E-commerce…). Add merchants to the keyword arrays. |
| `src/services/gmail.js` | Gmail read-only OAuth + fetch pipeline. Off until you add client IDs. |
| `src/utils/aggregate.js` | All the period / category math. Extend here for monthly+ reports. |
| `src/data/storage.js` | Local persistence + first-run sample seeding. |
| `App.js` | The dashboard: period toggle, account filter, summary, charts, list. |

---

## Connecting your real inbox (Gmail)

The app is wired for Gmail with **read-only** access — it can read messages,
never send or delete, and tokens stay on your device.

1. Open `src/services/gmail.js` and follow the setup comment at the top:
   create a Google Cloud project, enable the **Gmail API**, add yourself as a
   test user, and create OAuth client IDs (Web / iOS / Android).
2. Paste the client IDs into `CLIENT_IDS`.
3. Wire the `useGmailAuth()` hook + `fetchAndParse()` into the Sync button
   (there's a commented pattern in `App.js`'s `onRefresh`).

Once configured, pull-to-refresh (or the Sync button) fetches recent bank
alerts, parses them, de-duplicates, and stores them.

### Filtering by account
Pass the **last 4 digits** — the parser already extracts them from each alert,
and the account chips at the top of the dashboard let you filter to one card /
account.

---

## What's next (enhancement roadmap)

- Monthly / quarterly / half-yearly / annual views — add cases in
  `filterByPeriod` + a period picker; the chart swaps day-buckets for
  month-buckets.
- Manual add / edit / re-categorize a transaction.
- Budgets and per-category limits with alerts.
- Move storage from AsyncStorage to `expo-sqlite` once you have lots of history.
- Optional backend so parsing/sync runs server-side instead of on-device.

---

## Notes & limitations

- Bank email formats vary; the parser covers common Indian formats and falls
  back gracefully. Check `emailParser.js` test expectations if an alert isn't
  captured, and add a pattern.
- Amounts assume INR (₹). Change `formatINR` in `src/utils/format.js` for other
  currencies.
- Sample data regenerates relative to today so the dashboard is never empty.
