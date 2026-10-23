import type {LensCorrectionData} from '../core/interchange/raw/lens';
import type {LensProfileSelectionData} from '../core/interchange/lens/schema';
import {Button,NumberField} from './controls';

/** Accepted calibration snapshots remain editable even without a local catalog. */
export function RawProfileSettings({lens,monochrome,disabled,onChange,onManual}:{lens:LensCorrectionData;monochrome:boolean;disabled:boolean;onChange(value:LensCorrectionData):void;onManual():void}){
  const profile=lens.profile!;
  const change=(patch:Partial<LensProfileSelectionData>)=>onChange({...lens,profile:{...profile,...patch}});
  const available=(kind:'distortion'|'chromatic'|'vignette')=>profile.definition.calibrations.some(set=>set[kind].some(point=>point.model!=='none'));
  return <>
    <p><strong>Calibrated profile: {profile.definition.maker} {profile.definition.model}</strong></p>
    {profile.definition.source&&<p>Database: {profile.definition.source.name}<br/>SHA-256: <code>{profile.definition.source.sha256}</code></p>}
    <p>The complete accepted calibration is retained with this image. Crop factor must come from calibrated camera geometry or your explicit measurement; 35 mm-equivalent focal length does not establish it.</p>
    <NumberField layout="stacked" label="Profile focal length" value={profile.focalLength} min={2**-149} max={3.4028234663852886e38} step="any" suffix="mm" disabled={disabled} onCommit={focalLength=>change({focalLength})}/>
    <NumberField layout="stacked" label="Profile camera crop factor" value={profile.cropFactor} min={2**-149} max={3.4028234663852886e38} step="any" disabled={disabled} onCommit={cropFactor=>change({cropFactor})}/>
    <NumberField layout="stacked" label="Profile aperture" value={profile.aperture??0} min={0} max={3.4028234663852886e38} step="any" disabled={disabled} onCommit={aperture=>change({aperture:aperture||null,...(!aperture?{vignette:false}:{})})}/>
    <p>Aperture 0 means unknown and disables vignette correction.</p>
    <NumberField layout="stacked" label="Profile focus distance" value={profile.focusDistance??0} min={0} max={3.4028234663852886e38} step="any" suffix="m" disabled={disabled} onCommit={focusDistance=>change({focusDistance:focusDistance||null})}/>
    <p>Focus distance 0 explicitly selects infinity.</p>
    {(['distortion','chromatic','vignette']as const).map(kind=><label className="check-field" key={kind}><input type="checkbox" checked={profile[kind]} disabled={disabled||!available(kind)||kind==='chromatic'&&monochrome||kind==='vignette'&&profile.aperture===null} onChange={event=>change({[kind]:event.target.checked})}/>{kind==='distortion'?'Profile distortion':kind==='chromatic'?'Profile chromatic correction':'Profile vignetting'}</label>)}
    <p>Calibration center: {profile.definition.center.x}, {profile.definition.center.y}. Native geometry validation runs before sensor development; incompatible or folded models reject without changing accepted pixels.</p>
    <Button disabled={disabled} onClick={onManual}>Switch to manual lens correction</Button>
  </>;
}
