const { Player, ContextMenu, Playbar, Storage, URI, Platform, notify } = SpotiKit;

/** @type {SpotiKit.Start} */
export default function start() {
  const settings = Storage.scope("now-playing-toast");
  let enabled = settings.get("enabled", true);

  Player.on("track", (state) => {
    if (enabled && state) {
      const artists = (state.item.artists || []).map((artist) => artist.name).join(", ");
      notify(`${state.item.name} · ${artists}`);
    }
  });

  ContextMenu.add({
    label: "Copy Spotify links",
    icon: "link",
    when: (target) => target.uris.every((uri) => URI.is(uri, ["track", "album", "playlist-v2", "artist"])),
    onSelect: async (target) => {
      await Platform.ClipboardAPI.copy(target.uris.map(URI.toUrl).join("\n"));
      notify(target.uris.length === 1 ? "Link copied" : `${target.uris.length} links copied`);
    },
  });

  const button = Playbar.add({
    label: "Track notifications",
    icon: "bell",
    active: enabled,
    onClick: () => {
      enabled = !enabled;
      button.active = enabled;
      settings.set("enabled", enabled);
    },
  });
}
