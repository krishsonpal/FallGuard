import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export class Store {
  constructor(path = ':memory:', devices = []) {
    if (path !== ':memory:') mkdirSync(dirname(path), {recursive: true});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS contacts(device_id TEXT PRIMARY KEY, wearer TEXT NOT NULL, chat_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(event_key TEXT PRIMARY KEY, device_id TEXT NOT NULL,
        boot_id INTEGER NOT NULL, window_id INTEGER NOT NULL, route TEXT NOT NULL,
        score REAL NOT NULL, detected_at INTEGER NOT NULL, deadline INTEGER NOT NULL,
        status TEXT NOT NULL, message_id TEXT, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS deadlines ON events(status, deadline);`);
    const upsert = this.db.prepare('INSERT INTO contacts VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET wearer=excluded.wearer, chat_id=excluded.chat_id');
    for (const d of devices) upsert.run(d.device_id, d.wearer, d.chat_id);
    // A crash after sending to Telegram but before saving success is ambiguous.
    // Never automatically resend these: Telegram sendMessage has no idempotency key.
    this.db.prepare("UPDATE events SET status='unknown' WHERE status='sending'").run();
  }
  contact(device) {return this.db.prepare('SELECT * FROM contacts WHERE device_id=?').get(device);}
  get(key) {return this.db.prepare('SELECT * FROM events WHERE event_key=?').get(key);}
  insert(e) {
    this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(e.event_key,e.device_id,e.boot_id,e.window_id,e.route,e.score,e.detected_at,e.deadline,e.status,null,e.detected_at);
    return this.get(e.event_key);
  }
  update(key,status,now,message = null) {this.db.prepare('UPDATE events SET status=?,updated_at=?,message_id=? WHERE event_key=?').run(status,now,message,key); return this.get(key);}
  active(device) {return this.db.prepare("SELECT * FROM events WHERE device_id=? AND status IN ('pending','sending','unknown','failed') ORDER BY detected_at DESC LIMIT 1").get(device);}
  recent(device,now) {return this.db.prepare("SELECT * FROM events WHERE device_id=? AND status IN ('sent','cancelled','simulated') AND updated_at>? ORDER BY updated_at DESC LIMIT 1").get(device,now-10000);}
  due(now) {return this.db.prepare("SELECT * FROM events WHERE route='cloud' AND status IN ('pending','failed') AND deadline<=? AND (status='pending' OR updated_at<=?)").all(now,now-15000);}
  close() {this.db.close();}
}
