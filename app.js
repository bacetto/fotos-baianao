// Fotos Baianão — tudo roda no navegador, direto do catálogo público do site.
const LOJA = "https://baianao.com.br";
const CDN_ARQ = "https://cdn.shopify.com/s/files/1/0736/4886/5530/files/";
const CACHE_KEY = "fb-catalogo-v2";
const CACHE_MIN = 30;
const POR_PAGINA = 48;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const norm = (s) => (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "foto";
const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const tamanho = (src, w) => src + (src.includes("?") ? "&" : "?") + "width=" + w;

function aviso(txt, ms = 3500) {
  const a = $("#aviso");
  a.textContent = txt;
  a.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => (a.hidden = true), ms);
}

function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function pegarBlob(url) {
  const r = await fetch(url, { mode: "cors" });
  if (!r.ok) throw new Error("Não consegui baixar a imagem (" + r.status + ")");
  return r.blob();
}

function extensao(url, blob) {
  const t = (blob && blob.type) || "";
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("gif")) return "gif";
  if (t.includes("jpeg")) return "jpg";
  const m = url.split("?")[0].match(/\.(\w{3,4})$/);
  return m ? m[1].toLowerCase() : "png";
}

/* ===================== Abas ===================== */
$$(".abas button").forEach((b) =>
  b.addEventListener("click", () => {
    $$(".abas button").forEach((x) => x.classList.toggle("ativa", x === b));
    $("#aba-produtos").hidden = b.dataset.aba !== "produtos";
    $("#aba-site").hidden = b.dataset.aba !== "site";
    if (b.dataset.aba === "site") carregarSite();
  })
);

/* ===================== Catálogo ===================== */
let produtos = [];
let filtrados = [];
let mostrados = 0;

function enxugar(p) {
  const precos = (p.variants || []).map((v) => parseFloat(v.price)).filter((x) => x > 0);
  return {
    t: p.title,
    h: p.handle,
    v: p.vendor || "",
    ty: p.product_type || "",
    tg: (p.tags || []).join(" "),
    p: precos.length ? Math.min(...precos) : null,
    img: (p.images || []).map((i) => i.src),
    // códigos (SKU) de cada cor/variação, com a foto daquela variação quando existir
    cod: (p.variants || []).filter((v) => v.sku).map((v) => ({ s: String(v.sku).trim(), c: v.title && v.title !== "Default Title" ? v.title : "", f: v.featured_image?.src || "" })),
  };
}

async function carregarCatalogo() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (c && Date.now() - c.t < CACHE_MIN * 60000 && c.itens?.length) {
      produtos = c.itens;
      prepararFiltros();
      return;
    }
  } catch {}
  const todos = [];
  for (let pag = 1; pag < 200; pag++) {
    $("#status").textContent = `Carregando o catálogo do site… ${todos.length} produtos`;
    let r;
    for (let tent = 0; tent < 3; tent++) {
      r = await fetch(`${LOJA}/products.json?limit=250&page=${pag}`).catch(() => null);
      if (r && r.ok) break;
      await new Promise((ok) => setTimeout(ok, 1500 * (tent + 1)));
    }
    if (!r || !r.ok) {
      if (!todos.length) throw new Error("O site não respondeu");
      break;
    }
    const j = await r.json();
    const lista = j.products || [];
    lista.forEach((p) => p.images?.length && todos.push(enxugar(p)));
    if (lista.length < 250) break;
  }
  produtos = todos;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), itens: todos }));
  } catch {}
  prepararFiltros();
}

function prepararFiltros() {
  const conta = (campo) => {
    const m = new Map();
    produtos.forEach((p) => p[campo] && m.set(p[campo], (m.get(p[campo]) || 0) + 1));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  };
  for (const [sel, campo] of [["#tipo", "ty"], ["#marca", "v"]]) {
    const s = $(sel);
    s.length = 1;
    conta(campo).forEach(([nome, n]) => s.add(new Option(`${nome} (${n})`, nome)));
  }
  filtrar();
}

const semZeros = (s) => norm(s).replace(/^0+(?=\d)/, "");
function achaCodigo(p, termo) {
  const t = semZeros(termo);
  return (p.cod || []).find((c) => norm(c.s) === norm(termo) || semZeros(c.s) === t);
}
function filtrar() {
  const termos = norm($("#busca").value).split(/\s+/).filter(Boolean);
  // busca por código: se todos os termos forem códigos, mostra só os produtos com esses códigos
  const porCodigo = termos.length && produtos.some((p) => achaCodigo(p, termos[0]));
  if (porCodigo) {
    filtrados = produtos
      .map((p) => {
        const c = termos.map((t) => achaCodigo(p, t)).find(Boolean);
        return c ? { ...p, achado: c } : null;
      })
      .filter(Boolean);
    $("#status").textContent = `${filtrados.length} produto(s) com esse código · clique numa foto pra baixar ou editar`;
    $("#lista").innerHTML = "";
    mostrados = 0;
    mostrarMais();
    return;
  }
  const tipo = $("#tipo").value;
  const marca = $("#marca").value;
  filtrados = produtos.filter((p) => {
    if (tipo && p.ty !== tipo) return false;
    if (marca && p.v !== marca) return false;
    if (!termos.length) return true;
    const alvo = norm(`${p.t} ${p.v} ${p.ty} ${p.tg} ${p.h} ${(p.cod || []).map((c) => c.s + " " + c.c).join(" ")}`);
    return termos.every((t) => alvo.includes(t));
  });
  $("#status").textContent = `${filtrados.length.toLocaleString("pt-BR")} produto(s)${termos.length || tipo || marca ? " encontrados" : " no site"} · clique numa foto pra baixar ou editar`;
  $("#lista").innerHTML = "";
  mostrados = 0;
  mostrarMais();
}

function mostrarMais() {
  const frag = document.createDocumentFragment();
  filtrados.slice(mostrados, mostrados + POR_PAGINA).forEach((p) => frag.appendChild(cardProduto(p)));
  mostrados += POR_PAGINA;
  $("#lista").appendChild(frag);
  $("#mais").hidden = mostrados >= filtrados.length;
}

function cardProduto(p) {
  const d = document.createElement("div");
  d.className = "card";
  d.innerHTML = `
    <div class="capa"><img loading="lazy" alt=""><span class="qtd">${p.img.length} foto${p.img.length > 1 ? "s" : ""}</span></div>
    <div class="info"><b></b><small></small><div class="cods"></div>${p.p ? `<div class="preco">${brl(p.p)}</div>` : ""}</div>
    <div class="miniaturas"></div>
    <div class="acoes"><button class="prim" data-a="zip">⬇ Baixar todas</button><button data-a="site">Ver no site</button></div>`;
  // se buscou por código, a capa mostra a foto daquela cor
  if (p.achado?.f && p.img.includes(p.achado.f)) p = { ...p, img: [p.achado.f, ...p.img.filter((x) => x !== p.achado.f)] };
  const cods = $(".cods", d);
  (p.cod || []).forEach((c) => {
    const b = document.createElement("span");
    b.className = "cod" + (p.achado && p.achado.s === c.s ? " ativo" : "");
    b.textContent = c.c ? `${c.s} · ${c.c}` : c.s;
    b.title = "Clique pra copiar o código";
    b.onclick = (ev) => {
      ev.stopPropagation();
      navigator.clipboard?.writeText(c.s);
      aviso("Código " + c.s + " copiado");
    };
    if (c.f) b.ondblclick = () => abrirEditor(c.f, `${p.t} - ${c.c || c.s}`, `Código ${c.s}`);
    cods.appendChild(b);
  });
  $(".capa img", d).src = tamanho(p.img[0], 500);
  $(".info b", d).textContent = p.t;
  $(".info small", d).textContent = [p.v, p.ty].filter(Boolean).join(" · ");
  $(".capa", d).onclick = () => abrirEditor(p.img[0], p.t, `${p.v} · foto 1 de ${p.img.length}`);
  const mini = $(".miniaturas", d);
  if (p.img.length > 1)
    p.img.forEach((src, i) => {
      const im = document.createElement("img");
      im.loading = "lazy";
      im.src = tamanho(src, 120);
      im.title = `Foto ${i + 1}`;
      im.onclick = () => abrirEditor(src, p.t, `${p.v} · foto ${i + 1} de ${p.img.length}`);
      mini.appendChild(im);
    });
  else mini.remove();
  $('[data-a="site"]', d).onclick = () => window.open(`${LOJA}/products/${p.h}`, "_blank", "noopener");
  $('[data-a="zip"]', d).onclick = (e) => baixarTodas(p, e.currentTarget);
  return d;
}

async function baixarTodas(p, botao) {
  const txt = botao.textContent;
  botao.disabled = true;
  try {
    if (p.img.length === 1) {
      const b = await pegarBlob(p.img[0]);
      baixarBlob(b, `${slug(p.t)}.${extensao(p.img[0], b)}`);
      return;
    }
    const zip = new JSZip();
    let n = 0;
    await Promise.all(
      p.img.map(async (src, i) => {
        const b = await pegarBlob(src);
        zip.file(`${slug(p.t)}-${String(i + 1).padStart(2, "0")}.${extensao(src, b)}`, b);
        botao.textContent = `Baixando ${++n}/${p.img.length}…`;
      })
    );
    baixarBlob(await zip.generateAsync({ type: "blob" }), `${slug(p.t)}.zip`);
  } catch (e) {
    aviso("Erro ao baixar: " + e.message);
  } finally {
    botao.disabled = false;
    botao.textContent = txt;
  }
}

let tBusca;
$("#busca").addEventListener("input", () => {
  clearTimeout(tBusca);
  tBusca = setTimeout(filtrar, 200);
});
$("#tipo").onchange = filtrar;
$("#marca").onchange = filtrar;
$("#mais").onclick = mostrarMais;

carregarCatalogo().catch((e) => {
  $("#status").textContent = "Não consegui carregar o catálogo agora (" + e.message + "). Atualize a página em alguns segundos.";
});

/* ===================== Imagens do site (banners, selos) ===================== */
let siteImgs = null;
async function carregarSite() {
  if (siteImgs) return;
  $("#status-site").textContent = "Carregando imagens do site…";
  try {
    const r = await fetch("data/site.json?" + Math.floor(Date.now() / 600000));
    const j = await r.json();
    siteImgs = j.imagens || [];
    $("#status-site").dataset.base = `Atualizado em ${new Date(j.atualizado).toLocaleString("pt-BR")}`;
    filtrarSite();
  } catch {
    $("#status-site").textContent = "Não consegui carregar as imagens do site.";
  }
}
function filtrarSite() {
  if (!siteImgs) return;
  const q = norm($("#busca-site").value);
  const tam = $("#tam-site").value;
  const lista = siteImgs.filter((i) => {
    if (q && !norm(i.n).includes(q)) return false;
    if (tam === "banner" && !(i.w && i.h && i.w / i.h >= 2)) return false;
    if (tam === "outros" && i.w && i.h && i.w / i.h >= 2) return false;
    return true;
  });
  $("#status-site").textContent = `${lista.length} imagem(ns) do site · ${$("#status-site").dataset.base || ""}`;
  const g = $("#lista-site");
  g.innerHTML = "";
  lista.forEach((i) => {
    const d = document.createElement("div");
    d.className = "card";
    d.innerHTML = `<div class="capa"><img loading="lazy" alt=""></div><div class="info"><small></small></div>
      <div class="acoes"><button class="prim" data-a="b">⬇ Baixar</button><button data-a="e">Editar</button></div>`;
    $("img", d).src = tamanho(i.u, 640);
    $("small", d).textContent = `${i.n}${i.w ? ` · ${i.w}×${i.h}` : ""}`;
    $(".capa", d).onclick = $('[data-a="e"]', d).onclick = () => abrirEditor(i.u, i.n, "Imagem do site");
    $('[data-a="b"]', d).onclick = async () => {
      try {
        const b = await pegarBlob(i.u);
        baixarBlob(b, i.n);
      } catch (e) {
        aviso("Erro ao baixar: " + e.message);
      }
    };
    g.appendChild(d);
  });
}
$("#busca-site").addEventListener("input", filtrarSite);
$("#tam-site").onchange = filtrarSite;

/* ===================== Editor ===================== */
const fantasma = document.createElement("canvas");
fantasma.id = "ed-fantasma";
fantasma.hidden = true;
$("#ed-area").insertBefore(fantasma, $("#ed-base"));
const E = {
  ref: null,
  base: $("#ed-base"),
  over: $("#ed-over"),
  previa: $("#ed-previa"),
  nome: "foto",
  original: null,
  hist: [],
  modo: "ver",
  mask: null,
  sel: null,
};

function novoCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
function clonar(c) {
  const n = novoCanvas(c.width, c.height);
  n.getContext("2d").drawImage(c, 0, 0);
  return n;
}
function carregando(txt) {
  $("#ed-carregando").hidden = !txt;
  if (txt) $("#ed-carregando-txt").textContent = txt;
}

async function abrirEditor(url, nome, info) {
  $("#editor").hidden = false;
  document.body.style.overflow = "hidden";
  $("#ed-titulo").textContent = nome;
  $("#ed-info").textContent = info || "";
  E.nome = slug(nome);
  E.hist = [];
  E.ref = null;
  setModo("ver");
  carregando("Abrindo a foto em alta…");
  try {
    const bmp = await createImageBitmap(await pegarBlob(url));
    const c = novoCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    E.original = c;
    definirBase(clonar(c), false);
    $("#ed-info").textContent = `${info || ""} · original ${bmp.width}×${bmp.height}`;
  } catch (e) {
    aviso("Erro ao abrir: " + e.message);
  } finally {
    carregando(null);
  }
}

function fecharEditor() {
  $("#editor").hidden = true;
  document.body.style.overflow = "";
  E.hist = [];
  E.original = null;
}
$("#ed-fechar").onclick = fecharEditor;
$("#editor").addEventListener("click", (e) => e.target.id === "editor" && fecharEditor());
document.addEventListener("keydown", (e) => {
  if ($("#editor").hidden) return;
  if (e.key === "Escape") fecharEditor();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") desfazer();
});

function definirBase(c, guardar = true) {
  if (guardar) {
    E.hist.push(clonar(E.base));
    if (E.hist.length > 12) E.hist.shift();
  }
  E.base.width = c.width;
  E.base.height = c.height;
  E.base.getContext("2d").drawImage(c, 0, 0);
  E.over.width = c.width;
  E.over.height = c.height;
  E.mask = novoCanvas(c.width, c.height);
  E.sel = null;
  ajustarTamanhoTela();
  $("#ed-desfazer").disabled = !E.hist.length;
  renderPrevia();
}

function ajustarTamanhoTela() {
  const area = $("#ed-area").getBoundingClientRect();
  if (!area.width || !E.base.width) return;
  const esc = Math.min((area.width - 16) / E.base.width, (area.height - 16) / E.base.height, 1.5);
  const w = Math.round(E.base.width * esc) + "px";
  const h = Math.round(E.base.height * esc) + "px";
  for (const c of [E.base, E.over, fantasma]) {
    c.style.width = w;
    c.style.height = h;
  }
}
window.addEventListener("resize", ajustarTamanhoTela);

function desfazer() {
  const c = E.hist.pop();
  if (!c) return;
  definirBase(c, false);
}
$("#ed-desfazer").onclick = desfazer;
$("#ed-original").onclick = () => {
  if (!E.original) return;
  E.ref = null;
  definirBase(clonar(E.original));
};

function setModo(m) {
  E.modo = m;
  $$(".ed-ferr [data-modo]").forEach((b) => b.classList.toggle("ativa", b.dataset.modo === m));
  $("#ed-apagar-ctl").hidden = m !== "apagar";
  $("#ed-recortar-ctl").hidden = m !== "recortar";
  $("#ed-retocar-ctl").hidden = m !== "retocar";
  if (m === "retocar" && !referencia()) {
    aviso("Use “Remover fundo” primeiro; depois retoque aqui.");
    m = E.modo = "ver";
    $("#ed-retocar-ctl").hidden = true;
    $$(".ed-ferr [data-modo]").forEach((b) => b.classList.toggle("ativa", b.dataset.modo === "ver"));
  }
  atualizarFantasma();
  E.over.style.cursor = m === "ver" ? "default" : "crosshair";
  E.over.style.pointerEvents = m === "ver" ? "none" : "auto";
  $("#ed-dica").textContent = {
    ver: "Escolha o formato ao lado e baixe. Use as ferramentas acima pra recortar, apagar logo/marca ou tirar o fundo.",
    apagar: "Pinte por cima da marca, logo, selo ou texto que quer apagar. Depois clique em “Apagar área pintada”.",
    recortar: "Arraste um retângulo em volta do elemento que quer pegar (ex.: o produto de um banner).",
    retocar: "Restaurar: pinte onde a IA cortou parte do produto (vidro, pés, detalhes). Apagar: pinte a sobra de fundo que ficou. Ctrl+Z desfaz.",
  }[m];
  limparOver();
}
$$(".ed-ferr [data-modo]").forEach((b) => (b.onclick = () => setModo(b.dataset.modo)));

function limparOver() {
  E.over.getContext("2d").clearRect(0, 0, E.over.width, E.over.height);
  if (E.mask) E.mask.getContext("2d").clearRect(0, 0, E.mask.width, E.mask.height);
  E.sel = null;
}
$("#ed-limpar-mask").onclick = limparOver;

function ponto(e) {
  const r = E.over.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * E.over.width, y: ((e.clientY - r.top) / r.height) * E.over.height, esc: E.over.width / r.width };
}

let arrastando = null;
E.over.addEventListener("pointerdown", (e) => {
  if (E.modo === "ver") return;
  E.over.setPointerCapture(e.pointerId);
  const p = ponto(e);
  arrastando = { ini: p, ult: p };
  if (E.modo === "apagar") pintar(p, p);
  if (E.modo === "retocar") {
    E.hist.push(clonar(E.base));
    if (E.hist.length > 12) E.hist.shift();
    $("#ed-desfazer").disabled = false;
    retocar(p, p);
  }
});
E.over.addEventListener("pointermove", (e) => {
  if (!arrastando) return;
  const p = ponto(e);
  if (E.modo === "apagar") pintar(arrastando.ult, p);
  if (E.modo === "recortar") desenharSelecao(arrastando.ini, p);
  if (E.modo === "retocar") retocar(arrastando.ult, p);
  arrastando.ult = p;
});
E.over.addEventListener("pointerup", () => {
  if (arrastando && E.modo === "retocar") renderPrevia();
  arrastando = null;
});
E.over.addEventListener("pointermove", (e) => {
  if (E.modo !== "retocar") return;
  const p = ponto(e);
  const g = E.over.getContext("2d");
  g.clearRect(0, 0, E.over.width, E.over.height);
  g.strokeStyle = rtModo === "restaurar" ? "#16a34a" : "#d6111a";
  g.lineWidth = 2 * p.esc;
  g.beginPath();
  g.arc(p.x, p.y, (+$("#rt-pincel").value * p.esc) / 2, 0, Math.PI * 2);
  g.stroke();
});
E.over.addEventListener("pointerleave", () => E.modo === "retocar" && E.over.getContext("2d").clearRect(0, 0, E.over.width, E.over.height));

/* ---------- Retocar recorte (restaurar / apagar com pincel suave) ---------- */
let rtModo = "restaurar";
$("#rt-restaurar").onclick = () => { rtModo = "restaurar"; $("#rt-restaurar").classList.add("ativa"); $("#rt-apagar").classList.remove("ativa"); };
$("#rt-apagar").onclick = () => { rtModo = "apagar"; $("#rt-apagar").classList.add("ativa"); $("#rt-restaurar").classList.remove("ativa"); };
$("#rt-fantasma").onchange = atualizarFantasma;

function referencia() {
  if (E.ref && E.ref.width === E.base.width && E.ref.height === E.base.height) return E.ref;
  if (E.original && E.original.width === E.base.width && E.original.height === E.base.height) return E.original;
  return null;
}
function atualizarFantasma() {
  const ref = referencia();
  const mostrar = E.modo === "retocar" && ref && $("#rt-fantasma").checked;
  fantasma.hidden = !mostrar;
  if (mostrar) {
    fantasma.width = ref.width;
    fantasma.height = ref.height;
    fantasma.getContext("2d").drawImage(ref, 0, 0);
    ajustarTamanhoTela();
  }
}

let pincelCache = null;
function carimbo(raio, suave) {
  const chave = raio + "|" + suave;
  if (pincelCache?.chave === chave) return pincelCache.c;
  const d = Math.ceil(raio * 2) + 2;
  const c = novoCanvas(d, d);
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, raio);
  const duro = Math.max(0, Math.min(0.99, 1 - suave / 100));
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(duro, "rgba(0,0,0,1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, d, d);
  pincelCache = { chave, c };
  return c;
}

function retocar(a, b) {
  const ref = referencia();
  if (!ref) return;
  const raio = Math.max(1, (+$("#rt-pincel").value * b.esc) / 2);
  const pin = carimbo(raio, +$("#rt-suave").value);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const passos = Math.max(1, Math.ceil(dist / Math.max(1, raio / 4)));
  // máscara do traço
  const x0 = Math.floor(Math.min(a.x, b.x) - raio - 2), y0 = Math.floor(Math.min(a.y, b.y) - raio - 2);
  const w = Math.ceil(Math.abs(b.x - a.x) + raio * 2 + 4), h = Math.ceil(Math.abs(b.y - a.y) + raio * 2 + 4);
  const m = novoCanvas(w, h);
  const gm = m.getContext("2d");
  for (let i = 0; i <= passos; i++) {
    const t = i / passos;
    gm.drawImage(pin, a.x + (b.x - a.x) * t - x0 - pin.width / 2, a.y + (b.y - a.y) * t - y0 - pin.height / 2);
  }
  const g = E.base.getContext("2d");
  if (rtModo === "apagar") {
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.drawImage(m, x0, y0);
    g.restore();
  } else {
    gm.globalCompositeOperation = "source-in";
    gm.drawImage(ref, -x0, -y0);
    g.drawImage(m, x0, y0);
  }
}

function pintar(a, b) {
  const raio = (+$("#ed-pincel").value * b.esc) / 2;
  const gm = E.mask.getContext("2d");
  gm.strokeStyle = "#fff";
  gm.lineWidth = raio * 2;
  gm.lineCap = "round";
  gm.lineJoin = "round";
  gm.beginPath();
  gm.moveTo(a.x, a.y);
  gm.lineTo(b.x + 0.01, b.y);
  gm.stroke();
  // evita escurecer a sobreposição: redesenha a máscara inteira como uma cor só
  const g = E.over.getContext("2d");
  g.clearRect(0, 0, E.over.width, E.over.height);
  g.drawImage(E.mask, 0, 0);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = "rgba(214,17,26,.5)";
  g.fillRect(0, 0, E.over.width, E.over.height);
  g.globalCompositeOperation = "source-over";
}

function desenharSelecao(a, b) {
  const x = Math.max(0, Math.min(a.x, b.x)), y = Math.max(0, Math.min(a.y, b.y));
  const w = Math.min(E.over.width, Math.max(a.x, b.x)) - x, h = Math.min(E.over.height, Math.max(a.y, b.y)) - y;
  E.sel = { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  const g = E.over.getContext("2d");
  g.clearRect(0, 0, E.over.width, E.over.height);
  g.fillStyle = "rgba(0,0,0,.45)";
  g.fillRect(0, 0, E.over.width, E.over.height);
  g.clearRect(x, y, w, h);
  g.strokeStyle = "#ffd200";
  g.lineWidth = 3 * a.esc;
  g.setLineDash([10 * a.esc, 6 * a.esc]);
  g.strokeRect(x, y, w, h);
}

function recortar() {
  if (!E.sel || E.sel.w < 8 || E.sel.h < 8) {
    aviso("Arraste na imagem pra marcar a área primeiro.");
    return false;
  }
  const { x, y, w, h } = E.sel;
  const c = novoCanvas(w, h);
  c.getContext("2d").drawImage(E.base, x, y, w, h, 0, 0, w, h);
  const ref = referencia();
  if (ref) {
    const r = novoCanvas(w, h);
    r.getContext("2d").drawImage(ref, x, y, w, h, 0, 0, w, h);
    E.ref = r;
  }
  definirBase(c);
  return true;
}
$("#ed-aplicar-recorte").onclick = () => recortar() && setModo("ver");
$("#ed-recorte-fundo").onclick = async () => {
  if (recortar()) {
    setModo("ver");
    await removerFundo();
  }
};

/* ---------- Apagar marca (OpenCV inpaint, carregado só quando usado) ---------- */
let cvPronto = null;
function carregarOpenCV() {
  if (cvPronto) return cvPronto;
  cvPronto = new Promise((ok, erro) => {
    const fontes = ["https://docs.opencv.org/4.10.0/opencv.js", "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js"];
    const tentar = (i) => {
      if (i >= fontes.length) return erro(new Error("Não consegui carregar a ferramenta de apagar."));
      const s = document.createElement("script");
      s.src = fontes[i];
      s.async = true;
      s.onerror = () => tentar(i + 1);
      s.onload = () => {
        const ini = Date.now();
        const esperar = () => {
          if (window.cv && window.cv.Mat && window.cv.inpaint) return ok(true); // não passar o cv: ele é "thenable" e trava a Promise
          if (Date.now() - ini > 90000) return erro(new Error("A ferramenta de apagar demorou demais pra carregar."));
          setTimeout(esperar, 150);
        };
        esperar();
      };
      document.head.appendChild(s);
    };
    tentar(0);
  });
  cvPronto.catch(() => (cvPronto = null));
  return cvPronto;
}

$("#ed-aplicar-apagar").onclick = async () => {
  const dados = E.mask.getContext("2d").getImageData(0, 0, E.mask.width, E.mask.height).data;
  let tem = false;
  for (let i = 3; i < dados.length; i += 4) if (dados[i] > 0) { tem = true; break; }
  if (!tem) return aviso("Pinte por cima do que quer apagar primeiro.");
  carregando("Apagando… (na primeira vez demora uns segundos pra carregar a ferramenta)");
  try {
    await carregarOpenCV();
    const cv = window.cv;
    const w = E.base.width, h = E.base.height;
    const rgba = cv.matFromImageData(E.base.getContext("2d").getImageData(0, 0, w, h));
    const rgb = new cv.Mat();
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    const mrgba = cv.matFromImageData(E.mask.getContext("2d").getImageData(0, 0, w, h));
    const mask = new cv.Mat();
    cv.cvtColor(mrgba, mask, cv.COLOR_RGBA2GRAY);
    cv.threshold(mask, mask, 1, 255, cv.THRESH_BINARY);
    const k = cv.Mat.ones(5, 5, cv.CV_8U);
    cv.dilate(mask, mask, k);
    const out = new cv.Mat();
    const raio = Math.max(3, Math.round(Math.min(w, h) / 200));
    cv.inpaint(rgb, mask, out, raio, cv.INPAINT_TELEA);
    // também preenche o canal de transparência
    const canais = new cv.MatVector();
    cv.split(rgba, canais);
    const alfa = canais.get(3);
    const alfaOut = new cv.Mat();
    cv.inpaint(alfa, mask, alfaOut, raio, cv.INPAINT_TELEA);
    const final = new cv.Mat();
    const juntar = new cv.MatVector();
    const ch = new cv.MatVector();
    cv.split(out, ch);
    juntar.push_back(ch.get(0));
    juntar.push_back(ch.get(1));
    juntar.push_back(ch.get(2));
    juntar.push_back(alfaOut);
    cv.merge(juntar, final);
    const c = novoCanvas(w, h);
    c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(final.data), w, h), 0, 0);
    [rgba, rgb, mrgba, mask, k, out, canais, alfa, alfaOut, final, juntar, ch].forEach((m) => m.delete && m.delete());
    definirBase(c);
    setModo("apagar");
    aviso("Pronto. Se ficou alguma marca, pinte de novo por cima e apague outra vez.");
  } catch (e) {
    aviso("Erro ao apagar: " + (e.message || e));
  } finally {
    carregando(null);
  }
};

/* ---------- Remover fundo (IA grátis que roda no próprio navegador) ---------- */
let bgLib = null;
async function carregarRemovedor() {
  if (bgLib) return bgLib;
  const fontes = ["https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm", "https://esm.sh/@imgly/background-removal@1.7.0"];
  for (const f of fontes) {
    try {
      bgLib = await import(f);
      return bgLib;
    } catch {}
  }
  throw new Error("Não consegui carregar o removedor de fundo.");
}
const SERVIDOR_IA = (() => { try { return localStorage.getItem("fb-ia") || ""; } catch { return ""; } })() || ""; // servidor de recorte (BiRefNet)

async function mascaraServidor(blob) {
  const ctl = new AbortController();
  const limite = setTimeout(() => ctl.abort(), 180000);
  const lento = setTimeout(() => carregando("Ligando o servidor de recorte (fica parado quando ninguém usa, leva ~1 min)…"), 8000);
  try {
    const fd = new FormData();
    fd.append("foto", blob, "foto.png");
    const r = await fetch(SERVIDOR_IA + "/mascara", { method: "POST", body: fd, signal: ctl.signal });
    if (!r.ok) throw new Error("servidor " + r.status);
    return await createImageBitmap(await r.blob());
  } finally {
    clearTimeout(limite);
    clearTimeout(lento);
  }
}

let workerIA = null, pedidoIA = 0;
const modelosFalharam = new Set();
function rodarBiRefNet(nome, pixels, N) {
  if (!workerIA) workerIA = new Worker("recorte-worker.js", { type: "module" });
  const id = ++pedidoIA;
  return new Promise((ok, erro) => {
    workerIA.onmessage = (e) => {
      const m = e.data;
      if (m.tipo === "progresso") return carregando(m.txt);
      if (m.id !== id) return;
      m.tipo === "ok" ? ok(m) : erro(new Error(m.erro));
    };
    workerIA.postMessage({ id, nome, pixels, N }, [pixels.buffer]);
  });
}

async function mascaraBiRefNet(fonte) {
  if (!navigator.gpu) throw new Error("sem WebGPU");
  const N = 1024;
  const c = novoCanvas(N, N);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#fff";
  g.fillRect(0, 0, N, N);
  g.drawImage(fonte, 0, 0, N, N);
  const px = g.getImageData(0, 0, N, N).data;
  const media = [0.485, 0.456, 0.406], desvio = [0.229, 0.224, 0.225];
  for (const nome of ["birefnet", "birefnet-lite"]) {
    if (modelosFalharam.has(nome)) continue;
    const f = new Float32Array(3 * N * N);
    for (let i = 0; i < N * N; i++) for (let k = 0; k < 3; k++) f[k * N * N + i] = (px[i * 4 + k] / 255 - media[k]) / desvio[k];
    try {
      const r = await rodarBiRefNet(nome, f, N);
      const mc = novoCanvas(N, N);
      const img = new ImageData(N, N);
      for (let i = 0; i < N * N; i++) {
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = r.mascara[i];
        img.data[i * 4 + 3] = 255;
      }
      mc.getContext("2d").putImageData(img, 0, 0);
      return mc;
    } catch (e) {
      console.warn("BiRefNet", nome, "falhou:", e.message);
      modelosFalharam.add(nome);
      if (workerIA) { workerIA.terminate(); workerIA = null; }
    }
  }
  throw new Error("BiRefNet indisponível");
}

async function mascaraNavegador(blob) {
  const lib = await carregarRemovedor();
  const res = await lib.removeBackground(blob, {
    model: "isnet",
    output: { format: "image/png", quality: 1, type: "mask" },
    progress: (chave, atual, total) => {
      if (chave.includes("fetch") && total) carregando(`Baixando a IA de recorte… ${Math.round((atual / total) * 100)}%`);
      else if (chave.includes("compute")) carregando("Recortando o produto…");
    },
  });
  return createImageBitmap(res);
}

async function removerFundo() {
  carregando("Recortando o produto com IA…");
  try {
    const fonte = clonar(E.base);
    const blob = await new Promise((ok) => fonte.toBlob(ok, "image/png"));
    let mask = null;
    if (SERVIDOR_IA) {
      try {
        mask = await mascaraServidor(blob);
      } catch (e) {
        console.warn("servidor de recorte falhou", e);
      }
    }
    if (!mask) {
      try {
        mask = await mascaraBiRefNet(fonte);
      } catch {
        mask = await mascaraNavegador(blob);
      }
    }
    // aplica a máscara (em escala de cinza) como transparência
    const w = fonte.width, h = fonte.height;
    const mc = novoCanvas(w, h);
    const gm = mc.getContext("2d", { willReadFrequently: true });
    gm.imageSmoothingQuality = "high";
    gm.drawImage(mask, 0, 0, w, h);
    const md = gm.getImageData(0, 0, w, h).data;
    const c = clonar(fonte);
    const g = c.getContext("2d", { willReadFrequently: true });
    const d = g.getImageData(0, 0, w, h);
    for (let i = 0; i < md.length; i += 4) {
      const a = md[i + 3] < 255 ? (md[i] * md[i + 3]) / 255 : md[i]; // máscara em cinza (ou alfa)
      d.data[i + 3] = Math.round((d.data[i + 3] * a) / 255);
    }
    g.putImageData(d, 0, 0);
    E.ref = fonte;
    definirBase(c);
    $("#ed-fundo-tipo").value = "transp";
    renderPrevia();
    aviso("Fundo removido. Se faltou ou sobrou algum pedaço, use “Retocar recorte”.", 5000);
  } catch (e) {
    aviso("Erro ao remover o fundo: " + (e.message || e), 6000);
  } finally {
    carregando(null);
  }
}
$("#ed-fundo").onclick = removerFundo;

/* ---------- Saída ---------- */
function medidas() {
  const f = $("#ed-formato").value;
  if (f === "orig") return [E.base.width, E.base.height];
  if (f === "custom") return [Math.max(16, Math.min(8000, +$("#ed-w").value || 1080)), Math.max(16, Math.min(8000, +$("#ed-h").value || 1080))];
  return f.split("x").map(Number);
}

function renderFinal() {
  const [W, H] = medidas();
  const tipo = $("#ed-tipo-arq").value;
  const fundo = $("#ed-fundo-tipo").value;
  const margem = +$("#ed-margem").value / 100;
  const c = novoCanvas(W, H);
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  let cor = null;
  if (fundo === "branco" || (tipo === "jpg" && (fundo === "transp" || fundo === "orig"))) cor = "#ffffff";
  else if (fundo === "cor") cor = $("#ed-cor").value;
  if (cor) {
    g.fillStyle = cor;
    g.fillRect(0, 0, W, H);
  }
  const mx = W * margem, my = H * margem;
  const aw = W - mx * 2, ah = H - my * 2;
  const w = E.base.width, h = E.base.height;
  const esc = $("#ed-encaixe").value === "preencher" ? Math.max(aw / w, ah / h) : Math.min(aw / w, ah / h);
  const dw = w * esc, dh = h * esc;
  g.save();
  g.beginPath();
  g.rect(mx, my, aw, ah);
  g.clip();
  g.drawImage(E.base, (W - dw) / 2, (H - dh) / 2, dw, dh);
  g.restore();
  return c;
}

function renderPrevia() {
  if (!E.base.width) return;
  const c = renderFinal();
  const p = E.previa;
  const esc = Math.min(1, 520 / Math.max(c.width, c.height));
  p.width = Math.round(c.width * esc);
  p.height = Math.round(c.height * esc);
  p.getContext("2d").drawImage(c, 0, 0, p.width, p.height);
  $("#ed-previa-info").textContent = `${c.width}×${c.height} px · ${$("#ed-tipo-arq").value.toUpperCase()}`;
}

["#ed-formato", "#ed-encaixe", "#ed-fundo-tipo", "#ed-tipo-arq", "#ed-cor", "#ed-w", "#ed-h", "#ed-margem"].forEach((s) =>
  $(s).addEventListener("input", () => {
    $("#ed-custom").hidden = $("#ed-formato").value !== "custom";
    $("#ed-cor").hidden = $("#ed-fundo-tipo").value !== "cor";
    $("#ed-margem-v").textContent = $("#ed-margem").value + "%";
    renderPrevia();
  })
);

const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
async function blobFinal() {
  const tipo = $("#ed-tipo-arq").value;
  const c = renderFinal();
  return new Promise((ok) => c.toBlob(ok, MIME[tipo], 0.93));
}
$("#ed-baixar").onclick = async () => {
  const [W, H] = medidas();
  const tipo = $("#ed-tipo-arq").value;
  baixarBlob(await blobFinal(), `${E.nome}-${W}x${H}.${tipo}`);
};
$("#ed-copiar").onclick = async () => {
  try {
    const c = renderFinal();
    const b = await new Promise((ok) => c.toBlob(ok, "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": b })]);
    aviso("Imagem copiada. É só colar (Ctrl+V) no Canva, WhatsApp, etc.");
  } catch {
    aviso("Seu navegador não deixou copiar. Use o botão Baixar.");
  }
};

// Ajusta o tamanho da tela do editor quando ele abre
new ResizeObserver(ajustarTamanhoTela).observe($("#ed-area"));
