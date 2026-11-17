# @voxgig/sdkgen-validpack

Validation targets for the [Voxgig SDK Generator](https://github.com/voxgig/sdkgen):
things generated from an API's model to test an SDK against.

| Target | Generates |
| --- | --- |
| `ts-seed` | A TypeScript library of test data for the API. Each record is valid against the API definition, readable by a person, and the same for the same seed. |
| `ts-mock` | A local HTTP mock of the API, in TypeScript on `node:http`. It serves the `ts-seed` library's records on the definition's routes, so a project that adds it needs `ts-seed` too. |

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
  of the records its parent entity starts with. Where that entity starts with
  none, the record holds the id its first record would have, and
  `seed.misses()` reports it.

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
  target starts with changes. A target that starts with none is reported.
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


## The `ts-mock` target

`ts-mock` generates a mock server into `<project>/ts-mock/`. It answers every
route the model gives an entity operation, from a store that starts as the
`ts-seed` library's records. It is written in TypeScript on `node:http` and
has no runtime dependency.

It needs the `ts-seed` target in the same project. Generation fails, and says
so, when `ts-seed` is missing or inactive. The mock loads the seed library
when it starts, from the built output of the folder beside its own:
`../ts-seed/dist/index.js`, relative to the mock's `dist/`. So build the seed
library first, and keep the two folders side by side.

```sh
(cd ../ts-seed && npm install && npm run build)
cd ../ts-mock
npm install
npm run build
npm start              # node dist/server.js
```

```ts
import { makeMock } from 'solardemo-mock'

const mock = makeMock({ seed: 1 })
const server = await mock.listen(0)
// server.url: http://127.0.0.1:<port>, the base to give the SDK

await fetch(server.url + '/api/planet/planet-0002/moon')
// 200 [ { id: 'moon-0002', name: 'Keen River', planet_id: 'planet-0002', ... } ]

await server.close()
```

### What it serves

Every point of every `list`, `load`, `create`, `update`, `patch` and `remove`
operation of an active entity, at the path the definition gives it, with the
path parameters the definition names.

- **`list`** answers the records under the parent its path names. A query
  parameter that names a field keeps the records whose field has that value,
  and any other query parameter is ignored.
- **`load`** answers the record its path names.
- **`create`** takes the body as the record. The record's id is the seed
  library's id for the next record number whose id no record holds, and each
  required field the body leaves out comes from the seed library's record of
  that number. A record
  created on a parent's path sits under that parent, and a field of the record
  that names its parent holds that parent's id. A create whose path names the
  new record's id takes that id, or answers 409 where a record holds it.
- **`update`** and **`patch`** merge the body into the record. The record
  keeps its id, and the parent its path names.
- **`remove`** deletes the record and answers it.
- **A route that names a record or a parent the store does not hold** answers
  a JSON 404: `{ "code": "not_found", "message": "..." }`.
- **An action**, a route the model marks with `$action`, answers the record
  it names, unchanged: the definition does not say what an action does.
- **A field the definition marks read-only**, at any depth, is the mock's to
  set, so a body cannot change it, and a write-only field is never sent back.

A path parameter is matched as it is sent and decoded after, so an id may
hold a `/` sent as `%2F`. The path's literal text matches sent plain or
percent-encoded, beside a parameter as well as alone. One that is neither the record's id nor a parent's
id, such as a `{year}`, is accepted and ignored. A body that is not JSON, or holds no
record, is a 400. A method that no route on the path takes is a 405, and a
body over a mebibyte is a 413.

### Status codes and envelopes

The success status is the lowest the definition declares for the operation,
save that a create takes 201 where the definition declares it. A status of
204 sends no body, so a remove the definition answers with 204 answers with
nothing. Without the definition, every success is 200.

The model notes where the SDK reads a response's records. A note of `body`
means the records are the whole body. A deeper one, such as `body.items`,
means the SDK unwraps that path, so the mock wraps the records there. It also
fills what else the response holds: the total the model names, and each
further property the definition makes required. A `page` is 1, and a
`pageSize` or a `count` is the number of records answered.

### The credential

Where the API declares security, a request needs a credential where the SDK
sends one: in the header, query parameter or cookie the model names, and in a
header after the prefix the model gives, as in `Bearer <token>`. Without one,
or with an empty one, the mock answers a JSON 401. Any token is accepted unless
the mock was given one, with `makeMock({ token })` or `--token`. An operation
whose definition sets its own security to none, as `security: []` does, needs
no credential.

### The address

The mock listens on `127.0.0.1` and the port of the definition's first server
URL, and takes that URL's path as a prefix to every route. So where the server
is a local `http` address, as `http://localhost:8901` is, the SDK's default
base reaches the mock unchanged. A server URL that names no port leaves the
port at 8080.

| Option | Environment | Sets |
| --- | --- | --- |
| `--port <n>` | `PORT` | The port: `0` takes any free one |
| `--host <host>` | `HOST` | The host, `127.0.0.1` by default |
| `--seed <seed>` | | The seed the records are made from |
| `--count <n>` | | How many records each entity starts with |
| `--token <token>` | | The one credential the mock accepts |

A flag wins over the environment.

### Control routes

| Route | Does |
| --- | --- |
| `GET /__health` | Answers `{ ok, api, seed, entities }`, where `entities` counts each store's records |
| `POST /__reset` | Restores the seeded store. The body may set `seed`, `count` and `counts`, for this reset alone |
| `GET /__requests` | The requests answered since the last reset, in order, up to the latest 10,000: `seq`, `method`, `path`, `query`, `status`, `entity` and `op` |

A recorded request holds no header and no body, and a credential sent in the
query is recorded as `[redacted]`. A control route needs no credential, and
is reachable at the root and under the prefix.

### The library

```ts
makeMock(options?: { seed?: number | string, count?: number, counts?: { [entity: string]: number }, token?: string }): Mock
```

| Member | Gives |
| --- | --- |
| `mock.listen(port?, host?)` | Starts a server. Resolves to `{ url, host, port, close() }`, where `url` holds the prefix |
| `mock.handler(req, res)` | The request handler alone, for a `node:http` server of the caller's |
| `mock.reset(options?)` | Restores the seeded store, as `POST /__reset` does |
| `mock.requests()` | The recorded requests, as `GET /__requests` answers them |
| `mock.records(entity)` | The records the entity's store holds now |
| `mock.routes`, `routes` | What the target read from the API: per route, its method, path, parameters, status, envelope and request shape |
| `makeMockFor(routes, library, options?)` | The same, for routes and a seed library given by the caller |
| `seedLibrary()` | The seed library beside the mock, as `makeMock` loads it |

The same seed and the same requests give the same answers, byte for byte. The
mock reads no clock and no random source, and sends no `Date` header.

### Checking an SDK against it

A generated TypeScript SDK runs its live tests against the mock. Start the
mock on its default address, then run the SDK's tests with
`<PROJECT>_TEST_LIVE=TRUE`, and with `<PROJECT>_APIKEY` set to any value
where the API declares security. Where the project's guide gives an operation
a live recipe (`op: <name>: live: input: { ... }`), the SDK's live scenario
runner covers every operation, and calls none that has no recipe. Without a
recipe, its entity flows run, and a create whose body has a required field
with no example is blocked, which fails a strict run.

### What it does not do

- **No paging.** A list answers every record that matches.
- **No checking of a request.** The mock stores the body it is given, and
  keeps a field the definition does not declare.
- **No HTTPS.** A definition whose server is an `https` URL needs the SDK
  pointed at the mock with its `base` option.
- **One seed library, beside it.** A project that writes either target
  elsewhere has to keep the two folders side by side.


## Adding it to a project

From the project's `.sdk` folder, with this repository checked out beside it:

```sh
mkdir -p node_modules/@voxgig
ln -sfn /path/to/sdkgen-validpack node_modules/@voxgig/sdkgen-validpack
npx voxgig-sdkgen package add @voxgig/sdkgen-validpack
npm run generate
```

`package add` adds both targets. It warns that each has no source for each
feature the project holds. That is expected: neither target takes a feature.

Then build the seed library, then the mock, which loads it:

```sh
cd ../ts-seed
npm install
npm run build
cd ../ts-mock
npm install
npm run build
```

A project can take the seed library alone, with
`npx voxgig-sdkgen target add @voxgig/sdkgen-validpack/ts-seed`.

Needs `@voxgig/sdkgen` 4.44.0 or later.


## Working on this package

```sh
npm install
npm test               # builds, runs the gates, then the suite
npm run check-package  # sdkgen's own check of the package
```

The suite builds each API definition in `test/def/` with apidef, generates
both targets through sdkgen, and compiles them with `tsc`. It checks each
record against the definition with a checker of its own, then starts each mock
and holds every answer to the definition with the same checker.
[AGENTS.md](AGENTS.md) is the guide for changing a target.

## License

MIT. See [LICENSE](LICENSE).
