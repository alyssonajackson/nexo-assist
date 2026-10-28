import { resetSeed } from './seed-reset'

export default function globalTeardown() {
  resetSeed()
}
