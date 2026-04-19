# @mindcraft-lang/app-host

Project management and workspace storage for Mindcraft apps.

Provides `ProjectStore` and `ProjectManager` for managing named projects in
localStorage. Each project contains a workspace filesystem snapshot and
app-specific data blobs (brains, settings, etc.). All localStorage keys are
scoped by a configurable prefix to prevent collisions between apps on the same
origin.
