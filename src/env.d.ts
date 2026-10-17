/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** Set by the Node edge (scripts/start.mjs) or the middleware: one per request. */
    requestId?: string;
    /** The request's child logger (requestId bound). */
    log?: import('./server/logging/logger').AppLogger;
    /** True when the Node edge already logs this request (production). */
    edgeLogged?: boolean;
  }
}
