// Recorte de fundo com BiRefNet rodando na placa de vídeo (WebGPU), fora da tela principal.
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";
let ort = null;
const sessoes = {};

async function baixarModelo(nome) {
  const base = new URL(`modelo/${nome}/`, self.location.href.replace(/[^/]*$/, ""));
  const info = await (await fetch(new URL("modelo.json", base), { cache: "no-store" })).json();
  const cache = await caches.open("fb-modelo-" + nome);
  const chave = new URL(`completo-${info.sha}.onnx`, base).href;
  let r = await cache.match(chave);
  if (!r) {
    // limpa versões antigas
    for (const k of await cache.keys()) await cache.delete(k);
    const pedacos = [];
    let baixado = 0;
    for (const p of info.partes) {
      const resp = await fetch(new URL(p, base));
      if (!resp.ok) throw new Error("falha ao baixar o modelo");
      const leitor = resp.body.getReader();
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        pedacos.push(value);
        baixado += value.length;
        postMessage({ tipo: "progresso", txt: `Baixando a IA de recorte (só na primeira vez)… ${Math.round((baixado / info.bytes) * 100)}%` });
      }
    }
    await cache.put(chave, new Response(new Blob(pedacos)));
    r = await cache.match(chave);
  }
  return { buf: await r.arrayBuffer(), info };
}

async function sessao(nome) {
  if (sessoes[nome]) return sessoes[nome];
  if (!ort) {
    ort = await import(ORT + "ort.webgpu.min.mjs");
    ort.env.wasm.wasmPaths = ORT;
  }
  const { buf, info } = await baixarModelo(nome);
  postMessage({ tipo: "progresso", txt: "Preparando a IA na placa de vídeo…" });
  const s = await ort.InferenceSession.create(buf, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" });
  sessoes[nome] = { s, info };
  return sessoes[nome];
}

self.onmessage = async (e) => {
  const { id, nome, pixels, N } = e.data;
  try {
    if (!self.navigator.gpu) throw new Error("sem WebGPU");
    const { s } = await sessao(nome);
    postMessage({ tipo: "progresso", txt: "Recortando o produto…" });
    let entrada = new ort.Tensor("float32", pixels, [1, 3, N, N]);
    let out;
    try {
      out = await s.run({ [s.inputNames[0]]: entrada });
    } catch (err) {
      if (!/type|float16/i.test(String(err.message || err))) throw err;
      entrada = new ort.Tensor("float16", Float16Array.from(pixels), [1, 3, N, N]);
      out = await s.run({ [s.inputNames[0]]: entrada });
    }
    const t = out[s.outputNames[s.outputNames.length - 1]];
    const d = t.data;
    const m = new Uint8ClampedArray(N * N);
    for (let i = 0; i < m.length; i++) m[i] = 255 / (1 + Math.exp(-Number(d[i])));
    postMessage({ tipo: "ok", id, mascara: m, N }, [m.buffer]);
  } catch (err) {
    postMessage({ tipo: "erro", id, erro: String(err.message || err) });
  }
};
