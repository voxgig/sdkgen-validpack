
type PatNode =
  | { c: number[] }
  | { g: PatNode[][] }
  | { q: PatNode, min: number, max: number }


const UNSUPPORTED = new Error('unsupported pattern')

const PRINTABLE_FIRST = 0x20
const PRINTABLE_LAST = 0x7e

const DIGIT = [0x30, 0x39]
const LOWER = [0x61, 0x7a]
const UPPER = [0x41, 0x5a]
const WORD = [0x30, 0x39, 0x41, 0x5a, 0x5f, 0x5f, 0x61, 0x7a]
const SPACE = [0x20, 0x20]

const CONTROL: Record<string, number> = { t: 9, n: 10, v: 11, f: 12, r: 13 }


function normalize(ranges: number[]): number[] {
  const pairs: number[][] = []
  for (let i = 0; i < ranges.length; i += 2) pairs.push([ranges[i], ranges[i + 1]])
  pairs.sort((a, b) => a[0] - b[0])

  const out: number[] = []
  for (const [lo, hi] of pairs) {
    const last = out.length - 1
    if (0 <= last && lo <= out[last] + 1) out[last] = Math.max(out[last], hi)
    else out.push(lo, hi)
  }
  return out
}


function holds(ranges: number[], lo: number, hi: number): boolean {
  for (let i = 0; i < ranges.length; i += 2) {
    if (ranges[i] <= lo && hi <= ranges[i + 1]) return true
  }
  return false
}


// A negated class is generated from printable ASCII only.
function complement(ranges: number[]): number[] {
  const out: number[] = []
  for (let code = PRINTABLE_FIRST; code <= PRINTABLE_LAST; code++) {
    if (!holds(ranges, code, code)) out.push(code, code)
  }
  return normalize(out)
}


// Any subset of a class matches it, so a broad one is narrowed to what reads well.
function narrow(ranges: number[]): number[] {
  const digits = holds(ranges, DIGIT[0], DIGIT[1]) ? DIGIT : []
  if (holds(ranges, LOWER[0], LOWER[1])) return [...digits, ...LOWER]
  if (holds(ranges, UPPER[0], UPPER[1])) return [...digits, ...UPPER]
  return ranges
}


function parse(source: string): PatNode[] {
  let i = 0

  const fail = (): never => {
    throw UNSUPPORTED
  }

  const hexCode = (digits: number): number => {
    const text = source.slice(i, i + digits)
    if (digits !== text.length || !/^[0-9a-fA-F]+$/.test(text)) fail()
    i += digits
    return parseInt(text, 16)
  }

  const escape = (inClass: boolean): number[] => {
    const ch = source[i++]
    if (undefined === ch) fail()
    if ('d' === ch) return DIGIT
    if ('w' === ch) return WORD
    if ('s' === ch) return SPACE
    if ('D' === ch) return complement(DIGIT)
    if ('W' === ch) return complement(WORD)
    if ('S' === ch) return complement(SPACE)
    if (undefined !== CONTROL[ch]) return [CONTROL[ch], CONTROL[ch]]
    if ('0' === ch && !/[0-9]/.test(source[i] ?? '')) return [0, 0]
    if ('x' === ch) {
      const code = hexCode(2)
      return [code, code]
    }
    if ('u' === ch) {
      const code = hexCode(4)
      return [code, code]
    }
    if ('b' === ch && inClass) return [8, 8]
    if (/[A-Za-z0-9]/.test(ch)) fail()
    return [ch.charCodeAt(0), ch.charCodeAt(0)]
  }

  const single = (set: number[]): boolean => 2 === set.length && set[0] === set[1]

  const member = (): number[] => {
    const ch = source[i++]
    return '\\' === ch ? escape(true) : [ch.charCodeAt(0), ch.charCodeAt(0)]
  }

  const charClass = (): number[] => {
    const negate = '^' === source[i]
    if (negate) i++

    const ranges: number[] = []
    for (;;) {
      if (source.length <= i) fail()
      if (']' === source[i]) {
        i++
        break
      }
      const lo = member()
      if ('-' === source[i] && i + 1 < source.length && ']' !== source[i + 1] && single(lo)) {
        i++
        const hi = member()
        if (!single(hi) || hi[0] < lo[0]) fail()
        ranges.push(lo[0], hi[0])
      }
      else {
        ranges.push(...lo)
      }
    }

    const set = negate ? complement(normalize(ranges)) : normalize(ranges)
    if (0 === set.length) fail()
    return narrow(set)
  }

  const atom = (depth: number): PatNode => {
    const ch = source[i++]

    if ('(' === ch) {
      if ('?' === source[i]) {
        const named = '<' === source[i + 1] && '=' !== source[i + 2] && '!' !== source[i + 2]
        if (':' === source[i + 1]) i += 2
        else if (named && 0 < source.indexOf('>', i)) i = source.indexOf('>', i) + 1
        else fail()
      }
      const alts = alternation(depth + 1)
      if (')' !== source[i]) fail()
      i++
      return { g: alts }
    }

    if ('[' === ch) return { c: charClass() }
    if ('.' === ch) return { c: [...DIGIT, ...LOWER] }
    if ('\\' === ch) return { c: narrow(escape(false)) }
    if ('*+?{'.includes(ch)) fail()
    return { c: [ch.charCodeAt(0), ch.charCodeAt(0)] }
  }

  const repeat = (node: PatNode): PatNode => {
    const ch = source[i]
    let min = 1
    let max = 1

    if ('*' === ch || '+' === ch || '?' === ch) {
      min = '+' === ch ? 1 : 0
      max = '?' === ch ? 1 : -1
      i++
    }
    else if ('{' === ch) {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(source.slice(i))
      if (null == m) return fail()
      min = Number(m[1])
      max = undefined === m[2] ? min : '' === m[3] ? -1 : Number(m[3])
      if (0 <= max && max < min) fail()
      i += m[0].length
    }
    else {
      return node
    }

    if ('?' === source[i]) i++
    if (i < source.length && '*+?{'.includes(source[i])) fail()
    return { q: node, min, max }
  }

  // An anchor is read only where it holds the whole value: at either end of the pattern.
  const sequence = (depth: number): PatNode[] => {
    const out: PatNode[] = []
    while (i < source.length && '|' !== source[i] && ')' !== source[i]) {
      if ('^' === source[i]) {
        if (0 !== depth || 0 !== out.length) fail()
        i++
      }
      else if ('$' === source[i]) {
        i++
        if (0 !== depth || (i < source.length && '|' !== source[i])) fail()
      }
      else {
        out.push(repeat(atom(depth)))
      }
    }
    return out
  }

  const alternation = (depth: number): PatNode[][] => {
    const alts = [sequence(depth)]
    while ('|' === source[i]) {
      i++
      alts.push(sequence(depth))
    }
    return alts
  }

  const top = alternation(0)
  if (i < source.length) fail()
  return 1 === top.length ? top[0] : [{ g: top }]
}


// The shortest and a longer walk of the compiled form, to hold it to the expression itself.
function walk(nodes: PatNode[], long: boolean): string {
  let out = ''
  for (const node of nodes) {
    if ('c' in node) {
      out += String.fromCharCode(node.c[long ? node.c.length - 1 : 0])
    }
    else if ('g' in node) {
      out += walk(node.g[long ? node.g.length - 1 : 0], long)
    }
    else {
      const count = long ? (node.max < 0 ? node.min + 2 : node.max) : node.min
      for (let n = 0; n < Math.min(count, 64); n++) out += walk([node.q], long)
    }
  }
  return out
}


function compilePattern(source: string): PatNode[] | null {
  let re: RegExp
  try {
    re = new RegExp(source)
  }
  catch (err) {
    return null
  }

  let nodes: PatNode[]
  try {
    nodes = parse(source)
  }
  catch (err) {
    if (UNSUPPORTED === err) return null
    throw err
  }

  return re.test(walk(nodes, false)) && re.test(walk(nodes, true)) ? nodes : null
}


export type {
  PatNode,
}

export {
  compilePattern,
}
