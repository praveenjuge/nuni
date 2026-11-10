import { httpRouter } from "convex/server"

import { authKit } from "./auth"
import { cliLoginRoutes } from "./cliAuth"
import { commentRoutes } from "./comments"
import { pinRoutes } from "./pins"
import { replyRoutes } from "./replies"
import { uploadRoutes } from "./uploads"

/** Every HTTP route, each registered next to the function it calls. */
const http = httpRouter()

authKit.registerRoutes(http)
commentRoutes(http)
replyRoutes(http)
pinRoutes(http)
uploadRoutes(http)
cliLoginRoutes(http)

export default http
