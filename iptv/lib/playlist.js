// Parsing and URL helpers shared by the browser app and the Node tests.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Playlist = api;
  }
})(this, function () {
  "use strict";

  // Index of the first comma that is not inside double quotes, or -1.
  function findNameSeparator(text) {
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        return i;
      }
    }
    return -1;
  }

  function parseAttributes(text) {
    var attrs = {};
    var re = /([\w-]+)="([^"]*)"/g;
    var match;
    while ((match = re.exec(text)) !== null) {
      attrs[match[1].toLowerCase()] = match[2];
    }
    return attrs;
  }

  function isHttpUrl(value) {
    return /^https?:\/\//i.test(value);
  }

  // Parses an M3U / M3U8 playlist into [{ name, logo, group, tvgId, url }].
  function parseM3U(text) {
    var channels = [];
    var pending = null;

    String(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();

      if (line.indexOf("#EXTINF:") === 0) {
        var info = line.slice("#EXTINF:".length);
        var sep = findNameSeparator(info);
        var attrs = parseAttributes(sep === -1 ? info : info.slice(0, sep));
        var title = sep === -1 ? "" : info.slice(sep + 1).trim();

        pending = {
          name: title || attrs["tvg-name"] || "Unnamed channel",
          logo: attrs["tvg-logo"] || "",
          group: attrs["group-title"] || "",
          tvgId: attrs["tvg-id"] || ""
        };
      } else if (line && line.charAt(0) !== "#" && pending) {
        if (isHttpUrl(line)) {
          pending.url = line;
          channels.push(pending);
        }
        pending = null;
      }
    });

    return channels;
  }

  // Accepts "provider.example:8080", "http://provider.example/" and so on.
  function normalizeServer(server) {
    var trimmed = String(server || "").trim().replace(/\/+$/, "");
    if (!trimmed) {
      throw new Error("Server address is required.");
    }
    return isHttpUrl(trimmed) ? trimmed : "http://" + trimmed;
  }

  // Xtream Codes player API, e.g. action "get_live_streams".
  function xtreamApiUrl(creds, action) {
    var params = new URLSearchParams({
      username: creds.username,
      password: creds.password
    });
    if (action) {
      params.set("action", action);
    }
    return normalizeServer(creds.server) + "/player_api.php?" + params.toString();
  }

  // Xtream Codes live stream in HLS form, playable with hls.js.
  function xtreamStreamUrl(creds, streamId) {
    return (
      normalizeServer(creds.server) +
      "/live/" +
      encodeURIComponent(creds.username) +
      "/" +
      encodeURIComponent(creds.password) +
      "/" +
      encodeURIComponent(streamId) +
      ".m3u8"
    );
  }

  // Turns Xtream get_live_streams / get_live_categories results into channels.
  function buildXtreamChannels(creds, streams, categories) {
    var groupNames = {};
    (Array.isArray(categories) ? categories : []).forEach(function (cat) {
      groupNames[cat.category_id] = cat.category_name;
    });

    return (Array.isArray(streams) ? streams : []).map(function (stream) {
      return {
        name: stream.name || "Stream " + stream.stream_id,
        logo: stream.stream_icon || "",
        group: groupNames[stream.category_id] || "",
        tvgId: stream.epg_channel_id || "",
        url: xtreamStreamUrl(creds, stream.stream_id)
      };
    });
  }

  function isHlsUrl(url) {
    return /\.m3u8?(\?|#|$)/i.test(String(url));
  }

  return {
    parseM3U: parseM3U,
    normalizeServer: normalizeServer,
    xtreamApiUrl: xtreamApiUrl,
    xtreamStreamUrl: xtreamStreamUrl,
    buildXtreamChannels: buildXtreamChannels,
    isHlsUrl: isHlsUrl
  };
});
