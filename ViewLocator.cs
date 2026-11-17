using System;
using System.Diagnostics.CodeAnalysis;
using System.Runtime.CompilerServices;
using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Avalonia.VisualTree;
using SpotiKit.ViewModels;

namespace SpotiKit;

[RequiresUnreferencedCode(
    "Default implementation of ViewLocator involves reflection which may be trimmed away.",
    Url = "https://docs.avaloniaui.net/docs/concepts/view-locator")]
public class ViewLocator : IDataTemplate
{
    private static readonly ConditionalWeakTable<object, Control> Built = new();

    public Control? Build(object? param)
    {
        if (param is null)
            return null;

        if (Built.TryGetValue(param, out var cached))
        {
            // Still leaving: a control can only have one parent.
            if (cached.Parent is null && cached.GetVisualParent() is null)
                return cached;
            return Create(param);
        }

        var view = Create(param);
        if (view is not TextBlock)
            Built.AddOrUpdate(param, view);
        return view;
    }

    private static Control Create(object param)
    {
        var name = param.GetType().FullName!.Replace("ViewModel", "View", StringComparison.Ordinal);
        var type = Type.GetType(name);

        if (type != null)
        {
            return (Control)Activator.CreateInstance(type)!;
        }

        return new TextBlock { Text = "Not Found: " + name };
    }

    public bool Match(object? data)
    {
        return data is ViewModelBase;
    }
}
