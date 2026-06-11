# Backlog

## UI Responsiveness

- [ ] Add an in-progress/loading state when toggling **IAU Constellation Boundaries**.
  - Problem: switching the boundary layer can make the app feel frozen because the poster render is expensive.
  - Expected behavior: after the user clicks the toggle, show immediate feedback until the boundary layer finishes applying.
  - Notes: keep the control understandable in both English and Chinese UI labels.
