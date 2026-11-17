const { React, Player, Hooks, Components: C } = SpotiKit;
const h = React.createElement;

export default function App() {
  const { track, isPlaying } = Hooks.usePlayer();

  return h(
    "div",
    { className: "{{ID}}" },
    h(C.Text, { as: "h1", variant: "titleLarge" }, "{{NAME}}"),
    h(
      C.Text,
      { variant: "bodyMedium", semanticColor: "textSubdued" },
      track ? `Playing: ${track.name}` : "Nothing is playing."
    ),
    h(
      "div",
      { className: "{{ID}}-actions" },
      h(C.Button, { onClick: () => Player.toggle() }, isPlaying ? "Pause" : "Play"),
      h(C.ButtonSecondary, { onClick: () => Player.next() }, "Next")
    )
  );
}
