# IPTV Player

A small web app that plays live TV channels from an IPTV provider. Sign in with either:

- **M3U link**: the playlist URL your provider gave you (usually `get.php?...&type=m3u_plus`).
- **Login**: the server address, username and password (Xtream Codes style).

Channels are listed with search and group filters. Click one to play it.

## Run it

Requires Node.js 18 or newer. There are no dependencies to install.

```sh
cd iptv
npm start
# open http://127.0.0.1:8080
```

Use `PORT=9000 npm start` to change the port.

## Why there is a server

Providers rarely send CORS headers, so a browser cannot download their playlists or
HLS segments directly. `server.js` serves the page and forwards requests through
`/proxy`. For HLS playlists it also rewrites segment URLs so the player fetches them
through the proxy as well.

The proxy accepts any http or https URL. It listens on `127.0.0.1` by default, so only
your own machine can reach it. Do not set `HOST=0.0.0.0` on a public network unless
you add authentication in front of it.

Set `IPTV_USER_AGENT` if your provider only accepts a specific player user agent.

## Files

- `index.html`, `styles.css`, `app.js`: the page and player logic. hls.js is loaded from jsDelivr.
- `lib/playlist.js`: M3U parsing and Xtream URL helpers (no browser APIs, so it is unit tested).
- `server.js`: static files, `/proxy`, and playlist rewriting.
- `test/playlist.test.js`: tests for parsing, URL building, playlist rewriting and the proxy. Run with `npm test`.

## Behaviour and limits

- Streams are played with hls.js when the URL ends in `.m3u8`. Xtream logins build `.m3u8` URLs.
- Other stream formats (for example raw MPEG-TS URLs) only play where the browser can play them natively. Safari plays HLS natively, so it works without hls.js.
- The server and username are remembered in this browser's local storage. The password is never stored. M3U URLs often contain the password in the query string, so the M3U URL is stored in full. Clear it by deleting `iptv-player-source` from local storage.
- Login requests pass your password through this server to the provider. Run the server only on machines you control.
- Only stream channels you have the right to watch.
