from PIL import Image, ImageChops, ImageFilter, ImageDraw
ROOT='/home/user/ce'; REF_BOX=(430,100,948,478)

def sharp_mask(im, edge=14, grow=13, close=0, feather=5):
    m=(im.convert('L').filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(5))
        .point(lambda p:255 if p>edge else 0).filter(ImageFilter.MaxFilter(grow)))
    if close: m=m.filter(ImageFilter.MaxFilter(close)).filter(ImageFilter.MinFilter(close))
    return m.filter(ImageFilter.GaussianBlur(feather))

def bokeh(im, radius=16, edge=14):
    return Image.composite(im, im.filter(ImageFilter.GaussianBlur(radius)), sharp_mask(im, edge, 13))

def field_blur(size, r=70):
    ref=Image.open(f'{ROOT}/IMG_1440.png').convert('RGB').crop(REF_BOX)
    return ref.filter(ImageFilter.GaussianBlur(r)).resize(size, Image.LANCZOS)

def regrade(im, field, w=0.7, radius=55, protect=None):
    low=im.filter(ImageFilter.GaussianBlur(radius))
    new_low=Image.blend(low, field, w)
    gain=ImageChops.subtract(new_low, low); loss=ImageChops.subtract(low, new_low)
    if protect is not None:
        gain=ImageChops.multiply(gain, Image.merge('RGB',[protect]*3))
        loss=ImageChops.multiply(loss, Image.merge('RGB',[protect]*3))
    return ImageChops.subtract(ImageChops.add(im, gain), loss)

V={
 'A: field .6': lambda im,f: regrade(im,f,0.6),
 'B: field .8 + protect': lambda im,f: regrade(bokeh(im,16),f,0.8,protect=255-0 if False else (255-im.convert('L').point(lambda p:0)) and None) if False else regrade(bokeh(im,16),f,0.8,protect=ImageChops.invert(sharp_mask(im,14,13,25,7))),
 'C: field .95 + protect': lambda im,f: regrade(bokeh(im,16),f,0.95,protect=ImageChops.invert(sharp_mask(im,14,13,25,7))),
 'D: bokeh only': lambda im,f: bokeh(im,16),
}
codes=['AG0001','AG0015','AG0027','AG0020']
th=430; tw=int(848/1264*th)
out=Image.new('RGB',((len(V)+1)*(tw+8)+8, len(codes)*(th+20)+12),(10,12,18))
d=ImageDraw.Draw(out)
for j,c in enumerate(codes):
    im=Image.open(f'webapp/assets/products/st-{c}.jpg').convert('RGB'); f=field_blur(im.size)
    x=8; y=j*(th+20)+20
    out.paste(im.resize((tw,th),Image.LANCZOS),(x,y))
    if j==0: d.text((x,6),'MASTER',fill=(200,200,200))
    for i,(name,fn) in enumerate(V.items()):
        out.paste(fn(im,f).resize((tw,th),Image.LANCZOS),((i+1)*(tw+8)+8,y))
        if j==0: d.text(((i+1)*(tw+8)+8,6),name,fill=(150,200,255))
        if i==0: pass
    d.text((2,y+th//2),c,fill=(150,170,200))
out.save('.arena/bg_variants3.png'); print(out.size)
