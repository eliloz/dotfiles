// Which model a sidecar runs on. Pure: rows come from Pi's model registry in index.ts.
// row: { ref, provider, id, name, levels: string[], thinking, main, fast }

export const FAST = [/^anthropic\/claude-haiku-5-5$/, /haiku/i];

/** Sort available models: the fast default first, then Main's, then by name. */
export function modelRows(available, mainRef) {
  const seen = new Set(), rows = [];
  for (const m of available) {
    const ref = `${m.provider}/${m.id}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    rows.push({ ref, provider: m.provider, id: m.id, name: m.name || m.id, levels: m.levels, thinking: m.thinking, main: ref === mainRef, fast: false });
  }
  const fast = FAST.map(re => rows.find(r => re.test(r.ref))).find(Boolean) ?? rows.find(r => r.main);
  if (fast) {
    fast.fast = true;
    if (!fast.main && fast.levels.includes('low')) fast.thinking = 'low';
  }
  return rows.sort((a, b) => Number(b.fast) - Number(a.fast) || Number(b.main) - Number(a.main) || a.ref.localeCompare(b.ref));
}

/** The row for --model (undefined or "fast" = the fast default, "main" = Main's), with --thinking applied. */
export function requireModel(rows, requested, thinking) {
  const row = requested === undefined || requested === 'fast' ? rows.find(r => r.fast) : requested === 'main' ? rows.find(r => r.main) : rows.find(r => r.ref === requested);
  if (!row) {
    if (requested === 'main') throw Error('Main\'s model is not available to sidecars. Choose one with --model provider/id. No pane opened.');
    throw Error(`${requested ?? 'No model'} is not available here. Run /sidecar NAME without --model to pick one. No pane opened.`);
  }
  if (thinking === undefined) return row;
  if (!row.levels.includes(thinking)) throw Error(`${row.ref} does not support thinking ${thinking}; use ${row.levels.join(', ')}. No pane opened.`);
  return { ...row, thinking };
}
