// aidlc-omp-adapter.ts — the omp (oh-my-pi) hook shim (AUTHORED shell file; the
// aidlc-*.ts hook bodies in <project>/.aidlc/hooks/ are PACKAGED core, byte-
// shared with every other harness).
//
// omp has no settings.json/hooks.json hook registry; its extension seam is the
// native extension API (auto-discovered from .omp/extensions/*.ts and loaded
// in-process by the omp runtime). This one extension maps omp's `pi.on(...)`
// event surface onto the core hook bodies, each run as a bun subprocess fed the
// ClaudeCodeHookInput JSON shape the core hooks parse (verified against omp
// 18.3.5):
//
//   omp event                     → core hook (Claude event it mirrors)
//   -----------------------------------------------------------------------
//   session_start                 → aidlc-session-start.ts       (SessionStart)
//   input (non-extension source)  → aidlc-record-human-turn.ts   (UserPromptSubmit)
//   tool_call task                → aidlc-deliver-stage-rules.ts + plan-approval-guard.ts (PreToolUse)
//   tool_call bash                → entrypoint boundary + aidlc-state-transition-guard.ts (PreToolUse)
//   tool_call write|edit|bash     → aidlc-review-freeze.ts + plan-approval-guard.ts (PreToolUse)
//   tool_call read|write|edit|…   → aidlc-reviewer-scope.ts      (PreToolUse)
//   tool_result write|edit        → aidlc-write-audit-log.ts + aidlc-run-sensors.ts (PostToolUse)
//   tool_result bash              → aidlc-rebuild-stage-graph.ts (PostToolUse Bash)
//   tool_result todowrite         → aidlc-sync-workflow-state.ts (PostToolUse TaskUpdate)
//   tool_result task              → aidlc-log-subagent.ts        (SubagentStop)
//   session_before_compact        → aidlc-validate-state.ts      (PreCompact)
//   session_stop                  → aidlc-continue-workflow.ts   (Stop)
//
// Blocking: omp's `tool_call` handler returns `{ block: true, reason }` to
// refuse a call, and `session_stop` returns `{ decision: "block", reason }` to
// re-engage the forwarding loop — the omp analogue of Claude's exit-2 + stderr
// and the Stop-hook block decision.

import { spawn } from "node:child_process";
import { isAbsolute, join } from "node:path";

// Minimal structural views of the omp extension API — declared locally so this
// authored shell file typechecks without resolving the host package (which is
// present only at runtime, inside omp). The real signatures come from
// @oh-my-pi/pi-coding-agent's ExtensionAPI.
type OmpContext = {
  cwd: string;
  sessionManager?: { getSessionId?: () => string };
};
type OmpToolCallEvent = { toolName: string; toolCallId: string; input?: Record<string, unknown> };
type OmpToolResultEvent = {
  toolName: string;
  toolCallId: string;
  input?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
};
type OmpInputEvent = { text?: string; source?: string };
type OmpToolCallResult = { block?: boolean; reason?: string; input?: Record<string, unknown> };
type OmpSessionStopResult = { decision?: "block"; reason?: string };
type OmpExtensionAPI = {
  registerCommand(
    name: string,
    options: { description?: string; handler: (args: string, ctx: OmpContext) => Promise<void> | void },
  ): void;
  on(event: "session_start", handler: (event: unknown, ctx: OmpContext) => Promise<void> | void): void;
  on(event: "input", handler: (event: OmpInputEvent, ctx: OmpContext) => Promise<void> | void): void;
  on(event: "tool_call", handler: (event: OmpToolCallEvent, ctx: OmpContext) => Promise<OmpToolCallResult | undefined> | OmpToolCallResult | undefined): void;
  on(event: "tool_result", handler: (event: OmpToolResultEvent, ctx: OmpContext) => Promise<void> | void): void;
  on(event: "session_before_compact", handler: (event: unknown, ctx: OmpContext) => Promise<void> | void): void;
  on(event: "session_stop", handler: (event: unknown, ctx: OmpContext) => Promise<OmpSessionStopResult | undefined> | OmpSessionStopResult | undefined): void;
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" | "nextTurn"; expandPromptTemplates?: boolean }): void;
  appendEntry(customType: string, data?: unknown): void;
};

const PROJECTED_INVOKE = "bun .aidlc/tools/aidlc.ts";
const TRUSTED_NAMESPACE = "engine";
const PROJECTED_TRUSTED_NAMESPACE = TRUSTED_NAMESPACE.startsWith("{{")
  ? "engine"
  : TRUSTED_NAMESPACE;
const DEFAULT_AIDLC_COMMAND = PROJECTED_INVOKE.startsWith("{{")
  ? ["bun", ".aidlc/tools/aidlc.ts", PROJECTED_TRUSTED_NAMESPACE]
  : [...PROJECTED_INVOKE.trim().split(/\s+/), PROJECTED_TRUSTED_NAMESPACE];

function runCoreHook(
  hookFile: string,
  input: Record<string, unknown>,
  cwd: string,
  aidlcCommand: readonly string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const [bin, ...prefix] = aidlcCommand;
    const hook = hookFile.replace(/^aidlc-/, "").replace(/\.ts$/, "");
    if (!bin) return resolve({ stdout: "", stderr: "", code: 0 });
    try {
      const child = spawn(bin, [...prefix, "hook", hook, "--project-dir", cwd], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, AIDLC_PROJECT_DIR: cwd, CLAUDE_PROJECT_DIR: cwd },
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        err += d.toString();
      });
      child.on("error", () => resolve({ stdout: "", stderr: "", code: 0 })); // fail open
      child.on("close", (code: number | null) => resolve({ stdout: out, stderr: err, code: code ?? 0 }));
      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
    } catch {
      resolve({ stdout: "", stderr: "", code: 0 }); // fail open
    }
  });
}

// emit.ts replaces the empty array with every packaged .aidlc/{tools,hooks}/*.ts
// path so the coarse bash boundary can reject a newly-authored payload.ts.
const shippedAidlcEntrypoints: ReadonlySet<string> = new Set<string>(
  /* @aidlc-shipped-entrypoints@ */ [
    "hooks/aidlc-continue-workflow.ts",
    "hooks/aidlc-deliver-stage-rules.ts",
    "hooks/aidlc-fold-usage.ts",
    "hooks/aidlc-log-subagent.ts",
    "hooks/aidlc-plan-approval-guard.ts",
    "hooks/aidlc-rebuild-stage-graph.ts",
    "hooks/aidlc-record-human-turn.ts",
    "hooks/aidlc-review-freeze.ts",
    "hooks/aidlc-reviewer-scope.ts",
    "hooks/aidlc-run-sensors.ts",
    "hooks/aidlc-session-end.ts",
    "hooks/aidlc-session-start.ts",
    "hooks/aidlc-state-transition-guard.ts",
    "hooks/aidlc-statusline.ts",
    "hooks/aidlc-sync-workflow-state.ts",
    "hooks/aidlc-validate-state.ts",
    "hooks/aidlc-write-audit-log.ts",
    "hooks/review-freeze-command.ts",
    "hooks/runtime-integrity.ts",
    "tools/aidlc-archive.ts",
    "tools/aidlc-artifact-resolution.ts",
    "tools/aidlc-artifact-vocabulary.ts",
    "tools/aidlc-attest.ts",
    "tools/aidlc-audit.ts",
    "tools/aidlc-bolt.ts",
    "tools/aidlc-channel.ts",
    "tools/aidlc-color.ts",
    "tools/aidlc-command.ts",
    "tools/aidlc-completions.ts",
    "tools/aidlc-config-diagnostics.ts",
    "tools/aidlc-construction-checkpoints.ts",
    "tools/aidlc-directive.ts",
    "tools/aidlc-distribution.ts",
    "tools/aidlc-doctor-bundle.ts",
    "tools/aidlc-doctor.ts",
    "tools/aidlc-documentkb-schema.ts",
    "tools/aidlc-graph.ts",
    "tools/aidlc-guard-fences.ts",
    "tools/aidlc-guard-operation.ts",
    "tools/aidlc-guard-switch.ts",
    "tools/aidlc-includes.ts",
    "tools/aidlc-init.ts",
    "tools/aidlc-inline-context.ts",
    "tools/aidlc-install-paths.ts",
    "tools/aidlc-jump.ts",
    "tools/aidlc-knowledge.ts",
    "tools/aidlc-learnings.ts",
    "tools/aidlc-lib.ts",
    "tools/aidlc-lifecycle.ts",
    "tools/aidlc-log.ts",
    "tools/aidlc-machine-config.ts",
    "tools/aidlc-metrics.ts",
    "tools/aidlc-model-policy.ts",
    "tools/aidlc-orchestrate.ts",
    "tools/aidlc-plugin-build.ts",
    "tools/aidlc-plugin-create.ts",
    "tools/aidlc-plugin-emit.ts",
    "tools/aidlc-plugin-test.ts",
    "tools/aidlc-plugin-validate.ts",
    "tools/aidlc-plugin.ts",
    "tools/aidlc-release.ts",
    "tools/aidlc-review-brief.ts",
    "tools/aidlc-rule-schema.ts",
    "tools/aidlc-runner-gen.ts",
    "tools/aidlc-runtime-budget.ts",
    "tools/aidlc-runtime-paths.ts",
    "tools/aidlc-runtime.ts",
    "tools/aidlc-sensor-claim-sources.ts",
    "tools/aidlc-sensor-linter.ts",
    "tools/aidlc-sensor-required-sections.ts",
    "tools/aidlc-sensor-schema.ts",
    "tools/aidlc-sensor-traceability.ts",
    "tools/aidlc-sensor-type-check.ts",
    "tools/aidlc-sensor-upstream-coverage.ts",
    "tools/aidlc-sensor.ts",
    "tools/aidlc-settings.ts",
    "tools/aidlc-stage-schema.ts",
    "tools/aidlc-state.ts",
    "tools/aidlc-steering.ts",
    "tools/aidlc-swarm-checkpoints.ts",
    "tools/aidlc-swarm.ts",
    "tools/aidlc-testing-posture.ts",
    "tools/aidlc-tiers.ts",
    "tools/aidlc-transaction.ts",
    "tools/aidlc-uninstall-plan.ts",
    "tools/aidlc-unit.ts",
    "tools/aidlc-update.ts",
    "tools/aidlc-usage.ts",
    "tools/aidlc-utility.ts",
    "tools/aidlc-validate.ts",
    "tools/aidlc-validity.ts",
    "tools/aidlc-version.ts",
    "tools/aidlc-windows-uninstall.ts",
    "tools/aidlc-workspace-doctor.ts",
    "tools/aidlc-workspace-manifest.ts",
    "tools/aidlc-workspace-sync.ts",
    "tools/aidlc-worktree.ts",
    "tools/aidlc.ts"
  ],
);

const AIDLC_BUN_PREFIX = /^bun[ \t]+\.aidlc\/(?:tools|hooks)\//;
const AIDLC_ENTRYPOINT = /^\.aidlc\/(tools|hooks)\/([A-Za-z0-9][A-Za-z0-9._-]*\.ts)$/;

/** Parse one expansion-free shell command into argv, or reject shell syntax. */
function directShellWords(command: string): string[] | null {
  const words: string[] = [];
  let word = "";
  let wordStarted = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        continue;
      }
      if (ch === "\\" && i + 1 < command.length) {
        word += command[++i];
        continue;
      }
      if (ch === "`" || ch === "$" || ch === "\n" || ch === "\r") return null;
      word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      wordStarted = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (wordStarted) {
        words.push(word);
        word = "";
        wordStarted = false;
      }
      continue;
    }
    if (
      ch === "\n" || ch === "\r" || ch === "\\" || ch === "`" || ch === "$" ||
      ch === "#" || ch === ";" || ch === "|" || ch === "&" || ch === "(" ||
      ch === ")" || ch === "<" || ch === ">"
    ) {
      return null;
    }
    word += ch;
    wordStarted = true;
  }
  if (quote !== null) return null;
  if (wordStarted) words.push(word);
  return words;
}

/** Return a denial reason only when the static AIDLC allow-prefix would match. */
function aidlcBashBoundaryViolation(
  command: string,
  allowedEntrypoints: ReadonlySet<string> = shippedAidlcEntrypoints,
): string | null {
  if (/^aidlc(?:[ \t]|$)/.test(command)) {
    return directShellWords(command)?.[0] === "aidlc"
      ? null
      : "AIDLC bash permission allows one direct invocation of a framework tool only. " +
          "Do not use chaining, redirection, expansion, or command substitution.";
  }
  if (!AIDLC_BUN_PREFIX.test(command)) return null;
  const words = directShellWords(command);
  const target = words?.[1]?.match(AIDLC_ENTRYPOINT);
  if (words?.[0] === "bun" && target && allowedEntrypoints.has(`${target[1]}/${target[2]}`)) {
    return null;
  }
  return (
    "AIDLC bash permission allows one direct invocation of a shipped tool or hook only. " +
    "Use an unchanged .aidlc entrypoint without chaining, redirection, expansion, or command substitution."
  );
}

// omp built-in tool name → the Claude-dialect normalized calls the core hooks
// parse. omp names its tools lower-case; some builds use `ls`/`list`.
function reviewerCalls(tool: string, args: Record<string, unknown>): Array<{ toolName: string; toolInput: Record<string, unknown> }> {
  if (tool === "bash") return [{ toolName: "Bash", toolInput: { command: (args.command as string) ?? "" } }];
  if (tool === "read") return [{ toolName: "Read", toolInput: { file_path: (args.filePath as string) ?? (args.path as string) ?? "" } }];
  if (tool === "write") return [{ toolName: "Write", toolInput: { file_path: (args.filePath as string) ?? (args.path as string) ?? "" } }];
  if (tool === "edit") return [{ toolName: "Edit", toolInput: { file_path: (args.filePath as string) ?? (args.path as string) ?? "" } }];
  if (tool === "glob") return [{ toolName: "Glob", toolInput: { pattern: (args.pattern as string) ?? "", path: (args.path as string) ?? "" } }];
  if (tool === "grep") return [{ toolName: "Grep", toolInput: { pattern: (args.pattern as string) ?? "", path: (args.path as string) ?? "", glob: (args.include as string) ?? (args.glob as string) ?? "" } }];
  if (tool === "ls" || tool === "list") return [{ toolName: "LS", toolInput: { path: (args.path as string) ?? "" } }];
  return [];
}

export default function aidlcOmpAdapter(pi: OmpExtensionAPI): void {
  const runCore = (hookFile: string, input: Record<string, unknown>, cwd: string) =>
    runCoreHook(hookFile, input, cwd, DEFAULT_AIDLC_COMMAND);

  // Sessions whose session-start hook reached an active workflow.
  const started = new Set<string>();
  // Sessions that delivered a real human turn (Stop enforcement keys on this).
  const sawHumanTurn = new Set<string>();

  // The /aidlc entry: inject a user message that puts the model in the AI-DLC
  // conductor loop (the orchestrator skill body is .omp/skills/aidlc/SKILL.md).
  pi.registerCommand("aidlc", {
    description: "Start, resume, or manage an AI-DLC workflow",
    handler: async (args: string, _ctx: OmpContext) => {
      const tail = args.trim();
      pi.sendUserMessage(
        `Adopt the AI-DLC orchestrator skill (aidlc) and run its forwarding loop.${
          tail ? ` Arguments: ${tail}` : ""
        }`,
        { deliverAs: "followUp", expandPromptTemplates: true },
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const cwd = ctx.cwd;
    const result = await runCore(
      "aidlc-session-start.ts",
      { hook_event_name: "SessionStart", source: "startup", session_id: ctx.sessionManager?.getSessionId?.() ?? "" },
      cwd,
    );
    try {
      const parsed = JSON.parse(result.stdout) as { additionalContext?: unknown };
      if (typeof parsed.additionalContext === "string") {
        started.add(cwd);
        // omp's session_start has no additionalContext channel; surface it as a
        // developer-visible note the conductor can act on when it runs.
        pi.appendEntry("aidlc-session-start", { additionalContext: parsed.additionalContext });
      }
    } catch {
      /* no active workflow yet */
    }
  });

  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return;
    sawHumanTurn.add(ctx.cwd);
    await runCore(
      "aidlc-record-human-turn.ts",
      { hook_event_name: "UserPromptSubmit", prompt: event.text ?? "", session_id: ctx.sessionManager?.getSessionId?.() ?? "" },
      ctx.cwd,
    );
  });

  pi.on("tool_call", async (event, ctx) => {
    const cwd = ctx.cwd;
    const tool = event.toolName;
    const args = (event.input ?? {}) as Record<string, unknown>;

    if (tool === "task") {
      const dispatch = await runCore(
        "aidlc-deliver-stage-rules.ts",
        { hook_event_name: "PreToolUse", tool_name: "task", tool_input: args, cwd },
        cwd,
      );
      if (dispatch.code === 2) {
        return { block: true, reason: dispatch.stderr.trim() || "required active-stage rules could not be loaded for subagent dispatch" };
      }
      if (dispatch.stdout.trim()) {
        try {
          const parsed = JSON.parse(dispatch.stdout) as { hookSpecificOutput?: { updatedInput?: Record<string, unknown> } };
          if (parsed.hookSpecificOutput?.updatedInput) return { input: parsed.hookSpecificOutput.updatedInput };
        } catch {
          return { block: true, reason: "AIDLC deliver-stage-rules hook returned invalid rewrite output" };
        }
      }
    }

    if (tool === "bash") {
      const command = (args.command as string) ?? "";
      const violation = aidlcBashBoundaryViolation(command);
      if (violation) return { block: true, reason: violation };
      const guard = await runCore(
        "aidlc-state-transition-guard.ts",
        { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd },
        cwd,
      );
      if (guard.code === 2) {
        return { block: true, reason: guard.stderr.trim() || "stage status is changed by the workflow tools, not by hand" };
      }
    }

    // Review-freeze (§12a) — runs for every agent; self-filters to writes.
    if (["bash", "write", "edit", "apply_patch"].includes(tool)) {
      const calls = tool === "bash"
        ? [{ toolName: "Bash", toolInput: { command: (args.command as string) ?? "" } }]
        : reviewerCalls(tool, args);
      for (const call of calls) {
        const freeze = await runCore(
          "aidlc-review-freeze.ts",
          { hook_event_name: "PreToolUse", tool_name: call.toolName, tool_input: call.toolInput, cwd },
          cwd,
        );
        if (freeze.code === 2) {
          return { block: true, reason: freeze.stderr.trim() || "review-freeze: this write would invalidate a fresh READY review receipt" };
        }
      }
    }

    // Plan-approval guard: workspace mutations + developer dispatch.
    if (["bash", "write", "edit", "apply_patch"].includes(tool)) {
      const calls = tool === "bash"
        ? [{ toolName: "Bash", toolInput: { command: (args.command as string) ?? "" } }]
        : reviewerCalls(tool, args);
      for (const call of calls) {
        const guard = await runCore(
          "aidlc-plan-approval-guard.ts",
          { hook_event_name: "PreToolUse", tool_name: call.toolName, tool_input: call.toolInput, session_id: ctx.sessionManager?.getSessionId?.() ?? "", cwd },
          cwd,
        );
        if (guard.code === 2) {
          return { block: true, reason: guard.stderr.trim() || "code-generation requires an approved plan before workspace mutation" };
        }
      }
    }
    if (tool === "task") {
      const target = (args.subagent_type as string) ?? (args.agent as string) ?? "";
      if (target === "aidlc-developer-agent") {
        const guard = await runCore(
          "aidlc-plan-approval-guard.ts",
          {
            hook_event_name: "PreToolUse",
            tool_name: "Task",
            tool_input: {
              subagent_type: target,
              prompt: [(args.prompt as string) ?? "", (args.description as string) ?? ""].filter((t) => t.length > 0).join("\n"),
            },
            session_id: ctx.sessionManager?.getSessionId?.() ?? "",
            cwd,
          },
          cwd,
        );
        if (guard.code === 2) {
          return { block: true, reason: guard.stderr.trim() || "code-generation requires an approved plan before dispatching the developer agent" };
        }
      }
    }

    // Reviewer read-scope: enforce for the whole session (main + delegated alike);
    // the core hook self-filters to the reviewer's read/write/edit/bash calls.
    const calls = reviewerCalls(tool, args);
    if (calls.length === 0) return;
    for (const call of calls) {
      const result = await runCore(
        "aidlc-reviewer-scope.ts",
        { hook_event_name: "PreToolUse", tool_name: call.toolName, tool_input: call.toolInput, cwd },
        cwd,
      );
      if (result.code === 2) {
        return { block: true, reason: result.stderr.trim() || "reviewer read-scope refused this tool call" };
      }
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    const cwd = ctx.cwd;
    const tool = event.toolName;
    const args = (event.input ?? {}) as Record<string, unknown>;
    if (tool === "write" || tool === "edit" || tool === "apply_patch") {
      const filePath = (args.filePath as string) ?? (args.path as string) ?? "";
      if (!filePath) return;
      const absolutePath = isAbsolute(filePath) ? filePath : join(cwd, filePath);
      const payload = { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: absolutePath } };
      await runCore("aidlc-write-audit-log.ts", payload, cwd);
      await runCore("aidlc-run-sensors.ts", payload, cwd);
      return;
    }
    if (tool === "bash") {
      await runCore(
        "aidlc-rebuild-stage-graph.ts",
        {
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: (args.command as string) ?? "" },
          tool_response: (event.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join(""),
        },
        cwd,
      );
      return;
    }
    if (tool === "todowrite") {
      const todos = (args.todos as Array<{ content?: string; status?: string }>) ?? [];
      const active = todos.find((t) => t.status === "in_progress");
      if (!active?.content) return;
      await runCore(
        "aidlc-sync-workflow-state.ts",
        { hook_event_name: "PostToolUse", tool_name: "TaskUpdate", tool_input: { status: "in_progress", activeForm: active.content } },
        cwd,
      );
      return;
    }
    if (tool === "task") {
      await runCore(
        "aidlc-log-subagent.ts",
        {
          hook_event_name: "SubagentStop",
          agent_type: (args.subagent_type as string) ?? (args.agent as string) ?? "unknown",
          agent_id: event.toolCallId ?? "",
        },
        cwd,
      );
    }
  });

  pi.on("session_before_compact", async (_event, ctx) => {
    await runCore("aidlc-validate-state.ts", { hook_event_name: "PreCompact", cwd: ctx.cwd }, ctx.cwd);
  });

  pi.on("session_stop", async (_event, ctx) => {
    if (!sawHumanTurn.has(ctx.cwd)) return;
    const res = await runCore(
      "aidlc-continue-workflow.ts",
      { hook_event_name: "Stop", stop_hook_active: false, session_id: ctx.sessionManager?.getSessionId?.() ?? "" },
      ctx.cwd,
    );
    try {
      const parsed = JSON.parse(res.stdout) as { decision?: string; reason?: string };
      if (parsed.decision === "block" && parsed.reason) {
        return { decision: "block", reason: parsed.reason };
      }
    } catch {
      /* no/unparseable output → allow the stop */
    }
  });
}
