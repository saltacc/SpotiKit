using System;
using System.ComponentModel;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using SpotiKit.Models;
using SpotiKit.Services;

namespace SpotiKit.ViewModels;

public partial class DevToolsViewModel : ViewModelBase
{
    private readonly DevToolsService _service;
    private readonly ActivityLog _log;
    private readonly SpotifyPause _pause;
    private DevToolsStatus _status = new(DevToolsState.NotFound, false, "");
    private bool _isSyncing;

    public DevToolsViewModel(DevToolsService service, SpotifyStatusViewModel spotify, ActivityLog log, SpotifyPause pause)
    {
        _service = service;
        _log = log;
        _pause = pause;
        Spotify = spotify;
        Spotify.PropertyChanged += OnSpotifyChanged;
        Refresh();
    }

    public SpotifyStatusViewModel Spotify { get; }

    [ObservableProperty]
    public partial bool IsOn { get; set; }

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(CanChange), nameof(Hint), nameof(HasHint))]
    public partial bool IsBusy { get; private set; }

    [ObservableProperty]
    public partial string? Message { get; private set; }

    [ObservableProperty]
    public partial StatusKind MessageStatus { get; private set; }

    public bool CanChange => !IsBusy && _status.State is DevToolsState.Enabled or DevToolsState.Disabled;

    public string? Hint => IsBusy ? null
        : _status.State is DevToolsState.NotFound or DevToolsState.Unrecognized ? _status.Message
        : null;

    public bool HasHint => Hint is not null;

    partial void OnIsOnChanged(bool value)
    {
        if (!_isSyncing)
            _ = ApplyAsync(value);
    }

    private async Task ApplyAsync(bool on)
    {
        if (!CanChange)
        {
            Refresh();
            return;
        }

        IsBusy = true;
        var wasRunning = false;
        try
        {
            var closed = await _pause.CloseAsync(on ? "turn on the developer tools" : "turn off the developer tools");
            if (closed is null)
            {
                Show(StatusKind.Error, SpotifyPause.StillRunning);
                return;
            }
            wasRunning = closed.Value;
            var result = await Task.Run(() => on ? _service.Enable() : _service.Disable());
            Show(StatusKind.Success, wasRunning ? "Done. Spotify starts again with the change." : result);
        }
        catch (Exception ex)
        {
            Show(StatusKind.Error, _log.Error("DevTools", ex).Message);
        }
        finally
        {
            _pause.Resume(wasRunning);
            IsBusy = false;
            Refresh();
        }
    }

    public void Refresh()
    {
        try
        {
            _status = _service.GetStatus();
        }
        catch (Exception ex) when (ex is System.IO.IOException or UnauthorizedAccessException)
        {
            _status = new DevToolsStatus(DevToolsState.Unrecognized, false, FriendlyError.Describe(ex).Message);
        }

        _isSyncing = true;
        IsOn = _status.State == DevToolsState.Enabled;
        _isSyncing = false;
        OnPropertyChanged(nameof(CanChange));
        OnPropertyChanged(nameof(Hint));
        OnPropertyChanged(nameof(HasHint));
    }

    private async void OnSpotifyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(SpotifyStatusViewModel.Installation))
            return;
        if (!IsBusy && !Spotify.IsRunning)
        {
            try
            {
                await Task.Run(_service.KeepOn);
            }
            catch (Exception ex)
            {
                _log.Error("DevTools", ex);
            }
        }
        Refresh();
    }

    private void Show(StatusKind status, string message)
    {
        MessageStatus = status;
        Message = message;
    }
}
