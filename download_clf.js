import fs from 'node:fs';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

async function download() {
  console.log('Downloading cloudflared-windows-amd64.exe via Node fetch...');
  const res = await fetch('https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe');
  if (!res.ok) throw new Error(`HTTP error ${res.status}`);
  
  const fileStream = fs.createWriteStream('cloudflared.exe');
  await finished(Readable.fromWeb(res.body).pipe(fileStream));
  console.log('Download completed successfully! Size:', fs.statSync('cloudflared.exe').size, 'bytes');
}

download().catch(console.error);
