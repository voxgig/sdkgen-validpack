# Implementation rationale

## Seeded test data

A value is derived from a key, never from a position in a sequence. The key
is the seed, the entity, the record number and the field's path. Each key
starts a short stream of its own, so asking for one record, or for records in
another order, or for an API with one field more, draws the same numbers for
every value that was there before. A shared stream would make each value
depend on everything generated ahead of it.

The stream is integer arithmetic alone, and so is the calendar. A fraction is
an integer divided once by a power of ten. Nothing depends on a clock, a
random source, a locale, a time zone or a floating-point library function,
which is what lets the same seed give the same bytes on another machine.

The plan is data and the engine is code. The component reads the API once, at
generation, and writes what it found as a plan. The engine, which is the same
for every API, reads the plan at run time. So what a schema means is decided
in one place and how a value is made in another, and a consumer such as a
mock server can read the plan for itself.

The plan's types are written in the component and again in the engine, since
a component cannot import a template. A generated library compiles its plan
against the engine's types, so a disagreement is a compile error in every
generated library, and the suite compiles one for each definition it holds.

An id is numbered, and where the schema allows it carries the entity's name.
The component finds a form the id's schema admits and writes that form into
the plan: the text before the number, and the number's width. A number id is
a first id and a step, the least whole multiple of `multipleOf`. Ids count up
from the first positive multiple the bounds admit, or down from the last
where they admit none. An id past the bounds is still returned, and recorded
as a miss. A parent's id
is found by the same arithmetic in every record, so a child can name a parent
without the parent having been generated. Only an id whose schema admits no
numbered form is drawn from the stream, and such ids can repeat.

A record's parent is taken in turn from the records its parent entity starts
with, and a grandparent is that parent's own parent. Each parent therefore
has children, and a record never names a chain that does not exist. The one
exception is a parent entity that starts with no records: the child names
the id its first record would have, and the miss is recorded.

A pattern is compiled, at generation, into a small tree the engine can walk.
The compiler accepts only what it can generate from, and it is held to the
real expression twice over: a compiled pattern is refused unless its shortest
and longest walks match, and the engine tests each generated value against
the expression itself before returning it. A value that fails is tried again
from another stream, and a field that never passes is reported as a miss.

A value that cannot meet its schema is still returned, and recorded. Throwing
would make one unsatisfiable field cost a caller the whole record, and
returning it silently would make the library's central claim false.

apidef's resolved definition is a graph, with a marker string where a schema
holds itself. The plan is a tree, so the walk stops where it meets a schema
it is already inside, by the name the reference carries.

The definition reaches the component only in a project's own build. The
suite generates through sdkgen's entry with apidef's build result as the
build context, because sdkgen's test kit passes none, and writes to disk,
because the library has to compile and run.

Sources: [plan](.sdk/src/cmp/ts-seed/Plan_ts-seed.ts),
[pattern compiler](.sdk/src/cmp/ts-seed/Pattern_ts-seed.ts),
[file writer](.sdk/src/cmp/ts-seed/Main_ts-seed.ts),
[engine](.sdk/tm/ts-seed/src/engine.ts),
[suite support](test/support.js), [checker](test/check.js).


## The mock server

The routes are data and the engine is code, as in the seed library. The
component reads the model and the definition once, at generation, and writes
each route's method, path, parameters, status, envelope and request shape.
The engine, which is the same for every API, reads them when it starts.

What a path parameter means is decided at run time, from the seed library's
plan: the record's own id where the model renames the parameter to the id,
and a parent's id where the plan has a parent of that parameter's name. The
plan is what made each record's parents, so the store and the routes cannot
disagree about which record sits under which.

The seed library is loaded by a path, when the mock starts, not imported.
The mock compiles without it, its `package.json` names no dependency, and a
mock built before its seed library says what is missing rather than failing
to compile. The types it needs from the seed library, and from Node, are
declared in the templates, so that the mock compiles with `tsc` alone.

A create gives the record the seed library's id for the next record number,
and takes each required field the body leaves out from the seed library's
record of that number. A number whose id a record already holds, as one
created by a chosen id can, is passed over. So the same seed and the same requests make the same
records, and a created record reads like a seeded one. The server sends no
`Date` header, so the same requests get the same bytes back.

A route that names a parent the store does not hold is a 404, a list
included, so that an SDK that sends the wrong parent finds out. A reset
builds the new store before it replaces the old one, so a reset the seed
library refuses changes nothing.

The route is found before the credential is checked: a path no route serves
is a 404 with or without a credential, and a control route needs none.

Sources: [routes](.sdk/src/cmp/ts-mock/Routes_ts-mock.ts),
[file writer](.sdk/src/cmp/ts-mock/Main_ts-mock.ts),
[engine](.sdk/tm/ts-mock/src/mock.ts),
[entry](.sdk/tm/ts-mock/src/index.ts), [command](.sdk/tm/ts-mock/src/server.ts),
[suite](test/mock.test.js).
