import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export interface MessageRow {
  row_id: number;
  text: string | null;
  date: number | null;
  is_from_me: number;
  service: string | null;
  thread_originator_guid: string | null;
  contact_id: string | null;
  contact_display: string | null;
}

export interface ContactLookup {
  [phoneOrEmail: string]: string;
}

function normalize(phone: string): string {
  return phone.replace(/[\s\-()]/g, "");
}

export function buildContactLookup(): ContactLookup {
  const lookup: ContactLookup = {};
  const abPath = process.env.ADDRESSBOOK_PATH;
  if (!abPath || !fs.existsSync(abPath)) return lookup;

  try {
    const db = new Database(abPath, { readonly: true });
    const rows = db
      .prepare(
        `SELECT p.ZFIRSTNAME, p.ZLASTNAME, ph.ZFULLNUMBER
         FROM ZABCDRECORD p
         JOIN ZABCDPHONENUMBER ph ON ph.ZOWNER = p.Z_PK
         WHERE ph.ZFULLNUMBER IS NOT NULL
           AND (p.ZFIRSTNAME IS NOT NULL OR p.ZLASTNAME IS NOT NULL)`
      )
      .all() as Array<{ ZFIRSTNAME: string | null; ZLASTNAME: string | null; ZFULLNUMBER: string }>;

    for (const row of rows) {
      const name = [row.ZFIRSTNAME, row.ZLASTNAME].filter(Boolean).join(" ").trim();
      if (!name || !row.ZFULLNUMBER) continue;
      const n = normalize(row.ZFULLNUMBER);
      lookup[n] = name;
      if (n.startsWith("+1")) lookup[n.slice(2)] = name;
      if (!n.startsWith("+")) lookup[`+${n}`] = name;
      if (!n.startsWith("+1")) lookup[`+1${n}`] = name;
    }

    const emails = db
      .prepare(
        `SELECT p.ZFIRSTNAME, p.ZLASTNAME, e.ZADDRESS
         FROM ZABCDRECORD p
         JOIN ZABCDEMAILADDRESS e ON e.ZOWNER = p.Z_PK
         WHERE e.ZADDRESS IS NOT NULL
           AND (p.ZFIRSTNAME IS NOT NULL OR p.ZLASTNAME IS NOT NULL)`
      )
      .all() as Array<{ ZFIRSTNAME: string | null; ZLASTNAME: string | null; ZADDRESS: string }>;

    for (const row of emails) {
      const name = [row.ZFIRSTNAME, row.ZLASTNAME].filter(Boolean).join(" ").trim();
      if (!name || !row.ZADDRESS) continue;
      lookup[row.ZADDRESS.toLowerCase()] = name;
    }

    db.close();
  } catch {
    // ignore unreadable db
  }

  return lookup;
}

export function readMessages(limit = 2000): MessageRow[] {
  const dbPath = process.env.CHAT_DB_PATH || path.join(process.env.HOME!, "Library/Messages/chat.db");
  if (!fs.existsSync(dbPath)) return [];

  const db = new Database(dbPath, { readonly: true });
  const rows = db
    .prepare(
      `SELECT m.ROWID as row_id, m.text, m.date, m.is_from_me, m.service,
              m.thread_originator_guid, h.id as contact_id, h.id as contact_display
       FROM message m
       LEFT JOIN handle h ON m.handle_id = h.ROWID
       WHERE m.text IS NOT NULL AND LENGTH(m.text) > 1
       ORDER BY m.ROWID DESC LIMIT ?`
    )
    .all(limit) as MessageRow[];
  db.close();
  return rows;
}
