import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const file = path.resolve(process.cwd(), '.env');
let text;
try { text = await fs.readFile(file, 'utf8'); }
catch (error) {
  if (error.code === 'ENOENT') {
    text = await fs.readFile(path.resolve(process.cwd(), '.env.example'), 'utf8');
  } else throw error;
}

const values = {
  APP_SECRET: crypto.randomBytes(48).toString('base64url'),
  ADMIN_TOKEN: crypto.randomBytes(36).toString('base64url'),
  GPT_ACTION_API_KEY: crypto.randomBytes(48).toString('base64url'),
  TELEGRAM_WEBHOOK_SECRET: crypto.randomBytes(32).toString('base64url')
};

for (const [key, value] of Object.entries(values)) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const current = text.match(pattern)?.[0]?.slice(key.length + 1) || '';
  if (!current || current.startsWith('replace-with') || current.startsWith('development-')) {
    if (pattern.test(text)) text = text.replace(pattern, `${key}=${value}`);
    else text += `\n${key}=${value}\n`;
    console.log(`Generated ${key}`);
  } else {
    console.log(`Preserved existing ${key}`);
  }
}

await fs.writeFile(file, text, { mode: 0o600 });
console.log(`Saved ${file}`);
