# Third-party notices

## Spicetify

SpotiKit's JavaScript API (`Framework/api`) was designed with the API of [Spicetify](https://github.com/spicetify/cli) as a reference, in particular its `spicetifyWrapper` (`src/jsHelper/spicetifyWrapper`). Areas such as the player, the top bar and playbar buttons, menus and dialogs follow its design.

These parts of SpotiKit are adapted from Spicetify's code and follow its implementation closely:

| SpotiKit | Based on | Spicetify source |
| --- | --- | --- |
| `SpotiKit.Title` in `Framework/api/05-utilities.js` | `Spicetify.AppTitle` | `src/jsHelper/spicetifyWrapper/icons.js` |
| `SpotiKit.notify` in `Framework/api/05-utilities.js` | `Spicetify.showNotification` | `src/jsHelper/spicetifyWrapper/webpack/runtime-resolvers.js` |
| `fillPlatform` in `Framework/api/03-platform.js` | how `Spicetify.Platform` is filled | `src/jsHelper/spicetifyWrapper/platform.js` |

Each of these places is marked in the source. They were rewritten for SpotiKit in 2026 and are provided under the GNU Lesser General Public License, version 2.1, like the code they are based on. The full text is in [LICENSES/LGPL-2.1.txt](LICENSES/LGPL-2.1.txt).

SpotiKit 0.9.0 and earlier also contained a Spicetify compatibility layer with code and data adapted from spicetify/cli, including its CSS map (`css-map.json`) and icon set. It was removed in SpotiKit 0.9.1. SpotiKit's own class map was not made from Spicetify's CSS map; names it shares with it come from Spotify itself, such as `data-testid` values.

Spicetify is copyright its contributors and licensed under the LGPL-2.1. Spicetify is not affiliated with SpotiKit and does not endorse it.
