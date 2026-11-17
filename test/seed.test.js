// The ts-seed target's own suite.
//
// Three layers, from the inside out:
//
//   - UNIT tests drive the built components directly: the pattern compiler,
//     and the plan on hand-built models the definitions in test/def do not
//     reach.
//   - GENERATION tests build each definition's model with apidef in a staged
//     consumer, generate the library through SdkGen with the resolved
//     definition, and compile it with tsc.
//   - LIBRARY tests run the compiled library, and hold every record to the
//     definition with test/check.js, which shares no code with it.

const { test, describe, before, after } = require('node:test')
const { ok, strictEqual, deepStrictEqual, notDeepStrictEqual, throws } = require('node:assert')

const Fs = require('node:fs')
const Os = require('node:os')
const Path = require('node:path')
const { spawnSync } = require('node:child_process')

const YAML = require('yaml')
const { operationFacts } = require('@voxgig/apidef')
const { stageConsumer, generateInto } = require('@voxgig/sdkgen/testkit')

const {
  PKG, TARGET, defs, buildApi, apiModel, compileConsumer, generate, compileLibrary,
} = require('./support')
const { check } = require('./check')


const CMP = Path.join(PKG, '.build', 'cmp', TARGET)
const { compilePattern } = require(Path.join(CMP, 'Pattern_' + TARGET + '.js'))
const { seedPlan } = require(Path.join(CMP, 'Plan_' + TARGET + '.js'))

const POISON = Path.join(__dirname, 'poison.js')

// Which schema of its definition each entity's records follow. Stated here,
// by hand, so that the target's own reading of the definition is checked too.
const SCHEMAS = {
  bookshop: { author: 'Author', book: 'Book', review: 'Review', shelf: 'Shelf' },
  solardemo: { moon: 'Moon', planet: 'Planet' },
  taskpad: { todo: 'Todo' },
  taxonomy: { domain: 'Taxon', kingdom: 'Taxon', observation: 'Observation', phylum: 'Taxon' },
}

const SEEDS = ['1', '2', 'harbor']
const NUMBERS = 40


// --- unit: patterns ---------------------------------------------------------

// A value for each node, drawn from a counter so that a test covers many.
function spell(nodes, turn) {
  let out = ''
  for (const node of nodes) {
    if (node.c) {
      const sizes = []
      for (let i = 0; i < node.c.length; i += 2) sizes.push(node.c[i + 1] - node.c[i] + 1)
      let r = turn % sizes.reduce((a, b) => a + b, 0)
      const at = sizes.findIndex((size) => r < size || (r -= size, false))
      out += String.fromCharCode(node.c[at * 2] + r)
    }
    else if (node.g) {
      out += spell(node.g[turn % node.g.length], turn + 1)
    }
    else {
      const count = node.max < 0 ? node.min + (turn % 3) : node.min + (turn % (node.max - node.min + 1))
      for (let n = 0; n < count; n++) out += spell([node.q], turn + n)
    }
  }
  return out
}


describe('ts-seed: patterns', () => {

  const BUILT = [
    '^[A-Z]{2}$', '^BK-[0-9]{6}$', '^97[89]-[0-9]{10}$', '^[A-Za-z0-9_.-]+$',
    '^[A-Z][0-9]{1,2}$', '^\\d{3}-\\d{4}$', '^(cat|dog|bird)s?$', '^[^0-9 ]{3,5}$',
    '^\\w+@\\w+\\.(com|org)$', '^#[0-9a-fA-F]{6}$', '[a-z]{4}', '^a.c$',
    '^(?:ab){2,3}$', '^(?<year>[0-9]{4})-W[0-5][0-9]$', '^\\+?[1-9][0-9]{7,14}$',
    '^[\\u0041-\\u005a]\\x2d\\S\\D\\W$', '^x*y+z?$', '^one|^two$',
  ]

  test('a pattern within the subset is built into values that match it', () => {
    for (const source of BUILT) {
      const nodes = compilePattern(source)
      ok(null != nodes, 'not built: ' + source)
      const re = new RegExp(source)
      for (let turn = 0; turn < 200; turn++) {
        const text = spell(nodes, turn)
        ok(re.test(text), JSON.stringify(text) + ' does not match ' + source)
      }
    }
  })


  test('a pattern outside the subset is refused, never built wrongly', () => {
    const refused = [
      '^(?=.*[0-9])[a-z0-9]{6,}$', '^(a)\\1$', '\\bword\\b', '^a$b', 'a^b', '^(a|b$)c',
      // The first and the last branch of each match, so only the reading of it refuses these.
      '^(a|b$|d)c', '^c(a|^b|d)$', '^x(a|b$|d)*$',
      '^\\p{L}+$', '^[a-z', '^(?!x)[a-z]+$', '^a{2,1}$', '^a**$', '^[]$', '(',
    ]
    for (const source of refused) strictEqual(compilePattern(source), null, source)
  })


  test('a broad class is narrowed to letters and digits, and a narrow one is kept', () => {
    deepStrictEqual(compilePattern('^[A-Za-z0-9_.-]$'), [{ c: [0x30, 0x39, 0x61, 0x7a] }])
    deepStrictEqual(compilePattern('^[A-Z_]$'), [{ c: [0x41, 0x5a] }])
    deepStrictEqual(compilePattern('^[_.-]$'), [{ c: [0x2d, 0x2e, 0x5f, 0x5f] }])
  })
})


// --- unit: the plan ---------------------------------------------------------

const S = '`$STRING`'
const field = (n, t = S, r = true, extra = {}) => ({ n, h: n, t, r, ...extra })
const point = (m, o, res = '`body`', extra = {}) => ({ m, o, k: 'http', t: { req: '`reqdata`', res }, ...extra })
const JSON_OF = (schema) => ({ content: { 'application/json': { schema } } })

function model(entity) {
  return { name: 'demo', const: { name: 'demo', Name: 'Demo' }, main: { kit: { info: { title: 'Demo API' }, entity } } }
}

function resolvedOf(def) {
  return { version: 1, kind: 'openapi3', def, operation: (m, o) => operationFacts(def, { m, o }) }
}

// One entity `thing` whose load returns `schema`.
function thingPlan(schema, extra = {}) {
  const def = {
    paths: { '/thing/{id}': { get: { responses: { 200: JSON_OF(schema) } } } },
    ...extra,
  }
  const plan = seedPlan(model({
    thing: {
      name: 'thing', id: { field: 'id', name: 'id' },
      fields: { id: field('id'), name: field('name') },
      op: { load: { name: 'load', points: [point('GET', '/thing/{id}')] } },
    },
  }), resolvedOf(def))
  return plan
}

const specOf = (plan, name) => plan.entity.thing.fields.find((f) => f.n === name)?.s


describe('ts-seed: the plan', () => {

  test('each constraint a schema states reaches the plan', () => {
    const plan = thingPlan({
      type: 'object',
      required: ['id', 'size'],
      properties: {
        id: { type: 'string' },
        size: { type: 'integer', minimum: 2, maximum: 9, multipleOf: 3 },
        ratio: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
        old: { type: 'number', minimum: 0, exclusiveMinimum: true, maximum: 1, exclusiveMaximum: true },
        code: { type: 'string', minLength: 2, maxLength: 8, pattern: '^[a-z]+$', format: 'custom' },
        kind: { type: 'string', enum: ['a', 'b', null] },
        fixed: { const: 7 },
        list: { type: 'array', items: { type: 'boolean' }, minItems: 1, maxItems: 2, uniqueItems: true },
        open: { type: 'object', additionalProperties: { type: 'integer' }, minProperties: 1, maxProperties: 3 },
        free: { type: 'object', additionalProperties: true },
        maybe: { type: ['string', 'null'], maxLength: 4 },
        hidden: { type: 'string', writeOnly: true },
        seen: { type: 'string', readOnly: true },
        anything: {},
      },
    })

    deepStrictEqual(plan.notes, [])
    strictEqual(plan.source, 'definition')
    deepStrictEqual(specOf(plan, 'size'), { t: 'integer', min: 2, max: 9, step: 3 })
    deepStrictEqual(specOf(plan, 'ratio'), { t: 'number', min: 0, xmin: true, max: 1, xmax: true })
    deepStrictEqual(specOf(plan, 'old'), { t: 'number', min: 0, max: 1, xmin: true, xmax: true })
    deepStrictEqual(specOf(plan, 'code'), {
      t: 'string', fo: 'custom', min: 2, max: 8, re: '^[a-z]+$',
      pat: [{ q: { c: [0x61, 0x7a] }, min: 1, max: -1 }],
    })
    deepStrictEqual(specOf(plan, 'kind'), { t: 'enum', values: ['a', 'b'] })
    deepStrictEqual(specOf(plan, 'fixed'), { t: 'const', value: 7 })
    deepStrictEqual(specOf(plan, 'list'), { t: 'array', items: { t: 'boolean' }, min: 1, max: 2, unique: true })
    deepStrictEqual(specOf(plan, 'open'), { t: 'map', values: { t: 'integer' }, min: 1, max: 3 })
    deepStrictEqual(specOf(plan, 'free'), { t: 'object', fields: [] })
    deepStrictEqual(specOf(plan, 'maybe'), { t: 'string', max: 4 })
    deepStrictEqual(specOf(plan, 'anything'), { t: 'any' })

    const flags = Object.fromEntries(plan.entity.thing.fields.map((f) => [f.n, [f.r, f.ro, f.wo]]))
    deepStrictEqual(flags.size, [true, undefined, undefined])
    deepStrictEqual(flags.ratio, [false, undefined, undefined])
    deepStrictEqual(flags.hidden, [false, undefined, true])
    deepStrictEqual(flags.seen, [false, true, undefined])
  })


  test('an allOf is merged, and a union gives its first branch that is not null', () => {
    const plan = thingPlan({
      allOf: [
        { type: 'object', required: ['id'], properties: { id: { type: 'string' }, n: { type: 'integer', minimum: 1, maximum: 50 } } },
        { type: 'object', required: ['n'], properties: { n: { type: 'integer', minimum: 5 }, extra: { type: 'boolean' } } },
      ],
      properties: {
        either: { oneOf: [{ type: 'null' }, { type: 'integer', minimum: 3 }, { type: 'string' }] },
        tight: { allOf: [{ type: 'integer', minimum: 1, maximum: 9 }, { minimum: 4, maximum: 20 }] },
      },
    })

    deepStrictEqual(plan.entity.thing.fields.map((f) => [f.n, f.r]),
      [['id', true], ['n', true], ['extra', false], ['either', false], ['tight', false]])
    deepStrictEqual(specOf(plan, 'n'), { t: 'integer', min: 5 })
    deepStrictEqual(specOf(plan, 'either'), { t: 'integer', min: 3 })
    deepStrictEqual(specOf(plan, 'tight'), { t: 'integer', min: 4, max: 9 })
    deepStrictEqual(plan.notes, [{ entity: 'thing', field: 'either', note: 'the first of 2 alternatives is used' }])
  })


  test('a union branch chosen by a discriminator carries its tag', () => {
    const cat = { type: 'object', properties: { species: { type: 'string' }, purrs: { type: 'boolean' } }, 'x-ref': '#/components/schemas/Cat' }
    const dog = { type: 'object', properties: { species: { type: 'string' }, barks: { type: 'boolean' } }, 'x-ref': '#/components/schemas/Dog' }
    const plan = thingPlan({
      type: 'object',
      properties: {
        id: { type: 'string' },
        pet: { oneOf: [cat, dog], discriminator: { propertyName: 'species', mapping: { feline: '#/components/schemas/Cat' } } },
        other: { anyOf: [dog, cat], discriminator: { propertyName: 'species' } },
      },
    })

    deepStrictEqual(specOf(plan, 'pet').fields.map((f) => [f.n, f.s]),
      [['species', { t: 'const', value: 'feline' }], ['purrs', { t: 'boolean' }]])
    deepStrictEqual(specOf(plan, 'other').fields[0], { n: 'species', r: false, s: { t: 'const', value: 'Dog' } })
  })


  test('a schema that holds itself ends: the inner copy is left out, or its list empty', () => {
    const node = {
      type: 'object', required: ['id'], 'x-ref': '#/components/schemas/Node',
      properties: { id: { type: 'string' }, label: { type: 'string' } },
    }
    // As apidef leaves a cycle: each use an object of its own, the inner one cut.
    const use = () => ({ ...node })
    node.properties.next = { ...node, properties: '[Circular *components.schemas.Node.properties]' }
    node.properties.kids = { type: 'array', minItems: 1, items: { ...node, properties: '[Circular *x]' } }
    node.properties.cut = '[Circular *y]'

    const plan = thingPlan(use(), { components: { schemas: { Node: node } } })

    const next = specOf(plan, 'next')
    deepStrictEqual(next.fields.map((f) => f.n), ['id', 'label', 'kids'])
    deepStrictEqual(next.fields[2].s, { t: 'array', items: { t: 'any' }, min: 0, max: 0 })
    deepStrictEqual(specOf(plan, 'kids').items.fields.map((f) => f.n), ['id', 'label', 'kids'])
    strictEqual(specOf(plan, 'cut'), undefined)
    ok(plan.notes.some((n) => 'a list of its own kind is left empty' === n.note))
  })


  test('the records are found where the model says a response holds them', () => {
    const item = { type: 'object', properties: { id: { type: 'string' }, colour: { type: 'string', enum: ['red'] } }, 'x-ref': '#/components/schemas/Thing' }
    const def = {
      paths: {
        '/thing': {
          get: { responses: { 200: JSON_OF({ type: 'object', properties: { data: { type: 'object', properties: { items: { type: 'array', items: item } } } } }) } },
          post: { requestBody: JSON_OF(item), responses: { 204: { description: 'none' } } },
        },
        '/swag': { get: { responses: { 200: { schema: { type: 'array', items: item } } } } },
      },
    }
    const ent = (op) => ({ name: 'thing', id: { field: 'id', name: 'id' }, fields: { id: field('id') }, op })

    const listed = seedPlan(model({ thing: ent({ list: { points: [point('GET', '/thing', '`body.data.items`')] } }) }), resolvedOf(def))
    strictEqual(listed.entity.thing.schema, '#/components/schemas/Thing')
    deepStrictEqual(listed.entity.thing.fields.map((f) => f.n), ['id', 'colour'])

    const sent = seedPlan(model({ thing: ent({ create: { points: [point('POST', '/thing')] } }) }), resolvedOf(def))
    strictEqual(sent.entity.thing.source, 'definition')

    const swagger = seedPlan(model({ thing: ent({ list: { points: [point('GET', '/swag')] } }) }), resolvedOf(def))
    deepStrictEqual(swagger.entity.thing.fields.map((f) => f.n), ['id', 'colour'])

    const lost = seedPlan(model({ thing: ent({ list: { points: [point('GET', '/thing', '`body.nowhere`')] } }) }), resolvedOf(def))
    strictEqual(lost.entity.thing.source, 'model')
    strictEqual(lost.source, 'model')
    deepStrictEqual(lost.notes, [{ entity: 'thing', note: 'no record schema in the definition: built from the model alone' }])

    const action = seedPlan(model({ thing: ent({ list: { points: [point('GET', '/thing', '`body.data.items`', { q: { $action: 'x' } })] } }) }), resolvedOf(def))
    strictEqual(action.entity.thing.source, 'model')

    const both = seedPlan(model({
      thing: ent({ list: { points: [point('GET', '/swag')] } }),
      other: { ...ent({}), name: 'other' },
    }), resolvedOf(def))
    deepStrictEqual([both.source, both.entity.thing.source, both.entity.other.source], ['mixed', 'definition', 'model'])
  })


  test('without a definition the plan is the model\'s field types, and says so', () => {
    const plan = seedPlan(model({
      thing: {
        name: 'thing', id: { field: 'id', name: 'id' },
        fields: {
          when: field('when', S, false, { fo: 'date-time' }),
          id: field('id'),
          size: field('size', '`$INTEGER`'),
          cost: field('cost', '`$NUMBER`', false),
          on: field('on', '`$BOOLEAN`'),
          meta: field('meta', '`$OBJECT`', false),
          tags: field('tags', '`$ARRAY`', false),
          odd: field('odd', '`$ANY`', false),
          either: field('either', ['`$ONE`', ['`$STRING`', '`$NULL`']], false),
          off: field('off', S, true, { a: false }),
          ro: field('ro', S, false, { ro: true }),
        },
      },
      gone: { name: 'gone', active: false, fields: { id: field('id') } },
    }))

    strictEqual(plan.source, 'model')
    deepStrictEqual(Object.keys(plan.entity), ['thing'])
    ok(/built from the model alone/.test(plan.notes[0].note))
    deepStrictEqual(plan.entity.thing.fields, [
      { n: 'cost', r: false, s: { t: 'number' } },
      { n: 'either', r: false, s: { t: 'string' } },
      { n: 'id', r: true, s: { t: 'string' } },
      { n: 'meta', r: false, s: { t: 'object', fields: [] } },
      { n: 'odd', r: false, s: { t: 'any' } },
      { n: 'on', r: true, s: { t: 'boolean' } },
      { n: 'ro', r: false, s: { t: 'string' }, ro: true },
      { n: 'size', r: true, s: { t: 'integer' } },
      { n: 'tags', r: false, s: { t: 'array', items: { t: 'any' }, min: 0, max: 0 } },
      { n: 'when', r: false, s: { t: 'string', fo: 'date-time' } },
    ])
    deepStrictEqual(plan.entity.thing.id, { field: 'id', as: 'text', lead: 'thing-', width: 4 })
  })


  test('an id is numbered in a form its schema admits', () => {
    const idOf = (id, name = 'thing') => {
      const plan = seedPlan(model({
        [name]: { name, id: { field: 'id', name: 'id' }, fields: { id: field('id') }, op: { load: { points: [point('GET', '/thing/{id}')] } } },
      }), resolvedOf({ paths: { '/thing/{id}': { get: { responses: { 200: JSON_OF({ type: 'object', properties: { id } }) } } } } }))
      return [plan.entity[name].id, plan.notes]
    }

    deepStrictEqual(idOf({ type: 'string' })[0], { field: 'id', as: 'text', lead: 'thing-', width: 4 })
    deepStrictEqual(idOf({ type: 'string' }, 'data_type')[0], { field: 'id', as: 'text', lead: 'data-type-', width: 4 })
    deepStrictEqual(idOf({})[0], { field: 'id', as: 'text', lead: 'thing-', width: 4 })
    deepStrictEqual(idOf({ type: 'string', format: 'uuid' })[0], { field: 'id', as: 'uuid' })
    deepStrictEqual(idOf({ type: 'integer' })[0], { field: 'id', as: 'integer', base: 0 })
    deepStrictEqual(idOf({ type: 'integer', minimum: 1000 })[0], { field: 'id', as: 'integer', base: 999 })
    deepStrictEqual(idOf({ type: 'integer', minimum: 10, exclusiveMinimum: true })[0], { field: 'id', as: 'integer', base: 10 })
    deepStrictEqual(idOf({ type: 'string', pattern: '^BK-[0-9]{6}$' })[0], { field: 'id', as: 'text', lead: 'BK-', width: 6 })
    deepStrictEqual(idOf({ type: 'string', pattern: '^[A-Za-z0-9_.-]+$' })[0], { field: 'id', as: 'text', lead: 'thing-', width: 4 })
    deepStrictEqual(idOf({ type: 'string', maxLength: 8 })[0], { field: 'id', as: 'text', lead: 'thi-', width: 4 })
    deepStrictEqual(idOf({ type: 'string', maxLength: 5 })[0], { field: 'id', as: 'text', lead: 't', width: 4 })
    deepStrictEqual(idOf({ type: 'string', pattern: '^[0-9]+$' })[0], { field: 'id', as: 'text', lead: '', width: 1 })
    deepStrictEqual(idOf({ type: 'string', pattern: '^[A-Z]{3}-[0-9]{4}$' })[0], { field: 'id', as: 'text', lead: 'THI-', width: 4 })

    const [drawn, notes] = idOf({ type: 'string', pattern: '^[a-f]{12}$' })
    deepStrictEqual(drawn, { field: 'id', as: 'spec' })
    deepStrictEqual(notes.map((n) => [n.field, n.note]),
      [['id', 'no numbered id meets the schema, so ids are drawn from it and can repeat']])
    deepStrictEqual(idOf({ type: 'boolean' })[0], { field: 'id', as: 'spec' })
  })


  test('a parent is the nearest ancestor first, and a field holds its id only where it can', () => {
    const rec = (props) => JSON_OF({ type: 'object', properties: { id: { type: 'string' }, ...props } })
    const def = {
      paths: {
        '/a/{id}': { get: { responses: { 200: rec({}) } } },
        '/b/{id}': { get: { responses: { 200: rec({ a_id: { type: 'string' }, c_id: { type: 'string' } }) } } },
        '/c/{id}': { get: { responses: { 200: rec({ bId: { type: 'string' }, a_id: { type: 'integer' }, parentId: { type: 'string' } }) } } },
        '/d/{id}': { get: { responses: { 200: rec({ parent_id: { type: 'string', pattern: '^[0-9]+$' } }) } } },
      },
    }
    const ent = (name, ancestors) => ({
      name, id: { field: 'id', name: 'id' }, fields: { id: field('id') }, relations: { ancestors },
      op: { load: { points: [point('GET', '/' + name + '/{id}')] } },
    })
    const plan = seedPlan(model({
      a: ent('a', []),
      b: ent('b', [['$.main.kit.entity.a']]),
      c: ent('c', [['a', 'b', 'nosuch'], ['a']]),
      d: ent('d', [['a']]),
    }), resolvedOf(def))

    deepStrictEqual(plan.entity.a.parents, [])
    deepStrictEqual(plan.entity.b.parents, [{ entity: 'a', param: 'a_id', field: 'a_id' }])
    deepStrictEqual(plan.entity.c.parents,
      [{ entity: 'b', param: 'b_id', field: 'bId' }, { entity: 'a', param: 'a_id' }])
    deepStrictEqual(plan.entity.d.parents, [{ entity: 'a', param: 'a_id' }])
    deepStrictEqual(plan.entity.b.fields.find((f) => 'c_id' === f.n).s, { t: 'ref', entity: 'c' })
    deepStrictEqual(plan.notes, [{ entity: 'c', note: 'reached under more than one parent: the first is used' }])
  })


  test('the seed and the count come from the target\'s model, and the plan is the same every time', () => {
    const make = (target) => seedPlan(model({ thing: { name: 'thing', fields: { id: field('id') } } }), undefined, target)
    strictEqual(make({ seed: { value: 'x', count: 9 } }).seed, 'x')
    strictEqual(make({ seed: { value: 'x', count: 9 } }).count, 9)
    strictEqual(make({ seed: { value: 12, count: 0 } }).seed, '12')
    strictEqual(make({ seed: { value: 12, count: 0 } }).count, 0)
    strictEqual(make(undefined).seed, '1')
    strictEqual(make({ seed: { count: -1 } }).count, 5)
    deepStrictEqual(make({}), make({}))
  })
})


// --- the checker ------------------------------------------------------------

describe('ts-seed: the checker', () => {

  test('refuses each kind of value the suite relies on it to refuse', () => {
    const root = { components: { schemas: { Id: { type: 'string', pattern: '^[a-z]+$' } } } }
    const bad = [
      [{ type: 'string' }, 5],
      [{ type: 'integer' }, 1.5],
      [{ type: 'string' }, null],
      [{ type: 'string', enum: ['a', 'b'] }, 'c'],
      [{ const: 3 }, 4],
      [{ type: 'string', minLength: 3 }, 'ab'],
      [{ type: 'string', maxLength: 3 }, 'abcd'],
      [{ type: 'string', pattern: '^a+$' }, 'ab'],
      [{ type: 'string', format: 'date' }, '2026-02-30'],
      [{ type: 'string', format: 'date-time' }, '2026-01-01 10:00:00'],
      [{ type: 'string', format: 'date-time' }, '2026-01-01T25:00:00Z'],
      [{ type: 'string', format: 'email' }, 'no at.example.com'],
      [{ type: 'string', format: 'uri' }, 'example.com/x'],
      [{ type: 'string', format: 'uuid' }, '123'],
      [{ type: 'string', format: 'hostname' }, 'bad_host.example.com'],
      [{ type: 'string', format: 'ipv4' }, '192.0.2.256'],
      [{ type: 'string', format: 'byte' }, 'abc'],
      [{ type: 'number', minimum: 2 }, 1.9],
      [{ type: 'number', maximum: 2 }, 2.1],
      [{ type: 'number', minimum: 2, exclusiveMinimum: true }, 2],
      [{ type: 'number', exclusiveMaximum: 2 }, 2],
      [{ type: 'number', multipleOf: 0.25 }, 0.3],
      [{ type: 'array', minItems: 2 }, [1]],
      [{ type: 'array', maxItems: 1 }, [1, 2]],
      [{ type: 'array', uniqueItems: true }, [{ a: 1 }, { a: 1 }]],
      [{ type: 'array', items: { type: 'string' } }, ['a', 1]],
      [{ type: 'object', required: ['a'] }, {}],
      [{ type: 'object', properties: { a: { type: 'string' } } }, { a: 1 }],
      [{ type: 'object', properties: {}, additionalProperties: false }, { a: 1 }],
      [{ type: 'object', additionalProperties: { type: 'integer' } }, { a: 'x' }],
      [{ type: 'object', properties: { secret: { type: 'string', writeOnly: true } } }, { secret: 'x' }],
      [{ allOf: [{ type: 'object', required: ['a'] }, { type: 'object', required: ['b'] }] }, { a: 1 }],
      [{ oneOf: [{ type: 'string' }, { type: 'string', minLength: 1 }] }, 'x'],
      [{ anyOf: [{ type: 'string' }, { type: 'integer' }] }, true],
      [{ $ref: '#/components/schemas/Id' }, 'ABC'],
      [{ $ref: '#/components/schemas/Missing' }, 'x'],
    ]
    for (const [schema, value] of bad) {
      ok(0 < check(value, schema, root).length, 'admitted ' + JSON.stringify(value) + ' for ' + JSON.stringify(schema))
    }

    const good = [
      [{ type: 'string', nullable: true }, null],
      [{ type: ['string', 'null'] }, null],
      [{ type: 'number' }, 3],
      [{ type: 'string', format: 'date-time' }, '2026-02-28T23:59:00Z'],
      [{ type: 'string', format: 'uuid' }, 'dc4cb55b-0000-4000-8000-000000000001'],
      [{ type: 'number', multipleOf: 0.01 }, 136.18],
      [{ oneOf: [{ type: 'string' }, { type: 'integer' }] }, 'x'],
      [{ $ref: '#/components/schemas/Id' }, 'abc'],
    ]
    for (const [schema, value] of good) deepStrictEqual(check(value, schema, root), [], JSON.stringify(schema))
  })
})


// --- generation and the library --------------------------------------------

function run(dir, args, opts = {}) {
  return spawnSync(process.execPath, [...(opts.pre || []), Path.join(dir, 'dist', 'dump.js'), ...args],
    { encoding: 'utf8', env: { ...process.env, ...(opts.env || {}) } })
}

function load(dir) {
  return require(Path.join(dir, 'dist', 'index.js'))
}


describe('ts-seed: from the definitions', () => {

  let consumer
  const apis = {}
  const extra = {}

  before(async () => {
    consumer = stageConsumer({ recordLog: true })
    await consumer.addPackage(PKG)
    compileConsumer(consumer)

    for (const def of defs()) {
      const built = await buildApi(consumer, def)
      consumer.log.lines.length = 0
      const made = await generate(consumer, apiModel(consumer, def.api), built)
      const log = consumer.log.lines.slice()
      const again = await generate(consumer, apiModel(consumer, def.api), built)
      Fs.rmSync(again.dir, { recursive: true, force: true })

      apis[def.api] = {
        ...made, log, again: again.files,
        model: apiModel(consumer, def.api),
        tsc: compileLibrary(made.dir),
        spec: YAML.parse(Fs.readFileSync(def.path, 'utf8')),
      }
    }

    // The same definition with a field and an entity more than it has.
    const spec = YAML.parse(Fs.readFileSync(defs().find((d) => 'bookshop' === d.api).path, 'utf8'))
    // The new field goes first, so that a value keyed by its place would move.
    spec.components.schemas.Author.properties = {
      nickname: { type: 'string', minLength: 2 }, ...spec.components.schemas.Author.properties,
    }
    spec.components.schemas.Review.properties.reviewer = {
      type: 'object', required: ['name'],
      properties: { handle: { type: 'string' }, ...spec.components.schemas.Reviewer.properties },
    }
    spec.components.schemas.Press = {
      type: 'object', required: ['id', 'name'],
      properties: { id: { type: 'string' }, name: { type: 'string' }, founded: { type: 'integer', minimum: 1800, maximum: 2020 } },
    }
    spec.paths['/press/{press_id}'] = {
      get: {
        parameters: [{ name: 'press_id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Press' } } } } },
      },
    }
    const grown = Path.join(Fs.mkdtempSync(Path.join(Os.tmpdir(), 'ts-seed-def-')), 'bookgrown-1.0.0-openapi-3.0.0.yaml')
    Fs.writeFileSync(grown, YAML.stringify(spec))
    const built = await buildApi(consumer, { api: 'bookgrown', file: Path.basename(grown), path: grown })
    extra.grown = await generate(consumer, apiModel(consumer, 'bookgrown'), built)
    extra.grown.tsc = compileLibrary(extra.grown.dir)
    Fs.rmSync(Path.dirname(grown), { recursive: true, force: true })

    // As under the test kit: a generation that has no definition to read.
    consumer.log.lines.length = 0
    extra.bare = await generate(consumer, apiModel(consumer, 'bookshop'))
    extra.bare.log = consumer.log.lines.slice()
    extra.bare.tsc = compileLibrary(extra.bare.dir)

    extra.kit = await generateInto(consumer, { model: apiModel(consumer, 'bookshop') })

    extra.seeded = await generate(consumer, apiModel(consumer, 'solardemo',
      "main: kit: target: 'ts-seed': seed: { value: 'tide', count: 3 }"))
    extra.seeded.tsc = compileLibrary(extra.seeded.dir)
  })

  after(() => {
    for (const made of [...Object.values(apis), ...Object.values(extra)]) {
      if (null != made.dir) Fs.rmSync(made.dir, { recursive: true, force: true })
    }
    if (null != consumer) consumer.cleanup()
  })


  test('every definition in test/def is covered', () => {
    deepStrictEqual(defs().map((d) => d.api).sort(), Object.keys(SCHEMAS).sort())
  })


  for (const api of Object.keys(SCHEMAS)) {
    describe(api, () => {

      test('generates the library, with no placeholder left and the same bytes every time', () => {
        const { files, leaks, again } = apis[api]
        deepStrictEqual(Object.keys(files).sort(), [
          '.gitignore', 'README.md', 'package.json', 'src/dump.ts', 'src/engine.ts',
          'src/index.ts', 'src/plan.ts', 'src/words.ts', 'tsconfig.json',
        ])
        deepStrictEqual(leaks, [])
        deepStrictEqual(again, files)
        for (const path of ['README.md', 'package.json', 'src/plan.ts']) {
          ok(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(files[path]), path + ' holds a value that was never set')
        }
      })


      test('the library compiles, and depends on nothing at run time', () => {
        strictEqual(apis[api].tsc, '')
        const pkg = JSON.parse(apis[api].files['package.json'])
        strictEqual(pkg.name, api + '-seed')
        strictEqual(pkg.dependencies, undefined)
        strictEqual(pkg.peerDependencies, undefined)
        deepStrictEqual(Object.keys(pkg.devDependencies), ['typescript'])
        for (const [path, text] of Object.entries(apis[api].files)) {
          if (!path.endsWith('.ts')) continue
          for (const m of text.matchAll(/\bfrom\s+'([^']+)'|\brequire\(\s*'([^']+)'/g)) {
            ok((m[1] || m[2]).startsWith('./'), path + ' reaches outside the library: ' + (m[1] || m[2]))
          }
        }
      })


      test('each entity of the model has a plan, read from the schema the definition gives it', () => {
        const { plan } = load(apis[api].dir)
        const active = Object.values(apis[api].model.main.kit.entity).filter((e) => false !== e.active).map((e) => e.name)
        deepStrictEqual(Object.keys(plan.entity), active.sort())
        strictEqual(plan.source, 'definition')
        strictEqual(plan.api, api)
        for (const [entity, schema] of Object.entries(SCHEMAS[api])) {
          strictEqual(plan.entity[entity].schema, '#/components/schemas/' + schema, entity)
          deepStrictEqual(plan.entity[entity].fields.map((f) => f.n),
            Object.keys(propsOf(apis[api].spec, schema)), entity)
        }
        ok(!apis[api].log.some((l) => 'ts-seed-source' === l.point), 'a definition build warned of a fallback')
        ok(/Built from the API definition/.test(apis[api].files['README.md']))
      })


      test('every record is valid against its schema, for each seed, and nothing is missed', () => {
        const { makeSeed } = load(apis[api].dir)
        let checked = 0
        for (const value of SEEDS) {
          const seed = makeSeed({ seed: value })
          for (const [entity, schema] of Object.entries(SCHEMAS[api])) {
            for (let n = 1; n <= NUMBERS; n++) {
              const errs = check(seed.record(entity, n), apis[api].spec.components.schemas[schema], apis[api].spec)
              deepStrictEqual(errs, [], api + ' ' + entity + ' #' + n + ' seed ' + value)
              checked++
            }
          }
          deepStrictEqual(seed.misses(), [])
        }
        strictEqual(checked, SEEDS.length * NUMBERS * Object.keys(SCHEMAS[api]).length)
      })


      test('a record is a function of the seed and its number alone', () => {
        const { makeSeed } = load(apis[api].dir)
        const one = makeSeed({ seed: 7 })
        const two = makeSeed({ seed: '7' })
        const fewer = makeSeed({ seed: 7, count: 2 })
        const other = makeSeed({ seed: 8 })

        for (const entity of one.entities()) {
          const forward = [1, 2, 3, 4, 5].map((n) => one.record(entity, n))
          const backward = [5, 4, 3, 2, 1].map((n) => two.record(entity, n)).reverse()
          deepStrictEqual(backward, forward, entity)
          deepStrictEqual(one.records(entity), forward, entity)
          deepStrictEqual(one.record(entity, 3), forward[2], entity)

          // How many records there are moves only the ids a record points at.
          const plan = one.plan.entity[entity]
          const linked = [...plan.parents.map((p) => p.field), ...plan.fields.filter((f) => 'ref' === f.s.t).map((f) => f.n)]
          const unlinked = (record) => Object.fromEntries(Object.entries(record).filter(([name]) => !linked.includes(name)))
          deepStrictEqual([1, 2, 3, 4, 5].map((n) => unlinked(fewer.record(entity, n))), forward.map(unlinked), entity)

          notDeepStrictEqual(other.records(entity), forward, entity)
          if ('spec' !== one.plan.entity[entity].id?.as) {
            deepStrictEqual([1, 2, 3].map((n) => other.id(entity, n)), [1, 2, 3].map((n) => one.id(entity, n)), entity)
          }
        }
      })


      test('ids are distinct, numbered, and those the records carry', () => {
        const { makeSeed } = load(apis[api].dir)
        const seed = makeSeed({ count: 30 })
        for (const entity of seed.entities()) {
          const id = seed.plan.entity[entity].id
          ok(null != id, entity + ' has no id')
          const ids = seed.records(entity).map((r) => r[id.field])
          strictEqual(new Set(ids).size, 30, entity)
          deepStrictEqual(ids, ids.map((_x, i) => seed.id(entity, i + 1)), entity)
          if ('text' === id.as) ok(/0001$/.test(String(ids[0])) || /1$/.test(String(ids[0])), ids[0])
        }
      })


      test('each record sits under records that exist', () => {
        const { makeSeed } = load(apis[api].dir)
        const seed = makeSeed({ counts: Object.fromEntries(Object.keys(SCHEMAS[api]).map((e, i) => [e, 3 + 2 * i])) })
        let held = 0
        for (const entity of seed.entities()) {
          const plan = seed.plan.entity[entity]
          for (let n = 1; n <= 20; n++) {
            const up = seed.parents(entity, n)
            deepStrictEqual(Object.keys(up), plan.parents.map((p) => p.param), entity)
            const record = seed.record(entity, n)

            plan.parents.forEach((parent, i) => {
              const ids = seed.records(parent.entity).map((r) => r[seed.plan.entity[parent.entity].id.field])
              ok(ids.includes(up[parent.param]), entity + ' #' + n + ' is under no ' + parent.entity)
              if (null != parent.field) {
                strictEqual(record[parent.field], up[parent.param], entity + '.' + parent.field)
                held++
              }
              // A grandparent is its parent's parent, not a pick of its own.
              if (0 < i) {
                const near = plan.parents[0]
                const nearNumber = 1 + seed.records(near.entity)
                  .findIndex((r) => r[seed.plan.entity[near.entity].id.field] === up[near.param])
                strictEqual(seed.parents(near.entity, nearNumber)[parent.param], up[parent.param], entity)
              }
            })
          }
        }
        strictEqual(0 < held, ['bookshop', 'solardemo', 'taxonomy'].includes(api))
      })


      test('the same bytes from another process, another time zone, and with no clock or random source', () => {
        const { makeSeed } = load(apis[api].dir)
        const here = JSON.stringify({ seed: '11', records: makeSeed({ seed: 11, count: 12 }).all(), misses: [] }, null, 2) + '\n'

        const plain = run(apis[api].dir, ['--seed', '11', '--count', '12'])
        strictEqual(plain.status, 0, plain.stderr)
        strictEqual(plain.stdout, here)

        const away = run(apis[api].dir, ['--seed', '11', '--count', '12'],
          { pre: ['-r', POISON], env: { TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' } })
        strictEqual(away.status, 0, away.stderr)
        strictEqual(away.stdout, here)

        notDeepStrictEqual(run(apis[api].dir, ['--seed', '12', '--count', '12']).stdout, here)
      })
    })
  }


  describe('the library', () => {

    test('takes "an" before a vowel', () => {
      const strings = (value) => 'string' === typeof value ? [value]
        : null != value && 'object' === typeof value ? Object.values(value).flatMap(strings) : []
      let sentences = 0
      for (const api of Object.keys(apis)) {
        for (const seed of SEEDS) {
          const made = load(apis[api].dir).makeSeed({ seed, count: NUMBERS })
          for (const text of made.entities().flatMap((e) => made.records(e)).flatMap(strings)) {
            if (/ /.test(text) && /\.$/.test(text)) sentences++
            ok(!/\b[Aa] [aeiou]/.test(text), text)
          }
        }
      }
      ok(100 < sentences, 'only ' + sentences + ' sentences to judge')
    })

    test('is readable: ids name their entity, and text is words', () => {
      const solar = load(apis.solardemo.dir).makeSeed()
      deepStrictEqual(solar.records('planet').map((r) => r.id),
        ['planet-0001', 'planet-0002', 'planet-0003', 'planet-0004', 'planet-0005'])
      deepStrictEqual(solar.records('moon').map((r) => [r.id, r.planet_id]), [
        ['moon-0001', 'planet-0001'], ['moon-0002', 'planet-0002'], ['moon-0003', 'planet-0003'],
        ['moon-0004', 'planet-0004'], ['moon-0005', 'planet-0005'],
      ])
      deepStrictEqual(solar.parents('moon', 7), { planet_id: 'planet-0002' })
      for (const record of solar.records('planet')) {
        ok(/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(record.name), record.name)
        ok(/^[a-z]+$/.test(record.kind), record.kind)
      }

      const shop = load(apis.bookshop.dir).makeSeed()
      const [author] = shop.records('author')
      ok(/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(author.name), author.name)
      ok(/^[a-z]+\.[a-z]+@example\.com$/.test(author.email), author.email)
      ok(/^https:\/\/example\.com\//.test(author.website), author.website)
      ok(/^(19[6-9]\d|2000)-/.test(author.born), author.born)
      const [book] = shop.records('book')
      strictEqual(book.id, 'BK-000001')
      ok(/^[A-Z][a-z]+ the [a-z]+ [a-z]+$/.test(book.title), book.title)
      ok(shop.records('author').some((a) => a.id === book.author_id), 'a book by no author')
      ok(book.created_at < '2026', 'created in the early window')
      const [review] = shop.records('review')
      ok(/^[A-Z].* .*\.$/.test(review.body), review.body)
      ok(/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(review.reviewer.name), review.reviewer.name)
      strictEqual(Object.prototype.hasOwnProperty.call(review.reviewer, 'secret'), false)
      ok(review.replies.every((reply) => 0 === reply.replies.length))

      const todo = load(apis.taskpad.dir).makeSeed().record('todo', 1)
      strictEqual(todo.id, 'todo-0001')
      ok(/^\d{4}-\d{2}-\d{2}$/.test(todo.due), todo.due)
    })


    // A consumer's own expectations rest on these values, and the README quotes them.
    test('a seed\'s data does not move unseen', () => {
      const seed = load(apis.solardemo.dir).makeSeed({ seed: 1 })
      deepStrictEqual(seed.records('planet').slice(0, 2), [
        { id: 'planet-0001', name: 'Steady Raven', kind: 'standard', diameter: 1709 },
        { id: 'planet-0002', name: 'Keen Island', kind: 'basic', diameter: 4885.4 },
      ])
      deepStrictEqual(seed.record('moon', 7),
        { id: 'moon-0007', name: 'Tidy Prairie', planet_id: 'planet-0002', kind: 'basic', diameter: 282.9 })
      deepStrictEqual(load(apis.taskpad.dir).makeSeed().record('todo', 1),
        { id: 'todo-0001', title: 'Catalog the northern raven', done: false, due: '2026-07-07' })

      const readme = Fs.readFileSync(Path.join(PKG, 'README.md'), 'utf8')
      for (const quoted of ["id: 'planet-0001', name: 'Steady Raven', kind: 'standard', diameter: 1709",
        "id: 'planet-0002', name: 'Keen Island', kind: 'basic', diameter: 4885.4",
        "id: 'moon-0007', name: 'Tidy Prairie', planet_id: 'planet-0002', kind: 'basic', diameter: 282.9"]) {
        ok(readme.includes(quoted), 'the README no longer quotes: ' + quoted)
      }
    })


    test('takes its counts, lays fields over a record, and refuses what it cannot answer', () => {
      const { makeSeed, plan } = load(apis.solardemo.dir)
      const seed = makeSeed({ seed: 3, count: 2, counts: { moon: 4 } })

      deepStrictEqual(seed.entities(), ['moon', 'planet'])
      strictEqual(seed.seed, '3')
      strictEqual(seed.plan, plan)
      strictEqual(seed.count('planet'), 2)
      strictEqual(seed.count('moon'), 4)
      strictEqual(seed.records('moon').length, 4)
      deepStrictEqual(Object.keys(seed.all()), ['moon', 'planet'])
      deepStrictEqual(seed.records('moon').map((r) => r.planet_id),
        ['planet-0001', 'planet-0002', 'planet-0001', 'planet-0002'])

      const over = seed.record('moon', 9, { planet_id: 'planet-0002', name: 'Io', extra: [1] })
      deepStrictEqual(over, { ...seed.record('moon', 9), planet_id: 'planet-0002', name: 'Io', extra: [1] })
      strictEqual(over.id, 'moon-0009')
      strictEqual(seed.id('moon', 9), 'moon-0009')

      throws(() => seed.record('comet', 1), /unknown entity: comet \(known: moon, planet\)/)
      throws(() => seed.records('constructor'), /unknown entity/)
      throws(() => seed.record('moon', 0), RangeError)
      throws(() => seed.id('moon', 1.5), RangeError)
      throws(() => makeSeed({ count: -1 }), TypeError)
      throws(() => makeSeed({ counts: { moon: 'x' } }), TypeError)
      strictEqual(makeSeed({ count: 0 }).records('planet').length, 0)
      deepStrictEqual(makeSeed({ count: 0 }).parents('moon', 3), { planet_id: 'planet-0001' })
    })


    test('the dump command prints records, one entity, or the plan, and fails by exit code', () => {
      const { makeSeed, plan } = load(apis.solardemo.dir)
      const dir = apis.solardemo.dir

      const one = run(dir, ['--seed', '5', '--entity', 'planet'])
      strictEqual(one.status, 0)
      strictEqual(one.stdout, JSON.stringify(makeSeed({ seed: 5 }).records('planet'), null, 2) + '\n')

      deepStrictEqual(JSON.parse(run(dir, ['--plan']).stdout), JSON.parse(JSON.stringify(plan)))
      deepStrictEqual(Object.keys(JSON.parse(run(dir, []).stdout)), ['seed', 'records', 'misses'])

      for (const args of [['--nope'], ['--seed'], ['--entity', 'comet'], ['--count', 'many']]) {
        const failed = run(dir, args)
        strictEqual(failed.status, 1, args.join(' '))
        strictEqual(failed.stdout, '')
        ok(0 < failed.stderr.length)
      }
    })


    test('adding a field or an entity leaves every other value as it was', () => {
      strictEqual(extra.grown.tsc, '')
      const before = load(apis.bookshop.dir).makeSeed({ seed: 4 })
      const grown = load(extra.grown.dir).makeSeed({ seed: 4 })

      deepStrictEqual(grown.entities(), ['author', 'book', 'press', 'review', 'shelf'])
      for (const entity of before.entities()) {
        for (let n = 1; n <= 12; n++) {
          const was = before.record(entity, n)
          const now = grown.record(entity, n)
          if ('author' === entity) {
            ok('string' === typeof now.nickname && 2 <= now.nickname.length)
            delete now.nickname
          }
          if ('review' === entity) {
            ok('string' === typeof now.reviewer.handle)
            delete now.reviewer.handle
            for (const reply of now.replies) delete reply.reviewer.handle
          }
          deepStrictEqual(now, was, entity + ' #' + n)
        }
      }
      strictEqual(grown.record('press', 1).id, 'press-0001')
    })


    test('a value that cannot meet its schema is reported, not passed off', () => {
      const { makeSeedFor } = load(apis.solardemo.dir)
      const plan = {
        version: 1, api: 'x', source: 'definition', seed: '1', count: 2, notes: [],
        entity: {
          odd: {
            name: 'odd', source: 'definition', parents: [], id: { field: 'id', as: 'text', lead: 'odd-', width: 4 },
            fields: [
              { n: 'id', r: true, s: { t: 'string' } },
              { n: 'fine', r: true, s: { t: 'string', min: 30, max: 34 } },
              { n: 'never', r: true, s: { t: 'integer', min: 5, max: 4 } },
              { n: 'tight', r: true, s: { t: 'string', fo: 'email', max: 5 } },
              { n: 'twins', r: true, s: { t: 'array', items: { t: 'const', value: 1 }, min: 2, max: 2, unique: true } },
              { n: 'rich', r: true, s: { t: 'string', re: '^(?=.*[0-9])[a-z0-9]{6,}$' } },
            ],
          },
        },
      }
      const seed = makeSeedFor(plan)
      const record = seed.record('odd', 1)

      ok(30 <= record.fine.length && record.fine.length <= 34, record.fine)
      ok(/^(?=.*[0-9])[a-z0-9]{6,}$/.test(record.rich), record.rich)
      deepStrictEqual(seed.misses().map((m) => [m.entity, m.n, m.path]),
        [['odd', 1, 'never'], ['odd', 1, 'tight'], ['odd', 1, 'twins']])
      seed.record('odd', 1)
      strictEqual(seed.misses().length, 3)
    })


    test('numbers, lengths, patterns and dates hold across many records', () => {
      const { makeSeedFor } = load(apis.solardemo.dir)
      const fields = [
        { n: 'a', r: true, s: { t: 'number', min: 0, max: 1, xmin: true, xmax: true } },
        { n: 'only', r: true, s: { t: 'integer', min: 0, max: 2, xmin: true, xmax: true } },
        { n: 'b', r: true, s: { t: 'integer', min: -3, max: 3, step: 3 } },
        { n: 'c', r: true, s: { t: 'number', min: 0.1, max: 0.4, step: 0.1 } },
        { n: 'd', r: true, s: { t: 'integer', min: 9000000000, max: 9007199254740991 } },
        { n: 'top', r: true, s: { t: 'integer', min: 3594013240802373, max: 3594013240802373 } },
        { n: 'price', r: true, s: { t: 'number', max: 0.5 } },
        { n: 'age', r: true, s: { t: 'integer', min: 200 } },
        { n: 'slug', r: true, s: { t: 'string', re: '^[a-z]+$', pat: compilePattern('^[a-z]+$'), min: 20, max: 22 } },
        { n: 'post', r: true, s: { t: 'string', re: '^[a-z]+@[a-z]+\\.com$', pat: compilePattern('^[a-z]+@[a-z]+\\.com$'), min: 18, max: 20 } },
        { n: 'note', r: true, s: { t: 'string', min: 3, max: 9 } },
        { n: 'created_at', r: true, s: { t: 'string', fo: 'date-time' } },
        { n: 'updated_at', r: true, s: { t: 'string', fo: 'date-time' } },
        { n: 'birthday', r: true, s: { t: 'string', fo: 'date' } },
        { n: 'tags', r: true, s: { t: 'array', items: { t: 'enum', values: ['x', 'y', 'z'] }, min: 3, max: 3, unique: true } },
        { n: 'bag', r: true, s: { t: 'map', values: { t: 'boolean' }, min: 2, max: 4 } },
      ]
      const seed = makeSeedFor({
        version: 1, api: 'x', source: 'definition', seed: '1', count: 1, notes: [],
        entity: { e: { name: 'e', source: 'definition', parents: [], fields } },
      })

      for (let n = 1; n <= 300; n++) {
        const r = seed.record('e', n)
        ok(0 < r.a && r.a < 1, 'a ' + r.a)
        strictEqual(r.only, 1)
        ok([-3, 0, 3].includes(r.b), 'b ' + r.b)
        ok([0.1, 0.2, 0.3, 0.4].includes(r.c), 'c ' + r.c)
        ok(Number.isSafeInteger(r.d) && 9000000000 <= r.d, 'd ' + r.d)
        strictEqual(r.top, 3594013240802373)
        ok(r.price <= 0.5, 'price ' + r.price)
        ok(Number.isInteger(r.age) && 200 <= r.age, 'age ' + r.age)
        ok(/^[a-z]{20,22}$/.test(r.slug), r.slug)
        ok(/^[a-z]+@[a-z]+\.com$/.test(r.post) && 18 <= r.post.length && r.post.length <= 20, r.post)
        ok(3 <= r.note.length && r.note.length <= 9 && r.note === r.note.trim(), JSON.stringify(r.note))
        for (const key of ['created_at', 'updated_at']) {
          strictEqual(new Date(r[key]).toISOString(), r[key].replace('Z', '.000Z'), r[key])
        }
        ok(r.created_at < r.updated_at, r.created_at + ' is not before ' + r.updated_at)
        strictEqual(new Date(r.birthday + 'T00:00:00Z').toISOString().slice(0, 10), r.birthday)
        deepStrictEqual(r.tags.slice().sort(), ['x', 'y', 'z'])
        ok(2 <= Object.keys(r.bag).length && Object.keys(r.bag).length <= 4)
      }
      deepStrictEqual(seed.misses(), [])
      strictEqual(seed.id('e', 1), null)
    })


    test('a field named like a property of every object is still a field', () => {
      const { makeSeedFor } = load(apis.solardemo.dir)
      const seed = makeSeedFor({
        version: 1, api: 'x', source: 'definition', seed: '1', count: 1, notes: [],
        entity: {
          e: {
            name: 'e', source: 'definition', parents: [],
            fields: [{ n: '__proto__', r: true, s: { t: 'integer' } }, { n: 'constructor', r: true, s: { t: 'boolean' } }],
          },
        },
      })
      const record = seed.record('e', 1, JSON.parse('{"__proto__": 5}'))
      deepStrictEqual(Object.keys(record), ['__proto__', 'constructor'])
      strictEqual(Object.getPrototypeOf(record), Object.prototype)
      strictEqual(JSON.parse(JSON.stringify(record)).constructor, record.constructor)
      strictEqual(Object.getOwnPropertyDescriptor(record, '__proto__').value, 5)
    })
  })


  describe('without the definition', () => {

    test('the library is built from the model, says so, and still compiles and runs', () => {
      const { files, log, tsc, dir } = extra.bare
      strictEqual(tsc, '')

      const { makeSeed, plan } = load(dir)
      strictEqual(plan.source, 'model')
      ok(/built from the model alone/.test(plan.notes[0].note))
      ok(/Built from the model alone/.test(files['README.md']))
      ok(/^\/\/ Built from the model alone/m.test(files['src/plan.ts']))
      deepStrictEqual(log.filter((l) => 'ts-seed-source' === l.point).map((l) => l.level), ['warn'])

      const seed = makeSeed()
      for (const entity of seed.entities()) {
        strictEqual(plan.entity[entity].source, 'model')
        const fields = apis.bookshop.model.main.kit.entity[entity].fields
        for (const record of seed.records(entity)) {
          deepStrictEqual(Object.keys(record), Object.keys(fields).sort())
          for (const [name, value] of Object.entries(record)) {
            const type = String(Array.isArray(fields[name].t) ? fields[name].t[1][0] : fields[name].t)
            const kind = Array.isArray(value) ? 'array' : typeof value
            const allowed = {
              '`$STRING`': ['string'], '`$INTEGER`': ['number'], '`$NUMBER`': ['number'], '`$BOOLEAN`': ['boolean'],
              '`$OBJECT`': ['object'], '`$ARRAY`': ['array'], '`$ANY`': ['string'],
            }[type]
            ok(null != allowed && allowed.includes(kind), entity + '.' + name + ': a ' + kind + ' for ' + type)
            if ('`$INTEGER`' === type) ok(Number.isInteger(value), entity + '.' + name)
          }
        }
      }
      strictEqual(seed.record('review', 1).book_id, seed.id('book', 1))
      deepStrictEqual(seed.misses(), [])
    })


    // The suite generates for itself, so its way is held to the test kit's.
    test('the test kit\'s own generation gives the same library, byte for byte', () => {
      const { files, leaks } = extra.kit
      deepStrictEqual(leaks, [])
      deepStrictEqual(
        Object.fromEntries(Object.entries(files).filter(([path]) => path.startsWith(TARGET + '/'))
          .map(([path, text]) => [path.slice(TARGET.length + 1), text])),
        extra.bare.files)
    })


    test('a project\'s own seed and count reach the library', () => {
      strictEqual(extra.seeded.tsc, '')
      const { makeSeed, plan } = load(extra.seeded.dir)
      strictEqual(plan.seed, 'tide')
      strictEqual(plan.count, 3)
      strictEqual(makeSeed().records('planet').length, 3)
      deepStrictEqual(makeSeed().records('planet'), makeSeed({ seed: 'tide' }).records('planet'))
      notDeepStrictEqual(makeSeed().records('planet'), load(apis.solardemo.dir).makeSeed().records('planet').slice(0, 3))

      const numbered = apiModel(consumer, 'solardemo', "main: kit: target: 'ts-seed': seed: { value: 7 }")
      const target = numbered.main.kit.target[TARGET]
      deepStrictEqual([target.seed.value, target.seed.count], [7, 5])
      strictEqual(seedPlan(numbered, undefined, target).seed, '7')
    })
  })
})


// The properties a schema's records hold, an allOf's parts in turn, as the
// definition's author wrote them.
function propsOf(spec, name) {
  const out = {}
  const add = (schema) => {
    const at = null != schema.$ref ? spec.components.schemas[schema.$ref.replace(/^.*\//, '')] : schema
    for (const part of at.allOf || []) add(part)
    Object.assign(out, at.properties || {})
  }
  add(spec.components.schemas[name])
  return out
}


// --- the templates and the package -----------------------------------------

describe('ts-seed: the package', () => {

  test('no template reads a clock, a random source, the environment or a module', () => {
    const dir = Path.join(PKG, '.sdk', 'tm', TARGET, 'src')
    for (const file of Fs.readdirSync(dir)) {
      const text = Fs.readFileSync(Path.join(dir, file), 'utf8')
      for (const banned of [/Math\.random/, /Date\.now/, /new Date\b/, /\bDate\(/, /process\.env/, /\brequire\(/, /from 'node:/, /performance\./]) {
        ok(!banned.test(text), file + ' holds ' + banned)
      }
      ok(!/\$\$[A-Za-z_][A-Za-z0-9_.]*\$\$/.test(text), file + ' holds a placeholder reference')
    }
  })


  test('the manifest names exactly the targets the package holds', () => {
    const manifest = JSON.parse(Fs.readFileSync(Path.join(PKG, 'sdkgen-package.json'), 'utf8'))
    const pkg = JSON.parse(Fs.readFileSync(Path.join(PKG, 'package.json'), 'utf8'))
    const held = (dir, strip) => Fs.readdirSync(Path.join(PKG, '.sdk', dir)).map((name) => name.replace(strip, '')).sort()

    deepStrictEqual(manifest.provides.target, held('model/target', /\.aontu$/))
    deepStrictEqual(manifest.provides.target, held('src/cmp', ''))
    deepStrictEqual(manifest.provides.target, held('tm', ''))
    deepStrictEqual(Object.keys(manifest.parity), manifest.provides.target)
    strictEqual(manifest.name, pkg.name)
    strictEqual(manifest.version, pkg.version)
    strictEqual(manifest.engines.sdkgen, pkg.peerDependencies['@voxgig/sdkgen'])
    strictEqual(pkg.devDependencies['@voxgig/sdkgen'], pkg.peerDependencies['@voxgig/sdkgen'])
  })


  const CLI = Path.join(PKG, 'node_modules', '@voxgig', 'sdkgen', 'bin', 'voxgig-sdkgen')


  test('sdkgen\'s own check passes the package', () => {
    const res = spawnSync(process.execPath, [CLI, 'package', 'check', '.'], { cwd: PKG, encoding: 'utf8' })
    strictEqual(res.status, 0, res.stdout + res.stderr)
  })


  // The way a project uses the pack while nothing is published: through the
  // CLI, which reads the project's own model as the test kit's add does not.
  test('a project adds it by name from a linked checkout, and doctor finds no drift', () => {
    const consumer = stageConsumer({
      extra: '@"@voxgig/apidef/model/apidef.aontu"\n@"@voxgig/sdkgen/model/sdkgen.aontu"',
    })
    const link = Path.join(consumer.sdk, 'node_modules', '@voxgig', 'sdkgen-validpack')
    const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: consumer.sdk, encoding: 'utf8' })
    try {
      Fs.symlinkSync(PKG, link, 'junction')
      const added = cli('package', 'add', '@voxgig/sdkgen-validpack')
      strictEqual(added.status, 0, added.stdout + added.stderr)

      const model = Fs.readFileSync(Path.join(consumer.sdk, 'model', 'target', TARGET + '.aontu'), 'utf8')
      ok(model.includes("package: '@voxgig/sdkgen-validpack'"), 'no provenance in the installed model')
      for (const file of ['src/cmp/' + TARGET + '/Main_' + TARGET + '.ts', 'tm/' + TARGET + '/src/engine.ts']) {
        ok(consumer.files().includes(file), file + ' was not installed')
      }

      const doctor = cli('doctor')
      strictEqual(doctor.status, 0, doctor.stdout + doctor.stderr)

      const listed = cli('package', 'list')
      ok(/@voxgig\/sdkgen-validpack@[0-9.]+: target `ts-seed`/.test(listed.stdout), listed.stdout)
    }
    finally {
      Fs.rmSync(link, { force: true })
      consumer.cleanup()
    }
  })
})
