// The `factory` command. See ../README.md.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { createSandbox } from "@ai-hero/sandcastle";
import { defaultImageName } from "@ai-hero/sandcastle/sandboxes/docker";
import { agent } from "./agent.ts";
import {
  FACTORY_DIR,
  SKILLS,
  TEMPLATES,
  enterRoot,
  fail,
  git,
  readSettings,
  runner,
  tildify,
} from "./project.ts";
import { implement, review } from "./stages.ts";

const HELP = `factory: run the flow's unattended stages in Docker. Run from a project's root.

  factory init                 write .sandcastle/ (Dockerfile, factory.json, .env.example) from the templates
  factory build                build the project's image from .sandcastle/Dockerfile
  factory doctor               is everything in place?
  factory smoke                one "Hello" run: image, key, Pi's output, the skills mount
  factory implement <ticket>   implement one ticket on agent/<feature>-<NN-slug>, from the current branch
  factory review <ticket>      review that ticket's branch, fix what needs no person, list what is left
  factory review --branch B --base REF --spec PATH --out FILE
                               the same on any existing branch, without a run record (used by the bench)

The README: ${tildify(path.join(FACTORY_DIR, "README.md"))}`;

const [command, ...rest] = process.argv.slice(2);
if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log(HELP);
  process.exit(0);
}
const root = enterRoot();

switch (command) {
  case "init":
    init();
    break;
  case "build":
    build();
    break;
  case "doctor":
    doctor();
    break;
  case "smoke":
    await smoke();
    break;
  case "implement":
    await implement(rest[0]);
    break;
  case "review": {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        branch: { type: "string" },
        base: { type: "string" },
        spec: { type: "string" },
        out: { type: "string" },
      },
    });
    await review({ ticket: positionals[0], ...values });
    break;
  }
  default:
    fail(`unknown command '${command}'. Try 'factory --help'.`);
}

function init() {
  const dir = ".sandcastle";
  if (fs.existsSync(path.join(dir, "Dockerfile"))) fail(`${dir}/Dockerfile exists already`);
  fs.mkdirSync(dir, { recursive: true });
  const copies: [string, string][] = [
    ["Dockerfile", "Dockerfile"],
    ["factory.json", "factory.json"],
    ["env.example", ".env.example"],
    ["gitignore", ".gitignore"],
  ];
  for (const [from, to] of copies) {
    const target = path.join(dir, to);
    if (fs.existsSync(target)) {
      console.log(`kept    ${target} (exists)`);
      continue;
    }
    fs.copyFileSync(path.join(TEMPLATES, from), target);
    console.log(`wrote   ${target}`);
  }
  console.log(`
Now:
  1. Edit ${dir}/Dockerfile for the project's toolchain.
  2. Edit ${dir}/factory.json: "setup" installs and prepares the project in a fresh runner;
     "checks" are the commands every stage must leave passing.
  3. Put where code goes and how it is tested in AGENTS.md, not in the prompts.
  4. Copy ${dir}/.env.example to ${dir}/.env and add a separate, spend-capped key.
  5. Commit ${dir}/ (the .gitignore there keeps .env, logs, worktrees and runs out).
  6. factory build, factory doctor, factory smoke.`);
}

function build() {
  const bin = path.join(FACTORY_DIR, "node_modules", ".bin", "sandcastle");
  const { status } = spawnSync(bin, ["docker", "build-image"], { stdio: "inherit" });
  process.exit(status ?? 1);
}

function doctor() {
  let bad = 0;
  const line = (ok: boolean, text: string, hint = "") => {
    if (!ok) bad++;
    console.log(`${ok ? "✓" : "✗"} ${text}${!ok && hint ? `: ${hint}` : ""}`);
  };
  const quiet = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;

  line(fs.existsSync(path.join(FACTORY_DIR, "node_modules", "@ai-hero", "sandcastle")), "factory installed", `cd ${tildify(FACTORY_DIR)} && npm ci`);
  const dockerUp = quiet("docker", ["info"]);
  line(dockerUp, "Docker running", "start Docker Desktop");
  const image = defaultImageName(root);
  if (dockerUp) line(quiet("docker", ["image", "inspect", image]), `image ${image} built`, "factory build");
  line(fs.existsSync(".sandcastle/factory.json"), ".sandcastle/factory.json present", "factory init");
  if (fs.existsSync(".sandcastle/factory.json")) {
    const s = readSettings();
    console.log(`  setup:  ${s.setup}\n  checks: ${s.checks.join(", ")}`);
  }
  const env = fs.existsSync(".sandcastle/.env") ? fs.readFileSync(".sandcastle/.env", "utf8") : "";
  const keyed = /^ANTHROPIC_API_KEY=\S+/m.test(env) || Boolean(process.env.ANTHROPIC_API_KEY);
  line(keyed, "ANTHROPIC_API_KEY in .sandcastle/.env or the environment", "add a separate, spend-capped key");
  line(fs.existsSync(path.join(SKILLS, "code-review", "SKILL.md")), `skills to mount: ${tildify(SKILLS)}`, "code-review/SKILL.md missing");
  line(fs.existsSync("AGENTS.md"), "AGENTS.md present", "the runner reads the project's facts from it");
  const dirty = git("status", "--porcelain");
  line(dirty === "", "working tree clean", "commit first: a runner starts from HEAD and sees only commits");
  process.exit(bad === 0 ? 0 : 1);
}

async function smoke() {
  const branch = "agent/factory-smoke";
  try {
    git("rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
    fail(`${branch} exists from an earlier smoke run: git branch -D ${branch}`);
  } catch {
    // absent, as it should be
  }
  const sandbox = await createSandbox({ branch, sandbox: runner() });
  let ok = true;
  try {
    const result = await sandbox.run({
      agent,
      name: "smoke",
      prompt: "Hello. Reply with one short sentence and do nothing else.",
    });
    console.log(`reply: ${result.stdout.trim().split("\n").at(-1)}`);
    ok &&= result.stdout.trim() !== "";
    const skill = await sandbox.exec("test -r ~/.agents/skills/code-review/SKILL.md");
    console.log(`${skill.exitCode === 0 ? "✓" : "✗"} the runner sees ~/.agents/skills/code-review/SKILL.md`);
    ok &&= skill.exitCode === 0;
  } finally {
    await sandbox.close();
    git("branch", "-D", branch);
  }
  if (!ok) fail("smoke test FAILED");
  console.log("smoke test OK");
}
