import base from "@nuni/eslint-config/base"
import { defineConfig, globalIgnores } from "eslint/config"

export default defineConfig([globalIgnores(["dist/**"]), ...base])
