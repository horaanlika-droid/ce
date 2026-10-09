from PIL import Image, ImageChops, ImageFilter, ImageMath
import os

ROOT='/home/user/ce'
REF_BOX=(430,100,948,478)

def bokeh(im, radius=16, edge=14, grow=13):
    gray=im.convert('L')
    sharp=(gray.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(5))
             .point(lambda p:255 if p>edge else 0)
             .filter(ImageFilter.MaxFilter(grow)).filter(ImageFilter.GaussianBlur(5)))
    return Image.composite(im, im.filter(ImageFilter.GaussianBlur(radius)), sharp)

def field_for(size, radius=15):
    ref=Image.open(f'{ROOT}/IMG_1440.png').convert('RGB').crop(REF_BOX)
    ref=ref.filter(ImageFilter.GaussianBlur(radius)).resize(size, Image.LANCZOS)
    return ref

def regrade(im, field, w=0.8, radius=55):
    """im + (blend(low,field,w) - low), знако-точная сборка без потери теней стекла."""
    low=im.filter(ImageFilter.GaussianBlur(radius))
    new_low=Image.blend(low, field, w)
    gain=ImageChops.subtract(new_low, low)
    loss=ImageChops.subtract(low, new_low)
    return ImageChops.subtract(ImageChops.add(im, gain), loss)

codes=['AG0001','AG0015','AG0022','AG0027']
variants={
 'master': lambda im,f: im,
 'bokeh16': lambda im,f: bokeh(im,16),
 'regrade.8': lambda im,f: regrade(im,f,0.8),
 'bokeh+regrade.7': lambda im,f: regrade(bokeh(im,16),f,0.7),
 'bokeh+regrade.9': lambda im,f: regrade(bokeh(im,16),f,0.9),
}
th=440; tw=int(848/1264*th)
cols=len(variants)
out=Image.new('RGB',(cols*(tw+8)+8, len(codes)*(th+20)+12),(10,12,18))
from PIL import ImageDraw
d=ImageDraw.Draw(out)
for j,c in enumerate(codes):
    im=Image.open(f'webapp/assets/products/st-{c}.jpg').convert('RGB')
    f=field_for(im.size)
    for i,(name,fn) in enumerate(variants.items()):
        v=fn(im,f).resize((tw,th), Image.LANCZOS)
        x=i*(tw+8)+8; y=j*(th+20)+20
        out.paste(v,(x,y))
        if j==0: d.text((x,6), name, fill=(150,200,255))
        if i==0: d.text((2, y+th//2), c, fill=(150,170,200))
out.save('.arena/bg_variants.png'); print(out.size)
