import type { RocketBridge } from '../../shared/types.ts'

declare global {
  interface Window {
    rocket: RocketBridge
  }
}
