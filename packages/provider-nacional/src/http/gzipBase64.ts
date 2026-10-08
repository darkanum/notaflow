import { gunzipSync, gzipSync } from 'node:zlib';

export function gzipBase64(xml: string): string {
  return gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
}

export function gunzipBase64(payload: string): string {
  return gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
}
