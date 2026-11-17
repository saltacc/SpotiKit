# {{NAME}}

A CSS snippet is a small tweak that runs next to any theme. Several snippets can be on at once.

| File | What it's for |
|---|---|
| `spotikit.json` | Name, description, compatibility and the CSS to load |
| `snippet.css` | Your styles (`style`) |

Images and fonts can go next to it; link them relatively from the CSS.

## Try it

SpotiKit app → **Developer** → turn on **Live preview**, then save `snippet.css`: Spotify swaps the
CSS in place.

**Apply to Spotify** puts the snippet in for good. Turn it on or off in Spotify under
Marketplace → **Installed** → **From the SpotiKit app**.

## Class names

SpotiKit gives Spotify's elements readable class names that stay the same across Spotify updates,
like `main-view-panel` or `track-list-row`. Turn on the developer tools on the Developer page, then
right-click anything in Spotify → **Inspect** to see them. Use Spotify's color variables
(`--background-base`, `--text-base`, `--text-bright-accent`, ...) and the snippet fits any theme.

## Spotify versions

`spotify` in `spotikit.json` names the Spotify versions you tested it on: one version (`1.3.6`)
or a range (`1.3.5 - 1.3.6`). When Spotify updates past it, the marketplace pauses your snippet for
people until you test the new version and raise the range.

## Publish it

1. Put this folder in a public GitHub repository, with `spotikit.json` at the top.
2. Add a screenshot as `preview.png`, write a `description` and check `spotify`.
3. Give the repository the topic `spotikit-snippets` (About → ⚙ → Topics).

The marketplace picks it up from there. Several snippets in one repository: make `spotikit.json`
a list (`[{...}, {...}]`) and point each entry's `style` into its subfolder.
