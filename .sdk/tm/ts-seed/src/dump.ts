#!/usr/bin/env node

import { makeSeed, plan } from './index'

// Declared here so that the library needs no type package to compile.
declare const process: {
  argv: string[]
  exitCode?: number
  stdout: { write(text: string): unknown }
  stderr: { write(text: string): unknown }
}


const USAGE = 'usage: dump [--seed <seed>] [--count <n>] [--entity <name>] [--plan]\n'


function main(argv: string[]): number {
  let seed: string | undefined
  let count: number | undefined
  let entity: string | undefined
  let showPlan = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if ('--plan' === arg) showPlan = true
    else if ('--seed' === arg && i + 1 < argv.length) seed = argv[++i]
    else if ('--count' === arg && i + 1 < argv.length) count = Number(argv[++i])
    else if ('--entity' === arg && i + 1 < argv.length) entity = argv[++i]
    else {
      process.stderr.write(USAGE)
      return 1
    }
  }

  let out: unknown
  try {
    const made = makeSeed({ seed, count })
    if (showPlan) out = plan
    else if (undefined !== entity) out = made.records(entity)
    else {
      const records = made.all()
      out = { seed: made.seed, records, misses: made.misses() }
    }
  }
  catch (err) {
    process.stderr.write(String((err as Error).message) + '\n')
    return 1
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  return 0
}


process.exitCode = main(process.argv.slice(2))
