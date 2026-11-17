const { React, Player, Queue, Hooks, Components: C } = SpotiKit;
const h = React.createElement;

function NowPlaying() {
  const { track, isPlaying } = Hooks.usePlayer();
  const position = Hooks.usePosition();
  const colors = Hooks.useColors(track ? track.uri : null);
  const progress = track ? Math.min(1, position / Player.duration) : 0;

  return h(
    "section",
    {
      className: "listening-stats-now",
      style: { "--stats-accent": colors ? colors.light : "var(--text-bright-accent)" },
    },
    h(C.Text, { variant: "bodyMediumBold", semanticColor: "textSubdued" }, "Playing now"),
    h(C.Text, { as: "h2", variant: "titleMedium" }, track ? track.name : "Nothing"),
    h("div", { className: "listening-stats-bar" }, h("span", { style: { width: progress * 100 + "%" } })),
    h(
      "div",
      { className: "listening-stats-actions" },
      h(C.Button, { onClick: () => Player.toggle() }, isPlaying ? "Pause" : "Play"),
      h(C.ButtonSecondary, { onClick: () => Player.next() }, "Next")
    )
  );
}

function UpNext() {
  const next = Hooks.useQueue().slice(0, 10);
  return h(
    "section",
    null,
    h(C.Text, { variant: "bodyMediumBold", semanticColor: "textSubdued" }, `Up next (${next.length})`),
    h(
      "ol",
      { className: "listening-stats-list" },
      next.map((item, i) =>
        h(
          "li",
          { key: item.uid || i },
          h("span", null, item.title),
          h("span", { className: "listening-stats-artist" }, item.artist),
          h(
            "button",
            {
              className: "listening-stats-remove",
              title: "Remove",
              onClick: () => Queue.remove([{ uri: item.uri, uid: item.uid }]),
            },
            "×"
          )
        )
      )
    )
  );
}

export default function ListeningStats() {
  return h(
    "div",
    { className: "listening-stats" },
    h(C.Text, { as: "h1", variant: "titleLarge" }, "Listening stats"),
    h(NowPlaying),
    h(UpNext)
  );
}
