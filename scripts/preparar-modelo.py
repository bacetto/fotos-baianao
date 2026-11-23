"""Baixa o BiRefNet (MIT) em ONNX, ajusta pra rodar na placa de vídeo de qualquer PC
(divide Concats grandes, pois GPUs Intel só aceitam 16 buffers por shader)
e corta em partes < 100 MB pra servir pelo GitHub Pages."""
import hashlib, json, os, sys, urllib.request
import onnx
from onnx import helper

MODELOS = {
    "birefnet": "https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model_fp16.onnx",
    "birefnet-lite": "https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx",
}
MAX_ENTRADAS = 8
PARTE = 45 * 1024 * 1024
saida = sys.argv[1] if len(sys.argv) > 1 else "_modelo"
quais = sys.argv[2].split(",") if len(sys.argv) > 2 else list(MODELOS)

def dividir_concats(g):
    novos, n_div = [], 0
    for no in g.node:
        if no.op_type == "Concat" and len(no.input) > MAX_ENTRADAS:
            eixo = [a.i for a in no.attribute if a.name == "axis"][0]
            entradas = list(no.input)
            nivel = 0
            while len(entradas) > MAX_ENTRADAS:
                prox = []
                for i in range(0, len(entradas), MAX_ENTRADAS):
                    grupo = entradas[i:i + MAX_ENTRADAS]
                    if len(grupo) == 1:
                        prox.append(grupo[0]); continue
                    nome = f"{no.name or no.output[0]}_parte{nivel}_{i}"
                    novos.append(helper.make_node("Concat", grupo, [nome], axis=eixo, name=nome))
                    prox.append(nome)
                entradas, nivel = prox, nivel + 1
            novos.append(helper.make_node("Concat", entradas, list(no.output), axis=eixo, name=no.name))
            n_div += 1
        else:
            novos.append(no)
    del g.node[:]
    g.node.extend(novos)
    for no in g.node:  # subgrafos (If/Loop)
        for a in no.attribute:
            if a.type == onnx.AttributeProto.GRAPH:
                n_div += dividir_concats(a.g)
    return n_div

for nome in quais:
    url = MODELOS[nome]
    os.makedirs(f"{saida}/{nome}", exist_ok=True)
    orig = f"/tmp/{nome}.onnx"
    if not os.path.exists(orig):
        print("baixando", url, flush=True)
        urllib.request.urlretrieve(url, orig)
    m = onnx.load(orig)
    from collections import Counter
    grandes = Counter(x.op_type for x in m.graph.node if len(x.input) + len(x.output) > 12)
    print(f"{nome}: nós com muitas entradas antes do ajuste: {dict(grandes)}", flush=True)
    n = dividir_concats(m.graph)
    maior = max((len(x.input) + len(x.output) for x in m.graph.node), default=0)
    print(f"{nome}: {n} Concats divididos; maior nó agora tem {maior} entradas+saídas", flush=True)
    dados = m.SerializeToString()
    # confere que o modelo ajustado dá o mesmo resultado que o original
    try:
        import numpy as np, onnxruntime as ort
        x = np.random.RandomState(0).randn(1, 3, 1024, 1024).astype(np.float32)
        so = ort.SessionOptions(); so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
        a = ort.InferenceSession(orig, so).run(None, {m.graph.input[0].name: x})[-1]
        b = ort.InferenceSession(dados, so).run(None, {m.graph.input[0].name: x})[-1]
        print(nome, "diferença máxima após ajuste:", float(np.abs(a.astype(np.float32) - b.astype(np.float32)).max()), flush=True)
    except Exception as e:
        print("aviso: não consegui conferir no CPU:", e, flush=True)
    partes = []
    for i in range(0, len(dados), PARTE):
        p = f"parte-{i // PARTE:02d}.bin"
        with open(f"{saida}/{nome}/{p}", "wb") as f:
            f.write(dados[i:i + PARTE])
        partes.append(p)
    info = {"partes": partes, "bytes": len(dados), "sha": hashlib.sha256(dados).hexdigest()[:16],
            "entrada": m.graph.input[0].name, "saida": m.graph.output[-1].name}
    json.dump(info, open(f"{saida}/{nome}/modelo.json", "w"))
    print(nome, info, flush=True)
