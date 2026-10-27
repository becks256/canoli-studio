"""Build an independent native-host Little CMS reference from the same pin."""
from pathlib import Path
import argparse,subprocess,json,hashlib
p=argparse.ArgumentParser();p.add_argument('--lcms',type=Path,required=True);p.add_argument('--clang',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
revision=subprocess.check_output(['git','-C',str(a.lcms),'rev-parse','HEAD'],text=True).strip()
if revision!='21c582a594fe5279f90c0b93437c398f93bf62b0':raise SystemExit('Unexpected reference CMM source revision.')
if subprocess.check_output(['git','-C',str(a.lcms),'diff','--name-only'],text=True).strip():raise SystemExit('Reference source must be clean.')
command=[str(a.clang),'--target=x86_64-unknown-linux-gnu','-shared','-fPIC','-O2','-I',str(a.lcms/'include'),*[str(p)for p in sorted((a.lcms/'src').glob('*.c'))],'-lm','-o',str(a.output)]
subprocess.run(command,check=True);meta={'sourceRevision':revision,'compiler':subprocess.check_output([str(a.clang),'--version'],text=True).splitlines()[0],'command':command,'bytes':a.output.stat().st_size,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'boundary':'Independent native Linux CMM, without the Canoli wrapper; not a physical device calibration.'};a.output.with_suffix('.json').write_text(json.dumps(meta,indent=2)+'\n');print(json.dumps(meta))
