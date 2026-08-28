# SDLC Harness — Project Rules

Project-specific agent behaviors for the sdlc-harness workspace.

## Context

- **Demo GitLab** runs at `http://localhost:8080` (start with `./gitlab-local/manage.sh start`)
- **Demo project** is at `http://localhost:8080/sdlc-harness/weather-dashboard`
- **Weather app source** is in `weather-app/`
- **GitLab config** is in `gitlab-local/`

## Behaviors

- Always check that the GitLab container is running before attempting API operations
- Use `./gitlab-local/manage.sh seed` to reset demo data to a known state
- When modifying weather-app files, reflect changes via the seed script — do not edit
  files directly in GitLab
- Credentials for the demo instance are documented in `gitlab-local/README.md`
