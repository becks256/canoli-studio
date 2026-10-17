"""Independent native-photo Laplacian/direct sparse solve (NumPy/SciPy only).

Builds batches of full clipped 3x3 window matrices from Levin et al. Eq12,
then eliminates hard trimap constraints and solves with SciPy SuperLU. No
production code is imported. Research photos/reference arrays remain outside repo.
"""
import argparse,json,time,hashlib
from pathlib import Path
import numpy as np
from scipy import ndimage,sparse
from scipy.sparse.linalg import spsolve

p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dataset',type=Path,required=True);p.add_argument('--case',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
manifest=json.loads((a.dataset/'manifest.json').read_text());case=next(c for c in manifest['cases'] if c['id']==a.case);h,w=case['height'],case['width'];source=np.fromfile(a.dataset/case['rgba'],dtype=np.uint8).reshape(h,w,4);trimap=np.fromfile(a.dataset/case['trimap'],dtype=np.uint8).reshape(h,w)
if not (source[:,:,3]==255).all():raise ValueError('This independent evaluator handles opaque photographed inputs.')
unknown=trimap==128;count=int(unknown.sum());mapping=np.full((h,w),-1,np.int32);mapping[unknown]=np.arange(count);centers=np.argwhere(ndimage.binary_dilation(unknown,structure=np.ones((3,3))))
rows=[];cols=[];values=[];rhs=np.zeros(count);began=time.perf_counter();offsets=np.array([(dy,dx) for dy in [-1,0,1] for dx in [-1,0,1]])
for start in range(0,len(centers),1024):
 batch=centers[start:start+1024];yy=batch[:,None,0]+offsets[None,:,0];xx=batch[:,None,1]+offsets[None,:,1];valid=(yy>=0)&(xx>=0)&(yy<h)&(xx<w);yy=np.clip(yy,0,h-1);xx=np.clip(xx,0,w-1);sizes=valid.sum(axis=1)
 rgb=source[yy,xx,:3].astype(float)/255;mean=(rgb*valid[:,:,None]).sum(axis=1)/sizes[:,None];centered=(rgb-mean[:,None,:])*valid[:,:,None];covariance=np.einsum('bik,bil->bkl',centered,centered)/sizes[:,None,None];inverse=np.linalg.inv(covariance+np.eye(3)[None,:,:]*1e-7/sizes[:,None,None]);local=np.eye(9)[None,:,:]*valid[:,:,None]-(valid[:,:,None]*valid[:,None,:]+np.einsum('bik,bkl,bjl->bij',centered,inverse,centered))/sizes[:,None,None]
 ids=mapping[yy,xx];ids[~valid]=-1;ri=np.broadcast_to(ids[:,:,None],local.shape);ci=np.broadcast_to(ids[:,None,:],local.shape);keep=(ri>=0)&(ci>=0);rows.append(ri[keep]);cols.append(ci[keep]);values.append(local[keep]);known=(trimap[yy,xx]==255)&valid;local_rhs=-(local*known[:,None,:]).sum(axis=2);active=ids>=0;np.add.at(rhs,ids[active],local_rhs[active])
matrix=sparse.coo_matrix((np.concatenate(values),(np.concatenate(rows),np.concatenate(cols))),shape=(count,count)).tocsr();assembly=time.perf_counter()-began;started=time.perf_counter();alpha=spsolve(matrix,rhs,permc_spec='COLAMD');seconds=time.perf_counter()-started;residual=float(np.linalg.norm(matrix@alpha-rhs)/max(1,np.linalg.norm(rhs)))
result=trimap.copy();result[unknown]=np.clip(np.floor(alpha*255+.5),0,255).astype(np.uint8);a.output.parent.mkdir(parents=True,exist_ok=True);result.tofile(a.output)
report={'case':case['id'],'width':w,'height':h,'unknownPixels':count,'nonzeroMatrixEntries':matrix.nnz,'assemblySeconds':assembly,'directSolveSeconds':seconds,'relativeResidual':residual,'alphaSha256':hashlib.sha256(result.tobytes()).hexdigest(),'inputHashes':case['sha256'],'method':'Independent NumPy full-window matrices, hard elimination, SciPy SuperLU COLAMD direct solve'};a.output.with_suffix('.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
