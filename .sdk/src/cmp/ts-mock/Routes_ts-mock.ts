
import {
  entityCollection, isAuthActive, resolveAuthIn, resolveAuthName, resolveAuthPrefix, serverVariables,
} from '@voxgig/sdkgen'


type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

type Param = { wire: string, name: string, id?: boolean }

type Shape = { at: string[] } | { field: string } | { map: Record<string, string> }

type Fill = { at: string[], count?: boolean, value?: Json }

type Route = {
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

type Auth = { in: string, name: string, prefix: string }

type Note = { entity?: string, route?: string, note: string }

type Routes = {
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


const OPS = ['list', 'load', 'create', 'update', 'patch', 'remove']

const DEFAULT_PORT = 8080

const SEED_LIBRARY = '../../ts-seed/dist/index.js'

const LOOPBACK = ['localhost', '127.0.0.1', '::1', '0.0.0.0']

const PAGE_NAME = /^(?:page|pageno|pagenumber|pageindex|currentpage|(?:total|num|count)?pages|pagecount)$/

const SIZE_NAME = /size|limit|perpage|count|total|length/

const ROLES = ['total', 'more', 'cursor', 'next']


function isObject(v: any): boolean {
  return null != v && 'object' === typeof v && !Array.isArray(v)
}


function pointer(def: any, ref: string): any {
  if (!ref.startsWith('#/')) return undefined
  let at = def
  for (const part of ref.slice(2).split('/')) {
    if (!isObject(at)) return undefined
    at = at[part.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return at
}


// The keys below `root` in a transform such as `body.items`, or undefined.
function below(expr: any, root: string): string[] | undefined {
  const m = 'string' === typeof expr ? /^`([^`]+)`$/.exec(expr.trim()) : null
  if (null == m) return undefined
  const parts = m[1].split('.')
  return root === parts[0] && parts.every((p) => '' !== p) ? parts.slice(1) : undefined
}


// One plain schema: references followed, and the properties of allOf parts gathered.
function flat(schema: any, def: any, depth = 0): any {
  if (!isObject(schema) || 8 < depth) return { properties: {}, required: [] }
  if ('string' === typeof schema.$ref) return flat(pointer(def, schema.$ref), def, depth + 1)

  const out = { ...schema, properties: {}, required: [] as string[] }
  for (const part of Array.isArray(schema.allOf) ? schema.allOf : []) {
    const inner = flat(part, def, depth + 1)
    Object.assign(out.properties, inner.properties)
    out.required.push(...inner.required)
    if (undefined === out.type) out.type = inner.type
  }
  Object.assign(out.properties, isObject(schema.properties) ? schema.properties : {})
  out.required.push(...(Array.isArray(schema.required) ? schema.required : []))
  return out
}


function typeOf(schema: any): string | undefined {
  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => 'null' !== t) : schema.type
  if ('string' === typeof type) return type
  if (isObject(schema.properties) && 0 < Object.keys(schema.properties).length) return 'object'
  if (null != schema.items) return 'array'
  return undefined
}


function nullable(schema: any): boolean {
  return true === schema.nullable || (Array.isArray(schema.type) && schema.type.includes('null'))
}


function factsOf(resolved: any, point: any): any {
  if (null == resolved || 'function' !== typeof resolved.operation) return undefined
  try {
    const facts = resolved.operation(point.m, point.o)
    return 'http' === facts?.protocol ? facts : undefined
  }
  catch (err) {
    return undefined
  }
}


// The lowest success the definition declares, save that a create takes Created where it is declared.
function statusOf(facts: any, op: string): number | undefined {
  const codes = Object.keys(isObject(facts?.responses) ? facts.responses : {})
  const success = codes.filter((c) => /^2\d\d$/.test(c)).map(Number).sort((a, b) => a - b)
  if ('create' === op && success.includes(201)) return 201
  if (0 < success.length) return success[0]
  return codes.some((c) => /^2xx$/i.test(c)) ? 200 : undefined
}


function successSchema(facts: any, status: number): any {
  const responses = facts?.responses || {}
  const response = responses[String(status)] ?? responses['2XX'] ?? responses['2xx']
  const content = response?.content
  if (isObject(content)) {
    const type = Object.keys(content).find((t) => /json/i.test(t) || '*/*' === t)
    return null == type ? undefined : content[type]?.schema
  }
  return response?.schema
}


// An operation whose security is empty, or holds an entry that names no scheme, asks for no credential.
function isOpen(facts: any): boolean {
  const security = facts?.security
  return Array.isArray(security) &&
    (0 === security.length || security.some((req: any) => isObject(req) && 0 === Object.keys(req).length))
}


function paramsOf(point: any, idName: string | undefined): Param[] {
  const named = new Map<string, string>()
  for (const arg of point.g?.params || []) {
    if ('string' === typeof arg?.n) named.set('string' === typeof arg.or ? arg.or : arg.n, arg.n)
  }
  const renamed = isObject(point.r?.param) ? point.r.param : {}

  const out: Param[] = []
  for (const m of String(point.o).matchAll(/\{([^{}]+)\}/g)) {
    const wire = m[1]
    const name = named.get(wire) ??
      (Object.prototype.hasOwnProperty.call(renamed, wire) ? String(renamed[wire]) : wire)
    out.push({ wire, name, ...(undefined !== idName && name === idName ? { id: true } : {}) })
  }
  return out
}


function shapeOf(req: any, note: (text: string) => void): Shape {
  if (undefined === req) return { at: [] }

  const path = below(req, 'reqdata')
  if (undefined !== path && path.length < 2) return 0 === path.length ? { at: [] } : { field: path[0] }

  if (isObject(req)) {
    const keys = Object.keys(req)
    if (1 === keys.length && '`reqdata`' === req[keys[0]]) return { at: [keys[0]] }

    const map: Record<string, string> = {}
    const read = keys.every((key) => {
      const to = below(req[key], 'reqdata')
      if (undefined === to || 1 !== to.length) return false
      map[key] = to[0]
      return true
    })
    if (read && 0 < keys.length) return { map }
  }

  note('a request transform the mock does not read is taken as the record itself: ' + JSON.stringify(req))
  return { at: [] }
}


function filler(name: string, schema: any, def: any): { count?: boolean, value?: Json } {
  const s = flat(schema, def)
  if (undefined !== s.const) return { value: s.const }
  if (Array.isArray(s.enum) && 0 < s.enum.length) return { value: s.enum[0] }

  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const type = typeOf(s)
  if ('integer' === type || 'number' === type) {
    if (PAGE_NAME.test(key)) return { value: 1 }
    if (SIZE_NAME.test(key)) return { count: true }
    return { value: 'number' === typeof s.minimum ? s.minimum : 0 }
  }
  if (nullable(s)) return { value: null }
  if ('boolean' === type) return { value: false }
  if ('string' === type) return { value: '' }
  if ('array' === type) return { value: [] }
  if ('object' === type) return { value: {} }
  return { value: null }
}


// What a response holds beside its records: the page facts the model names, then each
// further property the definition makes required.
function fillsOf(schema: any, res: string[], page: any, def: any): Fill[] {
  const out: Fill[] = []
  if (0 === res.length) return out

  const roles = new Map<string, string>()
  for (const role of ROLES) {
    const at = below(page?.[role], 'body')
    if (undefined !== at && 0 < at.length) roles.set(at.join('.'), role)
  }

  const taken = new Set<string>([res.join('.')])
  const add = (at: string[], fill: { count?: boolean, value?: Json }) => {
    if (!taken.has(at.join('.'))) {
      taken.add(at.join('.'))
      out.push({ at, ...fill })
    }
  }
  for (const [key, role] of roles) {
    if ('total' === role) add(key.split('.'), { count: true })
    if ('more' === role) add(key.split('.'), { value: false })
  }

  const walk = (given: any, at: string[], depth: number): void => {
    const s = flat(given, def)
    for (const name of [...new Set<string>(s.required)]) {
      const here = [...at, name]
      const key = here.join('.')
      if (res.join('.').startsWith(key + '.')) {
        if (depth < 8) walk(s.properties[name], here, depth + 1)
        continue
      }
      const role = roles.get(key)
      add(here, undefined === role ? filler(name, s.properties[name], def) :
        'total' === role ? { count: true } :
          'more' === role ? { value: false } :
            { value: nullable(flat(s.properties[name], def)) ? null : '' })
    }
  }
  if (null != schema) walk(schema, [], 0)
  return out
}


function substituted(url: string, model: any): string {
  let out = url
  for (const v of serverVariables(model)) {
    if ('' !== v.dflt) out = out.split('{' + v.name + '}').join(v.dflt)
  }
  return out
}


// The port and path the definition's first server names. A server without a port of its own
// names no port the mock could take, so the default stands.
function addressOf(model: any): { port: number, prefix: string, server?: string, local: boolean } {
  const server = model?.main?.kit?.info?.servers?.[0]?.url
  if ('string' !== typeof server || '' === server.trim()) return { port: DEFAULT_PORT, prefix: '', local: false }

  const url = substituted(server.trim(), model)
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/.exec(url)
  const authority = null == m ? '' : m[2].replace(/^.*@/, '')
  const path = null == m ? url.replace(/[?#].*$/, '') : m[3]

  const hostport = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec(authority)
  const host = (hostport?.[1] ?? '').replace(/^\[|\]$/g, '').toLowerCase()
  const port = null == hostport?.[2] ? undefined : Number(hostport[2])

  return {
    port: undefined === port || 65535 < port ? DEFAULT_PORT : port,
    prefix: '/' === path ? '' : path.replace(/\/+$/, '').replace(/^(?=[^/])/, '/'),
    server,
    local: null != m && 'http' === m[1].toLowerCase() && LOOPBACK.includes(host) && undefined !== port,
  }
}


function authOf(model: any): Auth | null {
  if (!isAuthActive(model)) return null
  const where = resolveAuthIn(model)
  return {
    in: ['query', 'cookie'].includes(where) ? where : 'header',
    name: resolveAuthName(model),
    prefix: resolveAuthPrefix(model),
  }
}


function mockRoutes(model: any, resolved?: any): Routes {
  const coll = entityCollection(model)
  const names = Object.keys(coll)
    .filter((name) => null != coll[name] && false !== coll[name].active && '__proto__' !== name)
    .sort()

  const read = null != resolved && 'function' === typeof resolved.operation
  const notes: Note[] = []
  const routes: Route[] = []
  const served = new Map<string, string>()

  if (!read) {
    notes.push({
      note: 'built from the model alone: the API definition was not available to this build, ' +
        'so every success is 200',
    })
  }

  for (const entity of names) {
    const ent = coll[entity]
    const idName = 'string' === typeof ent.id?.name ? ent.id.name : undefined

    for (const op of OPS) {
      for (const point of ent.op?.[op]?.points || []) {
        if (null == point || false === point.a || 'string' !== typeof point.o) continue
        const key = String(point.m).toUpperCase() + ' ' + point.o
        const note = (text: string) => notes.push({ entity, route: key, note: text })

        if ('graphql' === point.k) {
          note('a GraphQL operation is not served')
          continue
        }
        if (served.has(key)) {
          note('also ' + served.get(key) + ', which is served')
          continue
        }
        served.set(key, entity + '.' + op)

        const facts = factsOf(resolved, point)
        if (read && undefined === facts) note('not in the definition, so its success is 200')
        const status = statusOf(facts, op) ?? 200

        const res = below(point.t?.res ?? '`body`', 'body')
        if (undefined === res) note('a response transform the mock does not read: the record is the whole body')
        const action = point.q?.$action

        routes.push({
          entity,
          op,
          ...('string' === typeof action && '' !== action ? { action } : {}),
          method: String(point.m).toUpperCase(),
          path: point.o.startsWith('/') ? point.o : '/' + point.o,
          params: paramsOf(point, idName),
          status,
          res: res ?? [],
          fill: fillsOf(successSchema(facts, status), res ?? [], point.t?.page, resolved?.def),
          req: shapeOf(point.t?.req, note),
          ...(isOpen(facts) ? { open: true } : {}),
        })
      }
    }
  }

  return {
    version: 1,
    api: String(model?.name ?? ''),
    source: read ? 'definition' : 'model',
    seed: SEED_LIBRARY,
    ...addressOf(model),
    auth: authOf(model),
    routes,
    notes,
  }
}


export type {
  Json, Param, Shape, Fill, Route, Auth, Note, Routes,
}

export {
  mockRoutes,
}
