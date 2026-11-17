using CommunityToolkit.Mvvm.ComponentModel;
using SpotiKit.Models;

namespace SpotiKit.ViewModels;

public partial class InstallStepViewModel(int number, string title, string description, bool isLast)
    : ViewModelBase
{
    public int Number { get; } = number;
    public string Title { get; } = title;
    public string Description { get; } = description;

    public bool IsLast { get; } = isLast;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsDone), nameof(IsActive), nameof(IsPending), nameof(IsFailed))]
    public partial StatusKind Status { get; set; }

    [ObservableProperty]
    public partial double Progress { get; set; }

    public bool IsDone => Status == StatusKind.Success;
    public bool IsActive => Status == StatusKind.Busy;
    public bool IsPending => Status == StatusKind.Neutral;
    public bool IsFailed => Status is StatusKind.Error or StatusKind.Warning;
}
