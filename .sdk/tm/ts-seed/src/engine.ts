
import {
  ADJECTIVES, NOUNS, VERBS, FIRST_NAMES, LAST_NAMES, CITIES, COUNTRIES,
  COLORS, STATUSES, CATEGORIES, STREETS, CURRENCIES, LANGUAGES, ZONES,
  SENTENCES,
} from './words'


export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

export type Row = { [field: string]: Json }

export type PatNode =
  | { c: number[] }
  | { g: PatNode[][] }
  | { q: PatNode, min: number, max: number }

export type Spec =
  | { t: 'string', fo?: string, min?: number, max?: number, re?: string, pat?: PatNode[] }
  | { t: 'integer' | 'number', min?: number, max?: number, xmin?: boolean, xmax?: boolean, step?: number }
  | { t: 'boolean' | 'null' | 'any' }
  | { t: 'enum', values: Json[] }
  | { t: 'const', value: Json }
  | { t: 'array', items: Spec, min?: number, max?: number, unique?: boolean }
  | { t: 'object', fields: Field[] }
  | { t: 'map', values: Spec, min?: number, max?: number }
  | { t: 'ref', entity: string }

export type Field = { n: string, r: boolean, s: Spec, ro?: boolean, wo?: boolean }

export type Parent = { entity: string, param: string, field?: string }

export type IdPlan = {
  field: string
  as: 'text' | 'integer' | 'uuid' | 'spec'
  lead?: string
  width?: number
  base?: number
  step?: number
}

export type EntityPlan = {
  name: string
  source: 'definition' | 'model'
  schema?: string
  id?: IdPlan
  parents: Parent[]
  fields: Field[]
}

export type Note = { entity?: string, field?: string, note: string }

export type Plan = {
  version: 1
  api: string
  source: 'definition' | 'model' | 'mixed'
  seed: string
  count: number
  entity: { [name: string]: EntityPlan }
  notes: Note[]
}

export type SeedOptions = {
  seed?: number | string
  count?: number
  counts?: { [entity: string]: number }
}

export type Miss = { entity: string, n: number, path: string, why: string }

export type Seed = {
  seed: string
  plan: Plan
  entities(): string[]
  count(entity: string): number
  id(entity: string, n: number): string | number | null
  parents(entity: string, n: number): { [param: string]: string | number }
  record(entity: string, n: number, over?: Row): Row
  records(entity: string): Row[]
  all(): { [entity: string]: Row[] }
  misses(): Miss[]
}


type Draw = () => number

type At = { base: string, entity: string, n: number, path: string, name: string }

type Text = { text: string, free: boolean }

type Piece = { text: string, c: number[], room: number }

type StringSpec = Extract<Spec, { t: 'string' }>

type NumberSpec = Extract<Spec, { t: 'integer' | 'number' }>


const U32 = 4294967296

const TRIES = 12

const POW = [1, 10, 100, 1000, 10000, 100000, 1000000]

// Days since the Unix epoch, both ends included.
const BIRTH = [-3653, 11322]
const EARLY = [20089, 20453]
const MID = [20454, 20634]
const LATE = [20635, 20818]

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const PEOPLE = [
  'user', 'person', 'people', 'author', 'customer', 'contact', 'member',
  'employee', 'owner', 'patient', 'student', 'teacher', 'driver', 'guest',
  'client', 'agent', 'staff', 'reviewer', 'assignee', 'reporter', 'editor',
  'creator', 'manager', 'contributor',
]


export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}


function stream(key: string): Draw {
  let a = hash32(key)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return (t ^ (t >>> 14)) >>> 0
  }
}


function below(draw: Draw, n: number): number {
  if (n <= 1) return 0
  if (n <= U32) return draw() % n
  return ((draw() >>> 11) * U32 + draw()) % n
}


function pick<T>(draw: Draw, list: readonly T[]): T {
  return list[below(draw, list.length)]
}


function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}


function cap(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}


function own(map: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key)
}


// A key such as __proto__ is data here, so it is defined, never assigned.
function put<T>(row: { [key: string]: T }, key: string, value: T): void {
  Object.defineProperty(row, key, {
    value, enumerable: true, writable: true, configurable: true,
  })
}


function tokens(name: string): string[] {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
    .split(/[^a-z0-9]+/).filter((t) => '' !== t)
}


function has(ts: string[], ...words: string[]): boolean {
  return words.some((w) => ts.includes(w))
}


function civil(day: number): string {
  const z = day + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const m = mp < 10 ? mp + 3 : mp - 9
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0)
  return pad(y, 4) + '-' + pad(m, 2) + '-' + pad(d, 2)
}


function dayOf(ts: string[], draw: Draw): string {
  const w = has(ts, 'born', 'birth', 'birthday', 'dob') ? BIRTH :
    has(ts, 'created', 'create', 'start', 'started', 'opened', 'joined', 'since', 'from') ? EARLY :
      has(ts, 'updated', 'modified', 'end', 'ended', 'closed', 'expires', 'expiry', 'due',
        'deadline', 'until', 'deleted', 'finished') ? LATE : MID
  return civil(w[0] + below(draw, w[1] - w[0] + 1))
}


function clock(draw: Draw): string {
  return pad(below(draw, 24), 2) + ':' + pad(below(draw, 60), 2) + ':00'
}


function hex(draw: Draw, len: number): string {
  let out = ''
  while (out.length < len) out += draw().toString(16).padStart(8, '0')
  return out.slice(0, len)
}


function uuid(draw: Draw): string {
  const h = hex(draw, 32)
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-' +
    '89ab'.charAt(below(draw, 4)) + h.slice(17, 20) + '-' + h.slice(20, 32)
}


function base64(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i)
    const b = i + 1 < text.length ? text.charCodeAt(i + 1) : -1
    const c = i + 2 < text.length ? text.charCodeAt(i + 2) : -1
    out += B64.charAt(a >> 2) + B64.charAt(((a & 3) << 4) | (b < 0 ? 0 : b >> 4)) +
      (b < 0 ? '=' : B64.charAt(((b & 15) << 2) | (c < 0 ? 0 : c >> 6))) +
      (c < 0 ? '=' : B64.charAt(c & 63))
  }
  return out
}


function person(draw: Draw): [string, string] {
  return [pick(draw, FIRST_NAMES), pick(draw, LAST_NAMES)]
}


function sentence(draw: Draw): string {
  return pick(draw, SENTENCES)
    .replace('{a}', pick(draw, ADJECTIVES))
    .replace('{n}', pick(draw, NOUNS))
    .replace('{m}', pick(draw, NOUNS))
    .replace(/\b([Aa]) (?=[aeiou])/g, '$1n ')
}


function formatted(format: string, ts: string[], draw: Draw): string | undefined {
  switch (format) {
    case 'date':
      return dayOf(ts, draw)
    case 'date-time':
      return dayOf(ts, draw) + 'T' + clock(draw) + 'Z'
    case 'time':
      return clock(draw) + 'Z'
    case 'email':
    case 'idn-email': {
      const [first, last] = person(draw)
      return (first + '.' + last).toLowerCase() + '@example.com'
    }
    case 'uri':
    case 'url':
    case 'iri':
    case 'uri-reference':
      return 'https://example.com/' + pick(draw, ADJECTIVES) + '-' + pick(draw, NOUNS)
    case 'uuid':
      return uuid(draw)
    case 'hostname':
    case 'idn-hostname':
      return pick(draw, ADJECTIVES) + '-' + pick(draw, NOUNS) + '.example.com'
    case 'ipv4':
      return '192.0.2.' + (1 + below(draw, 254))
    case 'ipv6':
      return '2001:db8::' + (1 + below(draw, 65535)).toString(16)
    case 'byte':
      return base64(pick(draw, ADJECTIVES) + ' ' + pick(draw, NOUNS))
    case 'password':
      return 'example-password-' + pad(below(draw, 10000), 4)
    default:
      return undefined
  }
}


function readable(ts: string[], at: At, draw: Draw): Text {
  const last = ts.length ? ts[ts.length - 1] : ''
  const adj = pick(draw, ADJECTIVES)
  const noun = pick(draw, NOUNS)
  const fixed = (text: string): Text => ({ text, free: false })
  const free = (text: string): Text => ({ text, free: true })

  if (has(ts, 'email', 'mail')) return fixed(formatted('email', ts, draw) as string)
  if (has(ts, 'phone', 'tel', 'mobile', 'fax')) return fixed('+1-202-555-01' + pad(below(draw, 100), 2))
  if (has(ts, 'ip', 'ipv4')) return fixed('192.0.2.' + (1 + below(draw, 254)))
  if (has(ts, 'image', 'avatar', 'photo', 'picture', 'icon', 'logo', 'thumbnail')) {
    return fixed('https://example.com/img/' + adj + '-' + noun + '.png')
  }
  if (has(ts, 'url', 'uri', 'link', 'website', 'homepage', 'href')) {
    return fixed('https://example.com/' + adj + '-' + noun)
  }
  if (has(ts, 'uuid', 'guid')) return fixed(uuid(draw))
  if ('id' === last || 'ids' === last) {
    const stem = ts.slice(0, -1).join('-') || 'item'
    return fixed(stem + '-' + pad(1 + below(draw, 9), 4))
  }
  if (has(ts, 'mime') || (has(ts, 'content') && has(ts, 'type'))) return fixed('application/json')
  if (has(ts, 'timezone', 'tz') || (has(ts, 'time') && has(ts, 'zone'))) return fixed(pick(draw, ZONES))

  if (has(ts, 'name', 'username', 'login', 'handle', 'surname') ||
    has(ts, 'author', 'owner', 'assignee', 'reviewer', 'reporter', 'editor', 'creator')) {
    const [first, family] = person(draw)
    if (has(ts, 'first', 'given')) return free(first)
    if (has(ts, 'last', 'family', 'surname')) return free(family)
    if (has(ts, 'username', 'login', 'handle', 'user')) return fixed((first + '.' + family).toLowerCase())
    const holder = tokens(at.entity + ' ' + at.path.split('.').slice(0, -1).join(' '))
    if (!has(ts, 'name') || has(ts, 'full') || has(holder, ...PEOPLE)) {
      return free(first + ' ' + family)
    }
    if (has(ts, 'company', 'organization', 'organisation', 'org', 'brand', 'publisher')) {
      return free(cap(noun) + ' & ' + cap(pick(draw, NOUNS)) + ' Ltd')
    }
    if (has(ts, 'file')) return fixed(adj + '-' + noun + '.txt')
    if (has(ts, 'host', 'domain')) return fixed(adj + '-' + noun + '.example.com')
    return free(cap(adj) + ' ' + cap(noun))
  }

  if (has(ts, 'title', 'subject', 'headline', 'task', 'todo')) {
    return free(pick(draw, VERBS) + ' the ' + adj + ' ' + noun)
  }
  if (has(ts, 'description', 'summary', 'note', 'notes', 'comment', 'comments', 'text', 'body',
    'content', 'message', 'reason', 'bio', 'about', 'details', 'detail', 'remark', 'remarks',
    'instructions', 'abstract')) {
    return free(sentence(draw))
  }

  if (has(ts, 'city', 'town')) return free(pick(draw, CITIES))
  if (has(ts, 'country')) return free(pick(draw, COUNTRIES)[0])
  if (has(ts, 'street', 'address', 'addr')) return free((1 + below(draw, 99)) + ' ' + pick(draw, STREETS))
  if (has(ts, 'zip', 'postcode', 'postal')) return fixed(pad(below(draw, 100000), 5))
  if (has(ts, 'company', 'organization', 'organisation', 'org', 'employer', 'vendor', 'brand',
    'publisher', 'manufacturer', 'supplier')) {
    return free(cap(noun) + ' & ' + cap(pick(draw, NOUNS)) + ' Ltd')
  }
  if (has(ts, 'color', 'colour')) return free(pick(draw, COLORS))
  if (has(ts, 'currency')) return fixed(pick(draw, CURRENCIES))
  if (has(ts, 'language', 'lang', 'locale')) return fixed(pick(draw, LANGUAGES))
  if (has(ts, 'status', 'state', 'stage', 'phase')) return free(pick(draw, STATUSES))
  if (has(ts, 'kind', 'type', 'category', 'species', 'genre', 'class', 'group', 'tier')) {
    return free(pick(draw, CATEGORIES))
  }

  if ('at' === last || 'on' === last || has(ts, 'timestamp', 'datetime', 'when', 'time')) {
    return fixed(dayOf(ts, draw) + 'T' + clock(draw) + 'Z')
  }
  if (has(ts, 'date', 'day', 'due', 'born', 'birthday', 'dob', 'deadline', 'expires', 'expiry')) {
    return fixed(dayOf(ts, draw))
  }

  if (has(ts, 'version')) {
    return fixed(below(draw, 5) + '.' + below(draw, 10) + '.' + below(draw, 10))
  }
  if (has(ts, 'hash', 'checksum', 'digest', 'sha')) return fixed(hex(draw, 40))
  if (has(ts, 'token', 'secret', 'password', 'apikey', 'credential')) {
    return fixed('example-' + last + '-' + hex(draw, 8))
  }
  if (has(ts, 'host', 'hostname', 'domain')) return fixed(adj + '-' + noun + '.example.com')
  if (has(ts, 'file', 'filename')) return fixed(adj + '-' + noun + '.txt')
  if (has(ts, 'path')) return fixed('/' + adj + '/' + noun)
  if (has(ts, 'slug')) return fixed(adj + '-' + noun)
  if (has(ts, 'code', 'sku', 'ref', 'reference', 'serial')) {
    return fixed(noun.slice(0, 3).toUpperCase() + '-' + pad(below(draw, 10000), 4))
  }
  if (has(ts, 'label', 'nickname')) return free(cap(adj) + ' ' + cap(noun))
  if (has(ts, 'tag', 'tags', 'keyword', 'keywords', 'labels', 'topic', 'topics')) return free(noun)
  return free(adj + ' ' + noun)
}


// Plainer shapes for a pattern no value has met yet, most readable first.
function plain(k: number, draw: Draw): Text {
  const adj = pick(draw, ADJECTIVES)
  const noun = pick(draw, NOUNS)
  const shapes = [
    adj + '-' + noun, noun, pad(below(draw, 10000), 4), cap(noun),
    noun.slice(0, 3).toUpperCase(), hex(draw, 8), adj + '_' + noun, cap(adj) + cap(noun),
    pad(below(draw, 100000000), 8), noun + (1 + below(draw, 9)), noun.charAt(0),
  ]
  return { text: shapes[(k - 1) % shapes.length], free: false }
}


function classChar(ranges: number[], draw: Draw): string {
  let total = 0
  for (let i = 0; i < ranges.length; i += 2) total += ranges[i + 1] - ranges[i] + 1
  let r = below(draw, total)
  for (let i = 0; i < ranges.length; i += 2) {
    const size = ranges[i + 1] - ranges[i] + 1
    if (r < size) return String.fromCharCode(ranges[i] + r)
    r -= size
  }
  return ''
}


// A repeat of one class that may stretch is laid at its least, with the room it has to grow.
function lay(nodes: PatNode[], draw: Draw, stretch: boolean, out: Piece[]): void {
  for (const node of nodes) {
    if ('c' in node) {
      out.push({ text: classChar(node.c, draw), c: node.c, room: 0 })
    }
    else if ('g' in node) {
      lay(pick(draw, node.g), draw, stretch, out)
    }
    else if (stretch && 'c' in node.q) {
      const piece: Piece = { text: '', c: node.q.c, room: node.max < 0 ? Infinity : node.max - node.min }
      for (let i = 0; i < node.min; i++) piece.text += classChar(node.q.c, draw)
      out.push(piece)
    }
    else {
      const most = node.max < 0 ? node.min + 3 : Math.min(node.max, node.min + 6)
      const count = node.min + below(draw, most - node.min + 1)
      for (let i = 0; i < count; i++) lay([node.q], draw, stretch, out)
    }
  }
}


// `want` is the length to reach, or -1. The whole walk is laid before the slack is shared out,
// first repeat first, so that whatever follows a repeat keeps its room.
function fromPattern(nodes: PatNode[], draw: Draw, want: number): string {
  const pieces: Piece[] = []
  lay(nodes, draw, 0 <= want, pieces)
  let slack = want - pieces.reduce((n, p) => n + p.text.length, 0)
  for (const p of pieces) {
    for (; 0 < slack && 0 < p.room; slack--, p.room--) p.text += classChar(p.c, draw)
  }
  return pieces.map((p) => p.text).join('')
}


function fit(text: string, spec: StringSpec, draw: Draw): string {
  const min = spec.min ?? 0
  let out = text
  while (out.length < min) out += ('' === out ? '' : ' ') + pick(draw, NOUNS)
  if (undefined !== spec.max && out.length > spec.max) {
    out = out.slice(0, spec.max).replace(/\s+$/, '')
    while (out.length < min) out += 'x'
  }
  return out
}


// The length a pattern is stretched to on try `k`: each readable length the schema admits, longest first.
function wanted(spec: StringSpec, k: number): number {
  if (undefined === spec.min && undefined === spec.max) return -1
  const least = spec.min ?? 0
  const most = undefined === spec.min ? Math.min(spec.max as number, 12) :
    Math.min(spec.max ?? spec.min + 4, spec.min + 4)
  return most - (k - 1) % Math.max(1, most - least + 1)
}


function numberHint(ts: string[], integer: boolean): [number, number, number] {
  if (has(ts, 'lat', 'latitude')) return [-90, 90, 4]
  if (has(ts, 'lon', 'lng', 'longitude')) return [-180, 180, 4]
  if (has(ts, 'age')) return [18, 90, 0]
  if (has(ts, 'year')) return [1990, 2030, 0]
  if (has(ts, 'month')) return [1, 12, 0]
  if (has(ts, 'day')) return [1, 28, 0]
  if (has(ts, 'hour')) return [0, 23, 0]
  if (has(ts, 'minute', 'second')) return [0, 59, 0]
  if (has(ts, 'price', 'amount', 'cost', 'total', 'balance', 'fee', 'salary', 'budget',
    'subtotal', 'tax')) {
    return [1, 999, 2]
  }
  if (has(ts, 'rating', 'stars')) return [1, 5, 1]
  if (has(ts, 'percent', 'percentage', 'pct', 'progress', 'score')) return [0, 100, 1]
  if (has(ts, 'ratio', 'rate', 'confidence', 'probability')) return [0, 1, 2]
  if (has(ts, 'port')) return [1024, 65535, 0]
  if (has(ts, 'count', 'quantity', 'qty', 'stock', 'pages', 'size', 'items')) return [1, 500, 0]
  if (has(ts, 'priority', 'rank', 'level', 'position', 'order', 'index')) return [1, 10, 0]
  if (has(ts, 'width', 'height', 'depth', 'length', 'weight', 'diameter', 'radius', 'distance',
    'duration', 'area', 'volume', 'mass', 'speed')) {
    return [1, 10000, 1]
  }
  return integer ? [1, 1000, 0] : [0, 1000, 2]
}


function decimals(step: number): number {
  for (let d = 0; d < POW.length; d++) {
    const v = step * POW[d]
    if (Math.abs(v - Math.round(v)) < 1e-9) return d
  }
  return POW.length - 1
}


function exact(x: number): number {
  return Math.round(x * 1e6) / 1e6
}


function within(spec: NumberSpec, x: number): boolean {
  const step = spec.step
  return (undefined === spec.min || (spec.xmin ? spec.min < x : spec.min <= x)) &&
    (undefined === spec.max || (spec.xmax ? x < spec.max : x <= spec.max)) &&
    (undefined === step || !(0 < step) || Math.abs(x / step - Math.round(x / step)) < 1e-9)
}


// The readable range where the schema allows it, else a range of that width inside the schema's.
function bounds(spec: NumberSpec, lo: number, hi: number): [number, number] {
  const { min, max } = spec
  if (undefined !== min && undefined !== max) {
    return Math.max(lo, min) < Math.min(hi, max) ? [Math.max(lo, min), Math.min(hi, max)] : [min, max]
  }
  if (undefined !== min) return min <= lo ? [lo, hi] : [min, min + (hi - lo)]
  if (undefined !== max) return hi <= max ? [lo, hi] : [max - (hi - lo), max]
  return [lo, hi]
}


export function makeSeedFor(plan: Plan, options: SeedOptions = {}): Seed {
  const seed = String(options.seed ?? plan.seed)
  const names = Object.keys(plan.entity).sort()
  const missed = new Map<string, Miss>()
  const patterns = new Map<string, RegExp | null>()

  const whole = (value: unknown, what: string): number => {
    if ('number' !== typeof value || !Number.isInteger(value) || value < 0) {
      throw new TypeError('ts-seed: ' + what + ' is not a whole number: ' + String(value))
    }
    return value
  }

  const fallback = whole(options.count ?? plan.count, 'count')
  const counts: { [entity: string]: number } = {}
  for (const name of Object.keys(options.counts ?? {})) {
    put(counts, name, whole((options.counts as { [entity: string]: number })[name], 'counts.' + name))
  }

  const entityOf = (name: string): EntityPlan => {
    if (!own(plan.entity, name)) {
      throw new Error('ts-seed: unknown entity: ' + name + ' (known: ' + names.join(', ') + ')')
    }
    return plan.entity[name]
  }

  const numbered = (n: number): number => {
    if (!Number.isInteger(n) || n < 1) {
      throw new RangeError('ts-seed: a record number starts at 1: ' + String(n))
    }
    return n
  }

  const size = (name: string): number => own(counts, name) ? counts[name] : fallback

  const miss = (at: At, why: string): void => {
    const key = at.entity + '\n' + at.n + '\n' + at.path
    if (!missed.has(key)) missed.set(key, { entity: at.entity, n: at.n, path: at.path, why })
  }

  const regexp = (source: string | undefined): RegExp | null => {
    if (undefined === source) return null
    if (!patterns.has(source)) {
      let re: RegExp | null = null
      try {
        re = new RegExp(source)
      }
      catch (err) {
        re = null
      }
      patterns.set(source, re)
    }
    return patterns.get(source) as RegExp | null
  }

  const fits = (text: string, spec: StringSpec): boolean => {
    const re = regexp(spec.re)
    return (undefined === spec.min || spec.min <= text.length) &&
      (undefined === spec.max || text.length <= spec.max) &&
      (null === re || re.test(text))
  }

  const stringOf = (spec: StringSpec, at: At): string => {
    const ts = tokens(at.name)
    let text = ''
    for (let k = 0; k < TRIES; k++) {
      const draw = stream(at.base + '\n' + at.path + (0 === k ? '' : '\n~' + k))
      const shaped = undefined === spec.fo ? undefined : formatted(spec.fo, ts, draw)
      if (undefined !== shaped) {
        text = shaped
      }
      else if (0 < k && undefined !== spec.pat) {
        text = fromPattern(spec.pat, draw, wanted(spec, k))
      }
      else {
        const made = 0 === k ? readable(ts, at, draw) : plain(k, draw)
        text = made.free ? fit(made.text, spec, draw) : made.text
      }
      if (fits(text, spec)) return text
    }
    miss(at, 'no value met the length or the pattern')
    return text
  }

  const numberOf = (spec: NumberSpec, at: At): number => {
    const draw = stream(at.base + '\n' + at.path)
    const integer = 'integer' === spec.t
    const [hlo, hhi, hdec] = numberHint(tokens(at.name), integer)
    const stepped = undefined !== spec.step && 0 < spec.step
    const [lo, hi] = bounds(spec, hlo, hhi)

    // The candidates at `dec` places: whole multiples of `unit`, from `a` to `b`, over `scale`.
    const candidates = (dec: number): { a: number, b: number, unit: number, scale: number } => {
      const scale = POW[dec]
      // A whole number is left as it is: rounding it through a fraction can move a large one.
      const scaled = (x: number): number => 1 === scale ? x : exact(x * scale)
      let a = Math.ceil(scaled(lo))
      let b = Math.floor(scaled(hi))
      if (spec.xmin && undefined !== spec.min && a <= scaled(spec.min)) {
        a = Math.floor(scaled(spec.min)) + 1
      }
      if (spec.xmax && undefined !== spec.max && b >= scaled(spec.max)) {
        b = Math.ceil(scaled(spec.max)) - 1
      }
      let unit = 1
      if (stepped) {
        unit = Math.max(1, Math.round((spec.step as number) * scale))
        a = Math.ceil(a / unit)
        b = Math.floor(b / unit)
      }
      return { a, b, unit, scale }
    }

    let dec = integer ? 0 : stepped ? decimals(spec.step as number) : hdec
    let c = candidates(dec)
    // The name's precision gives way to a range too narrow for it.
    while (c.b < c.a && !integer && !stepped && dec < POW.length - 1) c = candidates(++dec)
    if (c.b < c.a) {
      miss(at, 'no number lies within the bounds')
      c.b = c.a
    }
    return ((c.a + below(draw, c.b - c.a + 1)) * c.unit) / c.scale
  }

  const idOf = (ent: EntityPlan, n: number): string | number | null => {
    const id = ent.id
    if (undefined === id) return null
    if ('uuid' === id.as) {
      return hash32('id\n' + ent.name).toString(16).padStart(8, '0') +
        '-0000-4000-8000-' + n.toString(16).padStart(12, '0')
    }
    const field = ent.fields.find((f) => f.n === id.field)
    const at = { base: seed + '\n' + ent.name + '\n' + n, entity: ent.name, n, path: id.field, name: id.field }
    if ('spec' === id.as && undefined !== field) {
      return make(field.s, at) as string | number
    }

    const value = 'integer' === id.as ? (id.base ?? 0) + n * (id.step ?? 1) :
      (id.lead ?? ent.name + '-') + pad(n, id.width ?? 4)
    const spec = field?.s
    const meets = undefined === spec ? true :
      'string' === spec.t ? fits(String(value), spec) :
        'integer' === spec.t || 'number' === spec.t ? within(spec, Number(value)) : true
    if (!meets) miss(at, 'the numbered id runs past what the schema admits')
    return value
  }

  const ancestor = (ent: EntityPlan, n: number, target: string, hops: number): number => {
    const direct = ent.parents[0]
    const p = ((n - 1) % Math.max(1, size(direct.entity))) + 1
    if (direct.entity === target || 8 < hops) return p
    const up = own(plan.entity, direct.entity) ? plan.entity[direct.entity] : undefined
    if (undefined !== up && up.parents.some((x) => x.entity === target)) {
      return ancestor(up, p, target, hops + 1)
    }
    return ((n - 1) % Math.max(1, size(target))) + 1
  }

  const parentsOf = (ent: EntityPlan, n: number): { param: string, field?: string, id: string | number }[] => {
    const out: { param: string, field?: string, id: string | number }[] = []
    for (const parent of ent.parents) {
      if (!own(plan.entity, parent.entity)) continue
      const id = idOf(plan.entity[parent.entity], ancestor(ent, n, parent.entity, 0))
      if (null !== id) out.push({ param: parent.param, field: parent.field, id })
    }
    return out
  }

  const arrayOf = (spec: Extract<Spec, { t: 'array' }>, at: At): Json[] => {
    const lo = spec.min ?? Math.min(1, spec.max ?? 1)
    const hi = Math.max(lo, spec.max ?? lo + 2)
    const draw = stream(at.base + '\n' + at.path + '\n#')
    const length = lo + below(draw, hi - lo + 1)

    // Distinct picks from a short list are dealt, since chance can run out of tries.
    const few = 'enum' === spec.items.t ? spec.items.values : 'boolean' === spec.items.t ? [false, true] : null
    if (spec.unique && null !== few) {
      const deck = few.slice()
      for (let i = 0; i < deck.length - 1; i++) {
        const j = i + below(draw, deck.length - i)
        const held = deck[i]
        deck[i] = deck[j]
        deck[j] = held
      }
      if (deck.length < lo) miss(at, 'too few distinct items')
      return deck.slice(0, Math.min(length, deck.length))
    }

    const out: Json[] = []
    const seen = new Set<string>()
    for (let i = 0; i < length; i++) {
      let item: Json = null
      let fresh = false
      for (let k = 0; k < TRIES && !fresh; k++) {
        item = make(spec.items, { ...at, path: at.path + '.' + i + (0 === k ? '' : '~' + k) })
        fresh = !spec.unique || !seen.has(JSON.stringify(item))
      }
      if (fresh) {
        seen.add(JSON.stringify(item))
        out.push(item)
      }
      else if (out.length < lo) {
        miss(at, 'too few distinct items')
      }
    }
    return out
  }

  const mapOf = (spec: Extract<Spec, { t: 'map' }>, at: At): Row => {
    const lo = spec.min ?? 1
    const hi = Math.max(lo, spec.max ?? Math.max(lo, 2))
    const draw = stream(at.base + '\n' + at.path + '\n#')
    const length = lo + below(draw, hi - lo + 1)
    const out: Row = {}
    for (let i = 0; i < length; i++) {
      let key = pick(draw, NOUNS)
      for (let k = 2; own(out, key); k++) key = pick(draw, NOUNS) + k
      put(out, key, make(spec.values, { ...at, path: at.path + '.' + key, name: key }))
    }
    return out
  }

  const make = (spec: Spec, at: At): Json => {
    switch (spec.t) {
      case 'string':
        return stringOf(spec, at)
      case 'integer':
      case 'number':
        return numberOf(spec, at)
      case 'boolean':
        return 1 === (stream(at.base + '\n' + at.path)() & 1)
      case 'null':
        return null
      case 'enum':
        return 0 === spec.values.length ? null : pick(stream(at.base + '\n' + at.path), spec.values)
      case 'const':
        return spec.value
      case 'array':
        return arrayOf(spec, at)
      case 'map':
        return mapOf(spec, at)
      case 'object': {
        const out: Row = {}
        for (const f of spec.fields) {
          if (f.wo) continue
          put(out, f.n, make(f.s, { ...at, path: '' === at.path ? f.n : at.path + '.' + f.n, name: f.n }))
        }
        return out
      }
      case 'ref': {
        const to = own(plan.entity, spec.entity) ? plan.entity[spec.entity] : undefined
        const draw = stream(at.base + '\n' + at.path)
        const id = undefined === to ? null : idOf(to, 1 + below(draw, Math.max(1, size(to.name))))
        return null === id ? spec.entity + '-' + pad(1 + below(draw, 9), 4) : id
      }
      default:
        return readable(tokens(at.name), at, stream(at.base + '\n' + at.path)).text
    }
  }

  const record = (entity: string, n: number, over?: Row): Row => {
    const ent = entityOf(entity)
    numbered(n)
    const base = seed + '\n' + entity + '\n' + n
    const up = parentsOf(ent, n)
    const out: Row = {}
    for (const f of ent.fields) {
      if (f.wo) continue
      const held = up.find((p) => p.field === f.n)
      const value = undefined !== ent.id && f.n === ent.id.field ? idOf(ent, n) :
        undefined !== held ? held.id :
          make(f.s, { base, entity, n, path: f.n, name: f.n })
      put(out, f.n, value)
    }
    for (const key of Object.keys(over ?? {})) put(out, key, (over as Row)[key])
    return out
  }

  const records = (entity: string): Row[] => {
    const out: Row[] = []
    for (let n = 1; n <= size(entityOf(entity).name); n++) out.push(record(entity, n))
    return out
  }

  return {
    seed,
    plan,
    entities: () => names.slice(),
    count: (entity) => size(entityOf(entity).name),
    id: (entity, n) => idOf(entityOf(entity), numbered(n)),
    parents: (entity, n) => {
      const out: { [param: string]: string | number } = {}
      for (const p of parentsOf(entityOf(entity), numbered(n))) put(out, p.param, p.id)
      return out
    },
    record,
    records,
    all: () => {
      const out: { [entity: string]: Row[] } = {}
      for (const name of names) put(out, name, records(name))
      return out
    },
    misses: () => Array.from(missed.values()),
  }
}
