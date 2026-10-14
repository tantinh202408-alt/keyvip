import fs from 'node:fs';

const raw = fs.readFileSync('tiktok_links.json', 'utf8');
const data = JSON.parse(raw);

let html = fs.readFileSync('index.html', 'utf8');

// Cập nhật RAW_INITIAL_LINKS (giữ nguyên khóa cứng allLinks = [])
const replacement = `const RAW_INITIAL_LINKS = ${JSON.stringify(data.links)};`;
html = html.replace(/const RAW_INITIAL_LINKS = (\[.*?\]|JSON\.parse\(.*?\));/s, replacement);

fs.writeFileSync('index.html', html, 'utf8');
console.log('✔ Đã nhúng sẵn ' + data.links.length + ' link vào bộ nhớ an toàn của index.html (Khóa cứng bản quyền được duy trì)!');
