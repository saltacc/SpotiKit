# {{NAME}}

| File | What it's for |
|---|---|
| `spotikit.json` | Name, description, compatibility and the files to load |
| `theme.css` | Your styles (`style`) |
| `theme.js` | Optional script (`main`). Delete the line in `spotikit.json` if you only need CSS |
| `spotikit.d.ts`, `jsconfig.json` | Autocomplete for the SpotiKit API in VS Code. Not loaded into Spotify |

Images and fonts can go next to them; link them relatively from the CSS.

## Try it

SpotiKit app → **Developer** → turn on **Live preview**, then save a file: Spotify shows the theme
right away. CSS changes swap in place; a change to `theme.js` restarts it.

**Apply to Spotify** puts the theme in for good (also new images and fonts). Turn it on or off in
Spotify under Marketplace → **Installed** → **From the SpotiKit app**.

## Class names

SpotiKit gives Spotify's elements readable class names that stay the same across Spotify updates,
like `main-view-panel` or `track-list-row`. Turn on the developer tools on the Developer page, then
right-click anything in Spotify → **Inspect** to see them.

## Colors

`theme.css` uses Spotify's own color variables (`--background-base`, `--text-base`,
`--text-bright-accent`, ...). To ship your own colors, add `schemes` to `spotikit.json`:

```json
"schemes": {
  "dark": { "name": "Dark", "colors": { "background": "#121418", "accent": "#7c8cff" } }
}
```

Only `background` is required. Optional: `elevated`, `text`, `subtext`, `accent`, `onAccent`,
`divider`, `frame`. The first scheme is the default; with more than one, people switch in the
Color scheme menu under their profile picture, or on the theme's Marketplace page. Many schemes can go in their own file instead: `"schemes": "schemes.json"`.

## Script

`theme.js` exports a function that runs when the theme is picked. What it adds through `SpotiKit`
goes away by itself when another theme is picked; undo anything else in `onStop` or in a function
you return.

## Window buttons

Add `"windowControls": "custom"` to `spotikit.json` to replace Spotify's minimize, maximize and close
buttons with transparent ones you can style: `.spotikit-window-button`, plus `--minimize`,
`--maximize`, `--restore` and `--close`. Spotify's `…` menu comes back as
`.spotikit-window-menu-button`. Windows only.

## Spotify versions

`spotify` in `spotikit.json` names the Spotify versions you tested it on: one version (`1.3.6`)
or a range (`1.3.5 - 1.3.6`). When Spotify updates past it, the marketplace pauses your theme for
people until you test the new version and raise the range.

## Publish it

1. Put this folder in a public GitHub repository, with `spotikit.json` at the top.
2. Add a screenshot as `preview.png`, write a `description` and check `spotify`.
3. Give the repository the topic `spotikit-themes` (About → ⚙ → Topics).

The marketplace picks it up from there. Several themes in one repository: make `spotikit.json`
a list (`[{...}, {...}]`) and point each entry's paths into its subfolder.
