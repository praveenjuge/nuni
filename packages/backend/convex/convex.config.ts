import rateLimiter from "@convex-dev/rate-limiter/convex.config.js"
import workOSAuthKit from "@convex-dev/workos-authkit/convex.config"
import { defineApp } from "convex/server"

const app = defineApp()
app.use(workOSAuthKit)
app.use(rateLimiter)

export default app
