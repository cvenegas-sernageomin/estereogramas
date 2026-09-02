# -*- coding: utf-8 -*-
"""Iconos de la PWA Estereogramas.

El icono muestra lo que la app calcula: dos grandes círculos (los limbos de un
pliegue) y, en su intersección exacta, el eje de pliegue. Sin malla regular de
meridianos/paralelos, que es lo que hacía que se leyera como un globo terráqueo.

La geometría usa la misma proyección equiareal de Schmidt que la app; el punto
rojo se calcula con el producto cruz de las normales, no se coloca a ojo.

Se renderiza a 4x y se reduce con LANCZOS porque PIL no antialiasa líneas.
Uso:  python gen_icons.py <carpeta-destino>
"""
import math
from PIL import Image, ImageDraw

BG   = (19, 41, 61)      # #13293D  fondo (theme_color)
DISC = (245, 248, 251)   # disco
EDGE = (56, 78, 102)     # círculo primitivo
BLUE = (31, 111, 178)    # #1F6FB2  limbo 1
TEAL = (46, 139, 122)    # #2E8B7A  limbo 2
RED  = (178, 58, 58)     # #B23A3A  eje de pliegue

# Los dos limbos que se dibujan (dip direction, manteo)
LIMB1 = (115.0, 40.0)
LIMB2 = (250.0, 55.0)

def dd_dip_to_normal(dd, dip):
    """Polo real del plano: trend = dd+180, plunge = 90-manteo (x=este, y=norte, z=abajo)."""
    ddr, dr = math.radians(dd), math.radians(dip)
    return (-math.sin(dr)*math.sin(ddr), -math.sin(dr)*math.cos(ddr), math.cos(dr))

def equal_area(trend, plunge):
    tr, pl = math.radians(trend), math.radians(plunge)
    l = math.cos(pl)*math.sin(tr); m = math.cos(pl)*math.cos(tr); n = -math.sin(pl)
    if n > 0: l, m, n = -l, -m, -n
    if n <= -1.0: return (0.0, 0.0)
    f = 1.0 / math.sqrt(1.0 - n)
    return (l*f, m*f)

def great_circle(dd, dip, n_pts=700):
    ddr, dr = math.radians(dd), math.radians(dip)
    strike = math.radians((dd - 90) % 360)
    s = (math.sin(strike), math.cos(strike), 0.0)
    vd = (math.sin(ddr)*math.cos(dr), math.cos(ddr)*math.cos(dr), math.sin(dr))
    out = []
    for i in range(n_pts + 1):
        phi = math.pi * i / n_pts
        v = [math.cos(phi)*s[k] + math.sin(phi)*vd[k] for k in range(3)]
        if v[2] < 0: v = [-c for c in v]
        t = math.degrees(math.atan2(v[0], v[1])) % 360
        p = math.degrees(math.asin(max(-1.0, min(1.0, v[2]))))
        out.append(equal_area(t, p))
    return out

def fold_axis(l1, l2):
    """Eje de pliegue = intersección de los dos limbos (producto cruz normalizado)."""
    a, b = dd_dip_to_normal(*l1), dd_dip_to_normal(*l2)
    c = (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])
    n = math.sqrt(sum(k*k for k in c))
    x, y, z = (k/n for k in c)
    if z < 0: x, y, z = -x, -y, -z
    trend = math.degrees(math.atan2(x, y)) % 360
    plunge = math.degrees(math.asin(max(-1.0, min(1.0, z))))
    return equal_area(trend, plunge)

def render(size, ss=4):
    S = size * ss
    img = Image.new("RGB", (S, S), BG)
    d = ImageDraw.Draw(img)
    # 76% del lienzo: deja el contenido dentro de la zona segura del recorte
    # "maskable" de Android (círculo interior del 80%).
    R = S * 0.76 / 2.0
    c = S / 2.0
    px = lambda p: (c + p[0]*R, c - p[1]*R)     # y invertido: norte arriba

    d.ellipse([c-R, c-R, c+R, c+R], fill=DISC)

    # Los trazos van en una capa aparte recortada al disco: PIL deja bordes
    # dentados con líneas gruesas, así que se dibujan como círculos superpuestos.
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    br = S * 0.019
    for limb, color in ((LIMB1, BLUE), (LIMB2, TEAL)):
        for p in great_circle(*limb):
            x, y = px(p)
            ld.ellipse([x-br, y-br, x+br, y+br], fill=color)
    # Eje de pliegue en la intersección, con halo claro para que no se funda
    # con los arcos que cruza justo debajo.
    ax, ay = px(fold_axis(LIMB1, LIMB2))
    hr = S * 0.052
    ld.ellipse([ax-hr, ay-hr, ax+hr, ay+hr], fill=DISC + (255,))
    pr = S * 0.038
    ld.ellipse([ax-pr, ay-pr, ax+pr, ay+pr], fill=RED)

    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse([c-R, c-R, c+R, c+R], fill=255)
    img.paste(layer, (0, 0), Image.composite(layer.split()[3], mask, mask))

    d.ellipse([c-R, c-R, c+R, c+R], outline=EDGE, width=max(2, int(S*0.016)))
    return img.resize((size, size), Image.LANCZOS)

# El mismo archivo sirve como "maskable": el fondo es a sangre y el disco (76%)
# ya cabe dentro del círculo interior del 80% que respeta el recorte de Android.

if __name__ == "__main__":
    import sys
    out = sys.argv[1].rstrip("\\/")
    for name, size in [("icon-512.png", 512), ("icon-192.png", 192),
                       ("apple-touch-icon.png", 180)]:
        render(size).save(f"{out}/{name}", "PNG", optimize=True)
        print(f"OK  {name}  {size}x{size}")
    # Hoja de control: el icono a los tamaños en que se usa de verdad
    sheet = Image.new("RGB", (430, 150), (255, 255, 255))
    x = 10
    for s in (128, 72, 48, 24, 16):
        sheet.paste(render(s), (x, 10))
        x += s + 12
    sheet.save(f"{out}/tamanos.png")
    print("OK  tamanos.png")
