const { Player } = SpotiKit;

const start: SpotiKit.Start<SpotiKit.ThemeContext> = ({ theme, onStop }) => {
  const root = document.documentElement;
  const showPlaying = () => root.toggleAttribute(`data-${theme}-playing`, Player.isPlaying);

  Player.on("playpause", showPlaying);
  showPlaying();

  onStop(() => root.removeAttribute(`data-${theme}-playing`));
};

export default start;
