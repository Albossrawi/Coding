"use strict";

// Static file server plus a small proxy. IPTV providers rarely send CORS
// headers, so the browser cannot fetch their playlists or HLS segments
// directly. Everything goes through /proxy on this server instead.
//
//   node server.js                 -> http://127.0.0.1:8080
//   PORT=9000 HOST=0.0.0.0 node server.js
//
// Binding to any non-local HOST requires IPTV_PASSWORD, because anyone who can
// reach the server could otherwise use /proxy to fetch arbitrary http(s) URLs.

const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline, Readable } = require("node:stream");

const ROOT = __dirname;
const UPSTREAM_TIMEOUT_MS = 15000;
const USER_AGENT = process.env.IPTV_USER_AGENT || "Mozilla/5.0 (IPTV web player)";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendText(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function toProxyPath(ref, baseUrl) {
  try {
    return "/proxy?url=" + encodeURIComponent(new URL(ref, baseUrl).href);
  } catch (err) {
    return ref;
  }
}

// Routes every segment and key URI in an HLS playlist through /proxy.
function rewritePlaylist(text, baseUrl) {
  return text
    .split(/\r?\n/)
    .map(function (line) {
      if (!line.trim()) {
        return line;
      }
      if (line.charAt(0) === "#") {
        return line.replace(/URI="([^"]+)"/g, function (_, uri) {
          return 'URI="' + toProxyPath(uri, baseUrl) + '"';
        });
      }
      return toProxyPath(line.trim(), baseUrl);
    })
    .join("\n");
}

function looksLikePlaylist(url, contentType) {
  return /\.m3u8?$/i.test(new URL(url).pathname) || /mpegurl/i.test(contentType);
}

async function handleProxy(req, res, requestUrl) {
  const target = requestUrl.searchParams.get("url") || "";
  const raw = requestUrl.searchParams.get("raw") === "1";

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch (err) {
    return sendText(res, 400, "Missing or invalid url parameter.");
  }
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return sendText(res, 400, "Only http and https URLs are allowed.");
  }

  // The timeout covers only the wait for response headers, so long-running
  // stream bodies are not cut off.
  const controller = new AbortController();
  const timer = setTimeout(function () {
    controller.abort();
  }, UPSTREAM_TIMEOUT_MS);

  let upstream;
  try {
    const headers = { "User-Agent": USER_AGENT, Accept: "*/*" };
    if (req.headers.range) {
      headers.Range = req.headers.range;
    }
    upstream = await fetch(targetUrl, {
      headers: headers,
      redirect: "follow",
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    return sendText(res, 502, "Could not reach the provider: " + err.message);
  }
  clearTimeout(timer);

  const contentType = upstream.headers.get("content-type") || "";
  const finalUrl = upstream.url || targetUrl.href;

  try {
    if (!raw && upstream.ok && looksLikePlaylist(finalUrl, contentType)) {
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store"
      });
      return res.end(rewritePlaylist(text, finalUrl));
    }

    // Content-Length is deliberately not forwarded: fetch() decompresses the
    // body, so the upstream length would no longer match what is sent.
    const headers = { "Cache-Control": "no-store" };
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    res.writeHead(upstream.status, headers);
    if (!upstream.body) {
      return res.end();
    }
    pipeline(Readable.fromWeb(upstream.body), res, function () {});
  } catch (err) {
    if (!res.headersSent) {
      sendText(res, 502, "Provider response could not be read: " + err.message);
    } else {
      res.destroy();
    }
  }
}

function serveStatic(res, pathname) {
  let requested;
  try {
    requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  } catch (err) {
    return sendText(res, 400, "Bad request path.");
  }

  const filePath = path.join(ROOT, path.normalize(requested));
  const mime = MIME[path.extname(filePath)];
  if (!filePath.startsWith(ROOT + path.sep) || !mime) {
    return sendText(res, 404, "Not found");
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      return sendText(res, 404, "Not found");
    }
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" });
    res.end(data);
  });
}

// Basic auth with any username and the password from IPTV_PASSWORD. The
// browser asks once and then sends the same credentials to /proxy.
function isAuthorized(req, password) {
  if (!password) {
    return true;
  }
  const match = /^Basic (.+)$/i.exec(req.headers.authorization || "");
  if (!match) {
    return false;
  }
  const supplied = Buffer.from(match[1], "base64").toString("utf8");
  const separator = supplied.indexOf(":");
  const given = Buffer.from(separator === -1 ? "" : supplied.slice(separator + 1));
  const expected = Buffer.from(password);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function isLoopback(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function createServer(options) {
  const password = options && "password" in options ? options.password : process.env.IPTV_PASSWORD || "";

  return http.createServer(function (req, res) {
    if (!isAuthorized(req, password)) {
      res.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="IPTV Player", charset="UTF-8"',
        "Content-Type": "text/plain; charset=utf-8"
      });
      return res.end("Password required.");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendText(res, 405, "Method not allowed");
    }
    const requestUrl = new URL(req.url, "http://localhost");
    if (requestUrl.pathname === "/proxy") {
      return handleProxy(req, res, requestUrl);
    }
    return serveStatic(res, requestUrl.pathname);
  });
}

module.exports = { createServer, rewritePlaylist, isAuthorized, isLoopback };

if (require.main === module) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT) || 8080;
  const password = process.env.IPTV_PASSWORD || "";

  // Refuse to expose the open proxy on a network interface without a password.
  if (!isLoopback(host) && !password) {
    console.error("Set IPTV_PASSWORD before listening on HOST=" + host + ".");
    process.exit(1);
  }

  createServer().listen(port, host, function () {
    console.log("IPTV player running at http://" + host + ":" + port);
  });
}
