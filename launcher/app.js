(function () {
  var grid = document.getElementById("grid");
  var empty = document.getElementById("empty");
  var clock = document.getElementById("clock");
  var tiles = [];
  var focusIndex = 0;

  // Hide/pin lists are read from apps.json next to index.html.
  function loadConfig(callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "apps.json", true);
    xhr.onload = function () {
      var cfg = { hidden: [], pinned: [] };
      try { cfg = JSON.parse(xhr.responseText); } catch (e) { /* keep defaults */ }
      callback(cfg);
    };
    xhr.onerror = function () { callback({ hidden: [], pinned: [] }); };
    xhr.send();
  }

  // Ask webOS for the installed apps instead of hard-coding them.
  function listApps(callback) {
    webOS.service.request("luna://com.webos.applicationManager", {
      method: "listApps",
      parameters: {},
      onSuccess: function (res) { callback(null, res.apps || []); },
      onFailure: function (err) { callback(err, []); }
    });
  }

  function launch(appId) {
    webOS.service.request("luna://com.webos.applicationManager", {
      method: "launch",
      parameters: { id: appId },
      onFailure: function (err) { console.error("launch failed", appId, err); }
    });
  }

  function buildTiles(apps, cfg) {
    var hidden = {};
    cfg.hidden.forEach(function (id) { hidden[id] = true; });

    var pinOrder = {};
    cfg.pinned.forEach(function (id, i) { pinOrder[id] = i; });

    var visible = apps.filter(function (app) {
      return !hidden[app.id] && app.id !== "com.example.launcher";
    });

    // Pinned apps first in the order given in apps.json, then the rest alphabetically.
    visible.sort(function (a, b) {
      var pa = pinOrder[a.id], pb = pinOrder[b.id];
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return (a.title || "").localeCompare(b.title || "");
    });

    if (visible.length === 0) {
      empty.style.display = "block";
      return;
    }

    visible.forEach(function (app) {
      var tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.id = app.id;

      if (app.icon) {
        var img = document.createElement("img");
        img.src = app.icon;
        tile.appendChild(img);
      }

      var label = document.createElement("span");
      label.textContent = app.title || app.id;
      tile.appendChild(label);

      tile.addEventListener("click", function () { launch(app.id); });
      grid.appendChild(tile);
      tiles.push(tile);
    });

    setFocus(0);
  }

  function setFocus(index) {
    if (!tiles.length) return;
    tiles[focusIndex].classList.remove("focused");
    focusIndex = (index + tiles.length) % tiles.length;
    tiles[focusIndex].classList.add("focused");
  }

  // Remote control: arrow keys move focus, OK (13) launches.
  var COLUMNS = 5;
  document.addEventListener("keydown", function (e) {
    switch (e.keyCode) {
      case 37: setFocus(focusIndex - 1); break;
      case 39: setFocus(focusIndex + 1); break;
      case 38: setFocus(focusIndex - COLUMNS); break;
      case 40: setFocus(focusIndex + COLUMNS); break;
      case 13: launch(tiles[focusIndex].dataset.id); break;
      case 461: // webOS "Back" key: the launcher has nothing to go back to.
        break;
    }
  });

  function tickClock() {
    var d = new Date();
    clock.textContent = d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  tickClock();
  setInterval(tickClock, 15000);

  loadConfig(function (cfg) {
    listApps(function (err, apps) {
      if (err) {
        empty.style.display = "block";
        empty.textContent = "Could not list apps: " + JSON.stringify(err);
        return;
      }
      buildTiles(apps, cfg);
    });
  });
})();
