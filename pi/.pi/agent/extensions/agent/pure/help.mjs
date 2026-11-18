// Words a person reads: the guide, the bare listing, argument completions and the dim hint.
// state: { child, linked, name?, links: [{name, state}], inbox, saved: [[name, desc]] }
import { STARTERS } from './jobs.mjs';

export const ARG_HINT = '[--work] NAME [--model X] [--thinking L] [JOB…]';

const TOPICS = {
  open: `/agent [--work] NAME [--model provider/id|fast|main] [--thinking LEVEL] [JOB…]
Opens NAME in a new Herdr pane beside Main, forked from this conversation. From then on it sees
each new prompt and each finished reply in Main, as text only (no tool calls, results, images or
reasoning). Main gets no extra turn.
The job is, in order: the JOB you type, the "## Job" section of agents/NAME/agent.md, or a starter
(critic, notes, research). A new name needs a job.
A model picker opens with the fast default highlighted (Haiku). --model or --thinking skips it;
--model fast takes the fast default; --model main uses Main's model.
Example: /agent Repeater Repeat Main's last prompt in at most five words, as one numbered finding.`,
  work: `/agent --work NAME [JOB…]
Agents are read-only by default: read, grep, find, ls (those Main has active). --work also gives
write, edit and bash. Anything else is blocked.
Example: /agent --work Notes Keep decisions in notes.md`,
  send: `From Main:   /agent send NAME|all TEXT    the agent answers in its own pane
From agent:  /agent send main #2           sends finding 2 of the latest reply with findings
             /agent send main #1,3         sends findings 1 and 3
             /agent send main TEXT         sends your own words
             ↑ / ↓ then Enter              picks one numbered finding from the last 12 replies
A note never interrupts Main and never touches what you have typed there. Main shows
"from NAME · …" and keeps the note in its inbox; it joins your next prompt in Main.`,
  inbox: `/agent inbox
Shows the notes waiting for your next prompt in Main, without a model call. Reading them does not
use them up. Up to 16 notes / 16,000 characters wait at once.`,
  status: `/agent status
Lists links: opening (the pane has not connected yet), watching, or why it ended.`,
  stop: `/agent stop [NAME]
Ends a link; both panes stay open as ordinary conversations. From Main, with no name: every link.
In an agent pane: this agent's link. The link also ends when Main reloads, switches session or
branch (/tree), or when the agent's model is changed. Open a fresh agent to reconnect.`,
};

export function guide(topic = '', child = false) {
  if (topic) {
    if (!Object.hasOwn(TOPICS, topic)) return `No help topic "${topic}". Topics: ${Object.keys(TOPICS).join(', ')}.`;
    return TOPICS[topic];
  }
  return `/agent ${ARG_HINT}: a supporting agent in a pane beside Main, watching Main's conversation
${child ? '\nYou are in an agent pane. Useful here:\n  /agent send main #N     send finding N of the latest reply with findings\n  ↑ / ↓ then Enter        pick a numbered finding and send it\n  /agent status · stop    this link\n' : ''}
Commands (in Main)
  /agent                              list starters, saved agents and usage
  /agent critic                       open a starter: critic, notes, research
  /agent NAME JOB…                    open your own agent with this job
  /agent NAME                         open a saved agent (agents/NAME/agent.md, "## Job")
  /agent --work NAME [JOB…]           also allow write, edit and bash
  /agent NAME --model fast            skip the picker, use the fast default
  /agent NAME --model main            skip the picker, use Main's model
  /agent send NAME|all TEXT           ask an agent directly
  /agent inbox                        notes from agents waiting for your next prompt
  /agent status                       links and their state
  /agent stop [NAME]                  end a link (panes stay)

Commands (in an agent pane)
  /agent send main #2                 send finding 2 to Main (#1,3 for two)
  ↑ / ↓ then Enter                    same, picking with the arrow keys; Esc back to your draft

Nothing reaches Main unless you send it. A sent note never interrupts Main's reply or changes
your unsent text there; it is attached to your next prompt in Main.

Help topics: /agent help open | work | send | inbox | status | stop
Needs: Pi in a Herdr app pane (hc and herdr-app on PATH).`;
}

export function listing(state) {
  const rows = [];
  rows.push('Starters');
  for (const [n, s] of Object.entries(STARTERS)) rows.push(`  /agent ${n.padEnd(14)} ${s.hint}`);
  rows.push('', 'Saved agents (agents/NAME/agent.md)');
  if (state.saved.length) for (const [n, d] of state.saved) rows.push(`  /agent ${n.padEnd(14)} ${d}`);
  else rows.push('  none in this project');
  if (state.links.length) {
    rows.push('', 'Linked');
    for (const l of state.links) rows.push(`  ${l.name.padEnd(21)} ${l.state}`);
  }
  if (state.inbox) rows.push('', `${state.inbox} agent note${state.inbox === 1 ? '' : 's'} waiting · /agent inbox`);
  rows.push('', `Usage: /agent ${ARG_HINT}`, '       /agent send NAME|all TEXT · inbox · status · stop [NAME] · --help');
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
    if (prefix === '') return rows.map(([value, description]) => ({ value, label: `/agent ${value}`.trim(), description }));
    return match(prefix, rows.slice(1));
  }
  const names = [...Object.entries(STARTERS).map(([n, s]) => [n, s.hint]), ...state.saved.filter(([n]) => !STARTERS[n.toLowerCase()])];
  const fresh = names.filter(([n]) => !live(state).some(l => l.name.toLowerCase() === n.toLowerCase()));
  const roots = [...fresh, ['inbox', `notes waiting (${state.inbox})`], ['status', 'links and their state'], ['--help', 'the full guide']];
  if (prefix === '') return [{ value: '', label: '/agent', description: 'list agents and usage (Enter again)' }, ...roots.map(([v, description]) => ({ value: v, label: `/agent ${v}`, description }))];
  const words = prefix.trimStart().split(/\s+/);
  const last = words.at(-1), lead = words.slice(0, -1).join(' ').toLowerCase(), head = prefix.slice(0, prefix.length - last.length);
  if (!lead) return match(last, roots);
  if (lead === 'stop') return match(last, live(state).map(l => [l.name, l.state]), head);
  if (lead === 'help' || lead === '--help') return match(last, Object.keys(TOPICS).map(t => [t, `help on ${t}`]), head);
  if (lead === '--work') return match(last, fresh, head);
  return null; // never complete inside a job or a message
}

/** [syntax, tip] shown dim above the editor while the draft starts with /agent. */
export function hint(draft, state) {
  const m = /^\/agent(?=\s|$)/.exec(draft);
  if (!m) return null;
  const raw = draft.slice(m[0].length).trimStart(), word = raw.split(/\s+/, 1)[0].toLowerCase();
  if (state.child) {
    if (!state.linked) return ['/agent status', 'Not linked to Main. Open a fresh agent from Main.'];
    if (word === 'send') return ['/agent send main #N | TEXT', 'Queues a note for Main; Main keeps working.'];
    return ['/agent send main #N', 'Or ↑/↓ then Enter to pick a finding · /agent --help'];
  }
  if (!raw) return [`/agent ${ARG_HINT}`, 'Enter lists agents · Tab completes a name'];
  if (word === 'send') return ['/agent send NAME|all TEXT', live(state).length ? `Linked: ${live(state).map(l => l.name).join(', ')}` : 'No linked agents yet.'];
  if (word === 'stop') return ['/agent stop [NAME]', 'Ends the link; the panes stay.'];
  if (word === 'inbox' || word === 'status') return [`/agent ${word}`, 'No model call.'];
  if (word === 'help' || word === '--help' || word === '-h') return ['/agent help [open|work|send|inbox|status|stop]', 'Prints the guide here.'];
  if (word === '--work') return ['/agent --work NAME [JOB…]', 'Also allows write, edit and bash.'];
  if (/\s--(model|thinking)\b/.test(raw)) return ['NAME --model provider/id|main --thinking LEVEL JOB…', 'Skips the model picker.'];
  return [`/agent NAME [JOB…]`, 'Opens beside Main · read-only tools · picker chooses the model'];
}
