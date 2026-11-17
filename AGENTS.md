# Agent guide

`CLAUDE.md` is a symlink to this file. One guide, so there is nothing to keep
in step: edit this one.

`@voxgig/sdkgen-validpack` is an sdkgen package of validation targets: things
generated from an API's model to test an SDK against. It holds two targets:
`ts-seed`, a library of seeded test data, and `ts-mock`, a mock server that
serves that library's records and so needs `ts-seed` in the same project.

**Nothing here is published.** `package.json` is `private`, there is no
release route, and a project uses the pack by linking a checkout (see
[README.md](README.md)). Do not add a publish script or a workflow that
publishes until the owner asks for a release.


## The environment is not a property of this repository

This repository is worked on from more than one machine, and from ephemeral
containers whose installed software differs. A toolchain, path or version
present in one is routinely absent in the next. So never record an inventory
of what is installed as though the repository owned it, and never conclude
that something cannot be built or run without checking the current
environment first: `command -v <tool>` and `node --version` settle it.

What the repository needs, as distinct from what a machine has: Node, npm and
`make`. The dependencies ask for Node 24. The suite has also been run on Node
22, where npm warns about the engine and everything passes.

```bash
npm install            # writes an ignored lockfile
npm run build          # type-checks and compiles the targets' components
npm test               # builds, then the comment gate, the dependency gate, the suite
npm run check-package  # sdkgen's own check of this package
make check             # all of the above, and the comment gate's own tests
```

`package-lock.json` is gitignored, so a fresh checkout resolves dependencies
anew. `.build/` holds the compiled components and is gitignored too. The
suite reads it, which is why `npm test` builds first.

**No CI runs here yet.** A session cannot push a file under
`.github/workflows/`, so the workflow is in [`patch/`](patch/README.md) for a
maintainer to apply. Until then a change rests on the runs recorded in its
pull request: say exactly what was run.


## Committed dependencies name published packages

A committed dependency names a published npm package or a GitHub reference.
`file:`, `link:`, a bare path, a packed archive and a symlink into
`node_modules` are findings. `tools/dep-gate.cjs` enforces that over every
tracked manifest, and `npm test` runs it. Linking a sibling checkout to test
an unreleased tool is the right way to work, and undoing the link is part of
finishing. An exception goes in `tools/dep-gate.json` with a reason.

The generated libraries have no runtime dependency at all, and suite tests
hold that: nothing under `.sdk/tm/ts-seed/` may import a module, and nothing
under `.sdk/tm/ts-mock/` may import one but `node:http`. The mock reaches the
seed library by a path at run time, never by a dependency.


## How the `ts-seed` target is built

Two layers, split the way sdkgen splits them:

| Layer | Path | Holds |
| --- | --- | --- |
| Templates | `.sdk/tm/ts-seed/` | What is the same for every API: the engine that makes values, the word lists, the public entry, the dump command, the `tsconfig.json` |
| Components | `.sdk/src/cmp/ts-seed/` | What depends on the API: the plan, the `package.json`, the README |

- `Plan_ts-seed.ts` turns the model and the API definition into the **plan**:
  per entity, its fields with their constraints, its id, and its parents. It
  is a pure function, and the unit tests call it on hand-built input.
- `Pattern_ts-seed.ts` compiles the part of a regular expression a generator
  can walk.
- `Main_ts-seed.ts` writes the files. The plan becomes `src/plan.ts`, as data.
- `engine.ts`, a template, reads the plan at run time. It knows no API.

A rule about *what a schema means* belongs in the plan. A rule about *how a
value is made* belongs in the engine. The plan's types are written twice, in
`Plan_ts-seed.ts` and in `engine.ts`, because a component cannot import a
template: `plan.ts` is type-checked against the engine's copy whenever a
generated library compiles, which the suite does for every definition.


## How the `ts-mock` target is built

The same two layers:

| Layer | Path | Holds |
| --- | --- | --- |
| Templates | `.sdk/tm/ts-mock/` | The engine that serves, the public entry that loads the seed library, the command, the `tsconfig.json` |
| Components | `.sdk/src/cmp/ts-mock/` | The routes, the `package.json`, the README |

- `Routes_ts-mock.ts` turns the model and the API definition into the
  **routes**: per point, its method, path and path parameters, its success
  status, where its records sit in the response and what else the response
  holds, and how its request carries the record. Then the address and the
  credential. It is a pure function, and the unit tests call it on
  hand-built input.
- `Main_ts-mock.ts` refuses a project without an active `ts-seed`, then
  writes the files. The routes become `src/routes.ts`, as data.
- `mock.ts`, a template, serves the routes from a store it fills from the
  seed library. It knows no API.

What a path parameter means is not in the routes. A parameter is the
record's id where the model's rename says so, and a parent's id where the
seed library's plan has a parent of that name, read when the mock starts. So
the two targets cannot disagree about which record sits under which.

A component cannot import the other target's component either: `Main_ts-mock`
has to load in a project that lacks `ts-seed`, to say that it does. So the
little schema reading the routes need, for statuses and envelopes, is written
in `Routes_ts-mock.ts` itself.

The suite generates both targets side by side, with `generateTargets` in
`test/support.js`, since the mock loads `../ts-seed/dist` when it starts. A
test that serves starts the mock on port 0 and talks to it with `fetch`.


## Things that have already gone wrong once

- **The test kit has no API definition.** `generateInto` passes no build
  context, so `ctx$.meta.apidef` is absent and the target falls back to the
  model. The suite therefore generates for itself, in `test/support.js`:
  through `SdkGen`, with apidef's build result as `buildctx`, onto disk,
  because the output also has to compile and run.
- **apidef marks a schema that holds itself with a string.** In the resolved
  definition each use of a `$ref` is an object of its own carrying `x-ref`,
  and the inner copy of a recursive one has `"[Circular *<path>]"` where a
  schema should be. `Object.keys` of that string is a list of indices, which
  is how a review once came out with fields named `0`, `1`, `2` and on.
  `whole()` in the plan swaps the marker for the schema `x-ref` names, and a
  walk stops on a name it has already entered.
- **A unique list drawn by chance runs out of tries.** Three distinct picks
  from three values failed within a few hundred records. A short list is
  dealt instead.
- **A large whole number does not survive `round(x * 1e6) / 1e6`.** The
  engine only rounds that way when it is scaling a fraction.
- **A test that adds a field last cannot see a value keyed by position.**
  The stability test adds its field first for that reason.
- **Two samples do not prove a compiled pattern.** `compilePattern` checks
  its shortest and longest walk against the real expression, and an anchor
  in a middle branch passes both. The parser refuses such a pattern by its
  structure, and the suite has cases only that refusal catches.
- **sdkgen's `doctor` calls the target's model file outdated after the test
  kit's add**, and `generate` then warns of older templates. The kit adds
  with a small model of its own, which leaves `$$name$$` in the installed
  file, where the CLI's doctor reads the project's model and expects the
  name. sdkgen-infrapack shows the same under the kit. Added through the
  CLI, the way a project adds it, doctor finds nothing, and a suite test
  holds that. It is not a drift in this pack.
- **`package add` warns that the target has no source for each feature the
  project holds.** It has none: neither target takes a feature.
- **`pageSize` holds the word `pages`.** The envelope filler once read it as
  a page count and gave it 1. A name is matched whole now, and the unit test
  of envelopes names both.
- **Node's server sends a `Date` header.** Two answers to the same request
  then differ by the second. The engine turns it off, and the determinism
  test compares headers as well as bodies.
- **A generated SDK's live suite calls only what it has a recipe for.**
  Without one in the project's guide, its entity flows run, and a create
  whose body has a required field with no example is blocked, which fails a
  strict run. With any recipe, its scenario runner plans every point and
  blocks each one that has none. A run against the mock that gives some
  points no recipe proves less than it looks.


## Changing the target

Change the component or the template, then run `npm test`. After a change to
what the target promises, break the rule on purpose and see a test fail
before trusting the suite: the rules above were each found that way.

A new definition in `test/def/` needs a row in the seed suite's `SCHEMAS`
table and in the mock suite's `PORTS` table, and a test fails until it has
both. `test/check.js` is the judge of validity. It reads the definition as
written and shares no code with either target, and its own test lists values
it has to refuse. Keep it that way: a checker that imports the plan agrees
with the plan.

Generation is overwrite. Never edit a generated library: fix the template or
the component and generate again.


## Source code comments

Follow [COMMENT-POLICY.md](COMMENT-POLICY.md): comments are sparse and terse,
only for intricate or surprising code. Names carry intent; documents carry
requirements. Run `make comments comments-test` after editing source. The
gate covers the templates too.

Durable implementation rationale is in [COMMENT-NOTES.md](COMMENT-NOTES.md).
