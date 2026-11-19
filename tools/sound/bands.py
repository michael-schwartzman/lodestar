# Where the energy of a WAV is, by band, and how its level moves in time.
#   python3 tools/sound/bands.py <file.wav> [<file.wav> ...]        (needs numpy)
# tools/sound/sfx.mjs asks it for the share of a sound's energy between 150 and 4000 Hz — the gate a made
# sound has to pass (docs/WILD-sfx.md) — and reads the three middle bands of the line it prints.
import sys, wave, numpy as np
for path in sys.argv[1:]:
    w = wave.open(path); n = w.getnframes(); sr = w.getframerate(); ch = w.getnchannels()
    x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float64) / 32768
    if ch > 1: x = x.reshape(-1, ch).mean(axis=1)
    X = np.abs(np.fft.rfft(x)) ** 2; f = np.fft.rfftfreq(len(x), 1 / sr); tot = X.sum()
    bands = [(0, 60), (60, 150), (150, 400), (400, 1000), (1000, 4000), (4000, 22050)]
    parts = ' '.join(f"{lo}-{hi}:{100 * X[(f >= lo) & (f < hi)].sum() / tot:4.1f}%" for lo, hi in bands)
    win = sr // 4; rms = [np.sqrt(np.mean(x[i:i + win] ** 2)) for i in range(0, len(x) - win + 1, win)]
    env = ' '.join(f"{20 * np.log10(r + 1e-9):.0f}" for r in rms)
    print(f"{path.split('/')[-1]:24s} peak {np.abs(x).max():.2f} rms {20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9):.1f} dB | {parts}\n   level each 0.25 s (dB): {env}")
