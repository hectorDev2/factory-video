"""Busca los mejores tramos de una canción: los más fuertes y repetidos (el estribillo suele serlo).

  python3 hotspots.py <audio> <duración_del_tramo_en_s> [máx_resultados]  → JSON por la salida estándar

Cómo puntúa cada tramo: energía media (fuerte) + repetición (se parece a otras partes de la canción, lejos en el tiempo).
Se queda con los mejores que no se pisan entre sí y que no empiezan en silencio.
"""
import json
import subprocess
import sys

import numpy as np

SR = 11025
HOP = 0.5            # cada fotograma de análisis dura medio segundo
BANDS = 16


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def features(x):
    n = int(SR * HOP)
    frames = len(x) // n
    if frames < 8:
        return None, None
    win = np.hanning(n * 2)
    edges = np.unique(np.geomspace(2, n, BANDS + 1).astype(int))
    feats, rms = [], []
    for i in range(frames):
        seg = x[i * n:(i + 2) * n]
        if len(seg) < n * 2:
            seg = np.pad(seg, (0, n * 2 - len(seg)))
        spec = np.abs(np.fft.rfft(seg * win)) + 1e-9
        bands = [spec[edges[b]:edges[b + 1]].mean() for b in range(len(edges) - 1)]
        feats.append(np.log(np.array(bands) + 1e-6))
        rms.append(float(np.sqrt(np.mean(seg[:n] ** 2))))
    f = np.array(feats)
    f = (f - f.mean(0)) / (f.std(0) + 1e-6)
    return f, np.array(rms)


def main():
    path, length = sys.argv[1], float(sys.argv[2])
    top = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    x = decode(path)
    feats, rms = features(x)
    if feats is None:
        print(json.dumps({"error": "audio demasiado corto"}))
        return
    n = len(rms)
    w = max(4, int(round(length / HOP)))
    if w >= n:
        print(json.dumps({"total": n * HOP, "spots": [{"start": 0.0, "score": 1.0, "loud": 1.0, "repeat": 0.0}]}))
        return
    # parecido entre fotogramas (coseno) y cuánto se repite cada uno lejos de sí mismo (≥ 8 s)
    norm = feats / (np.linalg.norm(feats, axis=1, keepdims=True) + 1e-9)
    sim = norm @ norm.T
    lag = int(8 / HOP)
    idx = np.arange(n)
    far = np.abs(idx[:, None] - idx[None, :]) >= lag
    rep = np.where(far, sim, -1).max(axis=1)
    rep = np.clip(rep, 0, 1)
    loud = rms / (rms.max() + 1e-9)
    # puntaje por ventana
    cs_l, cs_r = np.concatenate([[0], np.cumsum(loud)]), np.concatenate([[0], np.cumsum(rep)])
    starts = np.arange(0, n - w + 1)
    m_loud = (cs_l[starts + w] - cs_l[starts]) / w
    m_rep = (cs_r[starts + w] - cs_r[starts]) / w
    z = lambda v: (v - v.mean()) / (v.std() + 1e-9)
    score = 0.55 * z(m_loud) + 0.45 * z(m_rep)
    # el primer fotograma no puede ser silencio
    score = np.where(loud[starts] < 0.12, -9, score)
    picks = []
    for s in np.argsort(-score):
        if score[s] <= -9:
            break
        if all(abs(s - p) >= w * 0.8 for p, _ in picks):
            picks.append((int(s), float(score[s])))
        if len(picks) >= top:
            break
    best = max((p[1] for p in picks), default=1.0)
    out = [{"start": round(s * HOP, 1), "score": round(max(0.0, min(1.0, 0.5 + sc / (2 * max(best, 1e-6)))), 2),
            "loud": round(float(m_loud[s]), 2), "repeat": round(float(m_rep[s]), 2)} for s, sc in picks]
    print(json.dumps({"total": round(n * HOP, 1), "spots": out}))


main()
