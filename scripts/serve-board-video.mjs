import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, join, resolve } from "node:path";

const host = process.env.SANDFEST_VIDEO_HOST || "127.0.0.1";
const port = Number(process.env.SANDFEST_VIDEO_PORT || 8900);
const root = resolve(process.env.SANDFEST_VIDEO_ROOT || "artifacts/board-presentation-demo/h3/host");
const allowed = new Set([
  "index.html",
  "texas-sandfest-world-class-board-demo.mp4",
  "texas-sandfest-world-class-board-demo-poster.jpg",
]);
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".jpg", "image/jpeg"],
]);

function requestedName(url) {
  const pathname = new URL(url, "http://localhost").pathname;
  if (pathname === "/") return "index.html";
  const name = basename(decodeURIComponent(pathname));
  return allowed.has(name) ? name : null;
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value || "");
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null && end !== null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else {
    start ??= 0;
    end = Math.min(end ?? size - 1, size - 1);
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= size) return null;
  return { start, end };
}

const server = createServer(async (request, response) => {
  try {
    if (!new Set(["GET", "HEAD"]).has(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const name = requestedName(request.url);
    if (!name || !allowed.has(name)) {
      response.writeHead(404).end("Not found\n");
      return;
    }
    const path = join(root, name);
    const info = await stat(path);
    const range = parseRange(request.headers.range, info.size);
    const headers = {
      "Accept-Ranges": "bytes",
      "Content-Type": contentTypes.get(extname(path)) || "application/octet-stream",
      "Cache-Control": name === "index.html" ? "no-store" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    };
    if (request.headers.range && !range) {
      response.writeHead(416, { ...headers, "Content-Range": `bytes */${info.size}` }).end();
      return;
    }
    if (range) {
      response.writeHead(206, {
        ...headers,
        "Content-Length": range.end - range.start + 1,
        "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`,
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(path, range).pipe(response);
      return;
    }
    response.writeHead(200, { ...headers, "Content-Length": info.size });
    if (request.method === "HEAD") response.end();
    else createReadStream(path).pipe(response);
  } catch (error) {
    const status = error?.code === "ENOENT" ? 404 : 500;
    response.writeHead(status).end(status === 404 ? "Not found\n" : "Server error\n");
  }
});

server.listen(port, host, () => {
  console.log(`SandFest board video: http://${host}:${port}/`);
});
