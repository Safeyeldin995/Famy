// QA-only helper: tracks identifiers of temporary QA_ records created for
// runtime testing, so global-teardown can find and remove exactly them.
import fs from 'fs';
import path from 'path';

const REGISTRY_PATH = path.resolve(process.cwd(), 'qa/.auth/registry.json');

export function readRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  } catch {
    return { users: [] };
  }
}

export function writeRegistry(reg) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

export function addUser(reg, entry) {
  reg.users.push(entry);
  writeRegistry(reg);
  return reg;
}
