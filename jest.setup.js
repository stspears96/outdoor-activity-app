require('@testing-library/jest-dom');
// Ensure Web Request/Response are available for Next.js route handlers in Jest.
try {
  const { Request, Response, Headers, fetch } = require('undici');
  if (!global.Request) global.Request = Request;
  if (!global.Response) global.Response = Response;
  if (!global.Headers) global.Headers = Headers;
  if (!global.fetch) global.fetch = fetch;
} catch {
  // If undici isn't available, tests that rely on Request/Response will fail.
}
