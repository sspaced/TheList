/**
 * Exchange rates, so a total can add up things bought in different currencies.
 *
 * Until now the total simply refused: only euros were summed and everything else
 * was declared "not counted". Honest, but useless — a £9,000 bag next to a €105
 * pair of trousers gave a total of €105 and a footnote.
 *
 * THE SOURCE: the European Central Bank's daily reference rates, served by
 * frankfurter.dev. No key, no account, no quota, `access-control-allow-origin: *`,
 * and the data is the ECB's own — the same table every bank publishes. It is also
 * open source, which matters for something that could otherwise disappear and
 * take the feature with it.
 *
 * CACHED FOR TWELVE HOURS. The ECB publishes once per working day, around 16:00
 * CET, so asking more often gets the same numbers back. Twelve hours means at most
 * one request per session and none at all most of the time.
 *
 * A FAILURE IS NEVER FATAL. Offline, rate-limited, or the service gone for good:
 * the last cached table is used instead. A day-old rate is off by a fraction of a
 * percent; refusing to convert costs the whole total. With no cache at all we
 * behave exactly as before — the display currency is summed, the rest is declared
 * out of the total, and the number says so.
 */

const KEY = 'rates';
const TTL = 12 * 60 * 60 * 1000;
const BASE = 'EUR';
const URL = `https://api.frankfurter.dev/v1/latest?base=${BASE}`;

/** `now` is passed in rather than read here: it keeps this testable. */
export async function loadRates(now) {
  let cached = null;
  try {
    ({ [KEY]: cached } = await chrome.storage.local.get({ [KEY]: null }));
  } catch {}
  if (cached?.rates && now - cached.ts < TTL) return cached;

  try {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.rates || typeof data.rates !== 'object') throw new Error('no rates');
    const table = { base: data.base || BASE, rates: data.rates, date: data.date || '', ts: now };
    await chrome.storage.local.set({ [KEY]: table });
    return table;
  } catch {
    return cached?.rates ? cached : null;
  }
}

/**
 * `null` when the conversion cannot be made — an unknown currency, no table at
 * all. Never a guess: an amount silently left unconverted would be added to the
 * total as if it were already in the right currency, which is how a total becomes
 * quietly wrong.
 *
 * The table is quoted against one base, so going from A to B passes through it.
 */
export function convert(amount, from, to, table) {
  if (from === to) return amount;
  if (!table?.rates) return null;
  const rate = (c) => (c === table.base ? 1 : table.rates[c]);
  const f = rate(from);
  const t = rate(to);
  if (!f || !t) return null;
  return (amount / f) * t;
}

/** The currencies the table can reach, for the picker. */
export function known(table) {
  return table?.rates ? [table.base, ...Object.keys(table.rates)] : [];
}
