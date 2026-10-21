(function () {
  "use strict";

  var STORAGE_KEY = "iptv-player-source";

  var els = {
    status: document.getElementById("status"),
    error: document.getElementById("error"),
    account: document.getElementById("account"),
    playerError: document.getElementById("player-error"),
    nowPlaying: document.getElementById("now-playing"),
    video: document.getElementById("video"),
    m3uForm: document.getElementById("m3u-form"),
    m3uUrl: document.getElementById("m3u-url"),
    xtreamForm: document.getElementById("xtream-form"),
    xtreamServer: document.getElementById("xtream-server"),
    xtreamUser: document.getElementById("xtream-user"),
    xtreamPass: document.getElementById("xtream-pass"),
    search: document.getElementById("search"),
    group: document.getElementById("group"),
    count: document.getElementById("channel-count"),
    list: document.getElementById("channels")
  };

  var state = {
    channels: [],
    currentIndex: -1,
    hls: null
  };

  function setStatus(text) {
    els.status.textContent = text;
  }

  function showError(message) {
    els.error.textContent = message || "";
    els.error.hidden = !message;
  }

  function showPlayerError(message) {
    els.playerError.textContent = message || "";
    els.playerError.hidden = !message;
  }

  // Requests for catalogs and playlists skip playlist rewriting (raw=1).
  function proxied(url, raw) {
    return "/proxy?" + (raw ? "raw=1&" : "") + "url=" + encodeURIComponent(url);
  }

  function fetchText(url) {
    return fetch(proxied(url, true)).then(function (res) {
      return res.text().then(function (body) {
        if (!res.ok) {
          throw new Error("Provider returned " + res.status + (body ? ": " + body.slice(0, 200) : ""));
        }
        return body;
      });
    });
  }

  function fetchJson(url) {
    return fetchText(url).then(function (body) {
      try {
        return JSON.parse(body);
      } catch (err) {
        throw new Error("Provider did not return JSON. Check the server address.");
      }
    });
  }

  function loadM3U(url) {
    return fetchText(url).then(function (text) {
      var channels = Playlist.parseM3U(text);
      if (!channels.length) {
        throw new Error("No playable channels found in that playlist.");
      }
      return { channels: channels, account: null };
    });
  }

  function describeAccount(user) {
    var parts = ["Account: " + (user.status || "unknown")];
    var expiry = Number(user.exp_date);
    if (expiry) {
      parts.push("expires " + new Date(expiry * 1000).toLocaleDateString());
    }
    if (user.max_connections) {
      parts.push(user.max_connections + " connection(s)");
    }
    return parts.join(", ");
  }

  function loadXtream(creds) {
    var categoriesUrl = Playlist.xtreamApiUrl(creds, "get_live_categories");
    var streamsUrl = Playlist.xtreamApiUrl(creds, "get_live_streams");
    var account = null;

    return fetchJson(Playlist.xtreamApiUrl(creds))
      .then(function (info) {
        var user = info && info.user_info;
        if (!user || Number(user.auth) !== 1) {
          throw new Error("Login failed. Check the server, username and password.");
        }
        account = describeAccount(user);
        return Promise.all([fetchJson(categoriesUrl), fetchJson(streamsUrl)]);
      })
      .then(function (results) {
        return {
          channels: Playlist.buildXtreamChannels(creds, results[1], results[0]),
          account: account
        };
      });
  }

  function saveSource(source) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(source));
    } catch (err) {
      /* storage can be blocked; the app works without it */
    }
  }

  function restoreSource() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) {
        return;
      }
      if (saved.type === "xtream") {
        selectTab("xtream");
        els.xtreamServer.value = saved.server || "";
        els.xtreamUser.value = saved.username || "";
      } else if (saved.type === "m3u") {
        els.m3uUrl.value = saved.url || "";
      }
    } catch (err) {
      /* ignore corrupt or unavailable storage */
    }
  }

  function setBusy(busy) {
    els.m3uForm.querySelector("button").disabled = busy;
    els.xtreamForm.querySelector("button").disabled = busy;
  }

  function loadChannels(factory, source) {
    setBusy(true);
    showError("");
    els.account.hidden = true;
    setStatus("Loading channels…");

    return Promise.resolve()
      .then(factory)
      .then(function (result) {
        state.channels = result.channels;
        state.currentIndex = -1;
        if (result.account) {
          els.account.textContent = result.account;
          els.account.hidden = false;
        }
        renderGroups();
        renderChannels();
        setStatus(result.channels.length + " channels loaded");
        saveSource(source);
      })
      .catch(function (err) {
        state.channels = [];
        renderGroups();
        renderChannels();
        showError(err.message || "Could not load channels.");
        setStatus("Not loaded");
      })
      .finally(function () {
        setBusy(false);
      });
  }

  function renderGroups() {
    var current = els.group.value;
    var seen = {};
    var groups = [];

    state.channels.forEach(function (channel) {
      if (channel.group && !seen[channel.group]) {
        seen[channel.group] = true;
        groups.push(channel.group);
      }
    });
    groups.sort();

    els.group.textContent = "";
    els.group.appendChild(new Option("All groups", ""));
    groups.forEach(function (group) {
      els.group.appendChild(new Option(group, group));
    });
    els.group.value = seen[current] ? current : "";
  }

  // Returns the channels matching the current search and group filters,
  // paired with their index in state.channels so playback state stays stable.
  function visibleChannels() {
    var query = els.search.value.trim().toLowerCase();
    var group = els.group.value;
    var matches = [];

    state.channels.forEach(function (channel, index) {
      if (group && channel.group !== group) {
        return;
      }
      if (query && channel.name.toLowerCase().indexOf(query) === -1) {
        return;
      }
      matches.push({ channel: channel, index: index });
    });
    return matches;
  }

  function renderChannels() {
    var matches = visibleChannels();
    els.list.textContent = "";

    matches.forEach(function (match) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      var text = document.createElement("span");
      var name = document.createElement("span");
      var group = document.createElement("span");

      button.type = "button";
      button.className = "channel-button";
      button.setAttribute("aria-current", String(match.index === state.currentIndex));
      button.addEventListener("click", function () {
        playChannel(match.index);
      });

      text.className = "channel-text";
      name.className = "channel-name";
      name.textContent = match.channel.name;
      group.className = "channel-group";
      group.textContent = match.channel.group;
      text.appendChild(name);
      if (match.channel.group) {
        text.appendChild(group);
      }

      if (match.channel.logo) {
        var logo = document.createElement("img");
        logo.className = "channel-logo";
        logo.loading = "lazy";
        logo.alt = "";
        logo.referrerPolicy = "no-referrer";
        logo.src = match.channel.logo;
        logo.addEventListener("error", function () {
          logo.remove();
        });
        button.appendChild(logo);
      }

      button.appendChild(text);
      item.appendChild(button);
      els.list.appendChild(item);
    });

    els.count.textContent = matches.length + " of " + state.channels.length + " shown";
  }

  function destroyPlayer() {
    if (state.hls) {
      state.hls.destroy();
      state.hls = null;
    }
    els.video.removeAttribute("src");
    els.video.load();
  }

  function handleHlsError(data) {
    if (!data.fatal) {
      return;
    }
    destroyPlayer();
    showPlayerError("Stream failed (" + (data.details || data.type) + "). Try another channel.");
  }

  function playChannel(index) {
    var channel = state.channels[index];
    if (!channel) {
      return;
    }

    destroyPlayer();
    showPlayerError("");
    state.currentIndex = index;
    els.nowPlaying.textContent = channel.name;
    renderChannels();

    var src = proxied(channel.url, false);

    if (Playlist.isHlsUrl(channel.url) && window.Hls && Hls.isSupported()) {
      var hls = new Hls();
      state.hls = hls;
      hls.on(Hls.Events.ERROR, function (_, data) {
        handleHlsError(data);
      });
      hls.loadSource(src);
      hls.attachMedia(els.video);
    } else {
      // Safari plays HLS natively; other formats are tried as-is.
      els.video.src = src;
    }

    els.video.play().catch(function () {
      /* autoplay can be blocked; the user can press play */
    });
  }

  els.video.addEventListener("error", function () {
    if (els.video.getAttribute("src")) {
      showPlayerError("This browser could not play the stream. Try another channel.");
    }
  });

  function selectTab(name) {
    document.querySelectorAll(".tab").forEach(function (tab) {
      var active = tab.getAttribute("data-tab") === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    els.m3uForm.hidden = name !== "m3u";
    els.xtreamForm.hidden = name !== "xtream";
  }

  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      selectTab(tab.getAttribute("data-tab"));
    });
  });

  els.m3uForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var url = els.m3uUrl.value.trim();
    loadChannels(function () {
      return loadM3U(url);
    }, { type: "m3u", url: url });
  });

  els.xtreamForm.addEventListener("submit", function (event) {
    event.preventDefault();
    var server = els.xtreamServer.value.trim();
    var username = els.xtreamUser.value.trim();
    var password = els.xtreamPass.value;
    loadChannels(function () {
      return loadXtream({ server: server, username: username, password: password });
    }, { type: "xtream", server: server, username: username });
  });

  els.search.addEventListener("input", renderChannels);
  els.group.addEventListener("change", renderChannels);

  restoreSource();
})();
