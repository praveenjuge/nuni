/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as auth from "../auth.js";
import type * as authors from "../authors.js";
import type * as cliAuth from "../cliAuth.js";
import type * as commentInput from "../commentInput.js";
import type * as commenters from "../commenters.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as digestEmail from "../digestEmail.js";
import type * as digests from "../digests.js";
import type * as http from "../http.js";
import type * as httpRoutes from "../httpRoutes.js";
import type * as lib from "../lib.js";
import type * as lifecycle from "../lifecycle.js";
import type * as limits from "../limits.js";
import type * as ownership from "../ownership.js";
import type * as pins from "../pins.js";
import type * as projects from "../projects.js";
import type * as rateLimits from "../rateLimits.js";
import type * as reactions from "../reactions.js";
import type * as replies from "../replies.js";
import type * as sessions from "../sessions.js";
import type * as testing from "../testing.js";
import type * as tokens from "../tokens.js";
import type * as transfers from "../transfers.js";
import type * as uploads from "../uploads.js";
import type * as users from "../users.js";
import type * as views from "../views.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  auth: typeof auth;
  authors: typeof authors;
  cliAuth: typeof cliAuth;
  commentInput: typeof commentInput;
  commenters: typeof commenters;
  comments: typeof comments;
  crons: typeof crons;
  digestEmail: typeof digestEmail;
  digests: typeof digests;
  http: typeof http;
  httpRoutes: typeof httpRoutes;
  lib: typeof lib;
  lifecycle: typeof lifecycle;
  limits: typeof limits;
  ownership: typeof ownership;
  pins: typeof pins;
  projects: typeof projects;
  rateLimits: typeof rateLimits;
  reactions: typeof reactions;
  replies: typeof replies;
  sessions: typeof sessions;
  testing: typeof testing;
  tokens: typeof tokens;
  transfers: typeof transfers;
  uploads: typeof uploads;
  users: typeof users;
  views: typeof views;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  workOSAuthKit: import("@convex-dev/workos-authkit/_generated/component.js").ComponentApi<"workOSAuthKit">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
