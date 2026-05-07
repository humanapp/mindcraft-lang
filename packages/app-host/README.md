# @mindcraft-lang/app-host

Project management and project file storage for Mindcraft apps.

Provides `ProjectStore` and `ProjectManager` for managing named projects in
IndexedDB. Each project contains a project file snapshot and app-specific data
blobs (brains, settings, etc.). IndexedDB database names are scoped by a
configurable prefix to prevent collisions between apps on the same origin.
