# Cloud HTTP API v1

Use HTTPS in deployment. Requests are JSON objects, max 32 KiB. Error responses have `{ "error": "..." }` with a non-2xx status. Health: `GET /healthz` (no key). All other routes use `Authorization: Bearer <key>` and `Content-Type: application/json`. Browser origins must be explicitly allowed.

## Identity and replay

Every event request contains `device_id`, `boot_id`, `window_id`, `event_key`. IDs are unsigned 32-bit integers. Key format is exactly `device_id/boot_hex_8_digits/window_hex_8_digits`, lowercase. Example: `FallGuard-ESP32-A1B2C3/0000000a/00000001`. Match the device name advertised over BLE. Retain identity across retries and fallback. Never substitute a new ID just to retry delivery.

Window submission and phone-alert requests also require `Idempotency-Key: <event_key>`. A device key cannot use the phone-alert endpoint; a phone key cannot submit/cancel cloud inference. Each key authorizes only its configured device. No contact/key appears in responses. Request limit is 600 authenticated requests per minute per device; suggested device polling is every 500 ms. Keep network I/O off the sampling task.

## Phone-owned alert

`POST /api/v1/events/phone-alert` using **phone key**, after the local six seconds elapse without cancellation:

```json
{"device_id":"FallGuard-ESP32-A1B2C3","boot_id":10,"window_id":1,"event_key":"FallGuard-ESP32-A1B2C3/0000000a/00000001","route":"phone","score":0.91,"detected_at":"2026-10-26T10:00:00.000Z","cancel_deadline":"2026-10-26T10:00:06.000Z"}
```

`cancel_deadline - detected_at` must be exactly 6000 ms, deadline no later than server now, score finite in [0.44,1]. Phone cancellations stay on the phone and never request dispatch. Only HTTP success with matching `event_key` and `status=sent` confirms Telegram acceptance. Dry run returns `simulated`; explicit delivery failures return 503, uncertainty 409. Safe to query/retry the same event after a browser request timeout, because saved success is reused while its database survives.

## Cloud inference

`POST /api/v1/windows` using **device key**, identity plus:

```json
{"captured_at_ms":1793008800000,"sample_hz":50,"units":"m/s2,rad/s","samples":[0,0,9.81,0,0,0]}
```

The example samples are abbreviated: supply **750 numbers**, 125 oldest-first rows flattened in `ax,ay,az,gx,gy,gz` order. Raw m/s² including gravity, gyro rad/s; no CNN normalization on device. Finite values only, absolute value <=1000. Same model, normalization and threshold as the phone. `captured_at_ms` is the candidate completion time in Unix epoch milliseconds (replace the example with actual network-synchronized time). New cloud events require capture age <=30 seconds and no more than five seconds in the future. Already saved events return their existing decision/deadline regardless of age, so late recovery cannot restart a timer. Firmware preserves the same IDs across a BLE-to-cloud retry. No automatic decision on timeout.

Response fields: `event_key`, device/boot/window identity, `route`, `score`, `detected_at` and `deadline` (server Unix epoch milliseconds), `status`, `remaining_ms`, `threshold=0.44`, `updated_at`, `message_id` (Telegram ID only after sent). Cloud-positive response starts as `pending`, normal as `normal`. Start ESP32's LED mirror using returned remaining time minus elapsed HTTP request time (conservative); **never start a new six seconds on receipt**. Network operations run on a worker task so sensing and button checks continue.

The backend worker sends after expiry without needing another request or device confirmation. Repeated submissions return the same event and deadline. Another window during an unresolved episode or ten-second terminal cooldown returns 409; do not interpret it as a CNN decision for that new window or reset the active event.

## Cloud status and cancellation

`POST /api/v1/events/status` with identity and **device key** returns the saved event. Poll after a pending result until terminal outcome; missing connection does not cancel the cloud timer.

`POST /api/v1/events/cancel` with identity and **device key**. Cloud must receive it strictly before deadline. Accepted returns `status=cancelled`; repeat cancellation remains cancelled. Late/phone-owned/resolved request returns 409. Clear LED only after a received cancellation acknowledgement. Do not turn heartbeat/window ACK into cancellation.

Terminal states are `normal`, `cancelled`, `sent`, `failed`, `simulated`, `unknown`. On timeout/error keep a fault/pending indication and retry the **same identity** as appropriate. `unknown` requires review; it does not mean delivered or definitely failed.

## Current integration boundary

Backend, phone authorization and ESP32 direct Wi-Fi/HTTPS transport are implemented. Firmware setup is in `../firmware/WIFI_SETUP.md`. Deploy this updated backend (including capture-age validation) before enabling the updated firmware. Live board/hotspot/Telegram operation still requires configuration and one end-to-end demonstration check.
