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

def dividir_splits(m):
    """Troca Split com muitas saídas por vários Slice (1 saída cada)."""
    from onnx import numpy_helper
    import numpy as np
    g = m.graph
    inits = {i.name: i for i in g.initializer}
    consts = {}
    for no in g.node:
        if no.op_type == "Constant":
            for a in no.attribute:
                if a.name == "value":
                    consts[no.output[0]] = numpy_helper.to_array(a.t)
    formas = {}
    try:
        inf = onnx.shape_inference.infer_shapes(m)
        for vi in list(inf.graph.value_info) + list(inf.graph.input) + list(inf.graph.output):
            formas[vi.name] = [d.dim_value if d.HasField("dim_value") else None for d in vi.type.tensor_type.shape.dim]
    except Exception as e:
        print("aviso shape inference:", e)
    novos, n = [], 0
    for no in g.node:
        if no.op_type != "Split" or len(no.output) + 1 <= MAX_ENTRADAS:
            novos.append(no); continue
        eixo = next((a.i for a in no.attribute if a.name == "axis"), 0)
        tam = None
        attr = next((a for a in no.attribute if a.name == "split"), None)
        if attr is not None:
            tam = list(attr.ints)
        elif len(no.input) > 1 and no.input[1]:
            nm = no.input[1]
            if nm in inits: tam = numpy_helper.to_array(inits[nm]).tolist()
            elif nm in consts: tam = consts[nm].tolist()
        if tam is None:
            forma = formas.get(no.input[0])
            k = len(no.output)
            if forma and eixo < len(forma) and forma[eixo]:
                total = forma[eixo]
                base = -(-total // k)
                tam = [base] * (k - 1) + [total - base * (k - 1)]
        if tam is None:
            print("Split sem tamanhos conhecidos, mantido:", no.name)
            novos.append(no); continue
        ini = 0
        for j, (saida, t) in enumerate(zip(no.output, tam)):
            pre = f"{no.name or no.output[0]}_fatia{j}"
            for nome_c, val in ((pre + "_ini", ini), (pre + "_fim", ini + t), (pre + "_eixo", eixo)):
                g.initializer.append(numpy_helper.from_array(np.array([val], dtype=np.int64), nome_c))
            novos.append(helper.make_node("Slice", [no.input[0], pre + "_ini", pre + "_fim", pre + "_eixo"], [saida], name=pre))
            ini += t
        n += 1
    del g.node[:]
    g.node.extend(novos)
    return n

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
    ns = dividir_splits(m)
    maior = max((len(x.input) + len(x.output) for x in m.graph.node), default=0)
    print(f"{nome}: {ns} Splits trocados por Slices; maior nó agora: {maior}", flush=True)
    maior = max((len(x.input) + len(x.output) for x in m.graph.node), default=0)
    print(f"{nome}: {n} Concats divididos; maior nó agora tem {maior} entradas+saídas", flush=True)
    dados = m.SerializeToString()
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
