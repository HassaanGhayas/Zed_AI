import numpy as np, wave

SR = 44100
DUR = 22.0
BPM = 120
BEAT = 60 / BPM
N = int(SR * DUR)
rng = np.random.default_rng(7)

def hz(m): return 440 * 2 ** ((m - 69) / 12)
def put(buf, t0, sig, gain=1.0):
    i = int(round(t0 * SR))
    if i >= len(buf): return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain
def tt(d): return np.arange(int(SR * d)) / SR

def pluck(f, d=0.9, bright=1.0):
    t = tt(d)
    s = np.sin(2*np.pi*f*t) + .45*np.sin(4*np.pi*f*t)*np.exp(-t*9)*bright + .2*np.sin(6*np.pi*f*t)*np.exp(-t*14)*bright
    return s * np.exp(-t*5.5) * np.minimum(1, t*400)
def bell(f, d=1.6):
    t = tt(d)
    s = np.sin(2*np.pi*f*t) + .35*np.sin(2*np.pi*f*2.01*t)*np.exp(-t*3) + .2*np.sin(2*np.pi*f*3.0*t)*np.exp(-t*5)
    return s * np.exp(-t*2.6) * np.minimum(1, t*300)
def kick():
    t = tt(.28); f = 48 + 90*np.exp(-t*28)
    return np.sin(2*np.pi*np.cumsum(f)/SR) * np.exp(-t*13)
def hat():
    n = rng.standard_normal(int(SR*.06)); n = np.diff(n, prepend=0); n = np.diff(n, prepend=0)
    return n * np.exp(-tt(.06)*70)
def tick():
    t = tt(.03); return np.sin(2*np.pi*1760*t) * np.exp(-t*160)
def pad_note(f, d):
    t = tt(d); s = 0
    for det in (-.004, 0, .004):
        s = s + np.sin(2*np.pi*f*(1+det)*t) + .3*np.sin(4*np.pi*f*(1+det)*t)
    a = np.minimum(1, t/.5) * np.minimum(1, (d-t)/.6)
    return s * a
def swell(d=.5):
    n = rng.standard_normal(int(SR*d)); out = np.zeros_like(n); y = 0
    for i in range(len(n)):
        k = 0.01 + 0.18*(i/len(n))**2
        y += k*(n[i]-y); out[i] = y
    return out * (np.linspace(0,1,len(n))**2) * np.minimum(1, (d - tt(d))/.04+0)

# chords per bar: Am F C G Am F C G Am G Am
chords = [(57,60,64),(53,57,60),(48,52,55),(55,59,62),(57,60,64),(53,57,60),(48,52,55),(55,59,62),(57,60,64),(55,59,62),(57,60,64)]
roots = [33,29,36,31,33,29,36,31,33,31,33]  # bass octaves

dry = np.zeros(N); wet = np.zeros(N)

# pad (wet)
for b, ch in enumerate(chords):
    for m in ch:
        put(wet, b*2*BEAT*2/ (2*BEAT) * 1.0 if False else b*2.0, pad_note(hz(m), 2.3), .05)

# arp pluck: beats only until 3.5, then 8ths
pat = [0,1,2,1,0,1,2,1]
for b, ch in enumerate(chords):
    for k in range(8):
        t0 = b*2.0 + k*.25
        if t0 < 3.5 and k % 2: continue
        if t0 >= 21.5: continue
        m = ch[pat[k]] + 12
        if k % 4 == 3: m += 12
        g = .10 if t0 >= 3.5 else .07
        put(wet, t0, pluck(hz(m)), g*.5); put(dry, t0, pluck(hz(m)), g)

# drums + bass from 3.5
for bt in range(int(3.5/BEAT), int(20.0/BEAT)):
    t0 = bt*BEAT
    put(dry, t0, kick(), .55)
    if t0 >= 8.0 and bt % 1 == 0: put(dry, t0 + BEAT/2, hat(), .05)
bass_t = 3.5
while bass_t < 20.0:
    bar = int(bass_t // 2)
    for off in (0, 1.5):
        t0 = bar*2.0 + off
        if t0 >= 3.5 and t0 < 20.0:
            t = tt(.55); put(dry, t0, np.sin(2*np.pi*hz(roots[bar])*t)*np.exp(-t*3.5)*np.minimum(1,t*120), .28)
    bass_t = (bar+1)*2.0
# outro sparkle (Am arpeggio, 16ths) at 19.5
for k, m in enumerate((69, 72, 76, 81)):
    t0 = 19.5 + k*.125; put(wet, t0, bell(hz(m), 1.8), .09); put(dry, t0, bell(hz(m), 1.8), .05)

# sfx (quiet)
def typing(t_start, t_end):
    t0 = t_start
    while t0 < t_end:
        put(dry, t0, tick(), .045); t0 += .125
typing(8.375, 9.5); typing(12.875, 14.0)
for tc in (9.5, 14.0, 18.5):
    put(dry, tc, pluck(hz(76), .35, 1.4), .14); put(wet, tc, pluck(hz(76), .35, 1.4), .1)
put(wet, 14.25, bell(hz(69)), .1); put(wet, 14.25, bell(hz(76)), .07)
for k, m in enumerate((84, 88)):
    put(wet, 18.5 + .125 + k*.125, bell(hz(m), 1.2), .06)
for tb in (3.5, 8.0, 12.0, 17.0, 19.5):
    s = swell(.5); put(dry, tb-.5, s, .5)
    put(dry, tb, kick(), .0)

# reverb
ir_t = tt(1.1); ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t*4.2); ir *= np.minimum(1, ir_t*60)
L = 1 << 21
w = np.fft.irfft(np.fft.rfft(wet, L) * np.fft.rfft(ir, L), L)[:N] * .018
wet_sum = wet*.55 + w
mix = dry + wet_sum
# stereo: slight haas on wet tail
left = mix + np.roll(w, 90)*.3; right = mix + np.roll(w, 260)*.3
st = np.stack([left, right], 1)
st = np.tanh(st*1.3)/1.3
st[:int(.05*SR)] *= np.linspace(0,1,int(.05*SR))[:,None]
st[-int(.9*SR):] *= np.linspace(1,0,int(.9*SR))[:,None]**1.5
st *= 0.89 / np.abs(st).max()
pcm = (st*32767).astype('<i2')
with wave.open('D:/ZED_AI/brag-output/work/music.wav','wb') as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR); f.writeframes(pcm.tobytes())
print('ok', N/SR)
