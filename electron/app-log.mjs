// Minimal append-only diagnostic log. Records events and error messages only —
// never message bodies, credentials or file contents — so a log can be handed
// to someone else without leaking the user's data.
import fs from 'node:fs/promises';
import path from 'node:path';

const SECRET_KEY = /(key|token|secret|password|cookie|authorization)/i;

function redact(value, depth = 0) {
  if (depth > 4) return '[depth]';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => redact(item, depth + 1));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [name, item] of Object.entries(value).slice(0, 40)) {
      result[name] = SECRET_KEY.test(name) ? '[redacted]' : redact(item, depth + 1);
    }
    return result;
  }
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  return value;
}

export class AppLog {
  constructor({directory, maxBytes = 1_000_000, keep = 2} = {}) {
    this.directory = directory;
    this.file = path.join(directory, 'app.log');
    this.maxBytes = maxBytes;
    this.keep = keep;
    this.queue = Promise.resolve();
    this.failed = false;
  }

  write(level, event, detail) {
    const line = `${new Date().toISOString()} ${level} ${event} ${JSON.stringify(redact(detail ?? {}))}\n`;
    this.queue = this.queue.then(() => this.append(line)).catch(() => { this.failed = true; });
    return this.queue;
  }

  async append(line) {
    await fs.mkdir(this.directory, {recursive: true});
    const size = await fs.stat(this.file).then(stat => stat.size).catch(() => 0);
    if (size + line.length > this.maxBytes) await this.rotate();
    await fs.appendFile(this.file, line, 'utf8');
  }

  async rotate() {
    for (let index = this.keep; index > 1; index--) {
      await fs.rename(`${this.file}.${index - 1}`, `${this.file}.${index}`).catch(() => {});
    }
    await fs.rename(this.file, `${this.file}.1`).catch(() => {});
  }

  async tail(lines = 200) {
    const text = await fs.readFile(this.file, 'utf8').catch(() => '');
    if (!text) return [];
    return text.trimEnd().split('\n').slice(-lines);
  }

  async copyTo(targetDirectory) {
    await this.queue;
    await fs.mkdir(targetDirectory, {recursive: true});
    const copied = [];
    for (const name of [this.file, `${this.file}.1`, `${this.file}.2`]) {
      const body = await fs.readFile(name, 'utf8').catch(() => null);
      if (body === null) continue;
      const destination = path.join(targetDirectory, path.basename(name));
      await fs.writeFile(destination, body, 'utf8');
      copied.push(path.basename(name));
    }
    return copied;
  }
}
