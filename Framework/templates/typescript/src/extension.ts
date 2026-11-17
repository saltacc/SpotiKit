const { Player, Playbar, Storage, notify } = SpotiKit;

const start: SpotiKit.Start = () => {
  const settings = Storage.scope("{{ID}}");
  let enabled = settings.get<boolean>("enabled", true);

  Player.on("track", (state) => {
    if (enabled && state) {
      notify(`Now playing: ${state.item.name}`);
    }
  });

  const button = Playbar.add({
    label: "{{NAME}}",
    icon: "bell",
    active: enabled,
    onClick: () => {
      enabled = !enabled;
      button.active = enabled;
      settings.set("enabled", enabled);
    },
  });
};

export default start;
