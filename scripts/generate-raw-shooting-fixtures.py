"""Append independently authored EXIF IFDs to an unchanged synthetic sensor.

The original strip bytes, calibration and geometry stay intact. No application
decoder, metadata parser or native wrapper is imported.
"""
from pathlib import Path
import hashlib,json,struct,gzip,sys

root=Path(__file__).resolve().parents[1]
out=root/'tests/fixtures/raw-shooting';out.mkdir(exist_ok=True)
base=(root/'tests/fixtures/raw/bayer-rggb.dng').read_bytes()

def fixture(maker=b'Canoli Optics\0',invalid=False,nonfinite=False,sensor=base):
    data=bytearray(sensor)
    def append(body):
        if len(data)%2:data.append(0)
        offset=len(data);data.extend(body);return offset
    fields=[]
    def tag(code,kind,body,count):
        value=body.ljust(4,b'\0')if len(body)<=4 else struct.pack('<I',append(body))
        fields.append(struct.pack('<HHI',code,kind,count)+value)
    def rational(code,numerator,denominator):tag(code,5,struct.pack('<II',numerator,denominator),1)
    rational(33434,1 if not invalid else 0,125)
    rational(33437,56 if not invalid else 0,10)
    tag(34855,3,struct.pack('<H',400 if not invalid else 0),1)
    rational(37386,35 if not invalid else 0,1)
    tag(41989,3,struct.pack('<H',53 if not invalid else 0),1)
    if maker is not None:tag(42035,2,maker,len(maker))
    model=b'Canoli Reference 24-70mm F2.8\0';tag(42036,2,model,len(model))
    if nonfinite:
        fields[:]=[f for f in fields if struct.unpack_from('<H',f)[0]not in (33434,33437,37386)]
        for code,value in [(33434,-1.0),(33437,float('inf')),(37386,float('nan'))]:tag(code,11,struct.pack('<f',value),1)
    fields.sort(key=lambda value:struct.unpack_from('<H',value)[0])
    exif=append(struct.pack('<H',len(fields))+b''.join(fields)+struct.pack('<I',0))
    old=struct.unpack_from('<I',sensor,4)[0];count=struct.unpack_from('<H',sensor,old)[0]
    fields=[sensor[old+2+i*12:old+14+i*12]for i in range(count)]
    fields.append(struct.pack('<HHII',34665,4,1,exif));fields.sort(key=lambda value:struct.unpack_from('<H',value)[0])
    main=append(struct.pack('<H',len(fields))+b''.join(fields)+struct.pack('<I',0));struct.pack_into('<I',data,4,main)
    return bytes(data)

cases=[]
for name,settings in [('recorded',{}),('missing-maker',{'maker':None}),('invalid-numbers',{'invalid':True}),('nonfinite-numbers',{'nonfinite':True})]:
    body=fixture(**settings);(out/(name+'.dng')).write_bytes(body)
    cases.append({'file':name+'.dng','bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})
if '--large'in sys.argv:
    sensor=gzip.decompress((root/'tests/fixtures/raw/native-50mp.dng.gz').read_bytes());body=fixture(sensor=sensor)
    (out/'recorded-50mp.dng.gz').write_bytes(gzip.compress(body,mtime=0))
    cases.append({'file':'recorded-50mp.dng.gz','bytes':len(body),'sha256':hashlib.sha256(body).hexdigest(),'sensorBaseSha256':hashlib.sha256(sensor).hexdigest(),'width':10000,'height':5000})
(out/'manifest.json').write_text(json.dumps({'generator':'Independent EXIF IFD authoring over unchanged synthetic sensor strips','baseSha256':hashlib.sha256(base).hexdigest(),'cases':cases},indent=2)+'\n')
print(json.dumps(cases))
