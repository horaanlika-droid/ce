from PIL import Image, ImageChops, ImageFilter, ImageDraw
import math

ROOT='/home/user/ce'
REF_BOX=(430,100,948,478)

def bokeh(im, radius=16, edge=14, grow=13):
    gray=im.convert('L')
    sharp=(gray.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(5))
             .point(lambda p:255 if p>edge else 0)
             .filter(ImageFilter.MaxFilter(grow)).filter(ImageFilter.GaussianBlur(5)))
    return Image.composite(im, im.filter(ImageFilter.GaussianBlur(radius)), sharp)

def regrade(im, field, w=0.7, radius=55):
    low=im.filter(ImageFilter.GaussianBlur(radius))
    new_low=Image.blend(low, field, w)
    gain=ImageChops.subtract(new_low, low); loss=ImageChops.subtract(low, new_low)
    return ImageChops.subtract(ImageChops.add(im, gain), loss)

def field_blur(size, r=70):
    ref=Image.open(f'{ROOT}/IMG_1440.png').convert('RGB').crop(REF_BOX)
    return ref.filter(ImageFilter.GaussianBlur(r)).resize(size, Image.LANCZOS)

def field_profile(size, pool=0.30, cx=0.5, cy=0.40):
    """Вертикальный профиль яркости референса + мягкая лужа света за стеклом."""
    W,H=size
    ref=Image.open(f'{ROOT}/IMG_1440.png').convert('RGB').crop(REF_BOX)
    col=ref.resize((1,ref.height), Image.BOX)
    vals=[col.getpixel((0,y)) for y in range(col.height)]
    n=len(vals); k=max(1,int(n*0.12))
    sm=[]
    for i in range(n):
        a=max(0,i-k); b=min(n,i+k+1)
        sm.append(tuple(round(sum(vals[j][c] for j in range(a,b))/(b-a)) for c in range(3)))
    grad=Image.new('RGB',(1,n)); grad.putdata(sm)
    base=grad.resize((W,H), Image.BILINEAR)
    # радиальная прибавка — лужа света
    w4, h4 = W//4, H//4
    data = bytearray(w4*h4)
    for i in range(h4):
        dy = (i/h4-cy)*2.0*H/w4/4.0
        for j in range(w4):
            dx = (j/w4-cx)*2.0
            v = max(0.0, 1.0 - math.sqrt(dx*dx + dy*dy)/0.95)
            data[i*w4+j] = int(255 * (v ** 1.6) * pool * 3)
    rg = Image.frombytes('L', (w4, h4), bytes(data))
    rg=rg.resize((W,H), Image.BICUBIC).point(lambda p: min(255,p))
    add=Image.merge('RGB',[rg]*3)
    return ImageChops.add(base, add)

codes=['AG0001','AG0015','AG0027','AG0022']
variants={
 'master': lambda im,f1,f2: im,
 'bokeh16': lambda im,f1,f2: bokeh(im,16),
 'blur-field .7': lambda im,f1,f2: regrade(bokeh(im,16),f1,0.7),
 'profile .55': lambda im,f1,f2: regrade(bokeh(im,16),f2,0.55),
 'profile .8': lambda im,f1,f2: regrade(bokeh(im,16),f2,0.8),
}
th=430; tw=int(848/1264*th); cols=len(variants)
out=Image.new('RGB',(cols*(tw+8)+8, len(codes)*(th+20)+12),(10,12,18))
d=ImageDraw.Draw(out)
for j,c in enumerate(codes):
    im=Image.open(f'webapp/assets/products/st-{c}.jpg').convert('RGB')
    f1=field_blur(im.size); f2=field_profile(im.size)
    for i,(name,fn) in enumerate(variants.items()):
        v=fn(im,f1,f2).resize((tw,th), Image.LANCZOS)
        x=i*(tw+8)+8; y=j*(th+20)+20
        out.paste(v,(x,y))
        if j==0: d.text((x,6), name, fill=(150,200,255))
        if i==0: d.text((2,y+th//2), c, fill=(150,170,200))
out.save('.arena/bg_variants2.png'); print(out.size)
