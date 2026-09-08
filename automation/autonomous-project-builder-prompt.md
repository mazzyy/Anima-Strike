# Prompt: build an autonomous project-completion system

Paste everything below the line into an LLM. It is written as a specification,
not a wish — the "Failure modes" section is the important part, because those
are the things that go wrong in practice and that a model will not anticipate
on its own.

---

## What to build

Build **Forge**: a local tool that takes a software project and a roadmap, and
completes the roadmap itself by calling an LLM API — writing code, verifying it
against the project's tests, keeping what passes and reverting what doesn't.

It has a web dashboard showing progress, spend and live activity, and a chat box
for steering it mid-run. The loop can be stopped and resumed at any time, and
resuming picks up exactly where it left off, folding in any new instructions
given since.

Assume the user is a competent engineer who will read the code. Prefer plain,
readable implementation over cleverness. No framework unless it earns its place.

## Core model

Four pieces of state, all on disk in the project, all human-readable:

- **Roadmap** — an ordered list of items: `{id, title, spec, files, status, note,
  blocked_by, attempts, history}`. `status` is one of `pending | in_progress |
  done | blocked | skipped`. `spec` is a full paragraph of intent, not a title —
  it is what the model actually builds from. `files` narrows the context sent.
- **Ledger** — cumulative token and cost accounting, broken down by item, by
  command and by model.
- **Capabilities** — what the tool has learned about the API endpoint: which
  parameters it rejects, what request sizes it accepts. Written automatically.
- **Instruction queue** — messages from the user waiting to be folded into the
  next iteration.

## Components

### 1. Provider client

One class wrapping the LLM API. Streaming not required. It must:

- Read credentials from `.env` or the environment, never from a tracked file.
- Record every call's input, output, cached and reasoning tokens into the ledger.
- Cost calls from a rates table. If no rate is known, count tokens exactly and
  report cost as unknown — **never guess a rate**. When a rate is supplied
  later, re-cost the entire history from the stored token counts.
- Adapt to the endpoint and remember what it learns (see Failure modes).

### 2. Project ingestion

Two entry paths:

- **Existing project** — scan it, detect language, build system, test command
  and entry points; summarise the architecture; propose a roadmap the user edits
  before anything runs.
- **From a roadmap** — the user supplies items directly.

Build a context assembler that turns the project into a prompt block: file tree,
key config, then whole file contents. It must respect a per-item `files` list and
report the token estimate before sending.

### 3. The build loop

Per item:

```
mark in_progress
  -> drain the instruction queue into the prompt
  -> ask the model for COMPLETE files in a parseable format
  -> apply, recording a manifest of what was modified and what was created
  -> run the project's tests
       pass -> keep, mark done, record what changed
       fail -> feed the failure output back for a repair pass, re-test
               still failing -> revert via the manifest, mark blocked
```

**The test gate is not optional.** Without it the loop quietly degrades the
codebase over hours. If the project has no tests, the tool's first act is to
propose writing some, and it refuses to run unattended until they exist.

Reverting is manifest-based, not git-based: record the exact files modified
(with backups) and created, so an undo is precise even in a dirty tree.

### 4. Dashboard

A local web UI on a port, served by the same process. No build step; plain
HTML/CSS/JS is fine. It shows:

- Roadmap items with status, and for each: what changed, why it blocked, attempts
- Overall progress, and a live log of the current run streaming as it happens
- Tokens and cost: total, per item, and a running rate; cached vs fresh input
- **Controls**: start, pause, stop, retry an item, skip an item, reorder
- **A chat box** — messages go into the instruction queue and are folded into the
  next iteration; they are never silently dropped. Show which iteration consumed
  each instruction.
- A diff view of what the last item changed, with a one-click revert

State the dashboard reads must be the same files the loop writes, so the two can
never disagree.

### 5. Resume

Stopping mid-run must leave consistent state. On restart:

- Continue at the first `pending` item
- Items blocked by an **API or transport** failure are retried automatically —
  whatever broke may since have been fixed
- Items blocked by **failing tests** are skipped unless explicitly requested,
  since retrying those blind repeats the failure
- Print what is being resumed into before starting: `4 done · 2 pending · 1
  retrying after a connection failure`
- An item that was `in_progress` when the process died must be reverted from its
  manifest before being retried, never left half-applied

## Failure modes — handle all of these

These are not hypothetical. Each one costs an afternoon if the tool cannot
handle it itself.

1. **A rejected parameter arrives in two disguises.** On a small request body the
   API returns a clean HTTP 400 naming the parameter. On a large body the server
   rejects it *while the client is still uploading* and closes the socket, so the
   identical error surfaces as a dropped connection with no response to read.
   Handle both. On an unexplained drop with a large body, re-send a **tiny canary
   request with the same parameters** to make the server state its objection
   cheaply, then apply what you learn and retry the real request.

2. **Remember what the endpoint rejects.** Persist it. Rediscovering the same
   rejection every run is the difference between a tool and a demo.

3. **Reasoning models spend the output budget on hidden reasoning.** A request
   can return 500 output tokens of which 400 are reasoning, leaving nothing.
   Never squeeze `max_output_tokens` to a small number to make a request fit —
   you get replies that are all thought and no content. If a reply comes back
   truncated before producing content, **double the budget and retry**.

4. **Some deployments bound input + output together.** A prompt that works with a
   small output allowance fails with a large one. Size the output allowance
   against what the prompt leaves of a learned combined budget.

5. **Measure limits; do not infer them from failure logs.** Provide a
   `calibrate` command that runs a real experiment — several prompt sizes ×
   descending output allowances — determines whether the constraint is on output
   alone or on the combination, and records it. Rejected requests are not billed,
   so this is nearly free. Skip it when already measured.

6. **An empty reply means the model wants MORE context, not less.** A model given
   too few files will correctly refuse to rewrite code it cannot see, and will
   say which files it needs. Parse that, resolve the paths against the real tree
   (it will guess shallower paths than reality — fall back to basename matching),
   and resend with those files **plus** the full default set. Never respond to an
   empty reply by narrowing further.

7. **Never let test or mock calls enter the real ledger.** Offline/mock mode must
   report its token counts but not persist them. A cost record that includes
   simulated spend is worse than no record.

8. **Cost shape drives design.** Output tokens typically cost several times input,
   and cached input an order of magnitude less than fresh. So: prefer sending more
   context to get one good answer over several narrow retries, and keep the file
   set stable between runs so caching actually engages.

9. **Distinguish "no tokens spent" from "free".** Dropped requests cost wall-clock
   time, not money. Say which, so the user knows whether to be patient or worried.

10. **Guard against a runaway loop.** A hard spend ceiling and a max-iterations
    limit, both configurable, both enforced before the call, not after.

## Technical constraints

- Standard library only where practical; every dependency must be justified.
- All state in plain JSON in the project directory. No database unless the user
  asks for one.
- Never write credentials to any file the project tracks. Add them to
  `.gitignore` on first run.
- The generated-code applier must reject absolute paths and anything containing
  `..` — a model naming `/etc/passwd` should be refused, not written.
- Everything the loop does must be inspectable afterwards: keep each proposal,
  its raw reply, and its manifest.

## Deliverables

1. Working code, organised so each component above is a separate readable module.
2. A README covering setup, the first run, the dashboard, and cost control.
3. Tests for the tool's own logic — manifest revert, resume-after-kill, ledger
   arithmetic, the adaptive client paths (simulate a rejecting endpoint).
4. A worked example: point it at a small real project and complete one item.

## Build order

Build and verify in this sequence; do not move on until each works:

1. Provider client + ledger + `calibrate`
2. Context assembly + a single one-shot "propose a change" command
3. Apply/revert with manifests, then the test gate
4. The loop over a roadmap, with resume
5. The dashboard, read-only at first
6. Controls and the chat/instruction queue

Ship each stage working rather than all of it half-built.

---

## Notes for whoever uses this prompt

Adapt the parts in brackets: your API provider, your language, your test command.
The failure-mode section is provider-agnostic in spirit but was learned against
Azure AI Foundry with a reasoning model — the specific symptoms (dropped
connections standing in for HTTP 400s, hidden reasoning tokens) are common to
that class of endpoint.

If you only keep one thing from this document, keep the test gate and the
manifest revert. An autonomous loop that cannot undo its own work is not
automation, it is a slow-motion accident.
