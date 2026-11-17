const { Player } = SpotiKit;

/** @type {SpotiKit.Start<SpotiKit.ThemeContext>} */
export default function start({ theme, onStop }) {
  const root = document.documentElement;
  const showPlaying = () => root.toggleAttribute(`data-${theme}-playing`, Player.isPlaying);

  Player.on("playpause", showPlaying);
  showPlaying();

  onStop(() => root.removeAttribute(`data-${theme}-playing`));
}
