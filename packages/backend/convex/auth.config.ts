import type { AuthConfig } from "convex/server"

const clientId = process.env.WORKOS_CLIENT_ID
// Convex auth-config evaluation throws on absent environment variables.
function workosApiUrl(): string {
  try {
    return process.env.WORKOS_API_URL ?? "https://api.workos.com"
  } catch {
    return "https://api.workos.com"
  }
}
const apiUrl = workosApiUrl().replace(/\/$/, "")

export default {
  providers: clientId
    ? [
        {
          type: "customJwt",
          issuer: `${apiUrl}/`,
          algorithm: "RS256",
          jwks: `${apiUrl}/sso/jwks/${clientId}`,
          applicationID: clientId,
        },
        {
          type: "customJwt",
          issuer: `${apiUrl}/user_management/${clientId}`,
          algorithm: "RS256",
          jwks: `${apiUrl}/sso/jwks/${clientId}`,
        },
      ]
    : [],
} satisfies AuthConfig
