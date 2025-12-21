import type { AppConfig } from "../config"
import { appConfig, setAppEnvironment } from "../config"

export type Config = AppConfig
export { appConfig, setAppEnvironment }

export function resolveConfig(): Config {
  return appConfig
}
