#!/usr/bin/env node

import { makeMock, routes } from './index'

// Declared here so that the mock needs no type package to compile.
declare const process: {
  argv: string[]
  env: { [name: string]: string | undefined }
  exitCode?: number
  stdout: { write(text: string): unknown }
  stderr: { write(text: string): unknown }
  once(event: string, listener: () => void): unknown
}


const USAGE = 'usage: server [--port <n>] [--host <host>] [--seed <seed>] [--count <n>] [--token <token>]\n'

type Args = { port?: number, host?: string, seed?: string, count?: number, token?: string }


function whole(text: string, most: number): number | undefined {
  return /^\d+$/.test(text) && Number(text) <= most ? Number(text) : undefined
}


// The environment first, then the flags, so that a flag wins.
function parse(argv: string[], env: { [name: string]: string | undefined }): Args | string {
  const args: Args = {}
  if (undefined !== env.PORT && '' !== env.PORT) {
    args.port = whole(env.PORT, 65535)
    if (undefined === args.port) return 'PORT is not a port: ' + env.PORT
  }
  if (undefined !== env.HOST && '' !== env.HOST) args.host = env.HOST

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (undefined === value || !['--port', '--host', '--seed', '--count', '--token'].includes(flag)) {
      return 'not understood: ' + argv.slice(i).join(' ')
    }
    i++
    if ('--port' === flag) {
      args.port = whole(value, 65535)
      if (undefined === args.port) return '--port is not a port: ' + value
    }
    else if ('--count' === flag) {
      args.count = whole(value, Number.MAX_SAFE_INTEGER)
      if (undefined === args.count) return '--count is not a whole number: ' + value
    }
    else if ('--host' === flag) args.host = value
    else if ('--seed' === flag) args.seed = value
    else args.token = value
  }
  return args
}


async function main(argv: string[]): Promise<number> {
  const args = parse(argv, process.env)
  if ('string' === typeof args) {
    process.stderr.write('ts-mock: ' + args + '\n' + USAGE)
    return 1
  }

  const mock = makeMock({ seed: args.seed, count: args.count, token: args.token })
  const server = await mock.listen(args.port, args.host)
  process.stdout.write('ts-mock: the ' + routes.api + ' mock is listening on ' + server.url + '\n')

  const stop = (): void => {
    void server.close()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return 0
}


main(process.argv.slice(2)).then(
  (code) => {
    if (0 !== code) process.exitCode = code
  },
  (err) => {
    process.stderr.write('ts-mock: ' + String((err as Error)?.message ?? err) + '\n')
    process.exitCode = 1
  })
