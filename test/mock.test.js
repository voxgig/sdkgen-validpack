// The ts-mock target's own suite.
//
// Three layers, from the inside out:
//
//   - UNIT tests drive the built routes component on hand-built models the
//     definitions in test/def do not reach.
//   - GENERATION tests build each definition's model with apidef in a staged
//     consumer, generate ts-seed and ts-mock side by side through SdkGen with
//     the resolved definition, and compile both with tsc.
//   - SERVING tests start the compiled mock, talk to it over HTTP, and hold
//     every answer to the definition with test/check.js, which shares no code
//     with either target.

const { test, describe, before, after } = require('node:test')
const { ok, strictEqual, deepStrictEqual, notDeepStrictEqual, throws, rejects, match } = require('node:assert')

const Fs = require('node:fs')
const Os = require('node:os')
const Net = require('node:net')
const Path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const YAML = require('yaml')
const { operationFacts } = require('@voxgig/apidef')
const { stageConsumer } = require('@voxgig/sdkgen/testkit')

const {
  PKG, defs, buildApi, apiModel, compileConsumer, generateTargets, compileLibrary,
} = require('./support')
const { check, pointer } = require('./check')


const MOCK = 'ts-mock'
const SEED = 'ts-seed'

const CMP = Path.join(PKG, '.build', 'cmp', MOCK)
const { mockRoutes } = require(Path.join(CMP, 'Routes_' + MOCK + '.js'))

const POISON = Path.join(__dirname, 'poison.js')

const PORTS = { bookshop: 8911, solardemo: 8901, taskpad: 8902, taxonomy: 8080 }

const FILES = [
  '.gitignore', 'README.md', 'package.json', 'src/index.ts', 'src/mock.ts', 'src/routes.ts',
  'src/server.ts', 'tsconfig.json',
]


// --- unit: the routes ------------------------------------------------------

const point = (m, o, extra = {}) => ({ m, o, k: 'http', a: true, t: { req: '`reqdata`', res: '`body`' }, ...extra })
const JSON_OF = (schema) => ({ content: { 'application/json': { schema } } })

function model(entity, info = {}, config = {}) {
  return {
    name: 'demo',
    main: {
      kit: {
        info: { title: 'Demo API', servers: [{ url: 'http://localhost:9100' }], auth: false, ...info },
        config,
        entity,
      },
    },
  }
}

function resolvedOf(def) {
  return { version: 1, kind: 'openapi3', def, operation: (m, o) => operationFacts(def, { m, o }) }
}

const entity = (name, op, extra = {}) => ({ name, id: { field: 'id', name: 'id' }, op, ...extra })

const shown = (routes) => routes.routes.map((r) => [r.entity, r.op, r.action, r.method, r.path, r.status])


describe('ts-mock: the routes', () => {

  test('each point of each operation is a route, its path parameters named as the model names them', () => {
    const routes = mockRoutes(model({
      moon: entity('moon', {
        remove: { points: [point('DELETE', '/planet/{planet_id}/moon/{moon_id}', { r: { param: { moon_id: 'id' } } })] },
        list: { points: [point('GET', '/planet/{planet_id}/moon', { g: { params: [{ n: 'planet_id', or: 'planet_id' }] } })] },
        load: {
          points: [point('GET', '/planet/{pid}/moon/{moon_id}', {
            r: { param: { moon_id: 'id' } },
            g: { params: [{ n: 'planet_id', or: 'pid' }, { n: 'id', or: 'moon_id' }] },
          })],
        },
        create: {
          points: [
            point('POST', '/planet/{planet_id}/moon/{moon_id}/zap', { q: { $action: 'zap' }, r: { param: { moon_id: 'id' } } }),
            point('POST', '/planet/{planet_id}/moon'),
          ],
        },
        patch: {
          points: [
            point('PATCH', 'planet/{planet_id}/moon/{moon_id}', { r: { param: { moon_id: 'id' } } }),
            point('PUT', '/off', { a: false }),
            point('POST', '/graph', { k: 'graphql' }),
          ],
        },
      }),
      gone: entity('gone', { list: { points: [point('GET', '/gone')] } }, { active: false }),
    }))

    deepStrictEqual(shown(routes), [
      ['moon', 'list', undefined, 'GET', '/planet/{planet_id}/moon', 200],
      ['moon', 'load', undefined, 'GET', '/planet/{pid}/moon/{moon_id}', 200],
      ['moon', 'create', 'zap', 'POST', '/planet/{planet_id}/moon/{moon_id}/zap', 200],
      ['moon', 'create', undefined, 'POST', '/planet/{planet_id}/moon', 200],
      ['moon', 'patch', undefined, 'PATCH', '/planet/{planet_id}/moon/{moon_id}', 200],
      ['moon', 'remove', undefined, 'DELETE', '/planet/{planet_id}/moon/{moon_id}', 200],
    ])
    deepStrictEqual(routes.routes[1].params, [{ wire: 'pid', name: 'planet_id' }, { wire: 'moon_id', name: 'id', id: true }])
    deepStrictEqual(routes.routes[0].params, [{ wire: 'planet_id', name: 'planet_id' }])
    ok(routes.notes.some((n) => 'POST /graph' === n.route && /GraphQL/.test(n.note)))
    strictEqual(routes.source, 'model')
    strictEqual(routes.seed, '../../ts-seed/dist/index.js')
  })


  test('a success is the definition\'s: the lowest it declares, 201 for a create that declares it, and 200 without it', () => {
    const def = {
      paths: {
        '/a': {
          get: { responses: { 206: { description: 'part' }, 200: JSON_OF({ type: 'array' }) } },
          post: { responses: { 200: { description: 'ok' }, 201: { description: 'made' } } },
        },
        '/a/{id}': {
          put: { responses: { '2XX': { description: 'ok' } } },
          patch: { responses: { default: { description: 'any' } } },
          delete: { responses: { 204: { description: 'gone' }, 404: { description: 'no' } } },
        },
      },
    }
    const ent = entity('a', {
      list: { points: [point('GET', '/a')] },
      create: { points: [point('POST', '/a')] },
      update: { points: [point('PUT', '/a/{id}')] },
      patch: { points: [point('PATCH', '/a/{id}')] },
      remove: { points: [point('DELETE', '/a/{id}'), point('DELETE', '/b/{id}')] },
    })

    const read = mockRoutes(model({ a: ent }), resolvedOf(def))
    strictEqual(read.source, 'definition')
    deepStrictEqual(read.routes.map((r) => [r.method + ' ' + r.path, r.status]), [
      ['GET /a', 200], ['POST /a', 201], ['PUT /a/{id}', 200], ['PATCH /a/{id}', 200],
      ['DELETE /a/{id}', 204], ['DELETE /b/{id}', 200],
    ])
    ok(read.notes.some((n) => 'DELETE /b/{id}' === n.route && /not in the definition/.test(n.note)))

    const bare = mockRoutes(model({ a: ent }))
    deepStrictEqual(bare.routes.map((r) => r.status), [200, 200, 200, 200, 200, 200])
    ok(/the API definition was not available/.test(bare.notes[0].note))
  })


  test('a response that wraps its records says where, and what else it holds', () => {
    const items = { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } }
    const def = {
      paths: {
        '/a': {
          get: {
            responses: {
              200: JSON_OF({
                type: 'object', required: ['data', 'more', 'meta'],
                properties: {
                  data: {
                    allOf: [
                      { type: 'object', required: ['items', 'total'], properties: { items, total: { type: 'integer' } } },
                      {
                        type: 'object', required: ['page', 'pageSize', 'offset', 'cursor', 'note', 'kind', 'tags'],
                        properties: {
                          page: { type: 'integer' }, pageSize: { type: 'integer' }, offset: { type: 'integer', minimum: 3 },
                          cursor: { type: 'string', nullable: true }, note: { type: 'string' }, kind: { enum: ['x', 'y'] },
                          tags: { type: 'array' },
                        },
                      },
                    ],
                  },
                  more: { type: 'boolean' },
                  meta: { type: 'object', properties: { at: { type: 'string' } } },
                },
              }),
            },
          },
        },
        '/a/{id}': { get: { responses: { 200: JSON_OF({ type: 'object', properties: { thing: { type: 'object' } } }) } } },
      },
    }
    const routes = mockRoutes(model({
      a: entity('a', {
        list: {
          points: [point('GET', '/a', {
            t: { res: '`body.data.items`', page: { total: '`body.data.total`', more: '`body.more`', cursor: '`body.data.cursor`' } },
          })],
        },
        load: { points: [point('GET', '/a/{id}', { t: { res: '`body.thing`' } })] },
        update: { points: [point('PUT', '/a/{id}', { t: { res: { odd: true } } })] },
      }),
    }), resolvedOf(def))

    const [list, load, update] = routes.routes
    deepStrictEqual(list.res, ['data', 'items'])
    deepStrictEqual(list.fill, [
      { at: ['data', 'total'], count: true },
      { at: ['more'], value: false },
      { at: ['data', 'page'], value: 1 },
      { at: ['data', 'pageSize'], count: true },
      { at: ['data', 'offset'], value: 3 },
      { at: ['data', 'cursor'], value: null },
      { at: ['data', 'note'], value: '' },
      { at: ['data', 'kind'], value: 'x' },
      { at: ['data', 'tags'], value: [] },
      { at: ['meta'], value: {} },
    ])
    deepStrictEqual([load.res, load.fill], [['thing'], []])
    deepStrictEqual([update.res, update.fill], [[], []])
    ok(routes.notes.some((n) => 'PUT /a/{id}' === n.route && /response transform/.test(n.note)))
  })


  test('a request transform is undone: the record, wrapped, a closed body, or one field', () => {
    const shape = (req) => mockRoutes(model({ a: entity('a', { create: { points: [point('POST', '/a', { t: { req } })] } }) })).routes[0].req
    deepStrictEqual(shape('`reqdata`'), { at: [] })
    deepStrictEqual(shape(undefined), { at: [] })
    deepStrictEqual(shape({ thing: '`reqdata`' }), { at: ['thing'] })
    deepStrictEqual(shape({ name: '`reqdata.name`', size: '`reqdata.size_n`' }), { map: { name: 'name', size: 'size_n' } })
    deepStrictEqual(shape('`reqdata.items`'), { field: 'items' })

    const odd = mockRoutes(model({ a: entity('a', { create: { points: [point('POST', '/a', { t: { req: { a: 1 } } })] } }) }))
    deepStrictEqual(odd.routes[0].req, { at: [] })
    ok(odd.notes.some((n) => /request transform/.test(n.note)))
  })


  test('the credential is checked where the SDK sends it, and an operation that asks for none is open', () => {
    const ent = { a: entity('a', { list: { points: [point('GET', '/a')] }, load: { points: [point('GET', '/a/{id}')] } }) }
    const security = (sec) => ({ auth: undefined, security: sec })

    strictEqual(mockRoutes(model(ent)).auth, null)
    deepStrictEqual(mockRoutes(model(ent, security({ in: 'header', name: 'Authorization', prefix: 'Bearer', type: 'http' }))).auth,
      { in: 'header', name: 'Authorization', prefix: 'Bearer' })
    deepStrictEqual(mockRoutes(model(ent, security({ in: 'query', name: 'api_key', prefix: '', type: 'apiKey' }))).auth,
      { in: 'query', name: 'api_key', prefix: '' })
    deepStrictEqual(mockRoutes(model(ent, security({ in: 'cookie', name: 'sid', type: 'apiKey' }))).auth,
      { in: 'cookie', name: 'sid', prefix: 'Bearer' })
    strictEqual(mockRoutes(model(ent, security({ in: 'header', name: 'X-Key' }), { auth: { active: false } })).auth, null)

    const def = {
      security: [{ key: [] }],
      paths: { '/a': { get: { security: [], responses: { 200: {} } } }, '/a/{id}': { get: { responses: { 200: {} } } } },
    }
    const routes = mockRoutes(model(ent, security({ in: 'header', name: 'Authorization', prefix: '' })), resolvedOf(def))
    deepStrictEqual(routes.routes.map((r) => [r.path, r.open]), [['/a', true], ['/a/{id}', undefined]])
    const anonymous = { paths: { '/a': { get: { security: [{}, { key: [] }], responses: { 200: {} } } } } }
    strictEqual(mockRoutes(model(ent), resolvedOf(anonymous)).routes[0].open, true)
  })


  test('the address is the definition\'s first server: its port, its path and its variables', () => {
    const at = (servers) => {
      const r = mockRoutes(model({}, { servers }))
      return [r.port, r.prefix, r.local]
    }
    deepStrictEqual(at([{ url: 'http://localhost:9100' }, { url: 'http://localhost:9200/x' }]), [9100, '', true])
    deepStrictEqual(at([{ url: 'http://127.0.0.1:9100/api/v2/' }]), [9100, '/api/v2', true])
    deepStrictEqual(at([{ url: 'http://[::1]:9300/' }]), [9300, '', true])
    deepStrictEqual(at([{
      url: 'https://{region}.example.com:8443/{base}/{rest}',
      variables: { region: { default: 'eu' }, base: { default: 'v1' }, rest: {} },
    }]), [8443, '/v1/{rest}', false])
    deepStrictEqual(at([{ url: 'https://api.example.com' }]), [8080, '', false])
    deepStrictEqual(at([{ url: 'http://localhost/svc' }]), [8080, '/svc', false])
    deepStrictEqual(at([{ url: '/relative/path' }]), [8080, '/relative/path', false])
    deepStrictEqual(at([]), [8080, '', false])
    strictEqual(mockRoutes(model({}, { servers: [{ url: 'http://localhost:9100' }] })).server, 'http://localhost:9100')
  })
})


// --- generation and serving -------------------------------------------------

function load(dir) {
  return require(Path.join(dir, 'dist', 'index.js'))
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = Net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

// A started mock, and a way to ask it things that reads the answer whole.
async function serve(made, options, routes) {
  const lib = load(made[MOCK].dir)
  const mock = undefined === routes ? lib.makeMock(options) : lib.makeMockFor(routes, lib.seedLibrary(), options)
  const server = await mock.listen(0)
  const call = async (method, path, opts = {}) => {
    const sent = undefined !== opts.raw ? opts.raw : undefined === opts.body ? undefined : JSON.stringify(opts.body)
    const res = await fetch(server.url + path, {
      method,
      headers: { ...(undefined === sent ? {} : { 'content-type': 'application/json' }), ...(opts.headers || {}) },
      body: sent,
    })
    const text = await res.text()
    return { status: res.status, headers: Object.fromEntries(res.headers), text, body: '' === text ? undefined : JSON.parse(text) }
  }
  return { lib, mock, server, call, close: () => server.close() }
}

function seedOf(made, options) {
  return load(made[SEED].dir).makeSeed(options)
}

// The response the definition declares for a route's success, as its author wrote it.
function declared(spec, route) {
  let response = spec.paths?.[route.path]?.[route.method.toLowerCase()]?.responses?.[String(route.status)]
  for (let hops = 0; hops < 8 && 'string' === typeof response?.$ref; hops++) response = pointer(spec, response.$ref)
  if (null == response) return undefined
  return { schema: null == response.content ? response.schema : response.content['application/json']?.schema }
}

// The status the definition gives a route, read from the definition as written.
function statusFor(spec, route) {
  const codes = Object.keys(spec.paths?.[route.path]?.[route.method.toLowerCase()]?.responses || {})
    .filter((code) => /^2\d\d$/.test(code)).map(Number).sort((a, b) => a - b)
  return 'create' === route.op && codes.includes(201) ? 201 : codes[0] ?? 200
}

// A record as the route's request transform sends it.
function shaped(shape, record) {
  if (null != shape.field) return record[shape.field]
  if (null != shape.map) return Object.fromEntries(Object.entries(shape.map).map(([wire, field]) => [wire, record[field]]))
  return shape.at.slice().reverse().reduce((body, key) => ({ [key]: body }), record)
}

function credentialFor(auth, token = 'test-token') {
  if (null == auth) return { headers: {}, query: '' }
  if ('query' === auth.in) return { headers: {}, query: '?' + auth.name + '=' + token }
  if ('cookie' === auth.in) return { headers: { cookie: auth.name + '=' + token }, query: '' }
  return { headers: { [auth.name.toLowerCase()]: ('' === auth.prefix ? '' : auth.prefix + ' ') + token }, query: '' }
}

// The path a route takes for record `n` of its entity.
function pathFor(route, seed, n) {
  const ent = seed.plan.entity[route.entity]
  const up = seed.parents(route.entity, n)
  return route.path.replace(/\{([^{}]+)\}/g, (_m, wire) => {
    const param = route.params.find((p) => p.wire === wire)
    const value = param.id ? seed.id(route.entity, n) :
      ent.parents.some((x) => x.param === param.name) ? up[param.name] : '1'
    return encodeURIComponent(String(value))
  })
}

const CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([name]) => !['PORT', 'HOST'].includes(name)))

function startCli(dir, args = [], env = {}, pre = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...pre, Path.join(dir, 'dist', 'server.js'), ...args],
      { env: { ...CLEAN_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const exited = new Promise((done) => child.once('exit', (code, signal) => done({ code, signal })))
    child.stdout.on('data', (chunk) => {
      out += chunk
      const m = /listening on (\S+)/.exec(out)
      if (null != m) {
        resolve({ url: m[1], out, stop: () => { child.kill('SIGTERM'); return exited } })
      }
    })
    child.stderr.on('data', (chunk) => { err += chunk })
    exited.then(({ code }) => reject(new Error('the mock exited with ' + code + ': ' + err)))
  })
}

function runCli(dir, args, env = {}) {
  return spawnSync(process.execPath, [Path.join(dir, 'dist', 'server.js'), ...args],
    { env: { ...CLEAN_ENV, ...env }, encoding: 'utf8', timeout: 20000 })
}


describe('ts-mock: from the definitions', () => {

  let consumer
  const apis = {}
  const extra = {}

  before(async () => {
    consumer = stageConsumer({ recordLog: true })
    await consumer.addPackage(PKG)
    compileConsumer(consumer)

    for (const def of defs()) {
      const built = await buildApi(consumer, def)
      const made = await generateTargets(consumer, apiModel(consumer, def.api), built, [SEED, MOCK])
      const again = await generateTargets(consumer, apiModel(consumer, def.api), built, [SEED, MOCK])
      Fs.rmSync(again.dir, { recursive: true, force: true })

      apis[def.api] = {
        ...made, built, again: again[MOCK].files,
        model: apiModel(consumer, def.api),
        tsc: [compileLibrary(made[SEED].dir), compileLibrary(made[MOCK].dir)],
        spec: YAML.parse(Fs.readFileSync(def.path, 'utf8')),
      }
    }

    // As under the test kit: a generation that has no definition to read.
    consumer.log.lines.length = 0
    extra.bare = await generateTargets(consumer, apiModel(consumer, 'solardemo'), undefined, [SEED, MOCK])
    extra.bare.log = consumer.log.lines.slice()
    extra.bare.tsc = [compileLibrary(extra.bare[SEED].dir), compileLibrary(extra.bare[MOCK].dir)]
  })

  after(() => {
    for (const made of [...Object.values(apis), ...Object.values(extra)]) {
      if (null != made.dir) Fs.rmSync(made.dir, { recursive: true, force: true })
    }
    if (null != consumer) consumer.cleanup()
  })


  test('every definition in test/def is covered', () => {
    deepStrictEqual(defs().map((d) => d.api).sort(), Object.keys(PORTS).sort())
  })


  test('generation fails, saying why, when the project has no active ts-seed target', async () => {
    const { built } = apis.solardemo
    const off = apiModel(consumer, 'solardemo', "main: kit: target: 'ts-seed': active: false")
    strictEqual(off.main.kit.target[SEED].active, false)
    await rejects(() => generateTargets(consumer, off, built, [MOCK]),
      /ts-mock needs the ts-seed target, active, in the same project[^]*target add @voxgig\/sdkgen-validpack\/ts-seed/)

    const absent = apiModel(consumer, 'solardemo')
    delete absent.main.kit.target[SEED]
    await rejects(() => generateTargets(consumer, absent, built, [MOCK]), /ts-mock needs the ts-seed target/)
  })


  for (const api of Object.keys(PORTS)) {
    describe(api, () => {

      test('generates the mock beside the seed library, with no placeholder left and the same bytes every time', () => {
        const { files, leaks } = apis[api][MOCK]
        deepStrictEqual(Object.keys(files).sort(), FILES)
        deepStrictEqual(leaks, [])
        deepStrictEqual(apis[api].again, files)
        ok(Fs.existsSync(Path.join(apis[api].dir, SEED, 'package.json')), 'no seed library beside the mock')
        for (const path of ['README.md', 'package.json', 'src/routes.ts']) {
          ok(!/\bundefined\b|\bNaN\b|\[object Object\]/.test(files[path]), path + ' holds a value that was never set')
        }
      })


      test('the mock compiles, and depends on nothing at run time', () => {
        deepStrictEqual(apis[api].tsc, ['', ''])
        const pkg = JSON.parse(apis[api][MOCK].files['package.json'])
        strictEqual(pkg.name, api + '-mock')
        strictEqual(pkg.dependencies, undefined)
        strictEqual(pkg.peerDependencies, undefined)
        deepStrictEqual(Object.keys(pkg.devDependencies), ['typescript'])
        deepStrictEqual(pkg.bin, { [api + '-mock']: 'dist/server.js' })
        strictEqual(pkg.scripts.start, 'node dist/server.js')
        for (const [path, text] of Object.entries(apis[api][MOCK].files)) {
          if (!path.endsWith('.ts')) continue
          for (const m of text.matchAll(/\bfrom\s+'([^']+)'|\brequire\(\s*'([^']+)'/g)) {
            const to = m[1] || m[2]
            ok(to.startsWith('./') || 'node:http' === to, path + ' reaches outside the mock: ' + to)
          }
        }
      })


      test('every point of every operation of the model is a route, on the definition\'s address', () => {
        const { routes } = load(apis[api][MOCK].dir)
        const want = []
        for (const ent of Object.values(apis[api].model.main.kit.entity).filter((e) => false !== e.active)) {
          for (const [op, o] of Object.entries(ent.op || {})) {
            for (const p of o.points || []) {
              if (false !== p.a && 'graphql' !== p.k) want.push([ent.name, op, p.m.toUpperCase(), p.o].join(' '))
            }
          }
        }
        deepStrictEqual(routes.routes.map((r) => [r.entity, r.op, r.method, r.path].join(' ')).sort(), want.sort())
        deepStrictEqual([routes.api, routes.source, routes.port, routes.prefix], [api, 'definition', PORTS[api], ''])
        deepStrictEqual(routes.notes, [])
        for (const route of routes.routes) strictEqual(route.status, statusFor(apis[api].spec, route), route.method + ' ' + route.path)

        const readme = apis[api][MOCK].files['README.md']
        for (const route of routes.routes) ok(readme.includes('| `' + route.method + '` | `' + route.path + '` |'), route.path)
        for (const control of ['GET /__health', 'POST /__reset', 'GET /__requests']) ok(readme.includes(control), control)
        ok(readme.includes('http://127.0.0.1:' + PORTS[api]))
      })


      test('every route answers with its declared status and a body the definition admits', async () => {
        const made = apis[api]
        const { mock, call, close } = await serve(made)
        const seed = seedOf(made)
        const auth = credentialFor(mock.routes.auth)
        const depth = (route) => seed.plan.entity[route.entity].parents.length
        const routes = [
          ...mock.routes.routes.filter((r) => 'remove' !== r.op),
          ...mock.routes.routes.filter((r) => 'remove' === r.op).sort((a, b) => depth(b) - depth(a)),
        ]
        try {
          for (const route of routes) {
            const writes = undefined === route.action && ['create', 'update', 'patch'].includes(route.op)
            const res = await call(route.method, pathFor(route, seed, 1) + auth.query,
              { headers: auth.headers, ...(writes ? { body: shaped(route.req, seed.record(route.entity, 9)) } : {}) })
            const where = api + ' ' + route.method + ' ' + route.path
            strictEqual(res.status, route.status, where + ': ' + res.text)

            const answer = declared(made.spec, route)
            ok(null != answer, where + ': the definition declares no ' + route.status)
            if (null == answer.schema) {
              strictEqual(res.text, '', where + ' answers a body the definition does not declare')
              continue
            }
            deepStrictEqual(check(res.body, answer.schema, made.spec), [], where)
            if ('list' === route.op && 0 === route.res.length) ok(0 < res.body.length, where + ' listed nothing')
          }
          deepStrictEqual(mock.requests().map((r) => r.status), routes.map((r) => r.status))
        }
        finally {
          await close()
        }
      })
    })
  }


  describe('serving solardemo', () => {

    test('a list is the seed library\'s records, and a nested list holds those under its parent', async () => {
      const { call, close } = await serve(apis.solardemo)
      const seed = seedOf(apis.solardemo)
      try {
        const planets = await call('GET', '/api/planet')
        strictEqual(planets.status, 200)
        strictEqual(planets.headers['content-type'], 'application/json; charset=utf-8')
        deepStrictEqual(planets.body, seed.records('planet'))

        let held = 0
        for (const planet of seed.records('planet')) {
          const moons = await call('GET', '/api/planet/' + planet.id + '/moon')
          const under = seed.records('moon').filter((_m, i) => seed.parents('moon', i + 1).planet_id === planet.id)
          deepStrictEqual(moons.body, under, planet.id)
          for (const moon of moons.body) strictEqual(moon.planet_id, planet.id)
          held += moons.body.length
        }
        strictEqual(held, seed.count('moon'))

        const nowhere = await call('GET', '/api/planet/planet-0099/moon')
        deepStrictEqual([nowhere.status, nowhere.body.code], [404, 'not_found'])
        match(nowhere.body.message, /planet-0099/)
      }
      finally {
        await close()
      }
    })


    test('a load finds its record by the path, and anything else is a JSON 404', async () => {
      const { call, close } = await serve(apis.solardemo)
      const seed = seedOf(apis.solardemo)
      try {
        deepStrictEqual((await call('GET', '/api/planet/planet-0003')).body, seed.record('planet', 3))

        const moon = seed.record('moon', 2)
        deepStrictEqual((await call('GET', '/api/planet/' + moon.planet_id + '/moon/moon-0002')).body, moon)

        const other = seed.records('planet').find((p) => p.id !== moon.planet_id)
        for (const path of ['/api/planet/' + other.id + '/moon/moon-0002', '/api/planet/planet-0099',
          '/api/planet/' + moon.planet_id + '/moon/moon-0099']) {
          const res = await call('GET', path)
          deepStrictEqual([res.status, res.headers['content-type'], res.body.code], [404, 'application/json; charset=utf-8', 'not_found'], path)
        }
      }
      finally {
        await close()
      }
    })


    test('a create takes the body, the next id from the seed library, and the required fields it leaves out', async () => {
      const { call, close } = await serve(apis.solardemo)
      const seed = seedOf(apis.solardemo)
      try {
        const made = await call('POST', '/api/planet', { body: { name: 'Vulcan', id: 'mine', colour: 'red' } })
        strictEqual(made.status, 201)
        deepStrictEqual(made.body, { ...seed.record('planet', 6), name: 'Vulcan', colour: 'red' })
        strictEqual(made.body.id, seed.id('planet', 6))
        strictEqual((await call('POST', '/api/planet', { body: {} })).body.id, seed.id('planet', 7))
        deepStrictEqual((await call('GET', '/api/planet/' + made.body.id)).body, made.body)
        strictEqual((await call('GET', '/api/planet')).body.length, 7)

        const moon = await call('POST', '/api/planet/planet-0002/moon', { body: { name: 'Tiny', planet_id: 'planet-0001' } })
        strictEqual(moon.status, 201)
        deepStrictEqual([moon.body.id, moon.body.planet_id, moon.body.name], [seed.id('moon', 6), 'planet-0002', 'Tiny'])
        ok((await call('GET', '/api/planet/planet-0002/moon')).body.some((m) => m.id === moon.body.id))
        ok(!(await call('GET', '/api/planet/planet-0001/moon')).body.some((m) => m.id === moon.body.id))

        strictEqual((await call('POST', '/api/planet/planet-0099/moon', { body: {} })).status, 404)
        for (const raw of ['{bad', '[1]', '"text"']) {
          const res = await call('POST', '/api/planet', { raw })
          deepStrictEqual([res.status, res.body.code], [400, 'bad_request'], raw)
        }
        strictEqual((await call('GET', '/api/planet')).body.length, 7)
      }
      finally {
        await close()
      }
    })


    test('an update merges the body into its record and keeps its id, and a patch merges too', async () => {
      const { lib, call, close } = await serve(apis.solardemo)
      const seed = seedOf(apis.solardemo)
      try {
        const res = await call('PUT', '/api/planet/planet-0001', { body: { kind: 'gas', id: 'other' } })
        strictEqual(res.status, 200)
        deepStrictEqual(res.body, { ...seed.record('planet', 1), kind: 'gas' })
        deepStrictEqual((await call('GET', '/api/planet/planet-0001')).body, res.body)

        const moon = seed.record('moon', 1)
        const moved = await call('PUT', '/api/planet/' + moon.planet_id + '/moon/moon-0001', { body: { planet_id: 'planet-0005', name: 'Io' } })
        deepStrictEqual(moved.body, { ...moon, name: 'Io' })
        strictEqual((await call('PUT', '/api/planet/planet-0099', { body: {} })).status, 404)
      }
      finally {
        await close()
      }

      // No definition here declares a PATCH, so the route is added by hand.
      const load = lib.routes.routes.find((r) => 'planet' === r.entity && 'load' === r.op)
      const routes = { ...lib.routes, routes: [...lib.routes.routes, { ...load, op: 'patch', method: 'PATCH' }] }
      const patched = await serve(apis.solardemo, {}, routes)
      try {
        const res = await patched.call('PATCH', '/api/planet/planet-0002', { body: { diameter: 1 } })
        deepStrictEqual([res.status, res.body], [200, { ...seed.record('planet', 2), diameter: 1 }])
        strictEqual((await patched.call('PATCH', '/api/planet/planet-0099', { body: {} })).status, 404)
      }
      finally {
        await patched.close()
      }
    })


    test('a remove deletes its record and answers as the definition declares', async () => {
      const { lib, call, close } = await serve(apis.solardemo)
      const seed = seedOf(apis.solardemo)
      try {
        const res = await call('DELETE', '/api/planet/planet-0001')
        deepStrictEqual([res.status, res.text, res.headers['content-type']], [204, '', undefined])
        strictEqual((await call('GET', '/api/planet/planet-0001')).status, 404)
        deepStrictEqual((await call('GET', '/api/planet')).body, seed.records('planet').slice(1))
        strictEqual((await call('DELETE', '/api/planet/planet-0001')).status, 404)
      }
      finally {
        await close()
      }

      const routes = {
        ...lib.routes,
        routes: lib.routes.routes.map((r) => 'planet' === r.entity && 'remove' === r.op ? { ...r, status: 200 } : r),
      }
      const declared200 = await serve(apis.solardemo, {}, routes)
      try {
        deepStrictEqual((await declared200.call('DELETE', '/api/planet/planet-0002')).body, seed.record('planet', 2))
      }
      finally {
        await declared200.close()
      }
    })


    test('an action answers the record it names, unchanged', async () => {
      const { call, close } = await serve(apis.solardemo)
      const seed = seedOf(apis.solardemo)
      try {
        const res = await call('POST', '/api/planet/planet-0002/terraform', { body: { start: true } })
        deepStrictEqual([res.status, res.body], [200, seed.record('planet', 2)])
        strictEqual((await call('POST', '/api/planet/planet-0099/forbid', { body: {} })).status, 404)
        deepStrictEqual((await call('GET', '/api/planet/planet-0002')).body, seed.record('planet', 2))
      }
      finally {
        await close()
      }
    })


    test('a path with no route is a 404, a method a route does not take a 405, and too large a body a 413', async () => {
      const { call, close } = await serve(apis.solardemo)
      try {
        deepStrictEqual([(await call('GET', '/nope')).status, (await call('GET', '/api/planet/a/b/c/d')).status], [404, 404])
        const wrong = await call('PATCH', '/api/planet/planet-0001', { body: {} })
        strictEqual(wrong.status, 405)
        deepStrictEqual(wrong.headers.allow.split(', ').sort(), ['DELETE', 'GET', 'PUT'])
        const big = await call('POST', '/api/planet', { raw: JSON.stringify({ name: 'x'.repeat(1100000) }) })
        deepStrictEqual([big.status, big.body.code], [413, 'payload_too_large'])
        strictEqual((await call('GET', '/api/planet')).body.length, 5)
      }
      finally {
        await close()
      }
    })


    test('/__reset restores the seeded store, and may take a seed, a count and counts', async () => {
      const { mock, call, close } = await serve(apis.solardemo)
      const seed = seedOf(apis.solardemo)
      try {
        await call('POST', '/api/planet', { body: { name: 'Vulcan' } })
        await call('DELETE', '/api/planet/planet-0002')
        const health = await call('GET', '/__health')
        deepStrictEqual(health.body, { ok: true, api: 'solardemo', seed: '1', entities: { moon: 5, planet: 5 } })

        const reset = await call('POST', '/__reset')
        deepStrictEqual([reset.status, reset.body.entities], [200, { moon: 5, planet: 5 }])
        deepStrictEqual((await call('GET', '/api/planet')).body, seed.records('planet'))
        strictEqual((await call('POST', '/api/planet', { body: {} })).body.id, seed.id('planet', 6))

        const other = await call('POST', '/__reset', { body: { seed: 2, count: 3, counts: { moon: 1 } } })
        deepStrictEqual(other.body, { ok: true, api: 'solardemo', seed: '2', entities: { moon: 1, planet: 3 } })
        const two = seedOf(apis.solardemo, { seed: 2, count: 3, counts: { moon: 1 } })
        deepStrictEqual((await call('GET', '/api/planet')).body, two.records('planet'))

        for (const body of [{ count: -1 }, { seed: {} }, { counts: { moon: 'x' } }, [1]]) {
          deepStrictEqual((await call('POST', '/__reset', { body })).status, 400, JSON.stringify(body))
        }
        strictEqual((await call('POST', '/__reset', { raw: '{bad' })).status, 400)
        strictEqual((await call('GET', '/__reset')).status, 405)
        strictEqual((await call('GET', '/api/planet')).body.length, 3)

        mock.reset()
        deepStrictEqual(mock.records('planet'), seed.records('planet'))
      }
      finally {
        await close()
      }
    })


    // The README quotes this answer.
    test('the README\'s example is what the mock answers', async () => {
      const { call, close } = await serve(apis.solardemo)
      try {
        const [moon] = (await call('GET', '/api/planet/planet-0002/moon')).body
        deepStrictEqual({ id: moon.id, name: moon.name, planet_id: moon.planet_id },
          { id: 'moon-0002', name: 'Keen River', planet_id: 'planet-0002' })
        const readme = Fs.readFileSync(Path.join(PKG, 'README.md'), 'utf8')
        ok(readme.includes("// 200 [ { id: 'moon-0002', name: 'Keen River', planet_id: 'planet-0002', ... } ]"),
          'the README no longer quotes the answer')
      }
      finally {
        await close()
      }
    })


    test('the same seed gives the same answers, byte for byte, and another seed others', async () => {
      const script = async (call) => {
        const out = []
        for (const [method, path, body] of [
          ['GET', '/api/planet'], ['GET', '/api/planet/planet-0002/moon'], ['POST', '/api/planet', { name: 'A' }],
          ['PUT', '/api/planet/planet-0003', { kind: 'b' }], ['DELETE', '/api/planet/planet-0004'],
          ['POST', '/api/planet/planet-0001/moon', {}], ['GET', '/api/planet'], ['GET', '/__requests'],
        ]) {
          const res = await call(method, path, undefined === body ? {} : { body })
          out.push([res.status, res.headers, res.text])
        }
        return out
      }
      const runs = []
      for (const options of [{ seed: 3 }, { seed: '3' }, { seed: 4 }]) {
        const { call, close } = await serve(apis.solardemo, options)
        try {
          runs.push(await script(call))
        }
        finally {
          await close()
        }
      }
      deepStrictEqual(runs[1], runs[0])
      notDeepStrictEqual(runs[2], runs[0])
      for (const [, headers] of runs[0]) strictEqual(headers.date, undefined)
    })
  })


  describe('serving taskpad', () => {

    test('a query parameter that names a field filters a list, and one that does not is ignored', async () => {
      const { call, close } = await serve(apis.taskpad)
      const seed = seedOf(apis.taskpad)
      const key = { authorization: 'key' }
      try {
        const todos = seed.records('todo')
        const ask = async (query) => (await call('GET', '/api/todo' + query, { headers: key })).body
        deepStrictEqual(await ask('?done=true'), todos.filter((t) => true === t.done))
        deepStrictEqual(await ask('?done=false'), todos.filter((t) => false === t.done))
        deepStrictEqual(await ask('?title=' + encodeURIComponent(todos[1].title)), [todos[1]])
        deepStrictEqual(await ask('?due=' + todos[0].due + '&id=' + todos[0].id), [todos[0]])
        deepStrictEqual(await ask('?nosuch=1&page=2'), todos)
        deepStrictEqual(await ask('?id=todo-0001&id=todo-0003'), [todos[0], todos[2]])
        deepStrictEqual(await ask('?title=nothing+like+this'), [])
      }
      finally {
        await close()
      }
    })


    test('a request without the credential is a 401, and any credential is taken unless a token was given', async () => {
      const open = await serve(apis.taskpad)
      try {
        for (const headers of [{}, { authorization: '' }, { authorization: '   ' }]) {
          const res = await open.call('GET', '/api/todo', { headers })
          deepStrictEqual([res.status, res.body.code], [401, 'unauthorized'], JSON.stringify(headers))
          strictEqual(res.headers['www-authenticate'], undefined)
        }
        strictEqual((await open.call('GET', '/api/todo', { headers: { authorization: 'anything' } })).status, 200)
        strictEqual((await open.call('POST', '/api/todo', { body: {} })).status, 401)
        strictEqual((await open.call('GET', '/__health')).status, 200)
        strictEqual((await open.call('GET', '/nope')).status, 404)
        strictEqual((await open.call('GET', '/api/todo')).status, 401)
        strictEqual(open.mock.records('todo').length, 5)
      }
      finally {
        await open.close()
      }

      const given = await serve(apis.taskpad, { token: 'sesame' })
      try {
        strictEqual((await given.call('GET', '/api/todo', { headers: { authorization: 'anything' } })).status, 401)
        strictEqual((await given.call('GET', '/api/todo', { headers: { authorization: 'sesame' } })).status, 200)
      }
      finally {
        await given.close()
      }
    })


    test('the credential is read where the API puts it: after a prefix, in the query, or in a cookie', async () => {
      const { routes } = load(apis.taskpad[MOCK].dir)
      const asked = async (auth, cases) => {
        const s = await serve(apis.taskpad, {}, { ...routes, auth })
        try {
          for (const [path, headers, status] of cases) {
            strictEqual((await s.call('GET', path, { headers })).status, status, JSON.stringify([auth, path, headers]))
          }
          return s.mock.requests()
        }
        finally {
          await s.close()
        }
      }

      await asked({ in: 'header', name: 'Authorization', prefix: 'Bearer' }, [
        ['/api/todo', { authorization: 'Bearer abc' }, 200], ['/api/todo', { authorization: 'bearer abc' }, 200],
        ['/api/todo', { authorization: 'abc' }, 401], ['/api/todo', { authorization: 'Bearer ' }, 401],
        ['/api/todo', { authorization: 'Basic abc' }, 401],
      ])
      const s = await serve(apis.taskpad, {}, { ...routes, auth: { in: 'header', name: 'X-Api-Key', prefix: 'Bearer' } })
      try {
        const res = await s.call('GET', '/api/todo')
        deepStrictEqual([res.status, res.headers['www-authenticate']], [401, 'Bearer'])
        strictEqual((await s.call('GET', '/api/todo', { headers: { 'x-api-key': 'Bearer k' } })).status, 200)
      }
      finally {
        await s.close()
      }

      const log = await asked({ in: 'query', name: 'api_key', prefix: '' }, [
        ['/api/todo?api_key=k123', {}, 200], ['/api/todo', {}, 401], ['/api/todo?api_key=', {}, 401],
        ['/api/todo', { authorization: 'k123' }, 401],
      ])
      deepStrictEqual(log.map((r) => r.query), [{ api_key: '[redacted]' }, {}, { api_key: '[redacted]' }, {}])
      ok(!JSON.stringify(log).includes('k123'))

      await asked({ in: 'cookie', name: 'sid', prefix: '' }, [
        ['/api/todo', { cookie: 'a=1; sid=abc' }, 200], ['/api/todo', { cookie: 'other=1' }, 401], ['/api/todo', {}, 401],
      ])

      const opened = { ...routes, routes: routes.routes.map((r) => 'list' === r.op ? { ...r, open: true } : r) }
      const o = await serve(apis.taskpad, {}, opened)
      try {
        strictEqual((await o.call('GET', '/api/todo')).status, 200)
        strictEqual((await o.call('GET', '/api/todo/todo-0001')).status, 401)
      }
      finally {
        await o.close()
      }
    })


    test('/__requests lists what was asked, numbered and in order, and never the credential', async () => {
      const { mock, call, close } = await serve(apis.taskpad)
      const key = { authorization: 'secret-token-123' }
      try {
        await call('GET', '/api/todo?done=true', { headers: key })
        await call('GET', '/__health')
        await call('POST', '/api/todo', { body: { title: 'New one', secret: 'body-secret-456' }, headers: key })
        await call('GET', '/api/todo/todo-0099', { headers: key })
        await call('DELETE', '/api/todo/todo-0001')
        await call('GET', '/nowhere')

        const listed = await call('GET', '/__requests')
        deepStrictEqual(listed.body, [
          { seq: 1, method: 'GET', path: '/api/todo', query: { done: 'true' }, status: 200, entity: 'todo', op: 'list' },
          { seq: 2, method: 'POST', path: '/api/todo', query: {}, status: 201, entity: 'todo', op: 'create' },
          { seq: 3, method: 'GET', path: '/api/todo/todo-0099', query: {}, status: 404, entity: 'todo', op: 'load' },
          { seq: 4, method: 'DELETE', path: '/api/todo/todo-0001', query: {}, status: 401, entity: 'todo', op: 'remove' },
          { seq: 5, method: 'GET', path: '/nowhere', query: {}, status: 404, entity: null, op: null },
        ])
        deepStrictEqual(mock.requests(), listed.body)
        ok(!/secret-token-123|body-secret-456/.test(listed.text))

        await call('POST', '/__reset')
        deepStrictEqual((await call('GET', '/__requests')).body, [])
        await call('GET', '/api/todo', { headers: key })
        strictEqual(mock.requests()[0].seq, 1)
      }
      finally {
        await close()
      }
    })
  })


  describe('the address and the command', () => {

    test('the default port and path come from the definition, and listen takes others', async () => {
      const lib = load(apis.solardemo[MOCK].dir)
      strictEqual(lib.routes.port, 8901)

      const port = await freePort()
      const mock = lib.makeMockFor({ ...lib.routes, port, prefix: '/v1' }, lib.seedLibrary())
      const server = await mock.listen()
      try {
        deepStrictEqual([server.port, server.host, server.url], [port, '127.0.0.1', 'http://127.0.0.1:' + port + '/v1'])
        strictEqual((await fetch(server.url + '/api/planet')).status, 200)
        strictEqual((await fetch('http://127.0.0.1:' + port + '/api/planet')).status, 404)
        strictEqual((await fetch('http://127.0.0.1:' + port + '/__health')).status, 200)
        strictEqual((await fetch(server.url + '/__health')).status, 200)
      }
      finally {
        await server.close()
      }
      await rejects(async () => {
        const blocker = await lib.makeMock().listen(0)
        try {
          await lib.makeMock().listen(blocker.port)
        }
        finally {
          await blocker.close()
        }
      }, /EADDRINUSE/)
    })


    test('the command listens where it is told, and a flag wins over the environment', async () => {
      const dir = apis.solardemo[MOCK].dir
      const [a, b] = [await freePort(), await freePort()]

      const plain = await startCli(dir, ['--port', '0'])
      try {
        match(plain.url, /^http:\/\/127\.0\.0\.1:\d+$/)
        match(plain.out, /^ts-mock: the solardemo mock is listening on /)
        strictEqual((await fetch(plain.url + '/__health')).status, 200)
      }
      finally {
        deepStrictEqual(await plain.stop(), { code: 0, signal: null })
      }

      for (const [args, env, url] of [
        [[], { PORT: String(a) }, 'http://127.0.0.1:' + a],
        [['--port', String(b)], { PORT: String(a) }, 'http://127.0.0.1:' + b],
        [['--host', 'localhost', '--port', String(b)], { HOST: '127.0.0.1' }, 'http://localhost:' + b],
        [[], { HOST: '127.0.0.1', PORT: String(a) }, 'http://127.0.0.1:' + a],
      ]) {
        const run = await startCli(dir, args, env)
        try {
          strictEqual(run.url, url, JSON.stringify([args, env]))
          strictEqual((await fetch(run.url + '/__health')).status, 200)
        }
        finally {
          await run.stop()
        }
      }

      const seeded = await startCli(dir, ['--seed', '9', '--count', '2', '--port', '0', '--token', 't0k'])
      try {
        deepStrictEqual((await (await fetch(seeded.url + '/__health')).json()),
          { ok: true, api: 'solardemo', seed: '9', entities: { moon: 2, planet: 2 } })
      }
      finally {
        await seeded.stop()
      }

      for (const [args, env] of [[['--nope', '1'], {}], [['--port'], {}], [['--port', 'many'], {}],
        [['--count', '-1'], {}], [['--port', '70000'], {}], [[], { PORT: 'abc' }]]) {
        const res = runCli(dir, args, env)
        strictEqual(res.status, 1, JSON.stringify([args, env]))
        strictEqual(res.stdout, '')
        match(res.stderr, /^ts-mock: .*\nusage: server /)
      }

      const taken = await startCli(dir, ['--port', '0'])
      try {
        const res = runCli(dir, ['--port', new URL(taken.url).port])
        deepStrictEqual([res.status, res.stdout], [1, ''])
        match(res.stderr, /EADDRINUSE/)
      }
      finally {
        await taken.stop()
      }
    })


    test('the command serves the same bytes with no clock and no random source', async () => {
      const dir = apis.solardemo[MOCK].dir
      const script = async (url) => {
        const out = []
        for (const [method, path, body] of [['GET', '/api/planet'], ['POST', '/api/planet', '{"name":"A"}'],
          ['GET', '/api/planet/planet-0006'], ['GET', '/__requests']]) {
          const res = await fetch(url + path, { method, body, headers: body ? { 'content-type': 'application/json' } : {} })
          out.push([res.status, Object.fromEntries(res.headers), await res.text()])
        }
        return out
      }
      const plain = await startCli(dir, ['--port', '0'])
      const poisoned = await startCli(dir, ['--port', '0'],
        { TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' }, ['-r', POISON])
      try {
        deepStrictEqual(await script(poisoned.url), await script(plain.url))
      }
      finally {
        await plain.stop()
        await poisoned.stop()
      }
    })
  })


  describe('the library', () => {

    test('says so when the seed library has not been built', () => {
      const lone = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'ts-mock-lone-'))
      try {
        Fs.cpSync(apis.solardemo[MOCK].dir, Path.join(lone, MOCK), { recursive: true })
        const lib = load(Path.join(lone, MOCK))
        throws(() => lib.makeMock(), /ts-mock: no seed library at .*ts-seed\/dist\/index\.js: build the ts-seed library first/)
      }
      finally {
        Fs.rmSync(lone, { recursive: true, force: true })
      }
    })


    test('serves through its handler alone, and keeps the latest requests it was asked', async () => {
      const { EventEmitter } = require('node:events')
      const mock = load(apis.solardemo[MOCK].dir).makeMock()
      const ask = (method, url, body = '') => new Promise((resolve) => {
        const req = Object.assign(new EventEmitter(), { method, url, headers: {}, setEncoding() { } })
        const res = {
          statusCode: 0, sendDate: true, headers: {},
          setHeader(name, value) { this.headers[name] = value },
          end(text) { resolve({ status: this.statusCode, sendDate: this.sendDate, headers: this.headers, text }) },
        }
        mock.handler(req, res)
        if ('' !== body) req.emit('data', body)
        req.emit('end')
      })

      const made = await ask('POST', '/api/planet', '{"name":"Direct"}')
      deepStrictEqual([made.status, made.sendDate, JSON.parse(made.text).name], [201, false, 'Direct'])
      for (let i = 0; i < 10004; i++) await ask('GET', '/api/planet/planet-0001?i=' + i)
      const kept = mock.requests()
      deepStrictEqual([kept.length, kept[0].seq, kept[0].query, kept[kept.length - 1].seq], [10000, 6, { i: '4' }, 10005])
      mock.reset()
      deepStrictEqual(mock.requests(), [])
    })


    test('refuses a seed library made from another model', () => {
      const lib = load(apis.solardemo[MOCK].dir)
      throws(() => lib.makeMockFor(lib.routes, load(apis.taskpad[SEED].dir)),
        /ts-mock: the seed library has no entity moon: generate ts-seed and ts-mock from the same model/)
    })


    test('takes a request shape and a response envelope the routes name', async () => {
      const lib = load(apis.solardemo[MOCK].dir)
      const seed = seedOf(apis.solardemo)
      const base = lib.routes.routes
      const pick = (op) => base.find((r) => 'planet' === r.entity && op === r.op && undefined === r.action)
      const routes = {
        ...lib.routes,
        routes: [
          { ...pick('list'), res: ['data', 'items'], fill: [{ at: ['data', 'total'], count: true }, { at: ['page'], value: 1 }] },
          { ...pick('load'), res: ['planet'], fill: [{ at: ['meta'], value: { v: 1 } }] },
          { ...pick('create'), req: { at: ['planet'] }, res: ['planet'] },
          { ...pick('update'), req: { map: { title: 'name', size: 'diameter' } } },
          { ...pick('create'), path: '/api/planet/{planet_id}/names', params: [{ wire: 'planet_id', name: 'id', id: true }], req: { field: 'name' }, op: 'update', method: 'POST' },
        ],
      }
      const s = await serve(apis.solardemo, {}, routes)
      try {
        const list = await s.call('GET', '/api/planet')
        deepStrictEqual(list.body, { data: { items: seed.records('planet'), total: 5 }, page: 1 })
        deepStrictEqual((await s.call('GET', '/api/planet/planet-0002')).body, { planet: seed.record('planet', 2), meta: { v: 1 } })

        const made = await s.call('POST', '/api/planet', { body: { planet: { name: 'Wrapped' } } })
        deepStrictEqual([made.status, made.body.planet.name, made.body.planet.id], [201, 'Wrapped', seed.id('planet', 6)])
        strictEqual((await s.call('POST', '/api/planet', { body: { name: 'Bare' } })).status, 400)

        const mapped = await s.call('PUT', '/api/planet/planet-0001', { body: { title: 'Mapped', size: 3, other: 1 } })
        deepStrictEqual(mapped.body, { ...seed.record('planet', 1), name: 'Mapped', diameter: 3 })
        const field = await s.call('POST', '/api/planet/planet-0003/names', { body: 'Named' })
        deepStrictEqual(field.body, { ...seed.record('planet', 3), name: 'Named' })
      }
      finally {
        await s.close()
      }
    })


    test('a page fact inside a required object keeps its place beside the object\'s own fills', async () => {
      const def = {
        paths: {
          '/api/planet': {
            get: {
              responses: {
                200: JSON_OF({
                  type: 'object', required: ['items', 'meta'],
                  properties: {
                    items: { type: 'array' },
                    meta: { type: 'object', required: ['total', 'size', 'note'], properties: { total: { type: 'integer' }, size: { type: 'integer' }, note: { type: 'string' } } },
                  },
                }),
              },
            },
          },
        },
      }
      const built = mockRoutes(model({
        planet: entity('planet', { list: { points: [point('GET', '/api/planet', { t: { res: '`body.items`', page: { total: '`body.meta.total`' } } })] } }),
      }), resolvedOf(def))
      const [list] = built.routes
      deepStrictEqual(list.fill, [
        { at: ['meta', 'total'], count: true }, { at: ['meta', 'size'], count: true }, { at: ['meta', 'note'], value: '' },
      ])

      const lib = load(apis.solardemo[MOCK].dir)
      const base = lib.routes.routes.find((r) => 'planet' === r.entity && 'list' === r.op)
      const s = await serve(apis.solardemo, {}, { ...lib.routes, routes: [{ ...base, res: list.res, fill: list.fill }] })
      try {
        const res = await s.call('GET', '/api/planet')
        deepStrictEqual(res.body, { items: seedOf(apis.solardemo).records('planet'), meta: { total: 5, size: 5, note: '' } })
        deepStrictEqual(check(res.body, def.paths['/api/planet'].get.responses[200].content['application/json'].schema, def), [])
      }
      finally {
        await s.close()
      }
    })


    test('a create whose path names the id takes it, and refuses one a record holds', async () => {
      const lib = load(apis.solardemo[MOCK].dir)
      const seed = seedOf(apis.solardemo)
      const create = lib.routes.routes.find((r) => 'planet' === r.entity && 'create' === r.op && undefined === r.action)
      const routes = {
        ...lib.routes,
        routes: [{ ...create, method: 'PUT', path: '/api/planet/{planet_id}', params: [{ wire: 'planet_id', name: 'id', id: true }] }],
      }
      const s = await serve(apis.solardemo, {}, routes)
      try {
        const made = await s.call('PUT', '/api/planet/chosen-1', { body: { name: 'Chosen' } })
        deepStrictEqual([made.status, made.body], [201, { ...seed.record('planet', 6), id: 'chosen-1', name: 'Chosen' }])
        const held = await s.call('PUT', '/api/planet/planet-0001', { body: {} })
        deepStrictEqual([held.status, held.body.code], [409, 'conflict'])
        strictEqual(s.mock.records('planet').length, 6)
      }
      finally {
        await s.close()
      }
    })


    test('keeps what the definition marks read-only and never sends back a write-only field', async () => {
      const made = apis.bookshop
      const { call, close } = await serve(made)
      const seed = seedOf(made)
      try {
        const book = await call('POST', '/book', { body: { title: 'Given Title', created_at: '1999-01-01T00:00:00Z' } })
        strictEqual(book.status, 201)
        strictEqual(book.body.title, 'Given Title')
        strictEqual(book.body.created_at, seed.record('book', 6).created_at)
        const kept = await call('PUT', '/book/' + book.body.id, { body: { created_at: '1999-01-01T00:00:00Z', pages: 12 } })
        deepStrictEqual([kept.body.created_at, kept.body.pages], [book.body.created_at, 12])

        const bookId = seed.parents('review', 1).book_id
        const review = await call('POST', '/book/' + bookId + '/review',
          { body: { ...seed.record('review', 9), reviewer: { name: 'Ann', secret: 'hush' } } })
        strictEqual(review.status, 201)
        deepStrictEqual(review.body.reviewer, { name: 'Ann' })
        strictEqual(review.body.book_id, bookId)
        const listed = await call('GET', '/book/' + bookId + '/review')
        ok(!listed.text.includes('hush'))
        deepStrictEqual(check(listed.body, made.spec.paths['/book/{book_id}/review'].get.responses['200'].content['application/json'].schema, made.spec), [])
      }
      finally {
        await close()
      }
    })
  })


  describe('without the definition', () => {

    test('every success is 200, the routes and the README say why, and the mock still serves', async () => {
      const { tsc, log } = extra.bare
      deepStrictEqual(tsc, ['', ''])
      const lib = load(extra.bare[MOCK].dir)
      strictEqual(lib.routes.source, 'model')
      deepStrictEqual([...new Set(lib.routes.routes.map((r) => r.status))], [200])
      ok(/the API definition was not available/.test(lib.routes.notes[0].note))
      ok(/the API definition was not available/.test(extra.bare[MOCK].files['README.md']))
      deepStrictEqual(log.filter((l) => 'ts-mock-source' === l.point).map((l) => l.level), ['warn'])

      const s = await serve(extra.bare)
      try {
        strictEqual((await s.call('POST', '/api/planet', { body: { name: 'X' } })).status, 200)
        strictEqual((await s.call('DELETE', '/api/planet/planet-0001')).body.id, 'planet-0001')
      }
      finally {
        await s.close()
      }
    })
  })
})


// --- the templates -----------------------------------------------------------

describe('ts-mock: the templates', () => {

  test('no template reads a clock or a random source, and only the command reads the environment', () => {
    const dir = Path.join(PKG, '.sdk', 'tm', MOCK, 'src')
    deepStrictEqual(Fs.readdirSync(dir).sort(), ['index.ts', 'mock.ts', 'server.ts'])
    for (const file of Fs.readdirSync(dir)) {
      const text = Fs.readFileSync(Path.join(dir, file), 'utf8')
      for (const banned of [/Math\.random/, /Date\.now/, /new Date\b/, /\bDate\(/, /performance\./, /\$\$[A-Za-z_][A-Za-z0-9_.]*\$\$/]) {
        ok(!banned.test(text), file + ' holds ' + banned)
      }
      if ('server.ts' !== file) ok(!/process\.env/.test(text), file + ' reads the environment')
      for (const m of text.matchAll(/\brequire\(\s*'([^']+)'/g)) strictEqual(m[1], 'node:http', file)
    }
    ok(/res\.sendDate = false/.test(Fs.readFileSync(Path.join(dir, 'mock.ts'), 'utf8')), 'the mock sends a Date header')
  })
})
