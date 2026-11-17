# {{NAME}}

| File | What it's for |
|---|---|
| `spotikit.json` | Name, description, compatibility and the file to run (`main`) |
| `extension.js` | Your code. Its default export runs when the extension starts |
| `spotikit.d.ts`, `jsconfig.json` | Autocomplete for the SpotiKit API in VS Code. Not loaded into Spotify |

The SpotiKit API is the global `SpotiKit`. Keep the code in `extension.js`: installed from the
marketplace, only that one file is downloaded.

## Start and stop

The default export runs when the extension starts. Whatever it adds through `SpotiKit` (buttons,
menu entries, panels, shortcuts, listeners) goes away by itself when it's turned off, so it turns
on and off without reloading Spotify. Undo anything else in `onStop` or in a function you return:

```js
export default function start({ onStop, signal }) {
  const timer = setInterval(tick, 1000);
  onStop(() => clearInterval(timer));
  document.addEventListener("keydown", onKey, { signal });
}
```

Without a default export the file still runs once when Spotify starts, but turning it off then
needs a reload.

## Try it

SpotiKit app → **Developer** → turn on **Live preview**, then save: the extension restarts with your
change. **Apply to Spotify** puts it in for good. Errors show up in Spotify's developer tools (turn
them on on the Developer page, then Ctrl+Shift+I).

## Other extensions it needs

List them in `spotikit.json` with the versions you tested, and get them with `use`:

```json
"dependencies": { "someone/queue-tools": "1.2 - 1.4" }
```

```js
export default function start({ use }) {
  const tools = use("someone/queue-tools");
}
```

The marketplace installs them first. Give your own extension a `"version"` if others build on it.

## Spotify versions

`spotify` in `spotikit.json` names the Spotify versions you tested it on: one version (`1.3.6`)
or a range (`1.3.5 - 1.3.6`). When Spotify updates past it, the marketplace pauses your extension for
people until you test the new version and raise the range.

## Publish it

1. Put this folder in a public GitHub repository, with `spotikit.json` at the top.
2. Add a screenshot as `preview.png`, write a `description` and check `spotify`.
3. Give the repository the topic `spotikit-extensions` (About → ⚙ → Topics).

The marketplace picks it up from there. Several extensions in one repository: make
`spotikit.json` a list (`[{...}, {...}]`) and point each entry's paths into its subfolder.

People can also open it straight from a link, `spotify:app:marketplace:install:<owner>:<repo>`, or
paste the repository's address into the marketplace (link button at the top).
