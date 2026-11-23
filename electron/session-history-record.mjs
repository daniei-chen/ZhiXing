import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const harnessRequire = createRequire(require.resolve('@deepseek-ai/dsh/lib/bin.js'));
const {assertStoredId, assertVersion, validateStoredEvents, assertContiguous} = await import(
 pathToFileURL(harnessRequire.resolve('@deepseek-ai/dsh-session-persistence')).href
);

export function validateHistoryRecord(id, {header, events}) {
 assertStoredId(id, header);
 assertVersion(header);
 validateStoredEvents(header, events);
 assertContiguous(id, events, 0);
}
