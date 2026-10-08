import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../../tools/xsd/validate.py', import.meta.url));
const SCHEMAS = fileURLToPath(new URL('../schemas/', import.meta.url));

export function validateAgainstXsd(xml: string, schemaFile: string): { valid: boolean; errors: string[] } {
  const python = process.env.PYTHON ?? 'python';
  const result = spawnSync(python, ['-P', SCRIPT, `${SCHEMAS}${schemaFile}`], { input: xml, encoding: 'utf8' });
  if (result.error) throw result.error;
  const errors = `${result.stdout}${result.stderr}`.split('\n').filter(Boolean);
  return { valid: result.status === 0, errors };
}
