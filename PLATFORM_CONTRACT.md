# FLOS edge agent — platform contract (Wiren Board)

Partner-ready draft. Agent is a **guest** on the controller: control-plane + rule pour, not a second OS.

## What we touch

| Path | Role |
|------|------|
| `/etc/wb-rules/` | Write FLOS shards (`00_core.js`, `40_rules_user.js`, …). Never replace WB engine binaries. |
| `/mnt/data/flos-edge/` | Compose, `.env`, agent state (WB flash policy). |
| `/etc/formlogic/` | Optional release hash marker. |
| `mqtt://127.0.0.1:1883` | Local broker only (host network). |
| HTTP `:18081` | Desk + `/runtime/*` (health, apply, rollback, pour). |

## What we do not touch

- Foreign packages, mosquitto config, unrelated systemd units.
- User home / root eMMC for agent data (use `/mnt/data`).
- HA / voice / resident dashboards (out of field agent scope).

## Apply / rollback

- Pour is scoped: **names** vs **rules** (split, no silent wipe of the other).
- Each successful pour records a **revision**; desk **Журнал → Вернуть** calls rollback.
- Restart of `wb-rules` after apply is explicit; failure is reported (files may be written, engine not reloaded).

## Privileges (known debt)

Current field compose often uses `network_mode: host`, `pid: host`, `privileged: true` so the agent can `systemctl restart wb-rules` on the host.

- **Why:** WB field apply needs host restart of rules engine.
- **Roadmap:** narrow to minimum caps / nsenter-only; do not add new features that require more privilege.
- Document any privilege change in this file.

## Health honesty

Desk must show separately when possible:

1. **Bus** — MQTT mirror connected + topic count  
2. **Cloud** — enrollment / heartbeat to FLOS  
3. **Version** — `EDGE_AGENT_VERSION`

Bus up ≠ cloud up. Never one green dot for both.

## Uninstall

`install.sh --uninstall` stops the container and removes agent data under `/mnt/data/flos-edge`.  
Does not silently delete the entire `/etc/wb-rules` tree without an explicit product decision.

## Compatibility

Record model + WB release suite in the field certificate (wave 6 resource passport).

---

*Draft for partner review pack. Keep in sync with `docker-compose.yml` mounts and pour paths.*
