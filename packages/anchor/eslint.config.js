import base from "@nuni/eslint-config/base"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([
  globalIgnores(["bench/.bundle/**", "test-results/**"]),
  ...base,
])
