
import {
  entityCollection, entityDataIdField, canonScalarKey,
} from '@voxgig/sdkgen'

import { compilePattern } from './Pattern_ts-seed'

import type { PatNode } from './Pattern_ts-seed'


type Spec = {
  t: string
  fo?: string
  min?: number
  max?: number
  xmin?: boolean
  xmax?: boolean
  step?: number
  re?: string
  pat?: PatNode[]
  values?: any
  value?: any
  items?: Spec
  unique?: boolean
  fields?: Field[]
  entity?: string
}

type Field = { n: string, r: boolean, s: Spec, ro?: boolean, wo?: boolean }

type Parent = { entity: string, param: string, field?: string }

type IdPlan = {
  field: string
  as: 'text' | 'integer' | 'uuid' | 'spec'
  lead?: string
  width?: number
  base?: number
  step?: number
}

type EntityPlan = {
  name: string
  source: 'definition' | 'model'
  schema?: string
  id?: IdPlan
  parents: Parent[]
  fields: Field[]
}

type Note = { entity?: string, field?: string, note: string }

type Plan = {
  version: 1
  api: string
  source: 'definition' | 'model' | 'mixed'
  seed: string
  count: number
  entity: Record<string, EntityPlan>
  notes: Note[]
}

type Walk = { def: any, entity: string, path: string[], seen: Set<any>, notes: Note[] }


const MAX_DEPTH = 8

const MAX_FLATTEN = 16

const RECORD_OPS = ['load', 'list', 'create', 'update', 'patch']

const ID_WIDTH = 4

const SCHEMA_SLOTS = ['properties', 'items', 'additionalProperties', 'allOf', 'oneOf', 'anyOf']

const TIGHTEST_MIN = ['minimum', 'minLength', 'minItems', 'minProperties']

const TIGHTEST_MAX = ['maximum', 'maxLength', 'maxItems', 'maxProperties']

const EMPTY_LIST: Spec = { t: 'array', items: { t: 'any' }, min: 0, max: 0 }

const MODEL_TYPES: Record<string, Spec> = {
  STRING: { t: 'string' },
  NUMBER: { t: 'number' },
  INTEGER: { t: 'integer' },
  BOOLEAN: { t: 'boolean' },
  NULL: { t: 'null' },
  OBJECT: { t: 'object', fields: [] },
  MAP: { t: 'object', fields: [] },
  ARRAY: EMPTY_LIST,
  LIST: EMPTY_LIST,
}


function isNumber(v: any): v is number {
  return 'number' === typeof v && Number.isFinite(v)
}


function isCount(v: any): v is number {
  return Number.isInteger(v) && 0 <= v
}


function gcd(a: number, b: number): number {
  return 0 === b ? a : gcd(b, a % b)
}


// The least whole number that is a multiple of `step`, where its decimals are few enough to find it.
function wholeStep(step: number): number | undefined {
  for (let places = 1; places <= 1e6; places *= 10) {
    const scaled = Math.round(step * places)
    if (0 < scaled && Math.abs(step * places - scaled) < 1e-9 * scaled) return scaled / gcd(scaled, places)
  }
  return undefined
}


function tokens(name: string): string[] {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
    .split(/[^a-z0-9]+/).filter((t) => '' !== t)
}


function note(walk: Walk, text: string): void {
  const field = walk.path.join('.')
  const made: Note = { entity: walk.entity, ...('' === field ? {} : { field }), note: text }
  if (!walk.notes.some((n) => JSON.stringify(n) === JSON.stringify(made))) walk.notes.push(made)
}


function pointer(def: any, ref: string): any {
  if (!ref.startsWith('#/')) return undefined
  let at = def
  for (const part of ref.slice(2).split('/')) {
    if (null == at || 'object' !== typeof at) return undefined
    at = at[part.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return at
}


function isCut(value: any): boolean {
  return 'string' === typeof value && value.startsWith('[Circular ')
}


// apidef leaves a marker where a schema holds itself. The schema it stands in
// is found again by the reference its holder still names.
function whole(schema: any, walk: Walk): any {
  if (null == schema || 'object' !== typeof schema || Array.isArray(schema)) return undefined
  if (!SCHEMA_SLOTS.some((slot) => isCut(schema[slot]))) return schema

  const ref = schema['x-ref']
  const target = 'string' === typeof ref ? pointer(walk.def, ref) : undefined
  if (null == target || SCHEMA_SLOTS.some((slot) => isCut(target[slot]))) return undefined
  return { ...target, 'x-ref': ref }
}


function typeOf(schema: any): string | undefined {
  const type = Array.isArray(schema.type) ?
    (schema.type.find((t: string) => 'null' !== t) ?? 'null') : schema.type
  if ('string' === typeof type) return type
  if (null != schema.properties || null != schema.additionalProperties) return 'object'
  if (null != schema.items) return 'array'
  if (null != schema.pattern || null != schema.minLength || null != schema.maxLength) return 'string'
  if (null != schema.minimum || null != schema.maximum || null != schema.multipleOf) return 'number'
  return undefined
}


function merge(a: any, b: any): any {
  const out: any = { ...a, ...b }

  if (null != a.properties || null != b.properties) {
    out.properties = { ...(a.properties || {}), ...(b.properties || {}) }
  }
  if (Array.isArray(a.required) || Array.isArray(b.required)) {
    out.required = [...new Set([...(a.required || []), ...(b.required || [])])]
  }
  for (const key of TIGHTEST_MIN) {
    if (isNumber(a[key]) && isNumber(b[key])) out[key] = Math.max(a[key], b[key])
  }
  for (const key of TIGHTEST_MAX) {
    if (isNumber(a[key]) && isNumber(b[key])) out[key] = Math.min(a[key], b[key])
  }
  if (Array.isArray(a.enum) && Array.isArray(b.enum)) {
    out.enum = a.enum.filter((v: any) =>
      b.enum.some((w: any) => JSON.stringify(v) === JSON.stringify(w)))
  }
  return out
}


// One plain schema for a value: an allOf's parts merged, and the first branch
// of a union that is not null.
function flatten(given: any, walk: Walk, depth = 0): any {
  const schema = whole(given, walk)
  if (undefined === schema || MAX_FLATTEN < depth) return {}

  if ('string' === typeof schema.$ref) {
    const target = pointer(walk.def, schema.$ref)
    if (null == target) note(walk, 'a reference the definition does not hold: ' + schema.$ref)
    return flatten(target, walk, depth + 1)
  }

  const own: any = { ...schema }
  delete own.allOf
  delete own.oneOf
  delete own.anyOf

  // Parts in the order written, then what the schema says for itself, which wins.
  let out: any = {}
  for (const part of Array.isArray(schema.allOf) ? schema.allOf : []) {
    out = merge(out, flatten(part, walk, depth + 1))
  }

  const union = Array.isArray(schema.oneOf) ? schema.oneOf :
    Array.isArray(schema.anyOf) ? schema.anyOf : []
  const branches = union.map((part: any) => flatten(part, walk, depth + 1))
    .filter((part: any) => 'null' !== typeOf(part))
  if (1 < branches.length) note(walk, 'the first of ' + branches.length + ' alternatives is used')
  if (0 < branches.length) {
    out = merge(out, branches[0])
    const tag = schema.discriminator?.propertyName
    if ('string' === typeof tag && null != out.properties?.[tag]) {
      const ref = String(branches[0]['x-ref'] || '')
      const mapped = Object.entries(schema.discriminator.mapping || {})
        .find(([, to]) => to === ref)
      const value = mapped ? mapped[0] : ref.replace(/^.*\//, '')
      if ('' !== value) out.properties = { ...out.properties, [tag]: { const: value } }
    }
  }

  // A part's name is not this schema's.
  delete out['x-ref']
  return merge(out, own)
}


function stringSpec(schema: any, walk: Walk): Spec {
  const out: Spec = { t: 'string' }
  if ('string' === typeof schema.format) out.fo = schema.format
  if (isCount(schema.minLength)) out.min = schema.minLength
  if (isCount(schema.maxLength)) out.max = schema.maxLength

  if ('string' === typeof schema.pattern) {
    let reads = true
    try {
      new RegExp(schema.pattern)
    }
    catch (err) {
      reads = false
    }

    if (!reads) {
      note(walk, 'a pattern this runtime cannot read is left out: ' + schema.pattern)
    }
    else {
      out.re = schema.pattern
      const pat = compilePattern(schema.pattern)
      if (null != pat) out.pat = pat
      else note(walk, 'values are tried against a pattern too rich to build from: ' + schema.pattern)
    }
  }
  return out
}


function numberSpec(schema: any, type: string): Spec {
  const out: Spec = { t: type }
  if (isNumber(schema.minimum)) out.min = schema.minimum
  if (isNumber(schema.maximum)) out.max = schema.maximum

  if (true === schema.exclusiveMinimum) {
    out.xmin = true
  }
  else if (isNumber(schema.exclusiveMinimum) && (undefined === out.min || out.min <= schema.exclusiveMinimum)) {
    out.min = schema.exclusiveMinimum
    out.xmin = true
  }

  if (true === schema.exclusiveMaximum) {
    out.xmax = true
  }
  else if (isNumber(schema.exclusiveMaximum) && (undefined === out.max || schema.exclusiveMaximum <= out.max)) {
    out.max = schema.exclusiveMaximum
    out.xmax = true
  }

  if (isNumber(schema.multipleOf) && 0 < schema.multipleOf) {
    out.step = 'integer' === type ? wholeStep(schema.multipleOf) ?? schema.multipleOf : schema.multipleOf
  }
  return out
}


function fieldsOf(schema: any, walk: Walk): Field[] {
  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
  const fields: Field[] = []

  for (const name of Object.keys(schema.properties || {})) {
    const prop = schema.properties[name]
    const inner = { ...walk, path: [...walk.path, name] }
    const spec = specOf(prop, inner)

    const flat = flatten(prop, inner)
    const list = undefined === spec && 'array' === typeOf(flat)

    if (undefined === spec && !list) {
      if (required.has(name)) note(inner, 'a required field that holds its own kind is left out')
      continue
    }
    if (list && 0 < (flat.minItems ?? 0)) note(inner, 'a list of its own kind is left empty')

    fields.push({
      n: name,
      r: required.has(name),
      s: spec ?? { ...EMPTY_LIST },
      ...(true === flat.readOnly ? { ro: true } : {}),
      ...(true === flat.writeOnly ? { wo: true } : {}),
    })
  }
  return fields
}


// Undefined where the schema holds itself, so that the caller can leave the value out.
function specOf(raw: any, walk: Walk): Spec | undefined {
  if (isCut(raw)) return undefined
  if (null == raw || 'object' !== typeof raw) return { t: 'any' }

  // Each use of a reference is an object of its own, so the name is what repeats.
  const key = 'string' === typeof raw['x-ref'] ? raw['x-ref'] : raw
  if (walk.seen.has(key) || MAX_DEPTH < walk.seen.size) return undefined
  if (undefined === whole(raw, walk)) return undefined

  walk.seen.add(key)
  try {
    const schema = flatten(raw, walk)

    if (undefined !== schema.const) return { t: 'const', value: schema.const }
    if (Array.isArray(schema.enum) && 0 < schema.enum.length) {
      const values = schema.enum.filter((v: any) => null !== v)
      return { t: 'enum', values: 0 < values.length ? values : schema.enum }
    }

    const type = typeOf(schema)

    if ('string' === type) return stringSpec(schema, walk)
    if ('integer' === type || 'number' === type) return numberSpec(schema, type)
    if ('boolean' === type || 'null' === type) return { t: type }

    if ('array' === type) {
      const items = specOf(schema.items ?? {}, { ...walk, path: [...walk.path, '[]'] })
      if (undefined === items) {
        if (0 < (schema.minItems ?? 0)) note(walk, 'a list of its own kind is left empty')
        return { ...EMPTY_LIST }
      }
      return {
        t: 'array',
        items,
        ...(isCount(schema.minItems) ? { min: schema.minItems } : {}),
        ...(isCount(schema.maxItems) ? { max: schema.maxItems } : {}),
        ...(true === schema.uniqueItems ? { unique: true } : {}),
      }
    }

    if ('object' === type) {
      if (0 < Object.keys(schema.properties || {}).length) {
        return { t: 'object', fields: fieldsOf(schema, walk) }
      }

      const extra = schema.additionalProperties
      const keyed = null != extra && 'object' === typeof extra
      if (keyed || 0 < (schema.minProperties ?? 0)) {
        const values = keyed ? specOf(extra, { ...walk, path: [...walk.path, '*'] }) : undefined
        return {
          t: 'map',
          values: values ?? { t: 'any' },
          ...(isCount(schema.minProperties) ? { min: schema.minProperties } : {}),
          ...(isCount(schema.maxProperties) ? { max: schema.maxProperties } : {}),
        }
      }
      return { t: 'object', fields: [] }
    }

    return { t: 'any' }
  }
  finally {
    walk.seen.delete(key)
  }
}


function successSchema(facts: any): any {
  const responses = facts?.responses
  if (null == responses || 'object' !== typeof responses) return undefined

  const code = Object.keys(responses).filter((c) => /^2\d\d$/.test(c)).sort()[0] ??
    (null != responses['2XX'] ? '2XX' : undefined)
  const response = null == code ? undefined : responses[code]

  const content = response?.content
  if (null != content && 'object' === typeof content) {
    const type = Object.keys(content).find((t) => /json/i.test(t) || '*/*' === t)
    return null == type ? undefined : content[type]?.schema
  }
  return response?.schema
}


function requestSchema(facts: any): any {
  const content = facts?.requestBody?.content
  if (null != content && 'object' === typeof content) {
    const type = Object.keys(content).find((t) => /json/i.test(t))
    return null == type ? undefined : content[type]?.schema
  }
  return (facts?.parameters || []).find((p: any) => 'body' === p?.in)?.schema
}


// Follows the model's own note of where a response holds its records.
function unwrap(schema: any, expr: any, walk: Walk): any {
  const path = String(expr || '`body`').replace(/`/g, '').split('.').filter((p) => '' !== p)
  if ('body' !== path[0]) return undefined

  let at = schema
  for (const key of path.slice(1)) {
    at = flatten(at, walk).properties?.[key]
    if (null == at) return undefined
  }
  return at
}


function recordOf(schema: any, walk: Walk): { schema: any, ref?: string } | undefined {
  let at = schema
  let flat = flatten(at, walk)
  if ('array' === typeOf(flat)) {
    at = flat.items
    flat = flatten(at, walk)
  }
  if ('object' !== typeOf(flat) || 0 === Object.keys(flat.properties || {}).length) return undefined

  const ref = flat['x-ref'] ?? at?.['x-ref']
  return { schema: at, ...('string' === typeof ref ? { ref } : {}) }
}


function recordSchema(ent: any, resolved: any, walk: Walk): { schema: any, ref?: string } | undefined {
  for (const opname of RECORD_OPS) {
    const points = ((ent.op || {})[opname]?.points || []).filter((p: any) =>
      null != p && false !== p.a && 'graphql' !== p.k && null == p.q?.$action)

    for (const point of points) {
      let facts: any
      try {
        facts = resolved.operation(point.m, point.o)
      }
      catch (err) {
        continue
      }
      if (null == facts || 'http' !== facts.protocol) continue

      const answered = recordOf(unwrap(successSchema(facts), point.t?.res, walk), walk)
      if (null != answered) return answered

      const reads = 'load' === opname || 'list' === opname
      const sent = reads ? undefined : recordOf(requestSchema(facts), walk)
      if (null != sent) return sent
    }
  }
  return undefined
}


function modelFields(ent: any): Field[] {
  const fields: Field[] = []
  for (const key of Object.keys(ent.fields || {}).sort()) {
    const f = ent.fields[key]
    if (null == f || false === f.a || 'string' !== typeof f.n) continue

    const base = MODEL_TYPES[canonScalarKey(f.t)] ?? { t: 'any' }
    const spec: Spec = 'string' === base.t && 'string' === typeof f.fo ?
      { ...base, fo: f.fo } : { ...base }
    fields.push({
      n: f.n,
      r: true === f.r,
      s: spec,
      ...(true === f.ro ? { ro: true } : {}),
      ...(true === f.wo ? { wo: true } : {}),
    })
  }
  return fields
}


function textFits(text: string, spec: Spec): boolean {
  if (undefined !== spec.min && text.length < spec.min) return false
  if (undefined !== spec.max && spec.max < text.length) return false
  return undefined === spec.re || new RegExp(spec.re).test(text)
}


function sample(lead: string, width: number, n: number): string {
  return lead + String(n).padStart(width, '0')
}


// Where a pattern is fixed text and then digits, that text and how many digits it takes.
function numbered(pat: PatNode[] | undefined): { lead: string, widths: number[] } | undefined {
  if (undefined === pat || 0 === pat.length) return undefined

  let lead = ''
  for (const node of pat.slice(0, -1)) {
    if (!('c' in node) || 2 !== node.c.length || node.c[0] !== node.c[1]) return undefined
    lead += String.fromCharCode(node.c[0])
  }

  const last = pat[pat.length - 1]
  if (!('q' in last) || !('c' in last.q)) return undefined
  const digits = last.q.c
  if (!digits.some((_lo, i) => 0 === i % 2 && digits[i] <= 0x30 && 0x39 <= digits[i + 1])) return undefined

  const most = last.max < 0 ? ID_WIDTH : Math.min(last.max, 12)
  return { lead, widths: [...new Set([last.min, most])].filter((w) => 0 < w) }
}


// Whole ids, counting up from the first positive multiple of the step the bounds admit,
// or down from the last where they admit none. Undefined where they admit no multiple.
function countedId(spec: Spec): { base: number, step?: number } | undefined {
  const unit = undefined === spec.step ? 1 : wholeStep(spec.step)
  if (undefined === unit) return undefined

  const lo = undefined === spec.min ? -Infinity :
    spec.xmin ? Math.floor(spec.min / unit) + 1 : Math.ceil(spec.min / unit)
  const hi = undefined === spec.max ? Infinity :
    spec.xmax ? Math.ceil(spec.max / unit) - 1 : Math.floor(spec.max / unit)
  if (hi < lo) return undefined

  const step = hi < 1 ? -unit : unit
  const first = (hi < 1 ? hi : Math.max(lo, 1)) * unit
  return { base: first - step, ...(1 === step ? {} : { step }) }
}


function idPlan(name: string, field: Field, walk: Walk): IdPlan {
  const spec = field.s
  const inner = { ...walk, path: [field.n] }

  if ('integer' === spec.t || 'number' === spec.t) {
    const counted = countedId(spec)
    if (undefined !== counted) return { field: field.n, as: 'integer', ...counted }
    note(inner, 'no numbered id meets the schema, so ids are drawn from it and can repeat')
    return { field: field.n, as: 'spec' }
  }
  if ('any' === spec.t) {
    return { field: field.n, as: 'text', lead: tokens(name).join('-') + '-', width: ID_WIDTH }
  }
  if ('string' !== spec.t) {
    note(inner, 'an id that is not text or a number is drawn from its schema, and can repeat')
    return { field: field.n, as: 'spec' }
  }
  if ('uuid' === spec.fo) return { field: field.n, as: 'uuid' }

  // The entity's own name first, then what the pattern spells out, then shorter forms.
  const words = tokens(name)
  const short = words.map((w) => w.slice(0, 3)).join('-')
  const shaped = numbered(spec.pat)
  const leads = [
    words.join('-') + '-', short + '-', words.join('').slice(0, 1), '',
    words.join('-').toUpperCase() + '-', short.toUpperCase() + '-',
    words.join('').slice(0, 1).toUpperCase(),
  ]
  const tries = [
    { lead: leads[0], width: ID_WIDTH },
    ...(undefined === shaped ? [] : shaped.widths.map((width) => ({ lead: shaped.lead, width }))),
    ...[ID_WIDTH, 6, 8, 12, 2, 1].flatMap((width) => leads.map((lead) => ({ lead, width }))),
  ]
  for (const { lead, width } of tries) {
    const fits = [1, 2, 10 ** Math.min(width, 4) - 1]
      .every((n) => textFits(sample(lead, width, n), spec))
    if (fits) return { field: field.n, as: 'text', lead, width }
  }

  note(inner, 'no numbered id meets the schema, so ids are drawn from it and can repeat')
  return { field: field.n, as: 'spec' }
}


function idSample(id: IdPlan | undefined): string | number | undefined {
  if (undefined === id) return undefined
  if ('integer' === id.as) return (id.base ?? 0) + (id.step ?? 1)
  if ('text' === id.as) return sample(id.lead ?? '', id.width ?? ID_WIDTH, 1)
  if ('uuid' === id.as) return '00000000-0000-4000-8000-000000000001'
  return undefined
}


// Whether a field of one entity can hold the id of another, as that id is written.
function holdsId(spec: Spec, id: IdPlan | undefined): boolean {
  const value = idSample(id)
  if (undefined === value) return false
  if ('any' === spec.t) return true
  if ('number' === typeof value) return 'integer' === spec.t || 'number' === spec.t
  if ('string' !== spec.t) return false
  if (undefined !== spec.fo && !('uuid' === spec.fo && 'uuid' === id?.as)) return false
  return textFits(value, spec)
}


function chainOf(ent: any, names: string[], walk: Walk): string[] {
  const chains = ent?.relations?.ancestors
  const all = (Array.isArray(chains) ? chains : [])
    .map((chain: any) => (Array.isArray(chain) ? chain : [chain])
      .map((link: any) => 'string' === typeof link ? link.replace(/^.*\./, '') : String(link?.name ?? ''))
      .filter((name: string) => names.includes(name) && name !== ent.name))
    .filter((chain: string[]) => 0 < chain.length)

  if (1 < all.length) note(walk, 'reached under more than one parent: the first is used')
  return 0 === all.length ? [] : [...new Set<string>(all[0])].reverse()
}


function linkName(fields: Field[], names: string[]): string | undefined {
  return names.find((name) => fields.some((f) => f.n === name))
}


function seedPlan(model: any, resolved?: any, target?: any): Plan {
  const coll = entityCollection(model)
  const names = Object.keys(coll)
    .filter((name) => null != coll[name] && false !== coll[name].active && '__proto__' !== name)
    .sort()

  const notes: Note[] = []
  const entity: Record<string, EntityPlan> = {}
  const read = null != resolved && 'function' === typeof resolved.operation

  if (!read) {
    notes.push({
      note: 'built from the model alone: the API definition was not available to this build, ' +
        'so types are honoured and enum, range, length and pattern constraints are not',
    })
  }

  for (const name of names) {
    const ent = coll[name]
    const walk: Walk = { def: resolved?.def, entity: name, path: [], seen: new Set(), notes }
    const found = read ? recordSchema(ent, resolved, walk) : undefined

    let fields: Field[]
    if (null != found) {
      fields = fieldsOf(flatten(found.schema, walk), walk)
    }
    else {
      fields = modelFields(ent)
      if (read) note(walk, 'no record schema in the definition: built from the model alone')
    }

    const idName = entityDataIdField(ent)
    const idField = fields.find((f) => f.n === idName)

    entity[name] = {
      name,
      source: null != found ? 'definition' : 'model',
      ...(null != found?.ref ? { schema: found.ref } : {}),
      ...(null != idField ? { id: idPlan(name, idField, walk) } : {}),
      parents: [],
      fields,
    }
  }

  for (const name of names) {
    const plan = entity[name]
    const walk: Walk = { def: resolved?.def, entity: name, path: [], seen: new Set(), notes }
    const chain = chainOf(coll[name], names, walk)

    chain.forEach((parent, i) => {
      const camel = parent.replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase()) + 'Id'
      const nearest = 0 === i ? ['parent_id', 'parentId'] : []
      const held = linkName(plan.fields, [parent + '_id', camel, ...nearest])
      const field = plan.fields.find((f) => f.n === held)
      const fits = null != field && field.n !== plan.id?.field && holdsId(field.s, entity[parent].id)
      plan.parents.push({ entity: parent, param: parent + '_id', ...(fits ? { field: held } : {}) })
    })

    for (const field of plan.fields) {
      const other = names.find((n) => n !== name && (field.n === n + '_id' ||
        field.n === n.replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase()) + 'Id'))
      const taken = field.n === plan.id?.field || plan.parents.some((p) => p.field === field.n)
      if (null != other && !taken && holdsId(field.s, entity[other].id)) {
        field.s = { t: 'ref', entity: other }
      }
    }
  }

  const sources = new Set(names.map((name) => entity[name].source))
  const seed = target?.seed?.value
  const count = target?.seed?.count

  notes.sort((a, b) =>
    JSON.stringify([a.entity ?? '', a.field ?? '', a.note]) <
      JSON.stringify([b.entity ?? '', b.field ?? '', b.note]) ? -1 : 1)

  return {
    version: 1,
    api: String(model?.name ?? ''),
    source: 1 < sources.size ? 'mixed' : sources.has('model') || !read ? 'model' : 'definition',
    seed: null == seed || '' === String(seed) ? '1' : String(seed),
    count: isCount(count) ? count : 5,
    entity,
    notes,
  }
}


export type {
  Spec, Field, Parent, IdPlan, EntityPlan, Note, Plan,
}

export {
  seedPlan,
}
