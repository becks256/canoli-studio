"""Prepare public AlphaMatting training data for LOCAL evaluation, outside the repo.

Requires Pillow and NumPy. No image is uploaded or admitted to product assets.
Source/attribution: https://www.alphamatting.com/datasets.php
Rhemann et al., A Perceptually Motivated Online Benchmark for Image Matting, CVPR09.
The official hidden test set is not downloaded/submitted. IDs divisible by three
are reserved before tuning as a local holdout from the public training set.
"""
import argparse,hashlib,json,urllib.request
from pathlib import Path
from io import BytesIO
from zipfile import ZipFile
import numpy as np
from PIL import Image

ARCHIVES={
 'input':('78d403b0671424cd6e6a01b5489a4d26e53c40b1b9b98ea33f3ee02a09ccb5db',18218854),
 'trimap':('819a095689057c3747df5d18492b4ef42f13f2d8d58b18de1411938229a3f4b6',375510),
 'gt':('686d560ea2b6e920b97485a34b64c24657b049e751cf97b05c962ebd5f1f7569',2268429)}

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--cache',type=Path,required=True);parser.add_argument('--download',action='store_true');args=parser.parse_args();root=args.cache.resolve();root.mkdir(parents=True,exist_ok=True)
 repo=Path(__file__).resolve().parent.parent
 if root==repo or repo in root.parents:raise ValueError('Keep research images outside the repository; use /tmp or another local cache.')
 provenance={}
 for kind,(digest,size) in ARCHIVES.items():
  path=root/(kind+'.zip');url=f'https://tucloud.tuwien.ac.at/index.php/s/kbv8ZxuqehNk9vy/download?files={kind}_training_lowres.zip&path=%2FDatasets'
  if not path.exists():
   if not args.download:raise ValueError(f'Missing {path}; use --download for the public archive.')
   urllib.request.urlretrieve(url,path)
  actual=hashlib.sha256(path.read_bytes()).hexdigest()
  if actual!=digest or path.stat().st_size!=size:raise ValueError(f'{path} does not match the pinned official archive.')
  provenance[kind]={'url':url,'sha256':actual,'bytes':size}
 zips={kind:ZipFile(root/(kind+'.zip')) for kind in ARCHIVES};cases=[]
 for number in range(1,28):
  name=f'GT{number:02}.png';image=Image.open(BytesIO(zips['input'].read(name)));truth_image=Image.open(BytesIO(zips['gt'].read(name)))
  if image.info.get('icc_profile') or image.info.get('gamma') or image.info.get('chromaticity'):raise ValueError(f'Explicitly handle the input color profile before evaluation: {name}')
  rgba=np.asarray(image.convert('RGBA'));truth=np.asarray(truth_image.convert('RGB'))
  if not np.array_equal(truth[:,:,0],truth[:,:,1]) or not np.array_equal(truth[:,:,0],truth[:,:,2]):raise ValueError('Reference alpha channels disagree.')
  truth=truth[:,:,0];height,width=truth.shape
  if rgba.shape!=(height,width,4):raise ValueError('Reference/input geometry differs.')
  folder=root/name[:-4];folder.mkdir(exist_ok=True);original=zips['input'].read(name);(folder/'input.png').write_bytes(original);(folder/'rgba.bin').write_bytes(rgba.tobytes());(folder/'truth.bin').write_bytes(truth.tobytes())
  for variant in ['Trimap1','Trimap2']:
   encoded=zips['trimap'].read(variant+'/'+name);labels=np.asarray(Image.open(BytesIO(encoded)).convert('L'))
   if labels.shape!=(height,width) or not np.isin(labels,[0,128,255]).all():raise ValueError('Invalid trimap labels/geometry.')
   (folder/(variant+'.bin')).write_bytes(labels.tobytes());native=np.full((height,width,4),255,dtype=np.uint8);native[:,:,3]=labels;Image.fromarray(native,'RGBA').save(folder/(variant+'-alpha.png'))
   cases.append({'id':f'GT{number:02}-{variant}','imageId':name[:-4],'variant':variant,'split':'holdout' if number%3==0 else 'development','width':width,'height':height,'unknownPixels':int(np.count_nonzero(labels==128)),'input':f'{name[:-4]}/input.png','rgba':f'{name[:-4]}/rgba.bin','trimap':f'{name[:-4]}/{variant}.bin','trimapAsset':f'{name[:-4]}/{variant}-alpha.png','truth':f'{name[:-4]}/truth.bin','sha256':{'originalPng':hashlib.sha256(original).hexdigest(),'officialTrimapPng':hashlib.sha256(encoded).hexdigest(),'groundTruthBytes':hashlib.sha256(truth.tobytes()).hexdigest()}})
 manifest={'source':'https://www.alphamatting.com/datasets.php','citation':'Rhemann et al., A Perceptually Motivated Online Benchmark for Image Matting, CVPR 2009','scope':'Local evaluation on public training images, not official hidden-test rankings; no dataset images redistributed','splitRule':'Image IDs divisible by 3 are local holdout; the others are development, both public trimap variants stay in the same split','archives':provenance,'cases':cases}
 (root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'images':27,'cases':len(cases),'holdoutCases':sum(c['split']=='holdout' for c in cases),'manifest':str(root/'manifest.json')}))
if __name__=='__main__':main()
