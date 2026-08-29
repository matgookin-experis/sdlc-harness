# GitLab Local

Runs a self-hosted GitLab CE instance and a static demo site locally via Docker,
with a reproducible demo environment.

## Requirements

- Docker
- Docker Compose v2+
- Bash 3.2+
- curl
- Python 3 (used for portable base64, URL encoding, and JSON encoding)

### Minimum host requirements

| Resource | Minimum | Recommended |
|---|---|---|
| RAM | 4 GB free | 8 GB free |
| CPU | 2 cores | 4 cores |
| Disk | 10 GB free | 20 GB free |

`docker-compose.yml` is already tuned down for local/demo use (`puma['worker_processes'] = 2`,
`sidekiq['concurrency'] = 5`, `prometheus_monitoring['enable'] = false`) — GitLab CE's own
[hardware requirements](https://docs.gitlab.com/ee/install/requirements.html) recommend 8 GB+ for
a comfortable experience, but this configuration has been run successfully at the 4 GB minimum for
demo purposes. If you're on Docker Desktop (Windows/Mac), make sure its own VM resource limits
(Settings → Resources) are set at or above these values — the container can't use more memory or
CPU than Docker Desktop itself is allowed.

## Quick Start

```bash
cd gitlab-local

# 1. Create your local credentials file with owner-only permissions
install -m 600 .env.example .env
#    Replace both GITLAB_ROOT_PASSWORD and GITLAB_DEMO_PASSWORD placeholders

# 2. Start the stack, wait until healthy, and run the complete idempotent seed
./manage.sh start

# 3. Create/refresh the API token used by the MCP server and live tests
./manage.sh refresh-token
```

If `install` is unavailable, run `umask 077` before copying `.env.example`.

Then open **http://localhost:8080** (GitLab) and **http://localhost:8081** (demo site).

## Credentials

Credentials come from your local `.env` file. Both values are explicit, must
contain at least eight characters, and must differ. The seed workflow rejects
placeholder or identical values.

| Account    | Username | Role      |
|------------|----------|-----------|
| Admin      | `root`   | Owner     |
| Demo user  | `demo`   | Developer |

The accounts use separate settings:

- `GITLAB_ROOT_PASSWORD` configures the initial GitLab administrator password.
- `GITLAB_DEMO_PASSWORD` configures the non-admin demo account.

`seed.sh` does not silently reuse the administrator password. On normal reruns, it
synchronizes the existing demo account to `GITLAB_DEMO_PASSWORD`. When an administrator
`GITLAB_TOKEN` is supplied to avoid Rails startup, the existing password is left unchanged.

Base provisioning also repairs the demo account on every run: it restores a usable
account state and adds or corrects its group membership to Developer access.

> **Sign in with `root` or `demo`. Do not use "Register now".**
> `seed.sh` sets `signup_enabled=false` — this is a closed demo instance. If you
> register an account anyway, GitLab creates it in a blocked state and you get
> *"Your account is pending approval from your GitLab administrator and hence
> blocked."* That is expected. Sign in as `root` instead; the blocked account can
> be ignored, or removed from **Admin → Users**.

Passwords are deliberately not emitted by the seed scripts. Retrieve them from
the local password store or `.env` without placing them in logs or screen captures.

On POSIX systems, every helper script refuses to continue when `.env` grants
group/world permissions. Repair an existing file with `chmod 600 .env`. Git Bash on
Windows skips the POSIX mode check because Windows ACLs are authoritative there;
restrict the file to your Windows account instead.

## Demo Project

After seeding, the demo project is at:

**http://localhost:8080/sdlc-harness/weather-dashboard**

It contains the **Weather Dashboard** — a self-contained mock weather app built as the
SDLC Harness demo artefact (sourced from the `dev` branch of the sdlc-harness repo):

| File | Description |
|---|---|
| `index.html` | App shell — open directly in any browser, no server needed |
| `styles.css` | All styling — dark mode, responsive, CSS custom properties |
| `app.js` | Runtime behaviour — mock data, search, theme toggle |
| `WEATHER-DASHBOARD.md` | Full docs + suggested SDLC demo changes |
| `tests.md` | Manual test checklist |

## Helper Scripts

| Command                       | Description                                           |
|-------------------------------|-------------------------------------------------------|
| `./smoke.sh`                  | Validate full stack health on demand (exit 0 = OK); run automatically by `start`, `restart`, and `reset` |
| `./manage.sh start`           | Start, wait until healthy, and run the complete seed  |
| `./manage.sh stop`            | Stop the stack                                        |
| `./manage.sh restart`         | Restart, wait until healthy, and run the complete seed|
| `./manage.sh seed`            | Run the complete idempotent demo seed                  |
| `./manage.sh refresh-token`   | Rotate and verify the gitignored MCP/API token         |
| `./manage.sh reset [-y]`      | Full wipe + fresh boot + reseed in one command (see Full Reset below) |
| `./manage.sh uninstall [-y]`  | Remove the stack, generated state, and Bob/MCP installation |
| `./manage.sh password`        | Show GitLab's temporary initial root password, if available |
| `./manage.sh logs`            | Tail container logs                                   |
| `./manage.sh status`          | Show container health                                 |

`./manage.sh seed` is the only public seeding operation. It keeps the implementation
modular by invoking `seed.sh` for base provisioning and then `seed-issues.sh` for
scenario fixtures. The complete workflow is **idempotent**, and the issue stage converges its
state-transition fixture to two open issues linked from a genuinely merged MR with a real
branch commit.

Unless the caller supplies `GITLAB_TOKEN`, `seed.sh` creates one one-day Rails PAT and
shares it with the internal issue-fixture stage. It keeps the token in owner-only temporary
files and revokes it from an EXIT cleanup path. Successful completion includes PAT
revocation and removal of container-side token files.

## Ports

| Port | Purpose |
|---|---|
| 8080 | GitLab web UI / API (host to container nginx port 80) |
| 8081 | Demo site (nginx); override with `DEMO_SITE_PORT` |
| 2222 | Git over SSH |

All published ports bind to `127.0.0.1`; they are not exposed on other host
interfaces. GitLab's external URL is `http://localhost:8080`, so generated web
and clone URLs retain the required `:8080` port.

SSH remote URL format:
```
ssh://git@localhost:2222/<namespace>/<repo>.git
```

## Troubleshooting

### "Your account is pending approval from your GitLab administrator"

You registered a new account instead of signing in. This is a closed instance —
sign in as `root` (see [Credentials](#credentials)). Nothing is broken.

### `./smoke.sh` reports the demo site is not up

The nginx demo site did not bind its port. This is usually a port collision — on
macOS, Docker Desktop's own helper process binds 8081 on some installs, so the
container exits immediately and never appears in `docker compose ps`.

```bash
lsof -iTCP:8081 -sTCP:LISTEN     # find what holds the port
```

Then pick a free port in `.env` and bring the stack back up:

```bash
echo "DEMO_SITE_PORT=8082" >> .env
docker compose up -d
```

`smoke.sh` requires GitLab's host-facing sign-in page, GitLab's internal readiness probe,
and the demo site to pass. A missing or partially initialized service produces a non-zero
result.

### Seeding hangs at "Creating API token..."

Without a caller-supplied token, the seed workflow mints one token by booting GitLab's
Rails environment inside the container (`gitlab-rails runner`). That boot is the heaviest
step and can stall on a long-running or resource-constrained instance. It is now bounded
to 180 seconds (override with `GITLAB_RAILS_RUNNER_TIMEOUT_SECONDS`) and exits with an
actionable error instead of hanging indefinitely.

Skip it by supplying an administrator token. In GitLab (signed in as `root`) go to
**User settings → Access tokens**, create one with the `api` scope, then:

```bash
export GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx
./manage.sh seed
```

The public seed operation validates that the token belongs to an administrator and passes
it to the internal issue-fixture stage. This path does not start Rails and is the most
reliable option for an already-provisioned demo instance.

`./manage.sh refresh-token` serves a different purpose: it rotates the non-admin demo
user token used by Bob's MCP integration. That token cannot perform the administrator
operations required by the seed workflow.

To refresh the MCP token, run:

```bash
./manage.sh refresh-token
```

It rotates a 30-day API token for the `demo` user, stores it in the repository
root `.env` with mode `600`, verifies authentication, and never prints the token.

If seeding is genuinely slow rather than stuck, check Docker Desktop's memory
allocation — GitLab CE wants 4 GB and will thrash below that.

---

### The password in `.env` does not work

GitLab enforces a minimum of eight characters. For values containing `$`, keep
the value single-quoted in `.env` so Docker Compose treats it literally:

```dotenv
GITLAB_ROOT_PASSWORD='replace-with-a-strong-$-password'
GITLAB_DEMO_PASSWORD='replace-with-another-strong-$-password'
```

Keep each assignment on one line with no `export` prefix. The scripts parse only
the named `KEY=value` entries and never execute `.env` as shell code.

Changing `GITLAB_ROOT_PASSWORD` does not update an existing root account. Use
GitLab's documented administrator password-reset procedure, or reset this disposable
stack if deleting its data is acceptable:

```bash
./manage.sh reset -y
```

After changing `GITLAB_DEMO_PASSWORD`, unset `GITLAB_TOKEN` and rerun
`./manage.sh seed`; the Rails-free token path intentionally leaves an existing
demo password unchanged.

### GitLab returns HTTP 502 for the first few minutes

Normal. Rails is still booting and compiling assets on first run — allow 3–5
minutes. `smoke.sh` polls for up to 300s.

---

## Data Persistence

All GitLab data is stored in named Docker volumes:

- `gitlab-config` — `/etc/gitlab`
- `gitlab-logs` — `/var/log/gitlab`
- `gitlab-data` — `/var/opt/gitlab`

The GitLab and nginx images are pinned by digest in `docker-compose.yml`. `GITLAB_IMAGE`
can temporarily override the GitLab image during a reviewed upgrade path; leave it unset
for new installations.

## Migrating an Existing Stack

Do not point arbitrary existing GitLab volumes at the pinned image. GitLab upgrades and
downgrades are version-sensitive; unsupported jumps can make the database unusable.

### Configuration-only migration

Use this path to apply the loopback bindings and `:8080` external URL while keeping the
exact GitLab image currently running:

1. Back up GitLab data, `/etc/gitlab`, and `gitlab-secrets.json` according to
   GitLab's Docker backup documentation. Store copies outside the Docker volumes.
2. Run `chmod 600 .env`, add an explicit `GITLAB_DEMO_PASSWORD`, and replace
   documented placeholders. Do not expect changing the root value to update the
   persisted root account.
3. Record the current version with `docker exec gitlab gitlab-rake gitlab:env:info`.
4. Record and tag the exact running image:

```bash
CURRENT_IMAGE_ID="$(docker inspect --format '{{.Image}}' gitlab)"
docker image tag "$CURRENT_IMAGE_ID" gitlab-local-config-migration:current
```

5. Set `GITLAB_IMAGE=gitlab-local-config-migration:current` in `.env`, then
   recreate without pulling another GitLab image:

```bash
docker compose up -d --no-deps --pull never gitlab
docker compose up -d --no-deps demo-site
./smoke.sh
./manage.sh seed
```

Keep the override until a separate GitLab image upgrade is completed. `restart` alone
does not apply changed Compose environment or port mappings.

### GitLab image upgrade

1. Inspect the running version with `docker exec gitlab gitlab-rake gitlab:env:info`.
2. Inspect the pinned candidate without attaching volumes:

```bash
docker run --rm --entrypoint cat \
  gitlab/gitlab-ce@sha256:f63df4c43029fe91db370609c0b40a1e3585cebd06e3e9637d93a9a3030eb86e \
  /RELEASE
```

3. Compare the versions against GitLab's official upgrade-path tool and
   documentation. Do not downgrade, and do not skip required upgrade stops.
4. Take and verify a fresh application backup plus separate copies of
   `/etc/gitlab` and `gitlab-secrets.json` before the first upgrade and every
   required stop. A backup restores only to the same GitLab version and edition.
5. Set `GITLAB_IMAGE` to the exact reviewed tag or digest for the next required
   stop, pull that image, and run `docker compose up -d --no-deps gitlab`.
6. At every stop, wait for GitLab to become healthy and run
   `docker exec gitlab gitlab-rake gitlab:background_migrations:status`. Continue
   only after all batched background migrations finish; resolve any pending
   database migrations or failed health checks.
7. Repeat one required stop at a time. Only after reaching the pinned version
   should you remove the `GITLAB_IMAGE` override and recreate from the default digest.
8. Run `./smoke.sh`. Starting or restarting through `manage.sh` automatically
   reconciles the complete seed.

Do not use `reset` for either migration path unless deleting all existing GitLab data is
intentional.

## Full Reset

To wipe all data and start fresh (e.g. for a clean demo re-take):

```bash
./manage.sh reset          # prompts for confirmation
./manage.sh reset -y       # skips the confirmation prompt
```

This tears down the stack including volumes, boots fresh, waits for GitLab's
host-facing HTTP endpoint and internal readiness via `smoke.sh`, runs the complete
seed, and refreshes the repository-root MCP token. Equivalent to running by hand:

```bash
docker compose down -v
docker compose up -d
./smoke.sh
./manage.sh seed
./manage.sh refresh-token
```

After a reset, unset any previously exported `GITLAB_TOKEN` and restart or reconnect Bob;
an already-running MCP process still holds the token from before the volumes were deleted.
