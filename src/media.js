// Serves uploaded audio and covers from R2, with Range support so seeking works.
export async function handleMedia(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }
  const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/media\//, ""));
  if (!/^(audio|covers)\//.test(key)) return new Response("Not found", { status: 404 });

  const hasRange = request.headers.has("range");
  const obj = await env.BUCKET.get(key, hasRange ? { range: request.headers } : {});
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  // Keys include a random suffix, so files never change once uploaded.
  headers.set("cache-control", "public, max-age=31536000, immutable");

  const body = request.method === "HEAD" ? null : obj.body;
  if (hasRange && obj.range) {
    const r = obj.range;
    let start, end;
    if ("suffix" in r) { start = obj.size - r.suffix; end = obj.size - 1; }
    else { start = r.offset || 0; end = r.length != null ? start + r.length - 1 : obj.size - 1; }
    headers.set("content-range", `bytes ${start}-${end}/${obj.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(body, { headers });
}
