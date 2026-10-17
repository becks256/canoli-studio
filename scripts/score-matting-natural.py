"""Local alpha-quality measurements; no official leaderboard compatibility claim.

All alpha values are normalized to [0,1]. Score only the official unknown mask.
Gradient = squared difference of Gaussian-derivative vector fields, sigma 1.4,
nearest-edge extension, scipy truncate=4, sum/1000. Connectivity independently
propagates thresholds 1,0.9,...,0 through prediction and reference from the largest
common exactly opaque component; phi=1-(alpha-level) when alpha-level>=0.15,
lambda=1, absolute phi differences sum/1000. No common opaque source => undefined.
These are explicitly defined local measures inspired by Rhemann et al. CVPR09;
they are not certified replacements for the website/MATLAB implementation.
"""
import argparse,json,unittest,hashlib
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile
from tempfile import TemporaryDirectory
import numpy as np
from scipy import ndimage
from PIL import Image

FOUR=ndimage.generate_binary_structure(2,1)

def reference_bytes(dataset,item,archive):
 truth=(dataset/item['truth']).read_bytes();labels=(dataset/item['trimap']).read_bytes();count=item['width']*item['height']
 if len(truth)!=count or len(labels)!=count or hashlib.sha256(truth).hexdigest()!=item['sha256']['groundTruthBytes']:raise ValueError('Reference alpha bytes changed.')
 encoded=archive.read(item['variant']+'/'+item['imageId']+'.png')
 if hashlib.sha256(encoded).hexdigest()!=item['sha256']['officialTrimapPng']:raise ValueError('Official trimap archive entry changed.')
 image=Image.open(BytesIO(encoded)).convert('L')
 if image.size!=(item['width'],item['height']) or image.tobytes()!=labels:raise ValueError('Prepared trimap labels differ from the pinned official archive.')
 return truth,labels

def measures(prediction,truth,trimap):
 if prediction.shape!=truth.shape or truth.shape!=trimap.shape or prediction.ndim!=2:raise ValueError('Quality arrays must share 2D native geometry.')
 if not np.isfinite(prediction).all() or not np.isfinite(truth).all() or min(prediction.min(),truth.min())<0 or max(prediction.max(),truth.max())>1:raise ValueError('Quality alpha must be finite and in [0,1].')
 if not np.isin(trimap,[0,128,255]).all():raise ValueError('Invalid trimap labels.')
 unknown=trimap==128;count=int(unknown.sum());difference=np.abs(prediction-truth);result={'unknownPixels':count,'knownLabelViolations':int(np.count_nonzero((~unknown)&(np.rint(prediction*255)!=trimap)))}
 result.update({'unknownMAE':float(difference[unknown].mean()) if count else None,'unknownMSE':float((difference[unknown]**2).mean()) if count else None,'unknownSADDiv1000':float(difference[unknown].sum()/1000)})
 gradient=0
 for order in [(1,0),(0,1)]:
  a=ndimage.gaussian_filter(prediction,1.4,order=order,mode='nearest',truncate=4);b=ndimage.gaussian_filter(truth,1.4,order=order,mode='nearest',truncate=4);gradient+=(a-b)**2
 result['gaussianVectorGradientDiv1000']=float(gradient[unknown].sum()/1000)
 components,n=ndimage.label((prediction==1)&(truth==1),FOUR)
 if not n:result.update({'seededConnectivityDiv1000':None,'connectivityReason':'No common exactly opaque source component'});return result
 sizes=np.bincount(components.ravel());sizes[0]=0;source=components==int(sizes.argmax())
 def levels(alpha):
  level=np.zeros(alpha.shape);assigned=np.zeros(alpha.shape,dtype=bool)
  for threshold in np.arange(10,-1,-1)/10:
   connected=ndimage.binary_propagation(source,structure=FOUR,mask=alpha>=threshold);new=connected&~assigned;level[new]=threshold;assigned|=connected
  return level
 def phi(alpha):
  distance=np.maximum(0,alpha-levels(alpha));return 1-np.where(distance>=.15,distance,0)
 result['seededConnectivityDiv1000']=float(np.abs(phi(prediction)-phi(truth))[unknown].sum()/1000)
 return result

class MetricsTests(unittest.TestCase):
 def test_identity_and_missing_unknowns(self):
  a=np.zeros((7,9));a[2:5,2:5]=1;a[3,5]=.5;t=np.full(a.shape,128);m=measures(a,a,t)
  self.assertEqual(m['unknownMSE'],0);self.assertEqual(m['gaussianVectorGradientDiv1000'],0);self.assertEqual(m['seededConnectivityDiv1000'],0)
  known=np.where(a>.5,255,0);self.assertIsNone(measures(a,a,known)['unknownMAE'])
 def test_known_values(self):
  a=np.array([[0.,.5,1.],[1.,.5,0.]]);b=a.copy();b[0,1]=.75;t=np.full(a.shape,128);m=measures(a,b,t)
  self.assertAlmostEqual(m['unknownMAE'],.25/6);self.assertAlmostEqual(m['unknownMSE'],.25**2/6);self.assertAlmostEqual(m['unknownSADDiv1000'],.25/1000)
 def test_topology_and_undefined(self):
  a=np.zeros((11,11));a[2:9,2:4]=1;a[5,4:9]=1;b=a.copy();b[5,5]=0;t=np.full(a.shape,128);m=measures(b,a,t)
  self.assertGreater(m['seededConnectivityDiv1000'],0);self.assertGreater(m['gaussianVectorGradientDiv1000'],0)
  self.assertIsNone(measures(a*.5,a*.5,t)['seededConnectivityDiv1000'])
 def test_invalid(self):
  with self.assertRaises(ValueError):measures(np.full((2,2),float('nan')),np.zeros((2,2)),np.full((2,2),128))
 def test_reference_provenance(self):
  with TemporaryDirectory() as folder:
   root=Path(folder);truth=bytes([0,128,255,0,255,128]);(root/'truth.bin').write_bytes(truth);(root/'labels.bin').write_bytes(truth);png=BytesIO();Image.frombytes('L',(3,2),truth).save(png,format='PNG');encoded=png.getvalue()
   with ZipFile(root/'trimap.zip','w') as archive:archive.writestr('Trimap1/GT01.png',encoded)
   item={'width':3,'height':2,'truth':'truth.bin','trimap':'labels.bin','variant':'Trimap1','imageId':'GT01','sha256':{'groundTruthBytes':hashlib.sha256(truth).hexdigest(),'officialTrimapPng':hashlib.sha256(encoded).hexdigest()}}
   with ZipFile(root/'trimap.zip') as archive:
    self.assertEqual(reference_bytes(root,item,archive),(truth,truth))
    (root/'labels.bin').write_bytes(bytes([255,128,255,0,255,128]))
    with self.assertRaisesRegex(ValueError,'trimap labels differ'):reference_bytes(root,item,archive)
    (root/'labels.bin').write_bytes(truth);(root/'truth.bin').write_bytes(bytes([0,127,255,0,255,128]))
    with self.assertRaisesRegex(ValueError,'alpha bytes changed'):reference_bytes(root,item,archive)

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--dataset',type=Path);parser.add_argument('--report',type=Path);parser.add_argument('--output',type=Path);parser.add_argument('--self-test',action='store_true');args=parser.parse_args()
 if args.self_test:
  result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(MetricsTests));raise SystemExit(not result.wasSuccessful())
 if not all([args.dataset,args.report,args.output]):parser.error('--dataset, --report and --output are required')
 manifest_bytes=(args.dataset/'manifest.json').read_bytes();manifest=json.loads(manifest_bytes);items={c['id']:c for c in manifest['cases']};report=json.loads(args.report.read_text())
 if hashlib.sha256(manifest_bytes).hexdigest()!=report['manifestSha256']:raise ValueError('Dataset manifest differs from the measured run.')
 archive_path=args.dataset/'trimap.zip';archive_hash=hashlib.sha256(archive_path.read_bytes()).hexdigest()
 if archive_hash!=manifest['archives']['trimap']['sha256'] or archive_path.stat().st_size!=manifest['archives']['trimap']['bytes']:raise ValueError('Official trimap archive differs from the pinned manifest.')
 with ZipFile(archive_path) as archive:
  for case in report['cases']:
   item=items[case['id']];shape=(item['height'],item['width']);truth_raw,labels_raw=reference_bytes(args.dataset,item,archive)
   if case['status']!='success':continue
   truth=np.frombuffer(truth_raw,dtype=np.uint8).reshape(shape)/255;labels=np.frombuffer(labels_raw,dtype=np.uint8).reshape(shape)
   for output in case['outputs']:
    raw=Path(output['path']).read_bytes()
    if hashlib.sha256(raw).hexdigest()!=output['sha256']:raise ValueError('Measured alpha output changed.')
    prediction=np.frombuffer(raw,dtype=np.uint8).reshape(shape)/255;output['quality']=measures(prediction,truth,labels)
 report['referenceValidation']={'trimapArchiveSha256':archive_hash,'casesChecked':len(report['cases']),'checks':['ground-truth alpha hash','official encoded trimap entry hash','exact prepared labels against independently decoded archive entry','output alpha hash'],'scorerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
 report['metricDefinition']=__doc__;report['summary']={'expectedCases':report['expectedCases'],'completedCases':len(report['cases']),'successes':sum(c['status']=='success' for c in report['cases']),'failures':[c['id'] for c in report['cases'] if c['status']!='success']}
 args.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['summary']))
if __name__=='__main__':main()
