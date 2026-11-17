# {{NAME}}

A page of its own in Spotify, opened from a button next to Home.

| File | What it's for |
|---|---|
| `spotikit.json` | Name, compatibility, button icons (`icon`, `activeIcon`) and the files to load |
| `index.js` | Your app (`main`). Its default export is the page (a React component) |
| `style.css` | Styles for the page (`style`). Start class names with the app's id |
| `spotikit.d.ts`, `jsconfig.json` | Autocomplete for the SpotiKit API in VS Code. Not loaded into Spotify |

`index.js` loads when Spotify starts, so code outside the component runs right away. The SpotiKit
API is the global `SpotiKit`. Keep the code in `index.js`: installed from the marketplace, only the
files named in `spotikit.json` are downloaded.

## Try it

SpotiKit app → **Developer** → turn on **Live preview**, then save: Spotify reloads with your
change. **Apply to Spotify** puts it in for good.

## Spotify versions

`spotify` in `spotikit.json` names the Spotify versions you tested it on: one version (`1.3.6`)
or a range (`1.3.5 - 1.3.6`). When Spotify updates past it, the marketplace pauses your app for
people until you test the new version and raise the range.

## Publish it

1. Put this folder in a public GitHub repository, with `spotikit.json` at the top.
2. Add a screenshot as `preview.png`, write a `description` and check `spotify`.
3. Give the repository the topic `spotikit-apps` (About → ⚙ → Topics).

The marketplace picks it up from there. Several apps in one repository: make `spotikit.json` a
list (`[{...}, {...}]`) and point each entry's paths into its subfolder.
