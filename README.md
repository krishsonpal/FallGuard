# FallGuard backend

Cloud service for the FallGuard college IoT fall-detection demonstration. An ESP32 wearable sends selected motion windows either to an Android Chrome webpage over BLE or directly to this backend over Wi-Fi. The phone or cloud runs the trained CNN; uncancelled positive events request Telegram delivery.

The backend is in `cloud/`. Firmware and the phone webpage are maintained separately; this repository currently contains the deployable backend and its trained model artifacts.

## Deploy on Render

Create a **Node Web Service** connected to this repository:

| Setting | Value |
| --- | --- |
| Root Directory | `cloud` |
| Build Command | `npm ci --omit=dev` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| Instances | One |

Alternatively, use the repository-root `render.yaml` Blueprint. It declares the same `cloud` root directory and starts in dry-run mode.

Set environment variables in Render:

- `NODE_VERSION=24.22.1`
- `HOST=0.0.0.0`
- `ALLOWED_ORIGINS`: exact HTTPS phone frontend origin; comma-separated if more than one.
- `DEVICES_JSON`: device/wearer/contact mapping with separate random `phone_key` and `device_key`. See `cloud/.env.example` for the shape.
- `TELEGRAM_BOT_TOKEN`: private bot token, entered only in server environment settings.
- `DRY_RUN=true` initially. Set to the exact string `false` when enabling actual messages.

Render supplies `PORT`. Do not use the local-only `HOST=127.0.0.1` value on Render. Open `https://YOUR-SERVICE.onrender.com/healthz` after deployment; readiness includes six saved model prediction checks. This request sends no Telegram message.

`DEVICES_JSON` must be valid JSON: keep double quotes around **all string values**, including `chat_id`, `phone_key` and `device_key`. Paste only the JSON array as the environment value, without a leading `DEVICES_JSON=` or extra enclosing quotes. Malformed JSON is rejected with a fixed error that omits the submitted value from startup logs.

No real recipient IDs, bot tokens or access keys are committed. The Telegram recipient must start the configured bot. Enter the backend URL and that device's **phone key** on the phone webpage; use the separate **device key** in the ESP32 configuration.

## Behavior

- Six raw IMU channels, 125 samples at 50 Hz: acceleration in m/s² including gravity and gyro in rad/s.
- Same exported CNN as the phone, running on CPU; positive threshold 0.44.
- Phone-owned six-second countdown for phone inference; independently executed cloud-owned six-second countdown for direct cloud inference.
- Timely event-specific cancellation, per-device authorization, duplicate-event protection and SQLite contact/event storage.
- Dry runs return `simulated`, never `sent`. Ambiguous Telegram delivery is recorded as `unknown` and is not automatically resent.

Free Render storage is temporary: contact configuration restores from environment, but event history/timers can be lost after filesystem replacement. Warm the service before the demonstration and avoid restarting during an active event. This is a single-process demo implementation.

## Local development

Use Node 24.15 or later within Node 24:

```powershell
cd cloud
npm ci
Copy-Item .env.example .env
# Edit the ignored .env locally with your own configuration.
npm test
npm start
```

Keep `.env` private. Do not overwrite an existing configured file with the example. For local-only service checks, open `http://127.0.0.1:8080/healthz`. The actual phone/ESP32 demo uses a reachable HTTPS deployment.

See [backend details](cloud/README.md) and the [HTTP API contract](cloud/API.md). Fifteen backend tests cover model agreement, deadlines/cancellation, retry identity, capture freshness, authorization, simulated delivery, safe configuration/request logging and precise cooldown/unresolved-episode conflicts.
