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
the plan: the text before the number, and the number's width. A parent's id
is found by the same arithmetic in every record, so a child can name a parent
without the parent having been generated. Only an id whose schema admits no
numbered form is drawn from the stream, and such ids can repeat.

A record's parent is taken in turn from the records its parent entity starts
with, and a grandparent is that parent's own parent. Each parent therefore
has children, and a record never names a chain that does not exist.

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
