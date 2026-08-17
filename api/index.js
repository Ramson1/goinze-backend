/**
 * Vercel serverless function entry point.
 * Delegates to the compiled NestJS handler in dist/vercel.js.
 * This file must live in the api/ directory for Vercel to recognise it.
 */
module.exports = require('../dist/vercel.js').default;
