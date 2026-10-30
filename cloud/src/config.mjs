// JSON.parse can include the offending JSON (and credentials) in its exception.
// Replace it with a fixed message; do not retain the original error as a cause.
export function parseDevicesJson(raw) {
  try {
    return JSON.parse(raw || '[]');
  } catch {
    throw new Error('DEVICES_JSON is invalid JSON. Put chat_id, phone_key and device_key values in double quotes. Check the Render environment setting; its contents are omitted from logs.');
  }
}

export function parseAllowedOrigins(raw) {
  const origins=(raw||'').split(',').map(value=>value.trim()).filter(Boolean);
  if(!origins.length||origins.includes('*'))throw Error('Configure explicit ALLOWED_ORIGINS');
  // The same owner-private FallGuard Site now redirects from its former account
  // hostname to this canonical hostname. Preserve existing Render configuration
  // while allowing that exact verified successor; do not allow arbitrary Sites.
  const previous='https://fallguard-mobile.muddynote1024.chatgpt.site';
  const current='https://fallguard-mobile.krishsonpal23.chatgpt.site';
  if(origins.includes(previous)&&!origins.includes(current))origins.push(current);
  return origins;
}
