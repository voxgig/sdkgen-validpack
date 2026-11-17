// Loaded ahead of a generated library to prove that it reads no clock and no
// random source: each of them throws.

const fail = (what) => () => {
  throw new Error(what + ' was read')
}

Math.random = fail('Math.random')
Date.now = fail('Date.now')
globalThis.Date = new Proxy(Date, { construct: fail('new Date'), apply: fail('Date()') })
