# FallGuard cloud backend — stage 3

Updated 26 October 2026. This backend connects the existing phone detector to Telegram and provides the direct-device cloud inference API. It runs the same exported CNN on CPU; no retraining or GPU is needed.

## What is implemented

- Per-device contact lookup in SQLite; contacts are restored from server environment configuration at startup.
- Separate phone and device bearer keys; explicit allowed browser origins; request size/rate limits.
- Phone alert dispatch after the phone's six-second countdown. This does not move the phone timer onto the server.
- Full 125×6 cloud inference, saved normalization applied once, threshold **0.44**.
- Cloud-owned six-second countdown, independently checked every 100 ms, event-specific cancellation and status polling.
- Duplicate-event handling, one unresolved episode per device, ten-second terminal cooldown.
- SQLite event recovery when the same database file survives a restart. Startup marks interrupted sends as `unknown` rather than resending them.
- Dry-run mode: **no real messages**, status `simulated`, never `sent`.

The ESP32 Wi-Fi/HTTPS client is now implemented; configure it using `../firmware/WIFI_SETUP.md`. Newly uploaded windows include a network-synchronized capture timestamp, preventing delayed/expired requests from starting a fresh fall timer. The hosted phone supports this backend through its URL and phone access-key fields and understands cloud ownership during handoff.

## Run locally

Install Node.js **24.15 or newer within Node 24**. From the `cloud` directory:

```powershell
npm ci
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Run the last command twice for two different keys. Edit `.env` locally:

1. Replace `device_id` with the exact advertised wearable name, such as `FallGuard-ESP32-A1B2C3`.
2. Configure `wearer`, recipient `chat_id`, `phone_key` and a separate `device_key` in `DEVICES_JSON`. The JSON must stay on one line.
3. Keep `DRY_RUN=true` initially. With real configuration ready, put the bot token in `TELEGRAM_BOT_TOKEN` and set `DRY_RUN=false` for actual alerts.
4. Set `ALLOWED_ORIGINS` to the exact frontend origins, separated by commas. Include your own deployed origin if hosting the phone elsewhere. No trailing slash or wildcard.

```powershell
npm test
npm start
```

Open `http://127.0.0.1:8080/healthz` to see model readiness and six successful reference checks. This request never sends a message. Local HTTP is for computer testing; an HTTPS phone page requires an HTTPS backend.

Secrets belong in ignored `.env` or hosting environment settings. Never upload `.env`, paste bot tokens into the webpage, or put real contact details in the public source repository. The browser uses only its device's restricted **phone key**. That key is held in page memory and must be entered again after reload.

## Configure Telegram

Create a bot through Telegram's official BotFather flow. The intended recipient must start/open the bot so it may message them. Obtain the recipient chat ID through the official Bot API and put it in the server contact configuration. Do not confuse the Telegram chat ID with a telephone number. The service intentionally has no public contact-management or test-message endpoint.

The Bot API's `sendMessage` success means Telegram accepted a message, not that the person read it. [Official Bot API](https://core.telegram.org/bots/api#sendmessage).

## Deploy on Render

The ZIP contains the complete `cloud` service, including trained weights and `package-lock.json`. Upload its source to your own Git repository; Render connects to that repository. No backend has been deployed or connected to a real Telegram account by this implementation.

If this is part of the full project repository, choose root directory `cloud`; for a repository containing the extracted ZIP contents at its root, leave Root Directory blank.

Create a Node Web Service with build command `npm ci --omit=dev`, start command `npm start`, health path `/healthz`, `NODE_VERSION=24.22.1`, and `HOST=0.0.0.0`. Render supplies `PORT`. Add `DEVICES_JSON`, `TELEGRAM_BOT_TOKEN`, `ALLOWED_ORIGINS`, `DRY_RUN` as environment settings. Alternatively use the supplied `render.yaml` Blueprint with the complete project layout; adjust/remove its `rootDir` for a standalone backend repository.

Start in dry run. Once ready, open the phone webpage's **Connection details**, enter the HTTPS backend origin and its configured `phone_key`, and save the URL. A dry-run response intentionally stays undelivered on the phone. A simulated event remains simulated if you later switch to real mode: create a fresh event for real delivery rather than reusing it.

Render free services sleep after inactivity and have no persistent disk. Warm `/healthz` shortly before the demonstration, keep the service active during it, and use a **single instance**. SQLite on free Render is temporary: contacts reload from `DEVICES_JSON`, but event deadlines/history/deduplication can be lost on redeploy or filesystem replacement. Do not replay old browser-queued events across a fresh database without reviewing them. For persistent event recovery use a persistent disk on a paid service or extend the store to an external database. Local SQLite on your computer survives ordinary restarts. [Render free limits](https://render.com/docs/free), [Node version settings](https://render.com/docs/node-version).

## Troubleshooting and delivery behavior

### Phone HTTP errors

The owner-private phone Site migrated to **https://fallguard-mobile.krishsonpal23.chatgpt.site** on 30 October 2026; the former `muddynote1024` URL redirects there. If the former origin is explicitly configured in `ALLOWED_ORIGINS`, the service additionally accepts this exact verified successor. Other origins remain explicitly restricted, and all event requests still need the appropriate per-device key. A custom-host setup is unchanged. You may also configure the new origin directly in Render.

API requests and rejected preflights now emit JSON log entries with method, known route, canonical browser origin, HTTP status and a reason code. Request bodies, Authorization headers and query strings are omitted. Startup lists configured device IDs and canonical origins, without contact IDs or keys.

- `origin_not_allowed` (403): set `ALLOWED_ORIGINS` to the phone webpage's exact scheme/host/port, without a trailing slash or page path. Do not enter the backend origin unless it also serves the frontend.
- `device_id_mismatch` (403): the phone is sending a wearable name different from the device entry associated with its key. Match the exact advertised name and case; old browser-queued test events can retain old names.
- `invalid_access_key` (401): re-enter the correct device's phone key on the webpage; it is held in memory and is lost on reload. The device key is for ESP32 requests.
- `episode_cooldown` (409): a different positive event reached the server within ten seconds of a resolved/simulated episode. Logs include `retry_after_ms`. This is an alert grouping rule, not a new ML classification.
- `device_episode_active` (409): an earlier episode remains pending, sending, failed or unknown; logs include `active_state`. An unknown delivery requires review rather than blind resend.
- `event_deadline_pending`, `event_cancelled`, `event_normal` (409): the same identity already has a deadline/decision incompatible with this dispatch request. `delivery_unknown` reports an ambiguous saved delivery outcome.

`DRY_RUN` controls only Telegram delivery. Actual sensor/model detections still use the normal event path; `simulated` means the message was not sent. Overlapping positive windows or separate queued detections can hit episode rules. The current phone retains simulated results as undelivered; do not assume every retry is a new physical fall or discard real history just to hide conflicts.

If a phone request produces no entry after deploying this logging version, verify that the page is configured with this Render service's HTTPS origin, that `/healthz` loads, that the latest deployment is active, and that Render log filters are not hiding application output. A hosting proxy, a different URL or the frontend host can reject a request before it reaches this application.

### Delivery states

- `sent`: Telegram accepted this event; further requests with the same key return saved success.
- `failed`: Telegram explicitly refused the request. Cloud worker retries after 15 seconds; phone events retry when the webpage requests it.
- `unknown`: timeout, invalid/ambiguous upstream reply, or restart during delivery. The message might already have been accepted. **No automatic resend.** Check Telegram and resolve the event/database manually before continuing that device's demo. This prevents pretending to guarantee exactly-once delivery, which the Bot API does not offer.
- `simulated`: safe dry run, no Telegram call; cannot be mistaken for delivery.

The server must stay running for its timer. This is a single-process college demo, not a distributed alert service. Network delay shortens the visible LED cancellation time; cancellation must arrive at the cloud before its deadline. Server time determines cloud deadlines. Keep phone/server clocks reasonably synchronized for phone expiry validation.

## Validation

`npm test` runs sixteen checks: six saved Keras prediction fixtures on CPU, independent expiry, exact cancellation boundary, duplicate concurrent delivery, overlap protection, normal scores, capture-age validation/recovery, persisted timer recovery, uncertain-send behavior, HTTP authorization/origin/identity validation, quoted configuration parsing, safe startup errors, secret-free request logging, cooldown/unresolved-episode conflicts and exact phone-host migration compatibility. All Telegram behavior is simulated or mocked; no real message was sent by these checks. Physical BLE/Wi-Fi and Android end-to-end behavior still require the board and phone.
