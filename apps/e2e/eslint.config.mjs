import base from "@nuni/eslint-config/base"
import { defineConfig, globalIgnores } from "eslint/config"
export default defineConfig([
  globalIgnores(["test-results/**", "playwright-report/**", ".claude/**"]),
  ...base,
])
