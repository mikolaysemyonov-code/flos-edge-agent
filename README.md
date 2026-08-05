# FLOS Edge Agent (Wiren Board)

Публичный репозиторий полевого Docker-агента для [Integrator OS](https://integrator-os-ten.vercel.app).

Агент на контроллере:
- enroll + heartbeat в облако Integrator;
- HTTP control-plane `:18081` (`/runtime/apply` → `/etc/wb-rules`);
- локальный MQTT scan для «Разметить щит», когда SaaS не видит LAN/Tailscale.

## Быстрая установка

Docker на Wiren Board уже установлен. Код подключения — в сервисе: **Контроллер → Установка → Агент FLOS → Выдать код**.

```bash
curl -fsSL https://raw.githubusercontent.com/mikolaysemyonov-code/flos-edge-agent/main/install.sh \
  | bash -s -- \
    --cloud-url https://integrator-os-ten.vercel.app \
    --project-id YOUR_PROJECT_UUID \
    --device-id wb-SERIAL \
    --token ENROLLMENT_TOKEN
```

Проверка:

```bash
curl -s http://127.0.0.1:18081/runtime/health
docker ps | grep flos-edge
```

## Обновление

Повторите curl (креды подхватятся из `/mnt/data/flos-edge/.env`) или:

```bash
git -C /opt/flos/flos-edge-agent pull
/mnt/data/flos-edge/.env  # уже есть
bash /opt/flos/flos-edge-agent/install.sh
```

## Разработка

Исходники синхронизируются из приватного монорепо `integratorOS`:

```bash
./scripts/sync-flos-edge-agent-publish.sh
```

## Файлы

| Файл | Назначение |
|------|------------|
| `install.sh` | полевой installer |
| `Dockerfile` | образ агента |
| `docker-compose.yml` | compose для WB |
| `reactor-edge-agent.mjs` | enroll / heartbeat / commands |
| `runtime-control-plane-http.mjs` | apply wb-rules |

Секреты (enrollment token) **не** хранятся в репо — только в `.env` на контроллере.
