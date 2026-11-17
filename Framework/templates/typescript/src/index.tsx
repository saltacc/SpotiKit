const { Player, Hooks, Components: C } = SpotiKit;

export default function App() {
  const { track, isPlaying } = Hooks.usePlayer();

  return (
    <div className="{{ID}}">
      <C.Text as="h1" variant="titleLarge">
        {"{{NAME}}"}
      </C.Text>
      <C.Text variant="bodyMedium" semanticColor="textSubdued">
        {track ? `Playing: ${track.name}` : "Nothing is playing."}
      </C.Text>
      <div className="{{ID}}-actions">
        <C.Button onClick={() => Player.toggle()}>{isPlaying ? "Pause" : "Play"}</C.Button>
        <C.ButtonSecondary onClick={() => Player.next()}>Next</C.ButtonSecondary>
      </div>
    </div>
  );
}
