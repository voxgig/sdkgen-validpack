// A checker for the part of JSON Schema an OpenAPI definition uses, in both
// the 3.0 and the 3.1 spelling. It is written for this suite, and reads the
// definition as its author wrote it, so that neither the generated library
// nor the plan it was generated from is ever its own judge.

const Net = require('node:net')


function pointer(root, ref) {
  if ('string' !== typeof ref || !ref.startsWith('#/')) return undefined
  let at = root
  for (const part of ref.slice(2).split('/')) {
    if (null == at || 'object' !== typeof at) return undefined
    at = at[part.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return at
}


function same(a, b) {
  if (a === b) return true
  if (null == a || null == b || 'object' !== typeof a || 'object' !== typeof b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]))
}


function typeName(value) {
  if (null === value) return 'null'
  if (Array.isArray(value)) return 'array'
  if ('number' === typeof value) return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}


function realDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (null == m) return false
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return date.getUTCFullYear() === Number(m[1]) && date.getUTCMonth() === Number(m[2]) - 1 &&
    date.getUTCDate() === Number(m[3])
}


function realTime(text) {
  const m = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(text)
  return null != m && Number(m[1]) < 24 && Number(m[2]) < 60 && Number(m[3]) < 61
}


const FORMATS = {
  date: realDate,
  'date-time': (text) => {
    const at = text.indexOf('T')
    return 0 < at && realDate(text.slice(0, at)) && realTime(text.slice(at + 1))
  },
  time: realTime,
  email: (text) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(text),
  uri: (text) => {
    try {
      return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text) && null != new URL(text)
    }
    catch (err) {
      return false
    }
  },
  uuid: (text) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text),
  hostname: (text) => text.length < 254 &&
    /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(text),
  ipv4: (text) => Net.isIPv4(text),
  ipv6: (text) => Net.isIPv6(text),
  byte: (text) => 0 === text.length % 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(text),
}


// Every way `value` breaks `schema`, as `path: reason` lines. `root` is the
// whole definition, for references.
function check(value, schema, root, path = '$', errs = []) {
  if (true === schema || null == schema) return errs
  if (false === schema) {
    errs.push(path + ': no value is allowed here')
    return errs
  }

  if ('string' === typeof schema.$ref) {
    const target = pointer(root, schema.$ref)
    if (undefined === target) errs.push(path + ': the reference does not resolve: ' + schema.$ref)
    else check(value, target, root, path, errs)
    return errs
  }

  const types = Array.isArray(schema.type) ? schema.type : null == schema.type ? [] : [schema.type]

  if (null === value) {
    const allowed = true === schema.nullable || types.includes('null') ||
      (0 === types.length && null == schema.enum && undefined === schema.const &&
        null == schema.allOf && null == schema.anyOf && null == schema.oneOf) ||
      (Array.isArray(schema.enum) && schema.enum.includes(null)) || null === schema.const
    if (!allowed) errs.push(path + ': null is not allowed')
    return errs
  }

  const kind = typeName(value)
  if (0 < types.length && !types.includes(kind) && !('integer' === kind && types.includes('number'))) {
    errs.push(path + ': a ' + kind + ' where the type is ' + types.join(' or '))
    return errs
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((v) => same(v, value))) {
    errs.push(path + ': ' + JSON.stringify(value) + ' is not one of ' + JSON.stringify(schema.enum))
  }
  if (undefined !== schema.const && !same(schema.const, value)) {
    errs.push(path + ': ' + JSON.stringify(value) + ' is not ' + JSON.stringify(schema.const))
  }

  if ('string' === typeof value) {
    const length = [...value].length
    if (null != schema.minLength && length < schema.minLength) {
      errs.push(path + ': ' + JSON.stringify(value) + ' is shorter than ' + schema.minLength)
    }
    if (null != schema.maxLength && schema.maxLength < length) {
      errs.push(path + ': ' + JSON.stringify(value) + ' is longer than ' + schema.maxLength)
    }
    if (null != schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errs.push(path + ': ' + JSON.stringify(value) + ' does not match ' + schema.pattern)
    }
    const format = FORMATS[schema.format]
    if (null != format && !format(value)) {
      errs.push(path + ': ' + JSON.stringify(value) + ' is not a ' + schema.format)
    }
  }

  if ('number' === typeof value) {
    const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf } = schema
    if (null != minimum && (value < minimum || (true === exclusiveMinimum && value === minimum))) {
      errs.push(path + ': ' + value + ' is below ' + minimum)
    }
    if (null != maximum && (maximum < value || (true === exclusiveMaximum && value === maximum))) {
      errs.push(path + ': ' + value + ' is above ' + maximum)
    }
    if ('number' === typeof exclusiveMinimum && value <= exclusiveMinimum) {
      errs.push(path + ': ' + value + ' is not above ' + exclusiveMinimum)
    }
    if ('number' === typeof exclusiveMaximum && exclusiveMaximum <= value) {
      errs.push(path + ': ' + value + ' is not below ' + exclusiveMaximum)
    }
    if (null != multipleOf && 1e-9 < Math.abs(value / multipleOf - Math.round(value / multipleOf))) {
      errs.push(path + ': ' + value + ' is not a multiple of ' + multipleOf)
    }
    if ('int32' === schema.format && (value < -2147483648 || 2147483647 < value)) {
      errs.push(path + ': ' + value + ' is outside int32')
    }
  }

  if (Array.isArray(value)) {
    if (null != schema.minItems && value.length < schema.minItems) {
      errs.push(path + ': ' + value.length + ' items, fewer than ' + schema.minItems)
    }
    if (null != schema.maxItems && schema.maxItems < value.length) {
      errs.push(path + ': ' + value.length + ' items, more than ' + schema.maxItems)
    }
    if (true === schema.uniqueItems && value.some((a, i) => value.some((b, j) => i < j && same(a, b)))) {
      errs.push(path + ': items repeat')
    }
    if (null != schema.items) {
      value.forEach((item, i) => check(item, schema.items, root, path + '[' + i + ']', errs))
    }
  }

  if ('object' === kind) {
    const props = schema.properties || {}
    const keys = Object.keys(value)
    for (const name of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, name)) errs.push(path + ': ' + name + ' is required')
    }
    if (null != schema.minProperties && keys.length < schema.minProperties) {
      errs.push(path + ': fewer than ' + schema.minProperties + ' properties')
    }
    if (null != schema.maxProperties && schema.maxProperties < keys.length) {
      errs.push(path + ': more than ' + schema.maxProperties + ' properties')
    }
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        if (true === deref(props[key], root).writeOnly) errs.push(path + '.' + key + ': a write-only field in a record')
        check(value[key], props[key], root, path + '.' + key, errs)
      }
      else if (false === schema.additionalProperties) {
        errs.push(path + '.' + key + ': not a declared property')
      }
      else if (null != schema.additionalProperties && 'object' === typeof schema.additionalProperties) {
        check(value[key], schema.additionalProperties, root, path + '.' + key, errs)
      }
    }
  }

  for (const part of schema.allOf || []) check(value, part, root, path, errs)

  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((part) => 0 === check(value, part, root, path, []).length)) {
    errs.push(path + ': none of the anyOf alternatives admits ' + JSON.stringify(value))
  }
  if (Array.isArray(schema.oneOf)) {
    const admitted = schema.oneOf.filter((part) => 0 === check(value, part, root, path, []).length).length
    if (1 !== admitted) {
      errs.push(path + ': ' + admitted + ' of the oneOf alternatives admit ' + JSON.stringify(value))
    }
  }
  if (null != schema.not && 0 === check(value, schema.not, root, path, []).length) {
    errs.push(path + ': the value is one `not` rules out')
  }

  return errs
}


function deref(schema, root) {
  let at = schema
  for (let hops = 0; hops < 16 && null != at && 'string' === typeof at.$ref; hops++) at = pointer(root, at.$ref)
  return at || {}
}


module.exports = { check, pointer }
