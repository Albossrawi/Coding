"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const Playlist = require("../lib/playlist.js");
const { createServer, rewritePlaylist, isAuthorized, isLoopback } = require("../server.js");

test("parseM3U reads attributes, quoted commas and skips non-http entries", () => {
  const text = [
    "#EXTM3U",
    '#EXTINF:-1 tvg-id="news.1" tvg-logo="http://logo/news.png" group-title="News",News, Live',
    "http://provider/live/news.m3u8",
    '#EXTINF:-1 group-title="Sport",Sports "Plus", HD',
    "rtmp://not-supported/sport",
    "#EXTINF:-1,",
    "http://provider/unnamed.m3u8"
  ].join("\n");

  const channels = Playlist.parseM3U(text);

  assert.equal(channels.length, 2);
  assert.deepEqual(channels[0], {
    name: "News, Live",
    logo: "http://logo/news.png",
    group: "News",
    tvgId: "news.1",
    url: "http://provider/live/news.m3u8"
  });
  assert.equal(channels[1].name, "Unnamed channel");
  assert.equal(channels[1].url, "http://provider/unnamed.m3u8");
});

test("parseM3U handles CRLF line endings", () => {
  const text = "#EXTM3U\r\n#EXTINF:-1,One\r\nhttp://p/1.m3u8\r\n";
  assert.equal(Playlist.parseM3U(text)[0].name, "One");
});

test("normalizeServer adds a scheme and strips trailing slashes", () => {
  assert.equal(Playlist.normalizeServer("provider.example:8080/"), "http://provider.example:8080");
  assert.equal(Playlist.normalizeServer(" https://p.example// "), "https://p.example");
  assert.throws(() => Playlist.normalizeServer("   "), /Server address is required/);
});

test("xtream URLs encode credentials and use HLS form", () => {
  const creds = { server: "p.example:8080", username: "ann lee", password: "p@ss/word" };

  assert.equal(
    Playlist.xtreamApiUrl(creds, "get_live_streams"),
    "http://p.example:8080/player_api.php?username=ann+lee&password=p%40ss%2Fword&action=get_live_streams"
  );
  assert.equal(
    Playlist.xtreamStreamUrl(creds, 42),
    "http://p.example:8080/live/ann%20lee/p%40ss%2Fword/42.m3u8"
  );
});

test("buildXtreamChannels maps categories onto streams", () => {
  const creds = { server: "http://p", username: "u", password: "p" };
  const categories = [{ category_id: "7", category_name: "Movies" }];
  const streams = [
    { stream_id: 1, name: "Cinema", stream_icon: "http://i/1.png", category_id: "7", epg_channel_id: "cinema" },
    { stream_id: 2, name: "", category_id: "99" }
  ];

  const channels = Playlist.buildXtreamChannels(creds, streams, categories);

  assert.equal(channels[0].group, "Movies");
  assert.equal(channels[0].logo, "http://i/1.png");
  assert.equal(channels[0].tvgId, "cinema");
  assert.equal(channels[0].url, "http://p/live/u/p/1.m3u8");
  assert.equal(channels[1].name, "Stream 2");
  assert.equal(channels[1].group, "");
  assert.deepEqual(Playlist.buildXtreamChannels(creds, null, null), []);
});

test("isHlsUrl recognises playlist URLs with and without query strings", () => {
  assert.equal(Playlist.isHlsUrl("http://p/a/b.m3u8"), true);
  assert.equal(Playlist.isHlsUrl("http://p/a/b.M3U8?token=1"), true);
  assert.equal(Playlist.isHlsUrl("http://p/a/b.ts"), false);
});

test("rewritePlaylist routes segments and key URIs through the proxy", () => {
  const playlist = [
    "#EXTM3U",
    '#EXT-X-KEY:METHOD=AES-128,URI="keys/k.bin"',
    "#EXTINF:4.0,",
    "seg/1.ts",
    "#EXTINF:4.0,",
    "https://cdn.example/abs.ts?x=1",
    ""
  ].join("\n");

  const out = rewritePlaylist(playlist, "http://p.example/live/u/p/1.m3u8");

  assert.match(out, /URI="\/proxy\?url=http%3A%2F%2Fp\.example%2Flive%2Fu%2Fp%2Fkeys%2Fk\.bin"/);
  assert.ok(out.includes("/proxy?url=" + encodeURIComponent("http://p.example/live/u/p/seg/1.ts")));
  assert.ok(out.includes("/proxy?url=" + encodeURIComponent("https://cdn.example/abs.ts?x=1")));
  assert.ok(out.includes("#EXTINF:4.0,"));
});

test("proxy rewrites playlists, streams segments, and rejects bad targets", async () => {
  const provider = http.createServer((req, res) => {
    if (req.url === "/live/stream.m3u8") {
      res.writeHead(200, { "Content-Type": "application/x-mpegURL" });
      return res.end("#EXTM3U\n#EXTINF:4,\nseg.ts\n");
    }
    if (req.url === "/live/seg.ts") {
      res.writeHead(200, { "Content-Type": "video/mp2t" });
      return res.end(Buffer.from([0x47, 0x40, 0x00, 0x10]));
    }
    if (req.url === "/raw.m3u") {
      res.writeHead(200, { "Content-Type": "audio/x-mpegurl" });
      return res.end("#EXTM3U\n#EXTINF:-1,Raw\nhttp://elsewhere/x.m3u8\n");
    }
    res.writeHead(404);
    res.end("nope");
  });
  const app = createServer();
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));

  const origin = `http://127.0.0.1:${app.address().port}`;
  const upstream = `http://127.0.0.1:${provider.address().port}`;
  const proxy = (target, extra = "") => `${origin}/proxy?${extra}url=${encodeURIComponent(target)}`;

  try {
    const playlistRes = await fetch(proxy(`${upstream}/live/stream.m3u8`));
    const playlistBody = await playlistRes.text();
    assert.equal(playlistRes.status, 200);
    assert.ok(playlistBody.includes(encodeURIComponent(`${upstream}/live/seg.ts`)));

    const segmentRes = await fetch(proxy(`${upstream}/live/seg.ts`));
    const segment = Buffer.from(await segmentRes.arrayBuffer());
    assert.equal(segmentRes.headers.get("content-type"), "video/mp2t");
    assert.deepEqual([...segment], [0x47, 0x40, 0x00, 0x10]);

    const rawRes = await fetch(proxy(`${upstream}/raw.m3u`, "raw=1&"));
    assert.equal(await rawRes.text(), "#EXTM3U\n#EXTINF:-1,Raw\nhttp://elsewhere/x.m3u8\n");

    const missing = await fetch(proxy(`${upstream}/missing`));
    assert.equal(missing.status, 404);

    const fileScheme = await fetch(proxy("file:///etc/passwd"));
    assert.equal(fileScheme.status, 400);

    const badUrl = await fetch(`${origin}/proxy?url=not-a-url`);
    assert.equal(badUrl.status, 400);

    const page = await fetch(`${origin}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>IPTV Player<\/title>/);

    const traversal = await fetch(`${origin}/..%2fpackage.json`);
    assert.equal(traversal.status, 404);
  } finally {
    app.close();
    provider.close();
  }
});

test("isAuthorized accepts only the configured password via Basic auth", () => {
  const basic = (value) => ({ headers: { authorization: "Basic " + Buffer.from(value).toString("base64") } });

  assert.equal(isAuthorized({ headers: {} }, ""), true);
  assert.equal(isAuthorized({ headers: {} }, "s3cret"), false);
  assert.equal(isAuthorized(basic("anyone:s3cret"), "s3cret"), true);
  assert.equal(isAuthorized(basic(":s3cret"), "s3cret"), true);
  assert.equal(isAuthorized(basic("anyone:wrong!"), "s3cret"), false);
  assert.equal(isAuthorized(basic("anyone:s3cre"), "s3cret"), false);
  assert.equal(isAuthorized({ headers: { authorization: "Bearer s3cret" } }, "s3cret"), false);
});

test("isLoopback identifies local-only hosts", () => {
  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("localhost"), true);
  assert.equal(isLoopback("0.0.0.0"), false);
});

test("password-protected server rejects anonymous requests before proxying", async () => {
  const app = createServer({ password: "s3cret" });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${app.address().port}`;
  const auth = "Basic " + Buffer.from("u:s3cret").toString("base64");

  try {
    const anonymous = await fetch(`${origin}/proxy?url=${encodeURIComponent("http://example.invalid/")}`);
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers.get("www-authenticate"), /^Basic /);

    const page = await fetch(`${origin}/`);
    assert.equal(page.status, 401);

    const authed = await fetch(`${origin}/`, { headers: { Authorization: auth } });
    assert.equal(authed.status, 200);
  } finally {
    app.close();
  }
});
