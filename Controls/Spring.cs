using System;

namespace SpotiKit.Controls;

internal struct Spring(double dampingRatio, double stiffness)
{
    public double Value;
    public double Velocity;
    public double Target;

    public readonly bool IsSettled => Math.Abs(Value - Target) < 0.0005 && Math.Abs(Velocity) < 0.005;

    public void SnapTo(double value)
    {
        Value = Target = value;
        Velocity = 0;
    }

    public void Step(double dt)
    {
        const int subSteps = 4;
        var damping = 2 * dampingRatio * Math.Sqrt(stiffness);
        var h = dt / subSteps;
        for (var i = 0; i < subSteps; i++)
        {
            var acceleration = -stiffness * (Value - Target) - damping * Velocity;
            Velocity += acceleration * h;
            Value += Velocity * h;
        }
    }
}
