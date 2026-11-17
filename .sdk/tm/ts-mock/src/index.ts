
import { routes } from './routes'
import { makeMockFor } from './mock'

import type { Mock, MockOptions, SeedLibrary } from './mock'

export type {
  Json, Row, Param, Shape, Fill, Route, Auth, Note, Routes, SeedOptions, MockOptions,
  SeedLike, SeedLibrary, Query, Recorded, Req, Res, Listening, Mock,
} from './mock'

// Declared here so that the mock needs no type package to compile.
declare const require: (id: string) => unknown
declare const __dirname: string


// The seed library is found beside this one, by the path the routes name, when the mock starts.
export function seedLibrary(): SeedLibrary {
  const where = __dirname + '/' + routes.seed
  try {
    return require(where) as SeedLibrary
  }
  catch (err) {
    const e = err as { code?: string, message?: string }
    if ('MODULE_NOT_FOUND' === e?.code && String(e.message).includes(where)) {
      throw new Error('ts-mock: no seed library at ' + where +
        ': build the ts-seed library first, with npm install and npm run build in its folder')
    }
    throw err
  }
}


export function makeMock(options?: MockOptions): Mock {
  return makeMockFor(routes, seedLibrary(), options)
}


export { routes, makeMockFor }
