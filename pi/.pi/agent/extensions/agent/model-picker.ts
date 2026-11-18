/**
 * Searchable model picker for one agent. The fast default is first and highlighted.
 * Tab cycles the thinking level. Main's model is never changed.
 */
import { DynamicBorder, getSelectListTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, Input, SelectList, Text } from "@earendil-works/pi-tui";

export type Row = { ref: string; provider: string; id: string; name: string; levels: string[]; thinking: string; main: boolean; fast: boolean };
export type Choice = { ref: string; thinking: string };

export async function pickModel(ctx: ExtensionContext, name: string, rows: Row[]): Promise<Choice | null> {
	if (!rows.length) throw new Error("No models are available. Log in to a provider in Pi first (/login). No pane opened.");
	return ctx.ui.custom<Choice | null>(
		(tui, theme, kb, done) => {
			const input = new Input();
			const slot = new Container();
			const detail = new Text("", 1, 0);
			const thinking = new Map<string, string>();
			const byRef = new Map(rows.map((r) => [r.ref, r]));
			let list: SelectList;
			let closed = false;
			const finish = (c: Choice | null) => {
				if (closed) return;
				closed = true;
				done(c);
			};
			const selected = () => byRef.get(list.getSelectedItem()?.value ?? "");
			const level = (r: Row) => thinking.get(r.ref) ?? r.thinking;

			function describe() {
				const r = selected();
				detail.setText(
					r
						? theme.fg("accent", r.ref) +
								"\n" +
								theme.fg("text", `Thinking: ${level(r)}`) +
								theme.fg("dim", r.levels.length > 1 ? `  · Tab cycles (${r.levels.join(" / ")})` : "  (fixed)")
						: theme.fg("muted", "No model matches."),
				);
			}
			function cycle() {
				const r = selected();
				if (!r || r.levels.length < 2) return;
				thinking.set(r.ref, r.levels[(r.levels.indexOf(level(r)) + 1) % r.levels.length]);
				describe();
			}
			function filter() {
				const q = input.getValue().trim();
				const hits = q ? fuzzyFilter(rows, q, (r) => `${r.ref} ${r.name}${r.main ? " main" : ""}${r.fast ? " fast default" : ""}`) : rows;
				list = new SelectList(
					hits.map((r) => ({
						value: r.ref,
						label: r.fast ? `${r.id} · fast default` : r.main ? `${r.id} · same as Main` : r.id,
						description: r.provider,
					})),
					8,
					getSelectListTheme(),
					{ minPrimaryColumnWidth: 14, maxPrimaryColumnWidth: 40 },
				);
				list.onCancel = () => finish(null);
				list.onSelect = (item) => {
					const r = byRef.get(item.value)!;
					finish({ ref: r.ref, thinking: level(r) });
				};
				list.onSelectionChange = describe;
				describe();
				slot.clear();
				slot.addChild(list);
			}

			class Picker extends Container {
				readonly capturesViewportInput = true;
				get focused() {
					return input.focused;
				}
				set focused(v: boolean) {
					input.focused = v;
				}
				handleInput(data: string) {
					if (kb.matches(data, "tui.input.tab")) cycle();
					else if ((["tui.select.up", "tui.select.down", "tui.select.pageUp", "tui.select.pageDown", "tui.select.confirm", "tui.select.cancel"] as const).some((k) => kb.matches(data, k))) list.handleInput(data);
					else {
						const before = input.getValue();
						input.handleInput(data);
						if (input.getValue() !== before) filter();
					}
					tui.requestRender();
				}
				dispose() {
					closed = true;
				}
			}

			const view = new Picker();
			view.addChild(new DynamicBorder());
			view.addChild(new Text(theme.fg("accent", theme.bold(`Model for ${name}`)), 1, 0));
			view.addChild(new Text(theme.fg("muted", "This model receives the fork and the watched text. Main's model stays as it is."), 1, 0));
			view.addChild(input);
			view.addChild(slot);
			view.addChild(detail);
			view.addChild(new Text(theme.fg("dim", "Type to filter · ↑↓ choose · Enter opens the agent · Esc cancels"), 1, 0));
			view.addChild(new DynamicBorder());
			filter();
			return view;
		},
		{ overlay: true, overlayOptions: { width: "90%", anchor: "center" } },
	);
}
