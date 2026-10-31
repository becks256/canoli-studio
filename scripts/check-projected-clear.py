"""Independent projected-selection clear alpha, with float or byte compositing."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import numpy as np

spec=importlib.util.spec_from_file_location('forward',Path(__file__).with_name('generate-forward-projective-field-fixtures.py'))
forward=importlib.util.module_from_spec(spec)
spec.loader.exec_module(forward)
p=argparse.ArgumentParser()
p.add_argument('before',type=Path)
p.add_argument('after',type=Path)
p.add_argument('--case',type=Path,required=True)
p.add_argument('--source',type=Path,required=True)
p.add_argument('--byte',action='store_true')
a=p.parse_args()
case=json.loads(a.case.read_text())
field=case['field']
raw=np.frombuffer(a.source.read_bytes(),dtype='<f4').reshape(field['height'],field['width'])
coverage=forward.reference(raw,case).ravel()
if a.byte:coverage=(np.floor(coverage.astype(np.float64)*255+.5)/255).astype('<f4')
before=np.frombuffer(a.before.read_bytes(),dtype='<f4').reshape(-1,4)
actual=np.frombuffer(a.after.read_bytes(),dtype='<f4').reshape(-1,4)
expected=before.copy()
expected[:,3]=(before[:,3].astype(np.float64)*coverage.astype(np.float64)).astype('<f4')
expected[expected[:,3]==0]=0
error=float(np.abs(actual[:,3].astype(np.float64)-expected[:,3].astype(np.float64)).max())
assert error<=2**-21,error
nonzero=actual[:,3]>0
rgb=int(np.count_nonzero(actual[nonzero,:3].view('<u4')!=before[nonzero,:3].view('<u4')))
assert rgb==0,rgb
reduced=int(np.count_nonzero(actual[:,3]<before[:,3]))
assert reduced>0
print(json.dumps({'samplesCompared':int(actual.size),'maximumAlphaError':error,'retainedRgbWordDifferences':rgb,'reducedAlphaSamples':reduced,'byteCompositing':a.byte,'actualSha256':hashlib.sha256(actual.tobytes()).hexdigest(),'referenceSha256':hashlib.sha256(expected.tobytes()).hexdigest(),'reference':'Independent NumPy forward homography over original byte selection coverage, followed by original alpha multiplication.'}))
