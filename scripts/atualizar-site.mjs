// Junta os banners, selos e imagens do site (tudo que não é foto de produto) em data/site.json
import { writeFile } from "node:fs/promises";

const LOJA = "https://baianao.com.br";
const CDN = "https://cdn.shopify.com/s/files/1/0736/4886/5530/files/";
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36" };

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const falhas = {};
async function pegar(url, tipo = "text") {
  for (let t = 0; t < 5; t++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return tipo === "json" ? r.json() : r.text();
      falhas[r.status] = (falhas[r.status] || 0) + 1;
      const ra = +r.headers.get("retry-after");
      await espera(ra ? ra * 1000 : 3000 * 2 ** t);
      continue;
    } catch (e) {
      falhas[e.message] = (falhas[e.message] || 0) + 1;
    }
    await espera(3000 * 2 ** t);
  }
  return null;
}

const RE = /(?:baianao\.com\.br\/cdn\/shop|cdn\.shopify\.com\/s\/files\/1\/0736\/4886\/5530)\/files\/([^"'\s?)\\]+?\.(?:jpe?g|png|webp|gif|svg))/gi;
const arquivo = (src) => decodeURIComponent((src || "").split("?")[0].split("/files/").pop() || "");
const nomes = (html) => [...(html || "").matchAll(RE)].map((m) => decodeURIComponent(m[1]));

// 1) fotos de produto (pra excluir)
const deProduto = new Set();
for (let p = 1; p < 200; p++) {
  const j = await pegar(`${LOJA}/products.json?limit=250&page=${p}`, "json");
  const lista = j?.products || [];
  lista.forEach((x) => (x.images || []).forEach((i) => deProduto.add(arquivo(i.src))));
  if (lista.length < 250) break;
}

// 2) páginas do site: home + coleções
const paginas = [`${LOJA}/`];
const col = await pegar(`${LOJA}/collections.json?limit=250`, "json");
(col?.collections || []).slice(0, 60).forEach((c) => paginas.push(`${LOJA}/collections/${c.handle}`));

const achados = new Map(); // nome -> nº de páginas onde aparece
for (const url of paginas) {
  const html = await pegar(url);
  new Set(nomes(html)).forEach((n) => achados.set(n, (achados.get(n) || 0) + 1));
  await espera(800);
}
(col?.collections || []).forEach((c) => {
  const n = c.image?.src && arquivo(c.image.src);
  if (n) achados.set(n, (achados.get(n) || 0) + 1);
});

// 3) dimensões lendo só o cabeçalho do arquivo
function dimensoes(b) {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.toString("ascii", 0, 3) === "GIF") return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const t = b.toString("ascii", 12, 16);
    if (t === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (t === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (t === "VP8L") { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

const lista = [...achados.keys()].filter((n) => n && !deProduto.has(n) && !/\.svg$/i.test(n)).slice(0, 1500);
const imagens = [];
for (let i = 0; i < lista.length; i += 4) {
  await Promise.all(
    lista.slice(i, i + 4).map(async (n) => {
      const u = CDN + encodeURIComponent(n).replace(/%2F/g, "/");
      let b = null, sumiu = false;
      for (let t = 0; t < 3 && !b; t++) {
        try {
          const r = await fetch(u, { headers: { ...UA, Range: "bytes=0-65535" } });
          if (r.ok || r.status === 206) b = Buffer.from(await r.arrayBuffer());
          else {
            falhas["img " + r.status] = (falhas["img " + r.status] || 0) + 1;
            if (r.status === 404) { sumiu = true; break; }
            await espera(2000 * (t + 1));
          }
        } catch (e) {
          falhas["img " + e.message] = (falhas["img " + e.message] || 0) + 1;
          await espera(2000 * (t + 1));
        }
      }
      let d = dimensoes(b) || {};
      if (!d.w) {
        const m = n.match(/(\d{2,4})x(\d{2,4})/i); // ex.: banner-1920x465.png
        if (m) d = { w: +m[1], h: +m[2] };
      }
      if (sumiu) return;
      if (d.w && d.w < 40 && d.h < 40) return; // ícones minúsculos
      imagens.push({ n, u, w: d.w || null, h: d.h || null, p: achados.get(n) });
    })
  );
}
// banners largos primeiro, depois os maiores
imagens.sort((a, b) => ((b.w || 0) / (b.h || 1) >= 2) - ((a.w || 0) / (a.h || 1) >= 2) || (b.w || 0) * (b.h || 0) - (a.w || 0) * (a.h || 0));

console.log(`Produtos: ${deProduto.size} fotos · páginas: ${paginas.length} · achadas: ${achados.size} · válidas: ${imagens.length} · falhas: ${JSON.stringify(falhas)}`);
if (imagens.length < 30) {
  // o site não respondeu direito agora: mantém a última versão publicada em vez de zerar
  const anterior = await fetch("https://bacetto.github.io/fotos-baianao/data/site.json?" + Date.now()).then((r) => r.json()).catch(() => null);
  if (anterior?.imagens?.length) {
    await writeFile("data/site.json", JSON.stringify(anterior));
    console.log(`Mantida a versão anterior (${anterior.imagens.length} imagens).`);
    process.exit(0);
  }
  if (!imagens.length) {
    console.error("Nenhuma imagem encontrada e não há versão anterior.");
    process.exit(1); // falha o job e não publica um painel vazio
  }
}
await writeFile("data/site.json", JSON.stringify({ atualizado: new Date().toISOString(), imagens }, null, 0));
console.log(`${imagens.length} imagens do site salvas (${deProduto.size} fotos de produto ignoradas, ${paginas.length} páginas lidas).`);
