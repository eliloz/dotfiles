// What a review run hands back, and how it is read out of the run's stdout.
// `sandbox.run()` has no `output` option (only top-level `run()` does), so
// this mirrors Sandcastle's own extraction: the last <tag>…</tag>, a code
// fence unwrapped, JSON parsed, then validated.
import { z } from "zod/v4";

export const reviewSchema = z
  .strictObject({
    findings: z
      .array(
        z.strictObject({
          axis: z
            .enum(["standards", "spec"])
            .describe("Which review axis the finding belongs to."),
          title: z.string().min(1).describe("The finding in a few words, plain text."),
          path: z.string().min(1).describe("The file, relative to the repository root."),
          line: z
            .number()
            .int()
            .positive()
            .describe(
              "The first line the finding concerns, in the file as it was in the change you reviewed (before any fix)."
            ),
          body: z
            .string()
            .min(1)
            .describe(
              "The finding in Markdown: the documented rule or the spec line it breaks, quoted, and what is wrong."
            ),
          status: z
            .enum(["fixed", "left"])
            .describe("fixed: you fixed and committed it. left: only a person can decide it."),
        })
      )
      .describe("Every finding you made, fixed or left. Empty is fine."),
  })
  .describe("Your review's findings.");

export type Finding = z.infer<typeof reviewSchema>["findings"][number];

// Matt's extraction prompt (module 07, shared/extraction-prompt.ts).
export const extractionPrompt = (tag: string, schema: z.ZodType): string =>
  [
    `Reply with one \`<${tag}>\` block and nothing else. Inside it, put one JSON value that matches this JSON Schema:`,
    "",
    "```json",
    JSON.stringify(z.toJSONSchema(schema), null, 2),
    "```",
    "",
    "Answer from what you have already read, with no tool calls.",
    "",
    `<${tag}>`,
    "{ ...the JSON value... }",
    `</${tag}>`,
  ].join("\n");

export function extract<T>(stdout: string, tag: string, schema: z.ZodType<T>): T {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const end = stdout.lastIndexOf(close);
  const start = end === -1 ? -1 : stdout.lastIndexOf(open, end);
  if (start === -1) throw new Error(`no <${tag}> block in the reply`);
  let raw = stdout.slice(start + open.length, end).trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/u.exec(raw);
  if (fenced) raw = fenced[1].trim();
  return schema.parse(JSON.parse(raw));
}
