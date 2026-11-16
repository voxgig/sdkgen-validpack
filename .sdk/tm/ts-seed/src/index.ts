
import { plan } from './plan'
import { makeSeedFor } from './engine'

import type { Seed, SeedOptions } from './engine'

export type {
  Json, Row, PatNode, Spec, Field, Parent, IdPlan, EntityPlan, Note, Plan,
  SeedOptions, Miss, Seed,
} from './engine'


export function makeSeed(options?: SeedOptions): Seed {
  return makeSeedFor(plan, options)
}


export { plan, makeSeedFor }
