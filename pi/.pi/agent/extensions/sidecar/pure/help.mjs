// Words a person reads: the guide, the bare listing, argument completions and the dim hint.
// state: { child, linked, name?, links: [{name, state}], inbox, saved: [[name, desc]] }

export const ARG_HINT = '[--work] NAME [--model X] [--thinking L] [INSTRUCTIONS…]';

const TOPICS = {
  open: `/sidecar [--work] NAME [--model provider/id|fast|main] [--thinking LEVEL] [INSTRUCTIONS…]
Opens NAME in a new Herdr pane beside Main, forked from this conversation. From then on it sees
each new prompt and each finished reply in Main, as text only (no tool calls, results, images or
reasoning). Main gets no extra turn.
The instructions are the INSTRUCTIONS you type, or else the "## Instructions" section of sidecars/NAME/sidecar.md in this project.
A name with neither is refused.
A model picker opens with the fast default highlighted (Haiku). --model or --thinking skips it;
--model fast takes the fast default; --model main uses Main's model.
Example: /sidecar Repeater Repeat Main's last prompt in at most five words, as one numbered finding.`,
  work: `/sidecar --work NAME [INSTRUCTIONS…]
Sidecars are read-only by default: read, grep, find, ls (those Main has active). --work also gives
write, edit and bash. Anything else is blocked.
Example: /sidecar --work Notes Keep decisions in notes.md`,
  send: `From Main:   /sidecar send NAME|all TEXT    the sidecar answers in its own pane
From sidecar:  /sidecar send main #2           sends finding 2 of the latest reply with findings
             /sidecar send main #1,3         sends findings 1 and 3
             /sidecar send main TEXT         sends your own words
             ↑ / ↓ then Enter              picks one numbered finding from the last 12 replies
A note never interrupts Main and never touches what you have typed there. Main shows
"from NAME · …" and keeps the note in its inbox; it joins your next prompt in Main.`,
  inbox: `/sidecar inbox
Shows the notes waiting for your next prompt in Main, without a model call. Reading them does not
use them up. Up to 16 notes / 16,000 characters wait at once.`,
  status: `/sidecar status
Lists links: opening (the pane has not connected yet), watching, or why it ended.`,
  stop: `/sidecar stop [NAME]
Ends a link; both panes stay open as ordinary conversations. From Main, with no name: every link.
In a sidecar pane: this sidecar's link. The link also ends when Main reloads, switches session or
branch (/tree), or when the sidecar's model is changed. Open a fresh sidecar to reconnect.`,
};

export function guide(topic = '', child = false) {
  if (topic) {
    if (!Object.hasOwn(TOPICS, topic)) return `No help topic "${topic}". Topics: ${Object.keys(TOPICS).join(', ')}.`;
    return TOPICS[topic];
  }
  return `/sidecar ${ARG_HINT}: a sidecar in a pane beside Main, watching Main's conversation
${child ? '\nYou are in a sidecar pane. Useful here:\n  /sidecar send main #N     send finding N of the latest reply with findings\n  ↑ / ↓ then Enter        pick a numbered finding and send it\n  /sidecar status · stop    this link\n' : ''}
Commands (in Main)
  /sidecar                              list saved sidecars and usage
  /sidecar NAME INSTRUCTIONS…                    open your own sidecar with these instructions
  /sidecar NAME                         open a saved sidecar (sidecars/NAME/sidecar.md, "## Instructions")
  /sidecar --work NAME [INSTRUCTIONS…]           also allow write, edit and bash
  /sidecar NAME --model fast            skip the picker, use the fast default
  /sidecar NAME --model main            skip the picker, use Main's model
  /sidecar send NAME|all TEXT           ask a sidecar directly
  /sidecar inbox                        notes from sidecars waiting for your next prompt
  /sidecar status                       links and their state
  /sidecar stop [NAME]                  end a link (panes stay)

Commands (in a sidecar pane)
  /sidecar send main #2                 send finding 2 to Main (#1,3 for two)
  ↑ / ↓ then Enter                    same, picking with the arrow keys; Esc back to your draft

Nothing reaches Main unless you send it. A sent note never interrupts Main's reply or changes
your unsent text there; it is attached to your next prompt in Main.

Help topics: /sidecar help open | work | send | inbox | status | stop
Needs: Pi in a Herdr app pane (hc and herdr-app on PATH).`;
}

export function listing(state) {
  const rows = [];
  rows.push('Saved sidecars (sidecars/NAME/sidecar.md)');
  if (state.saved.length) for (const [n, d] of state.saved) rows.push(`  /sidecar ${n.padEnd(14)} ${d}`);
  else rows.push('  none in this project');
  if (state.links.length) {
    rows.push('', 'Linked');
    for (const l of state.links) rows.push(`  ${l.name.padEnd(21)} ${l.state}`);
  }
  if (state.inbox) rows.push('', `${state.inbox} sidecar note${state.inbox === 1 ? '' : 's'} waiting · /sidecar inbox`);
  rows.push('', `Usage: /sidecar ${ARG_HINT}`, '       /sidecar send NAME|all TEXT · inbox · status · stop [NAME] · --help');
  return rows.join('\n');
}

const live = s => s.links.filter(l => l.state === 'watching' || l.state === 'opening');

function match(prefix, rows, head = '') {
  const hits = rows.filter(([v]) => v.toLowerCase().startsWith(prefix.toLowerCase()));
  // An exact word is already a valid command: let Enter run it instead of applying a suggestion.
  if (!hits.length || hits.some(([v]) => v.toLowerCase() === prefix.toLowerCase())) return null;
  return hits.map(([v, description]) => ({ value: head + v, label: v, description }));
}

/**
 * Argument completions. In Pi 1.5.2 Enter applies the highlighted suggestion, and the value
 * replaces the whole argument text, so every value is a complete, valid command.
 */
export function completions(prefix, state) {
  if (/[\r\n]/.test(prefix)) return null;
  if (state.child) {
    const rows = [['', 'show the guide (Enter again)'], ...(state.linked ? [['send main #1', 'send finding 1 of the latest reply with findings']] : []), ['status', 'this link'], ['stop', 'end this link'], ['--help', 'the full guide']];
    if (prefix === '') return rows.map(([value, description]) => ({ value, label: `/sidecar ${value}`.trim(), description }));
    return match(prefix, rows.slice(1));
  }
  const names = state.saved;
  const fresh = names.filter(([n]) => !live(state).some(l => l.name.toLowerCase() === n.toLowerCase()));
  const roots = [...fresh, ['inbox', `notes waiting (${state.inbox})`], ['status', 'links and their state'], ['--help', 'the full guide']];
  if (prefix === '') return [{ value: '', label: '/sidecar', description: 'list sidecars and usage (Enter again)' }, ...roots.map(([v, description]) => ({ value: v, label: `/sidecar ${v}`, description }))];
  const words = prefix.trimStart().split(/\s+/);
  const last = words.at(-1), lead = words.slice(0, -1).join(' ').toLowerCase(), head = prefix.slice(0, prefix.length - last.length);
  if (!lead) return match(last, roots);
  if (lead === 'stop') return match(last, live(state).map(l => [l.name, l.state]), head);
  if (lead === 'help' || lead === '--help') return match(last, Object.keys(TOPICS).map(t => [t, `help on ${t}`]), head);
  if (lead === '--work') return match(last, fresh, head);
  return null; // never complete inside instructions or a message
}

/** [syntax, tip] shown dim above the editor while the draft starts with /sidecar. */
export function hint(draft, state) {
  const m = /^\/sidecar(?=\s|$)/.exec(draft);
  if (!m) return null;
  const raw = draft.slice(m[0].length).trimStart(), word = raw.split(/\s+/, 1)[0].toLowerCase();
  if (state.child) {
    if (!state.linked) return ['/sidecar status', 'Not linked to Main. Open a fresh sidecar from Main.'];
    if (word === 'send') return ['/sidecar send main #N | TEXT', 'Queues a note for Main; Main keeps working.'];
    return ['/sidecar send main #N', 'Or ↑/↓ then Enter to pick a finding · /sidecar --help'];
  }
  if (!raw) return [`/sidecar ${ARG_HINT}`, 'Enter lists sidecars · Tab completes a name'];
  if (word === 'send') return ['/sidecar send NAME|all TEXT', live(state).length ? `Linked: ${live(state).map(l => l.name).join(', ')}` : 'No linked sidecars yet.'];
  if (word === 'stop') return ['/sidecar stop [NAME]', 'Ends the link; the panes stay.'];
  if (word === 'inbox' || word === 'status') return [`/sidecar ${word}`, 'No model call.'];
  if (word === 'help' || word === '--help' || word === '-h') return ['/sidecar help [open|work|send|inbox|status|stop]', 'Prints the guide here.'];
  if (word === '--work') return ['/sidecar --work NAME [INSTRUCTIONS…]', 'Also allows write, edit and bash.'];
  if (/\s--(model|thinking)\b/.test(raw)) return ['NAME --model provider/id|main --thinking LEVEL INSTRUCTIONS…', 'Skips the model picker.'];
  return [`/sidecar NAME [INSTRUCTIONS…]`, 'Opens beside Main · read-only tools · picker chooses the model'];
}
