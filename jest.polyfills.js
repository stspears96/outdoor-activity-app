// Polyfills needed before Next.js route modules are imported in tests.
if (!global.Request) {
  global.Request = class Request {
    constructor(url, init = {}) {
      this.url = url;
      this.method = init.method || 'GET';
      this.headers = init.headers || {};
      this.body = init.body;
    }
  };
}

if (typeof jest !== 'undefined') {
  jest.mock('next/server', () => ({
    NextResponse: {
      json: (body, init) => ({
        status: init?.status ?? 200,
        json: async () => body,
      }),
    },
  }));
}
