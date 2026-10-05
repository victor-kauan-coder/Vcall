# Gera brand/vcall-*.svg e os ícones vetoriais do Android (android/app/src/main/res/drawable)
# a partir da mesma geometria. As letras de vcall-logo.svg vêm de um traçado (potrace) de
# public/assets/logo-wordmark.png salvo em brag-output/work/wordmark-path.txt; sem ele,
# reaproveite o <path> das letras que já está em brand/vcall-logo.svg.
# Rode da raiz do repositório: python brand/gerar-logo.py
import math
C = 256.0
R = 47.5
T = (163.6, 240.2); B = (249.8, 347.6)
TD = (2*C - T[0], T[1]); BD = (2*C - B[0], B[1])
CAB = 39.3; HE = (146.4, 154.0); HD = (2*C - HE[0], HE[1])

def f(v): return f"{v:.1f}".rstrip("0").rstrip(".")
def capsula(t, b, r=R):
    dx, dy = b[0]-t[0], b[1]-t[1]; L = math.hypot(dx, dy); ux, uy = dx/L, dy/L; nx, ny = -uy, ux
    p1 = (t[0]+nx*r, t[1]+ny*r); p2 = (b[0]+nx*r, b[1]+ny*r); p3 = (b[0]-nx*r, b[1]-ny*r); p4 = (t[0]-nx*r, t[1]-ny*r)
    return (f"M{f(p1[0])} {f(p1[1])}L{f(p2[0])} {f(p2[1])}A{f(r)} {f(r)} 0 0 0 {f(p3[0])} {f(p3[1])}"
            f"L{f(p4[0])} {f(p4[1])}A{f(r)} {f(r)} 0 0 0 {f(p1[0])} {f(p1[1])}Z")
def circulo(c, r):
    return f"M{f(c[0]-r)} {f(c[1])}A{f(r)} {f(r)} 0 1 1 {f(c[0]+r)} {f(c[1])}A{f(r)} {f(r)} 0 1 1 {f(c[0]-r)} {f(c[1])}Z"
ESQ, DIR = capsula(T, B), capsula(TD, BD)
CE, CD = circulo(HE, CAB), circulo(HD, CAB)

# gradientes (userSpace, coordenadas do quadro de 512)
G = {
 "rosa":   (T, B, [(0, "#fe5087"), (0.6, "#fe4d8f"), (1, "#e03c87")]),
 "laranja":(TD, BD, [(0, "#fe985b"), (1, "#ff875d")]),
 "dobra":  ((256, 262), (256, 395), [(0, "#ce307a", 0), (0.45, "#ce307a", 0.7), (1, "#a82058", 1)]),
 "cabecaR":((HE[0], HE[1]-CAB), (HE[0], HE[1]+CAB), [(0, "#fe5288"), (1, "#fe4c8a")]),
 "cabecaL":((HD[0], HD[1]-CAB), (HD[0], HD[1]+CAB), [(0, "#ffa75d"), (1, "#fe9b5d")]),
}
def svg_defs(p=""):
    out = []
    for k, (a, b, stops) in G.items():
        s = "".join(f'<stop offset="{st[0]}" stop-color="{st[1]}"' + (f' stop-opacity="{st[2]}"' if len(st) > 2 else "") + "/>" for st in stops)
        out.append(f'<linearGradient id="{p}{k}" gradientUnits="userSpaceOnUse" x1="{f(a[0])}" y1="{f(a[1])}" x2="{f(b[0])}" y2="{f(b[1])}">{s}</linearGradient>')
    out.append(f'<clipPath id="{p}corpoEsq"><path d="{ESQ}"/></clipPath>')
    return "".join(out)
def svg_simbolo(p=""):
    return (f'<path fill="url(#{p}rosa)" d="{ESQ}"/><path fill="url(#{p}laranja)" d="{DIR}"/>'
            f'<path fill="url(#{p}dobra)" clip-path="url(#{p}corpoEsq)" d="{DIR}"/>'
            f'<path fill="url(#{p}cabecaR)" d="{CE}"/><path fill="url(#{p}cabecaL)" d="{CD}"/>')
NOTA = ("<!-- Símbolo do Vcall em vetor: duas pessoas (cabeça + corpo de ponta redonda) formando o V. "
        "Geometria medida sobre public/assets/logo-mark.png (quadro de 512). -->")
X0, Y0, X1, Y1 = 107, 114, 405, 396
open("brand/vcall-simbolo.svg", "w", encoding="utf-8").write(
  f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{X0} {Y0} {X1-X0} {Y1-Y0}">{NOTA}<defs>{svg_defs()}</defs>{svg_simbolo()}</svg>\n')
open("brand/vcall-icone.svg", "w", encoding="utf-8").write(
  f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{NOTA}<defs>{svg_defs()}</defs>'
  f'<rect width="512" height="512" rx="115" fill="#12103b"/>{svg_simbolo()}</svg>\n')
# logo completa: símbolo encaixado onde ele fica no logo-wordmark.png + letras traçadas
letras = open("brag-output/work/wordmark-path.txt").read()
s = min((264-13)/(404.9-107.1), (262-24)/(395.1-114.7)); tx = 13 - 107.1*s; ty = 24 - 114.7*s
open("brand/vcall-logo.svg", "w", encoding="utf-8").write(
  f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 280">{NOTA}<defs>{svg_defs()}</defs>'
  f'<g transform="matrix({s:.4f} 0 0 {s:.4f} {tx:.2f} {ty:.2f})">{svg_simbolo()}</g>'
  f'<path fill="#110c3b" fill-rule="evenodd" d="{letras}"/></svg>\n')

# Android: VectorDrawable do primeiro plano do ícone adaptável (108dp, área segura de 66dp)
def vd_grad(k):
    a, b, stops = G[k]
    argb = lambda st: "#%02x%s" % (round(st[2] * 255), st[1][1:]) if len(st) > 2 else st[1]  # Android: #AARRGGBB
    itens = "".join(f'<item android:offset="{st[0]}" android:color="{argb(st)}"/>' for st in stops)
    return (f'<aapt:attr name="android:fillColor"><gradient android:type="linear" android:startX="{f(a[0])}" android:startY="{f(a[1])}" '
            f'android:endX="{f(b[0])}" android:endY="{f(b[1])}">{itens}</gradient></aapt:attr>')
def vd(cor_unica=None, escala=0.62):
    def path(d, k):
        if cor_unica: return f'<path android:fillColor="{cor_unica}" android:pathData="{d}"/>'
        return f'<path android:pathData="{d}">{vd_grad(k)}</path>'
    dobra = "" if cor_unica else f'<group><clip-path android:pathData="{ESQ}"/>{path(DIR, "dobra")}</group>'
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
      '<!-- Gerado a partir de brand/vcall-simbolo.svg (mesma geometria). -->\n'
      '<vector xmlns:android="http://schemas.android.com/apk/res/android" xmlns:aapt="http://schemas.android.com/aapt" '
      'android:width="108dp" android:height="108dp" android:viewportWidth="512" android:viewportHeight="512">'
      f'<group android:pivotX="256" android:pivotY="256" android:scaleX="{escala}" android:scaleY="{escala}" android:translateY="1">'
      f'{path(ESQ, "rosa")}{path(DIR, "laranja")}{dobra}{path(CE, "cabecaR")}{path(CD, "cabecaL")}</group></vector>\n')
open("android/app/src/main/res/drawable/ic_launcher_foreground.xml", "w", encoding="utf-8").write(vd())
open("android/app/src/main/res/drawable/ic_launcher_monochrome.xml", "w", encoding="utf-8").write(vd("#FFFFFFFF"))
print("ok", round(s, 4))
