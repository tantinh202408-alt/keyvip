import fs from 'node:fs';

const raw = fs.readFileSync('tiktok_links.json', 'utf8');
const data = JSON.parse(raw);

let html = fs.readFileSync('index.html', 'utf8');

// Thay thế dòng let allLinks = []; bằng dữ liệu thực tế
const replacement = `let allLinks = ${JSON.stringify(data.links)};`;
html = html.replace(/let allLinks = \[\];/, replacement);

fs.writeFileSync('index.html', html, 'utf8');
console.log('✔ Đã nhúng sẵn ' + data.links.length + ' link trực tiếp vào index.html!');
