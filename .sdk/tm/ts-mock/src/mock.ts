
// Declared here so that the mock needs no type package to compile.
declare const require: (id: string) => any


export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export type Row = { [field: string]: Json }

export type Param = { wire: string, name: string, id?: boolean }

export type Shape = { at: string[] } | { field: string } | { map: { [wire: string]: string } }

export type Fill = { at: string[], count?: boolean, value?: Json }

export type Route = {
  entity: string
  op: string
  action?: string
  method: string
  path: string
  params: Param[]
  status: number
  res: string[]
  fill: Fill[]
  req: Shape
  open?: boolean
}

export type Auth = { in: string, name: string, prefix: string }

export type Note = { entity?: string, route?: string, note: string }

export type Routes = {
  version: 1
  api: string
  source: 'definition' | 'model'
  seed: string
  port: number
  prefix: string
  server?: string
  local: boolean
  auth: Auth | null
  routes: Route[]
  notes: Note[]
}

export type SeedOptions = {
  seed?: number | string
  count?: number
  counts?: { [entity: string]: number }
}

export type MockOptions = SeedOptions & { token?: string }

type SpecLike = { t: string, fields?: FieldLike[], items?: SpecLike }

type FieldLike = { n: string, r: boolean, s: SpecLike, ro?: boolean, wo?: boolean }

type EntityLike = {
  name: string
  id?: { field: string }
  parents: { entity: string, param: string, field?: string }[]
  fields: FieldLike[]
}

export type SeedLike = {
  seed: string
  plan: { entity: { [name: string]: EntityLike } }
  entities(): string[]
  count(entity: string): number
  id(entity: string, n: number): string | number | null
  parents(entity: string, n: number): { [param: string]: string | number }
  record(entity: string, n: number): Row
}

export type SeedLibrary = { makeSeed(options?: SeedOptions): SeedLike }

export type Query = { [name: string]: string | string[] }

export type Recorded = {
  seq: number
  method: string
  path: string
  query: Query
  status: number
  entity: string | null
  op: string | null
}

export type Req = {
  method?: string
  url?: string
  headers: { [name: string]: string | string[] | undefined }
  setEncoding(encoding: string): unknown
  on(event: string, listener: (...args: any[]) => void): unknown
}

export type Res = {
  statusCode: number
  sendDate: boolean
  setHeader(name: string, value: string): unknown
  end(body?: string): unknown
}

export type Listening = { url: string, host: string, port: number, close(): Promise<void> }

export type Mock = {
  routes: Routes
  handler(req: Req, res: Res): void
  listen(port?: number, host?: string): Promise<Listening>
  reset(options?: SeedOptions): void
  requests(): Recorded[]
  records(entity: string): Row[]
}


type Server = {
  listen(port: number, host: string, ready: () => void): unknown
  once(event: string, listener: (err: Error) => void): unknown
  removeListener(event: string, listener: (err: Error) => void): unknown
  address(): { port: number } | string | null
  close(done: () => void): unknown
  closeAllConnections?(): void
}

type Seg = { lit: string } | { re: RegExp, names: string[] }

type Entry = { id: string | number | null, parents: { [param: string]: string | number }, record: Row }

type Want = { id?: string, parents: { param: string, value: string }[] }

type Answer = { status: number, body?: Json, headers?: { [name: string]: string } }


const HOST = '127.0.0.1'

const MAX_BODY = 1048576

const MAX_RECORDED = 10000

const REDACTED = '[redacted]'

const BODYLESS = [204, 205, 304]

const CONTROL = ['__health', '__reset', '__requests']


function own(map: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key)
}


// A key such as __proto__ is data here, so it is defined, never assigned.
function put<T>(row: { [key: string]: T }, key: string, value: T): void {
  Object.defineProperty(row, key, {
    value, enumerable: true, writable: true, configurable: true,
  })
}


function isRow(value: unknown): value is Row {
  return null != value && 'object' === typeof value && !Array.isArray(value)
}


function copy(value: Json): Json {
  if (Array.isArray(value)) return value.map(copy)
  if (!isRow(value)) return value
  const out: Row = {}
  for (const key of Object.keys(value)) put(out, key, copy(value[key]))
  return out
}


function fail(code: string, message: string): Row {
  return { code, message }
}


function decode(text: string): string {
  try {
    return decodeURIComponent(text)
  }
  catch (err) {
    return text
  }
}


function segments(path: string): Seg[] {
  return path.split('/').filter((part) => '' !== part).map((part): Seg => {
    if (!part.includes('{')) return { lit: part }
    const names: string[] = []
    const source = part.split(/(\{[^{}]+\})/).map((bit) => {
      const m = /^\{([^{}]+)\}$/.exec(bit)
      if (null == m) return bit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      names.push(m[1])
      return '([^/]+?)'
    }).join('')
    return { re: new RegExp('^' + source + '$'), names }
  })
}


function matches(segs: Seg[], parts: string[], into: { [name: string]: string }): boolean {
  if (segs.length !== parts.length) return false
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    if ('lit' in seg) {
      if (seg.lit !== parts[i]) return false
      continue
    }
    const m = seg.re.exec(parts[i])
    if (null == m) return false
    seg.names.forEach((name, j) => put(into, name, m[j + 1]))
  }
  return true
}


function split(url: string): { parts: string[], path: string, query: Query } {
  const at = url.indexOf('?')
  const path = (at < 0 ? url : url.slice(0, at)).replace(/#.*$/, '')
  const query: Query = {}
  for (const pair of (at < 0 ? '' : url.slice(at + 1).replace(/#.*$/, '')).split('&')) {
    if ('' === pair) continue
    const eq = pair.indexOf('=')
    const key = decode((eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, ' '))
    const value = eq < 0 ? '' : decode(pair.slice(eq + 1).replace(/\+/g, ' '))
    put(query, key, own(query, key) ? ([] as string[]).concat(query[key], value) : value)
  }
  return { parts: path.split('/').filter((part) => '' !== part).map(decode), path, query }
}


function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}


function cookie(header: string | undefined, name: string): string | undefined {
  for (const pair of String(header ?? '').split(';')) {
    const eq = pair.indexOf('=')
    if (0 < eq && pair.slice(0, eq).trim() === name) return decode(pair.slice(eq + 1).trim())
  }
  return undefined
}


function getAt(value: Json, at: string[]): Json | undefined {
  let here: Json | undefined = value
  for (const key of at) here = isRow(here) && own(here, key) ? here[key] : undefined
  return here
}


function setAt(row: Row, at: string[], value: Json): void {
  let here = row
  at.slice(0, -1).forEach((key) => {
    if (!isRow(here[key])) put(here, key, {})
    here = here[key] as Row
  })
  put(here, at[at.length - 1], value)
}


// A query value names a field's value as text, whatever the field's type.
function same(value: Json | undefined, wanted: string): boolean {
  if (undefined === value) return false
  return wanted === (isRow(value) || Array.isArray(value) ? JSON.stringify(value) : String(value))
}


function held(value: Json | undefined, key: string): Json | undefined {
  return isRow(value) && own(value, key) ? value[key] : undefined
}


// What a body may set, at any depth: a read-only value it sends is dropped, and the one held stays.
function writable(value: Json, kept: Json | undefined, spec: SpecLike): Json {
  if ('object' === spec.t && undefined !== spec.fields && isRow(value)) {
    const out: Row = {}
    for (const key of Object.keys(value)) {
      const field = spec.fields.find((f) => f.n === key)
      if (true === field?.ro) continue
      put(out, key, undefined === field ? value[key] : writable(value[key], held(kept, key), field.s))
    }
    for (const f of spec.fields) {
      const stays = held(kept, f.n)
      if (true === f.ro && undefined !== stays) put(out, f.n, copy(stays))
    }
    return out
  }
  if ('array' === spec.t && undefined !== spec.items && Array.isArray(value)) {
    const items = spec.items
    return value.map((item, i) => writable(item, Array.isArray(kept) ? kept[i] : undefined, items))
  }
  return value
}


export function makeMockFor(routes: Routes, library: SeedLibrary, options: MockOptions = {}): Mock {
  const Http: { createServer(handler: (req: Req, res: Res) => void): Server } = require('node:http')

  const table = routes.routes
    .map((route, index) => ({ route, index, segs: segments(route.path) }))
    .map((r) => ({ ...r, lits: r.segs.filter((seg) => 'lit' in seg).length }))
    .sort((a, b) => b.lits - a.lits || a.index - b.index)
  const prefix = segments(routes.prefix)

  let seed: SeedLike
  let store: { [entity: string]: Entry[] } = {}
  let next: { [entity: string]: number } = {}
  let log: Recorded[] = []
  let seq = 0

  const reset = (over: SeedOptions = {}): void => {
    const made = library.makeSeed({
      seed: over.seed ?? options.seed,
      count: over.count ?? options.count,
      counts: over.counts ?? options.counts,
    })
    for (const route of routes.routes) {
      if (!own(made.plan.entity, route.entity)) {
        throw new Error('ts-mock: the seed library has no entity ' + route.entity +
          ': generate ts-seed and ts-mock from the same model, then build both')
      }
    }
    const fresh: { [entity: string]: Entry[] } = {}
    const after: { [entity: string]: number } = {}
    for (const name of made.entities()) {
      const entries: Entry[] = []
      const size = made.count(name)
      for (let n = 1; n <= size; n++) {
        entries.push({ id: made.id(name, n), parents: made.parents(name, n), record: made.record(name, n) })
      }
      put(fresh, name, entries)
      put(after, name, size + 1)
    }
    seed = made
    store = fresh
    next = after
    log = []
    seq = 0
  }

  const entityOf = (name: string): EntityLike => seed.plan.entity[name]

  const strip = (value: Json, fields: FieldLike[]): Json => {
    if (!isRow(value)) return copy(value)
    const out: Row = {}
    for (const key of Object.keys(value)) {
      const field = fields.find((f) => f.n === key)
      if (true === field?.wo) continue
      put(out, key, undefined === field ? copy(value[key]) : inner(value[key], field.s))
    }
    return out
  }

  const inner = (value: Json, spec: SpecLike): Json =>
    'object' === spec.t && undefined !== spec.fields ? strip(value, spec.fields) :
      'array' === spec.t && undefined !== spec.items && Array.isArray(value) ?
        value.map((item) => inner(item, spec.items as SpecLike)) : copy(value)

  const view = (entity: string, record: Row): Json => strip(record, entityOf(entity).fields)

  const wrap = (route: Route, value: Json, count: number): Json => {
    if (0 === route.res.length) return value
    const body: Row = {}
    setAt(body, route.res, value)
    for (const fill of route.fill) setAt(body, fill.at, true === fill.count ? count : copy(fill.value ?? null))
    return body
  }

  const wantOf = (route: Route, values: { [wire: string]: string }): Want => {
    const ent = entityOf(route.entity)
    const want: Want = { parents: [] }
    for (const p of route.params) {
      if (true === p.id) want.id = values[p.wire]
      else if (ent.parents.some((x) => x.param === p.name)) want.parents.push({ param: p.name, value: values[p.wire] })
    }
    return want
  }

  const fits = (entry: Entry, want: Want): boolean =>
    (undefined === want.id || String(entry.id) === want.id) &&
    want.parents.every((w) => own(entry.parents, w.param) && String(entry.parents[w.param]) === w.value)

  // The parent a path names, held to the grandparents the same path names.
  const parentOf = (entity: string, want: Want, w: { param: string, value: string }): Entry | undefined => {
    const link = entityOf(entity).parents.find((x) => x.param === w.param)
    if (undefined === link || !own(store, link.entity)) return undefined
    const up = entityOf(link.entity)
    const others = want.parents.filter((o) => o !== w && up.parents.some((x) => x.param === o.param))
    return store[link.entity].find((e) => String(e.id) === w.value &&
      others.every((o) => own(e.parents, o.param) && String(e.parents[o.param]) === o.value))
  }

  const missingParent = (entity: string, want: Want): string | undefined => {
    for (const w of want.parents) {
      const link = entityOf(entity).parents.find((x) => x.param === w.param)
      if (undefined !== link && own(store, link.entity) && undefined === parentOf(entity, want, w)) {
        return 'no ' + link.entity + ' ' + w.value
      }
    }
    return undefined
  }

  const unshape = (shape: Shape, body: Json): Row | undefined => {
    if ('field' in shape) return { [shape.field]: body }
    if ('map' in shape) {
      if (!isRow(body)) return undefined
      const out: Row = {}
      for (const wire of Object.keys(shape.map)) if (own(body, wire)) put(out, shape.map[wire], body[wire])
      return out
    }
    const at = getAt(body, shape.at)
    return isRow(at) ? at : undefined
  }

  const typedId = (entity: string, text: string): string | number => {
    const held = (store[entity] ?? []).find((e) => String(e.id) === text)
    if (undefined !== held && null !== held.id) return held.id
    return 'number' === typeof seed.id(entity, 1) && /^-?\d+$/.test(text) ? Number(text) : text
  }

  const create = (route: Route, want: Want, given: Row): Answer => {
    const ent = entityOf(route.entity)
    const entries = store[route.entity]
    if (undefined !== want.id && entries.some((e) => String(e.id) === want.id)) {
      return { status: 409, body: fail('conflict', route.entity + ' ' + want.id + ' already exists') }
    }

    const n = next[route.entity]
    put(next, route.entity, n + 1)
    const seeded = seed.record(route.entity, n)
    const id = undefined === want.id ? seed.id(route.entity, n) : typedId(route.entity, want.id)
    const known = new Set(ent.fields.map((f) => f.n))

    const record: Row = {}
    for (const f of ent.fields) {
      if (undefined !== ent.id && f.n === ent.id.field && null !== id) put(record, f.n, id)
      else if (own(given, f.n) && true !== f.ro) put(record, f.n, writable(given[f.n], held(seeded, f.n), f.s))
      else if ((f.r || true === f.ro) && own(seeded, f.n)) put(record, f.n, seeded[f.n])
    }
    for (const key of Object.keys(given)) if (!known.has(key)) put(record, key, given[key])

    const parents: { [param: string]: string | number } = {}
    const seededParents = seed.parents(route.entity, n)
    for (const link of ent.parents) {
      const fromPath = want.parents.find((w) => w.param === link.param)
      const value = undefined !== fromPath ? typedId(link.entity, fromPath.value) :
        undefined !== link.field && own(given, link.field) && ['string', 'number'].includes(typeof given[link.field]) ?
          given[link.field] as string | number : seededParents[link.param]
      if (undefined === value) continue
      put(parents, link.param, value)
      if (undefined !== link.field) put(record, link.field, value)
    }

    entries.push({ id, parents, record })
    return { status: route.status, body: view(route.entity, record) }
  }

  const merge = (route: Route, entry: Entry, want: Want, given: Row): void => {
    const ent = entityOf(route.entity)
    const readOnly = new Set(ent.fields.filter((f) => true === f.ro).map((f) => f.n))
    for (const key of Object.keys(given)) {
      if ((undefined !== ent.id && key === ent.id.field) || readOnly.has(key)) continue
      const field = ent.fields.find((f) => f.n === key)
      put(entry.record, key, undefined === field ? given[key] : writable(given[key], held(entry.record, key), field.s))
    }
    for (const link of ent.parents) {
      if (undefined === link.field) continue
      if (want.parents.some((w) => w.param === link.param)) put(entry.record, link.field, entry.parents[link.param])
      else if (['string', 'number'].includes(typeof entry.record[link.field])) {
        put(entry.parents, link.param, entry.record[link.field] as string | number)
      }
    }
  }

  const serveRoute = (route: Route, values: { [wire: string]: string }, query: Query, text: string): Answer => {
    const want = wantOf(route, values)
    const missing = missingParent(route.entity, want)
    if (undefined !== missing) return { status: 404, body: fail('not_found', missing) }

    const entries = store[route.entity]
    const absent: Answer = {
      status: 404,
      body: fail('not_found', 'no ' + route.entity + (undefined === want.id ? '' : ' ' + want.id) +
        want.parents.map((w) => ' under ' + w.param + ' ' + w.value).join('')),
    }

    // An action's effect is not in the definition, so the record it names is answered as it is.
    if (undefined !== route.action) {
      if (undefined === want.id) return { status: route.status, body: wrap(route, {}, 0) }
      const named = entries.find((e) => fits(e, want))
      return undefined === named ? absent : { status: route.status, body: wrap(route, view(route.entity, named.record), 1) }
    }

    if ('list' === route.op) {
      const fields = new Set(entityOf(route.entity).fields.map((f) => f.n))
      const credential = null != routes.auth && 'query' === routes.auth.in ? routes.auth.name : undefined
      const keys = Object.keys(query).filter((key) => fields.has(key) && key !== credential)
      const listed = entries.filter((e) => fits(e, want) &&
        keys.every((key) => ([] as string[]).concat(query[key]).some((v) => same(e.record[key], v))))
      return { status: route.status, body: wrap(route, listed.map((e) => view(route.entity, e.record)), listed.length) }
    }

    let given: Row = {}
    if ('create' === route.op || 'update' === route.op || 'patch' === route.op) {
      let body: Json = {}
      if ('' !== text.trim()) {
        try {
          body = JSON.parse(text)
        }
        catch (err) {
          return { status: 400, body: fail('bad_request', 'the body is not JSON') }
        }
      }
      const unwrapped = unshape(route.req, body)
      if (undefined === unwrapped) return { status: 400, body: fail('bad_request', 'the body holds no record') }
      given = unwrapped
    }

    if ('create' === route.op) {
      const made = create(route, want, given)
      return made.status < 300 ? { ...made, body: wrap(route, made.body as Json, 1) } : made
    }

    const at = entries.findIndex((e) => fits(e, want))
    if (at < 0) return absent
    const entry = entries[at]

    if ('update' === route.op || 'patch' === route.op) merge(route, entry, want, given)
    if ('remove' === route.op) entries.splice(at, 1)
    return { status: route.status, body: wrap(route, view(route.entity, entry.record), 1) }
  }

  const credential = (req: Req, query: Query): string | undefined => {
    const auth = routes.auth as Auth
    const raw = 'query' === auth.in ? first(own(query, auth.name) ? query[auth.name] : undefined) :
      'cookie' === auth.in ? cookie(first(req.headers.cookie), auth.name) :
        first(req.headers[auth.name.toLowerCase()])
    let token = String(raw ?? '').trim()
    if ('header' === auth.in && '' !== auth.prefix) {
      const lead = auth.prefix.toLowerCase() + ' '
      token = token.toLowerCase().startsWith(lead) ? token.slice(lead.length).trim() : ''
    }
    return '' === token ? undefined : token
  }

  const denied = (req: Req, query: Query): Answer | undefined => {
    const auth = routes.auth
    if (null == auth) return undefined
    const token = credential(req, query)
    const challenge = 'header' === auth.in && '' !== auth.prefix ? { 'www-authenticate': auth.prefix } : undefined
    if (undefined === token) {
      return {
        status: 401, headers: challenge,
        body: fail('unauthorized', 'no credential: the API takes one in the ' + auth.name + ' ' + auth.in),
      }
    }
    if (undefined !== options.token && token !== options.token) {
      return { status: 401, headers: challenge, body: fail('unauthorized', 'the credential is not the one the mock was given') }
    }
    return undefined
  }

  const health = (): Row => {
    const entities: Row = {}
    for (const name of Object.keys(store).sort()) put(entities, name, store[name].length)
    return { ok: true, api: routes.api, seed: seed.seed, entities }
  }

  const control = (name: string, method: string, text: string): Answer => {
    const wants = '__reset' === name ? 'POST' : 'GET'
    if (method !== wants) {
      return { status: 405, headers: { allow: wants }, body: fail('method_not_allowed', name + ' takes ' + wants) }
    }
    if ('__health' === name) return { status: 200, body: health() }
    if ('__requests' === name) return { status: 200, body: log.map((r) => ({ ...r, query: copy(r.query) as Query })) }

    let body: Json = {}
    try {
      body = '' === text.trim() ? {} : JSON.parse(text)
    }
    catch (err) {
      return { status: 400, body: fail('bad_request', 'the body is not JSON') }
    }
    if (!isRow(body)) return { status: 400, body: fail('bad_request', 'the body is not an object') }
    const seedOf = body.seed
    if (undefined !== seedOf && 'string' !== typeof seedOf && 'number' !== typeof seedOf) {
      return { status: 400, body: fail('bad_request', 'seed is text or a number') }
    }
    try {
      reset({
        ...(undefined === seedOf ? {} : { seed: seedOf }),
        ...(undefined === body.count ? {} : { count: body.count as number }),
        ...(undefined === body.counts ? {} : { counts: body.counts as { [entity: string]: number } }),
      })
    }
    catch (err) {
      return { status: 400, body: fail('bad_request', String((err as Error).message)) }
    }
    return { status: 200, body: health() }
  }

  const send = (res: Res, answer: Answer): void => {
    res.statusCode = answer.status
    res.sendDate = false
    for (const name of Object.keys(answer.headers ?? {})) res.setHeader(name, (answer.headers as Row)[name] as string)
    if (undefined === answer.body || BODYLESS.includes(answer.status)) {
      res.end()
      return
    }
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(answer.body))
  }

  const serve = (req: Req, text: string | undefined): { answer: Answer, route?: Route, record: boolean } => {
    const method = String(req.method ?? 'GET').toUpperCase()
    const { parts, query } = split(String(req.url ?? '/'))

    const values: { [name: string]: string } = {}
    const under = matches(prefix, parts.slice(0, prefix.length), values) ? parts.slice(prefix.length) : undefined
    for (const rest of [parts, under]) {
      if (undefined !== rest && 1 === rest.length && CONTROL.includes(rest[0])) {
        const answer = undefined === text ? { status: 413, body: fail('payload_too_large', 'the body is too large') } :
          control(rest[0], method, text)
        return { answer, record: false }
      }
    }
    if (undefined === text) return { answer: { status: 413, body: fail('payload_too_large', 'the body is too large') }, record: true }

    const allow: string[] = []
    for (const row of undefined === under ? [] : table) {
      const caught: { [wire: string]: string } = {}
      if (!matches(row.segs, under as string[], caught)) continue
      if (row.route.method !== method) {
        if (!allow.includes(row.route.method)) allow.push(row.route.method)
        continue
      }
      if (true !== row.route.open) {
        const refused = denied(req, query)
        if (undefined !== refused) return { answer: refused, route: row.route, record: true }
      }
      return { answer: serveRoute(row.route, caught, query, text), route: row.route, record: true }
    }

    const answer: Answer = 0 < allow.length ?
      { status: 405, headers: { allow: allow.join(', ') }, body: fail('method_not_allowed', method + ' is not served here') } :
      { status: 404, body: fail('not_found', 'no route for ' + method + ' ' + String(req.url ?? '/').replace(/\?.*$/, '')) }
    return { answer, record: true }
  }

  const redacted = (query: Query): Query => {
    const out = copy(query) as Query
    if (null != routes.auth && 'query' === routes.auth.in && own(out, routes.auth.name)) put(out, routes.auth.name, REDACTED)
    return out
  }

  const handler = (req: Req, res: Res): void => {
    let text = ''
    let over = false
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      if (over) return
      text += chunk
      if (MAX_BODY < text.length) over = true
    })
    req.on('end', () => {
      let out: { answer: Answer, route?: Route, record: boolean }
      try {
        out = serve(req, over ? undefined : text)
      }
      catch (err) {
        out = { answer: { status: 500, body: fail('internal', String((err as Error)?.message ?? err)) }, record: true }
      }
      if (out.record) {
        const { path, query } = split(String(req.url ?? '/'))
        seq += 1
        log.push({
          seq,
          method: String(req.method ?? 'GET').toUpperCase(),
          path,
          query: redacted(query),
          status: out.answer.status,
          entity: out.route?.entity ?? null,
          op: out.route?.op ?? null,
        })
        if (MAX_RECORDED < log.length) log.shift()
      }
      send(res, out.answer)
    })
  }

  const listen = (port?: number, host?: string): Promise<Listening> => new Promise((resolve, reject) => {
    const server = Http.createServer(handler)
    const where = host ?? HOST
    server.once('error', reject)
    server.listen(port ?? routes.port, where, () => {
      server.removeListener('error', reject)
      const bound = server.address()
      const at = null != bound && 'object' === typeof bound ? bound.port : Number(port ?? routes.port)
      resolve({
        url: 'http://' + (where.includes(':') ? '[' + where + ']' : where) + ':' + at + routes.prefix,
        host: where,
        port: at,
        close: () => new Promise<void>((done) => {
          server.close(() => done())
          server.closeAllConnections?.()
        }),
      })
    })
  })

  reset()

  return {
    routes,
    handler,
    listen,
    reset: (over?: SeedOptions) => reset(over),
    requests: () => log.map((r) => ({ ...r, query: copy(r.query) as Query })),
    records: (entity: string) => (own(store, entity) ? store[entity] : []).map((e) => view(entity, e.record) as Row),
  }
}
