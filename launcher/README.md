# webOS TV launcher

A small web-based home screen for LG webOS TVs. It lists the apps installed on the TV, hides the ones you list in `apps.json`, and launches the selected app.

## Files

- `appinfo.json`: webOS app manifest. Change `id` to your own reverse-DNS name (e.g. `com.yourname.launcher`).
- `index.html`: layout and styling.
- `app.js`: loads `apps.json`, asks webOS for installed apps (`listApps`), builds the grid, handles remote keys.
- `apps.json`: `hidden` (app IDs to hide) and `pinned` (app IDs to show first, in order).

## Limits to know before you start

- **Removing preinstalled apps is not possible from a third-party app.** This launcher only hides them from its own grid. The apps stay on the TV. Real uninstall of system apps needs firmware-level access that consumer TVs do not give you.
- The launcher does not replace LG's Home screen. You open it as an app, or set it as your start app if your firmware allows that.
- The launch and listing calls (`com.webos.applicationManager`) are based on the webOS TV API from memory and have not been run on a TV from this repo. Check them on your model.
- Icons are taken from the `icon` field returned by `listApps`.

## Setting it up on a TV

1. Enable Developer Mode on the TV: install the **Developer Mode** app from the LG Content Store, sign in, and turn on Dev Mode and Key Server. Your PC's IP must be entered in the app.
2. Install the webOS TV CLI (`ares-cli`) from the webOS TV developer site (`npm install -g @webos-tools/cli`).
3. Add the TV as a device: `ares-setup-device` (enter the TV's IP and the passphrase from the Developer Mode app).
4. Get the webOS JS library (`webOSTV.js`, version 1.2.2 in the paths used by `index.html`) and place it under `launcher/webOSTVjs-1.2.2/`. Without it, `webOS.service.request` is undefined.
5. Package and install:

   ```sh
   cd launcher
   ares-package . -o ../dist
   ares-install -d <your-tv-name> ../dist/com.example.launcher_1.0.0_all.ipk
   ares-launch -d <your-tv-name> com.example.launcher
   ```

6. To find app IDs to hide, look at the output of `ares-install --list` or open the launcher's console with `ares-inspect`.

## Next steps

- Add `icon.png` (80x80 or larger) to `launcher/`. Without it the tiles show only text.
- Fill `apps.json` with the apps you want to hide or pin.
