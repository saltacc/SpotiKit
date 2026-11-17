using System.Collections.Generic;
using System.Threading.Tasks;
using SpotiKit.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace SpotiKit.ViewModels;

public partial class DialogService : ObservableObject
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsOpen))]
    public partial ConfirmDialogViewModel? Current { get; private set; }

    public bool IsOpen => Current is not null;

    public Task<bool> ConfirmAsync(string title, string message, string confirmText, bool isDestructive = false,
        string cancelText = "Cancel")
    {
        Current?.Cancel();
        var dialog = new ConfirmDialogViewModel(title, message, confirmText, cancelText, isDestructive, this);
        Current = dialog;
        return dialog.Result;
    }

    public Task<bool> ConfirmAsync(string title, string message, string confirmText, IReadOnlyList<InstallChange> details)
    {
        Current?.Cancel();
        var dialog = new ConfirmDialogViewModel(title, message, confirmText, "Cancel", false, this) { Details = details };
        Current = dialog;
        return dialog.Result;
    }

    public Task AlertAsync(string title, string message, string okText = "OK") =>
        ConfirmAsync(title, message, okText, cancelText: "");

    internal void Close(ConfirmDialogViewModel dialog)
    {
        if (ReferenceEquals(Current, dialog))
            Current = null;
    }
}

public partial class ConfirmDialogViewModel(
    string title, string message, string confirmText, string cancelText, bool isDestructive, DialogService owner)
    : ViewModelBase
{
    private readonly TaskCompletionSource<bool> _result = new();

    public string Title { get; } = title;
    public string Message { get; } = message;
    public string ConfirmText { get; } = confirmText;
    public string CancelText { get; } = cancelText;
    public bool IsDestructive { get; } = isDestructive;
    public bool HasCancel => CancelText.Length > 0;
    public IReadOnlyList<InstallChange> Details { get; init; } = [];
    public bool HasDetails => Details.Count > 0;

    public Task<bool> Result => _result.Task;

    [RelayCommand]
    private void Confirm() => Finish(true);

    [RelayCommand]
    public void Cancel() => Finish(false);

    private void Finish(bool confirmed)
    {
        owner.Close(this);
        _result.TrySetResult(confirmed);
    }
}
