import handler from "../../../../api/[...route].js";

export const prerender = false;

async function dispatch({ request }) {
  const url = new URL(request.url);
  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers: Object.fromEntries(request.headers.entries())
  };
  let statusCode = 200;
  const responseHeaders = {};
  let body = null;
  const res = {
    setHeader(name, value) { responseHeaders[name] = value; return this; },
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; }
  };
  await handler(req, res);
  return new Response(JSON.stringify(body ?? { error: "Empty API response" }), {
    status: statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", ...responseHeaders }
  });
}

export const GET = dispatch;
