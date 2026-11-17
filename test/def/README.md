# API definitions the suite generates from

| File | From | Why it is here |
| --- | --- | --- |
| `solardemo-1.0.0-openapi-3.0.0.yaml` | voxgig/station, `test/api/solardemo/`, as of commit `4cd169b` | A nested entity whose record names its parent |
| `taskpad-1.0.0-openapi-3.0.0.yaml` | voxgig/station, `test/api/taskpad/`, as of commit `4cd169b` | One flat entity with optional fields |
| `taxonomy-1.0.0-openapi-3.1.0.yaml` | voxgig/apidef-validate, commit `805193d`, by way of voxgig/sdkgen-infrapack's `test/def/` | OpenAPI 3.1, three levels of nesting, a paged list, a shared id pattern |
| `bookshop-1.0.0-openapi-3.0.0.yaml` | Written for this suite | Every constraint the `ts-seed` target says it honours |

The first three are copies. Change them where they come from, then copy
again. `bookshop` is edited here.

The suite picks up every `.yaml` file in this folder. The seed suite's
`SCHEMAS` table names, by hand, the schema each entity's records follow, and
the mock suite's `PORTS` table the port its first server names. A test fails
when a definition here has no row in either.
