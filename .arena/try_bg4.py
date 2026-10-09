from PIL import Image, ImageChops, ImageFilter, ImageDraw
ROOT='/home/user/ce'; REF_BOX=(430,100,948,478)
def sharp_mask(im, edge=14, grow=13):
    return (im.convert('L').filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(5))
            .point(lambda p:255 if p>edge else 0).filter(ImageFilter.MaxFilter(grow))
            .filter(ImageFilter.GaussianBlur(5)))
def bokeh(im, radius=10):
    return Image.composite(im, im.filter(ImageFilter.GaussianBlur(radius)), sharp_mask(im))
def field_blur(size, r=70):
    ref=Image.open(f'{ROOT}/IMG_1440.png').convert('RGB').crop(REF_BOX)
    return ref.filter(ImageFilter.GaussianBlur(r)).resize(size, Image.LANCZOS)
def regrade(im, field, w, radius=55):
    low=im.filter(ImageFilter.GaussianBlur(radius))
    new_low=Image.blend(low, field, w)
    gain=ImageChops.subtract(new_low, low); loss=ImageChops.subtract(low, new_low)
    return ImageChops.subtract(ImageChops.add(im, gain), loss)
V={'regrade .55': lambda im,f: regrade(im,f,0.55),
   'regrade .7 + bokeh10': lambda im,f: bokeh(regrade(im,f,0.7)),
   'bokeh10 + regrade .7': lambda im,f: regrade(bokeh(im),f,0.7),
   'regrade .85 + bokeh10': lambda im,f: bokeh(regrade(im,f,0.85))}
codes=['AG0001','AG0015','AG0027']
th=470; tw=int(848/1264*th)
out=Image.new('RGB',((len(V)+1)*(tw+8)+8, len(codes)*(th+20)+12),(10,12,18)); d=ImageDraw.Draw(out)
for j,c in enumerate(codes):
    im=Image.open(f'webapp/assets/products/st-{c}.jpg').convert('RGB'); f=field_blur(im.size)
    y=j*(th+20)+20
    out.paste(im.resize((tw,th),Image.LANCZOS),(8,y)); d.text((8,6),'MASTER',fill=(200,200,200))
    for i,(n,fn) in enumerate(V.items()):
        x=(i+1)*(tw+8)+8
        out.paste(fn(im,f).resize((tw,th),Image.LANCZOS),(x,y)); d.text((x,6),n,fill=(150,200,255))
    d.text((2,y+th//2),c,fill=(150,170,200))
out.save('.arena/bg_variants4.png'); print(out.size)
