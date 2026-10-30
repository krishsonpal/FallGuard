// JSON.parse can include the offending JSON (and credentials) in its exception.
// Replace it with a fixed message; do not retain the original error as a cause.
export function parseDevicesJson(raw) {
  try {
    return JSON.parse(raw || '[]');
  } catch {
    throw new Error('DEVICES_JSON is invalid JSON. Put chat_id, phone_key and device_key values in double quotes. Check the Render environment setting; its contents are omitted from logs.');
  }
}
