import { defineMiddleware } from 'astro:middleware';
import { handleRequest } from './server/middleware/pipeline';

/** Request context, guard, security headers and request logging (src/server/middleware). */
export const onRequest = defineMiddleware((context, next) => handleRequest(context, next));
