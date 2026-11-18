/**
 * The tray in an agent pane, below the editor. It always shows the latest numbered finding, so a
 * finding stays in view however much scrolls by. ↑/↓ pick one finding from the last 12 replies,
 * Enter sends it to Main, Esc goes back to the draft. It wraps the editor (it never reads global
 * terminal input) and only acts while the draft is a single line, not a /command, and no completion
 * menu is open.
 */
import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
// @ts-ignore: plain ESM, tested with node --test
import { ageLabel, plain, trayItems } from "./pure/items.mjs";

type Item = { key: string; age: number; n: number; body: string; text: string };
type Reply = { id: number; text: string };

export type Tray = {
	/** Every finished reply, including "🟢 Nothing new", so ages count real replies. */
	add(text: string): void;
	/** Note text sent to Main by any route (one item per line), so the tray does not offer it again. */
	markSent(text: string): void;
	clear(): void;
};

export function startTray(ctx: ExtensionContext, name: string, send: (text: string) => Promise<unknown>, live: () => boolean): Tray {
	const replies: Reply[] = [];
	const sent = new Set<string>(); // note texts ("Repeater 1: …") already sent to Main
	let serial = 0;
	let selected: string | null = null;
	let armed = ""; // the draft when selection began; typing ends the selection
	let status = "";
	let sending = false;
	let refresh = () => {};

	const list = (): Item[] => trayItems(replies, name);
	const current = () => list().find((i) => i.key === selected);
	const reset = () => {
		selected = null;
		status = "";
	};

	function move(step: number) {
		const all = list();
		if (!all.length) return;
		const i = all.findIndex((v) => v.key === selected);
		// ↑ from the draft selects item 1 of the newest reply with findings; further ↑ walks down the list and into older replies.
		const next = i < 0 ? (step > 0 ? 0 : -1) : i + step;
		if (next < 0) reset();
		else selected = all[Math.min(next, all.length - 1)].key;
		status = "";
		refresh();
	}

	async function sendSelected() {
		const item = current();
		if (!item || sending) return;
		if (sent.has(item.text)) {
			status = "Already sent to Main.";
			return refresh();
		}
		sending = true;
		status = "Sending…";
		refresh();
		try {
			await send(item.text);
			sent.add(item.text);
			status = "Sent to Main · in its inbox for your next prompt there";
		} catch (e) {
			status = `Not sent: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			sending = false;
			refresh();
		}
	}

	const previous = ctx.ui.getEditorComponent();
	ctx.ui.setEditorComponent((tui, theme, kb) => {
		const editor = previous?.(tui, theme, kb) ?? new CustomEditor(tui, theme, kb);
		const native = editor.handleInput.bind(editor);
		editor.handleInput = (data: string) => {
			const before = editor.getText();
			const menuOpen = (editor as any).capturesViewportInput === true;
			const eligible = live() && !before.includes("\n") && !before.startsWith("/") && !menuOpen;
			if (!eligible) {
				if (selected !== null) {
					reset();
					refresh();
				}
				return native(data);
			}
			if (selected !== null && armed !== before) reset();
			if (!isKeyRelease(data)) {
				if (matchesKey(data, "up") && list().length) {
					armed = before;
					return move(1);
				}
				if (matchesKey(data, "down") && selected !== null) return move(-1);
				if (selected !== null && matchesKey(data, "escape")) {
					reset();
					return refresh();
				}
				if (selected !== null && matchesKey(data, "enter")) return void sendSelected();
			}
			native(data);
			if (selected !== null && editor.getText() !== before) {
				reset();
				refresh();
			}
		};
		return editor;
	});

	ctx.ui.setWidget(
		"agent-tray",
		(tui, theme) => {
			refresh = () => tui.requestRender();
			return {
				invalidate() {},
				render(width: number) {
					if (!live()) return [];
					const w = Math.max(1, width);
					const muted = (s: string) => truncateToWidth(theme.fg("muted", s), w);
					const all = list();
					const item = selected === null ? undefined : current();
					if (!item) {
						// Not selecting: keep the newest finding in view.
						const latest = all[0];
						if (!latest) return [];
						const count = all.filter((i) => i.age === latest.age).length;
						const head = `Latest finding · ${ageLabel(latest.age)}${count > 1 ? ` · 1 of ${count}` : ""}${sent.has(latest.text) ? " · sent" : ""}`;
						return [
							muted(head),
							...wrapTextWithAnsi(`${latest.n}. ${plain(latest.body)}`, w).slice(0, 3),
							muted("↑ select · Enter sends to Main"),
							...(status ? [truncateToWidth(status, w)] : []),
						];
					}
					const action = sent.has(item.text) ? "sent" : "Enter sends to Main";
					return [
						truncateToWidth(theme.fg("accent", theme.bold(`Finding ${item.n} · ${ageLabel(item.age)} · ${action}`)), w),
						...wrapTextWithAnsi(`${item.n}. ${plain(item.body)}`, w).slice(0, 4),
						muted("↑/↓ select · Esc back to your draft"),
						...(status ? [truncateToWidth(status, w)] : []),
					];
				},
			};
		},
		{ placement: "belowEditor" },
	);

	return {
		add(text: string) {
			replies.push({ id: ++serial, text });
			while (replies.length > 12) replies.shift();
			reset();
			refresh();
		},
		markSent(text: string) {
			for (const line of String(text).split("\n")) if (line.trim()) sent.add(line);
			refresh();
		},
		clear() {
			replies.length = 0;
			reset();
			refresh();
		},
	};
}
