# @voxgig/sdkgen-validpack

Validation targets for the [Voxgig SDK Generator](https://github.com/voxgig/sdkgen):
things generated from an API's model to test an SDK against.

| Target | Generates |
| --- | --- |
| `ts-seed` | A TypeScript library of test data for the API. Each record is valid against the API definition, readable by a person, and the same for the same seed. |

The package is not published. A project uses it from a checkout: see
[Adding it to a project](#adding-it-to-a-project).


## The `ts-seed` target

`ts-seed` generates a library into `<project>/ts-seed/`. The library has no
runtime dependency. It answers one question: what does record number *n* of
this entity look like, for this seed?

```ts
import { makeSeed } from 'solardemo-seed'

const seed = makeSeed({ seed: 1 })

seed.records('planet')
// [ { id: 'planet-0001', name: 'Steady Raven', kind: 'standard', diameter: 1709 },
//   { id: 'planet-0002', name: 'Keen Island', kind: 'basic', diameter: 4885.4 }, ... ]

seed.record('moon', 7)
// { id: 'moon-0007', name: 'Tidy Prairie', planet_id: 'planet-0002', kind: 'basic', diameter: 282.9 }
```

### What it promises

- **The same data everywhere.** A value is a pure function of the seed, the
  entity, the record number and the field. It is computed with integer
  arithmetic alone. The library reads no clock, no random source, no locale
  and no time zone.
- **Stable under change.** Adding a field or an entity to the API leaves
  every other value as it was. A value does not depend on where its field
  sits, or on which records were asked for before it.
- **Valid against the definition.** A record meets the schema the API
  definition gives its entity: `type`, `required`, `enum`, `const`,
  `format`, `minimum`, `maximum`, both spellings of the exclusive bounds,
  `multipleOf`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`,
  `uniqueItems`, nested objects and lists, `additionalProperties` as a
  schema, `allOf`, and `$ref`. A `writeOnly` field is left out of a record.
- **Readable.** An id names its entity: `planet-0001`. A field named
  `email`, `title`, `city` or `created_at` holds what its name says. Emails
  are at `example.com`. Dates come from a fixed calendar.
- **Parents that exist.** A record nested under another holds the id of one
  of the records its parent entity starts with.

### What it does not promise

- **`oneOf` and `anyOf` give their first branch** that is not `null`. A
  `oneOf` whose branches overlap can therefore fail a strict check.
- **A pattern is honoured where it can be built from.** That covers literals,
  classes, groups with alternatives, counted repeats, and an anchor at either
  end. Past that, the library tries a few plain values against the pattern.
- **A value that cannot meet its schema is reported, not hidden.**
  `seed.misses()` lists each one. The generated README lists each schema the
  target could not follow in full.
- **A schema that holds itself is cut short.** The inner copy is left out
  where it is optional, and a list of its own kind is left empty.
- **Examples in the definition are not used.** Every record would hold the
  same one.
- **A field that holds another record's id depends on the counts.** It
  points at a record that exists, so it moves when the number of records its
  target starts with changes.
- **An id is valid while its number fits.** Where a pattern fixes the digits,
  as `^BK-[0-9]{6}$` does, record 1,000,000 has no valid id. A number id runs
  out at its bounds the same way. Either is reported in `seed.misses()`.

### Without the definition

The target reads the definition sdkgen hands it during a project's build.
Where a build has none, the library is built from the model's field types
alone. Types are then honoured, and `enum`, range, length and pattern
constraints are not. The generated README, `src/plan.ts` and a build warning
each say so.

### The library

```ts
makeSeed(options?: { seed?: number | string, count?: number, counts?: { [entity: string]: number } }): Seed
```

| Member | Gives |
| --- | --- |
| `seed.entities()` | The entity names, sorted |
| `seed.count(entity)` | How many records the entity starts with |
| `seed.records(entity)` | Those records: numbers 1 to `count` |
| `seed.record(entity, n, over?)` | Record number `n`, with the fields of `over` laid on top. `n` starts at 1 and has no upper limit |
| `seed.id(entity, n)` | The id of record `n`, or `null` where the entity has none |
| `seed.parents(entity, n)` | The ids of the records it sits under, keyed by path parameter: `{ planet_id: 'planet-0002' }` |
| `seed.all()` | Every entity's starting records |
| `seed.misses()` | Each value generated so far that could not meet its schema |
| `seed.plan`, `plan` | What the target read from the API: per entity, its fields and their constraints, its id, its parents |
| `makeSeedFor(plan, options?)` | The same, for a plan given by the caller |

A record after the starting set is `seed.record(entity, seed.count(entity) + 1)`
and so on, which is how a mock server mints one.

`npm run dump -- --seed 7 --entity planet` prints records as JSON. Without
`--entity` it prints every entity's. `--plan` prints the plan.

### Settings

A project sets the defaults in its own model:

```
main: kit: target: 'ts-seed': seed: { value: 'tide', count: 8 }
```

`value` is the seed a caller gets when it names none, as text or a number.
`count` is how many records each entity starts with.


## Adding it to a project

From the project's `.sdk` folder, with this repository checked out beside it:

```sh
mkdir -p node_modules/@voxgig
ln -sfn /path/to/sdkgen-validpack node_modules/@voxgig/sdkgen-validpack
npx voxgig-sdkgen package add @voxgig/sdkgen-validpack
npm run generate
```

`package add` warns that the target has no source for each feature the
project holds. That is expected: the target takes no feature.

Then build the library:

```sh
cd ../ts-seed
npm install
npm run build
```

Needs `@voxgig/sdkgen` 4.44.0 or later.


## Working on this package

```sh
npm install
npm test               # builds, runs the gates, then the suite
npm run check-package  # sdkgen's own check of the package
```

The suite builds each API definition in `test/def/` with apidef, generates
the library through sdkgen, compiles it with `tsc`, and checks each record
against the definition with a checker of its own. [AGENTS.md](AGENTS.md) is
the guide for changing the target.

## License

MIT. See [LICENSE](LICENSE).
